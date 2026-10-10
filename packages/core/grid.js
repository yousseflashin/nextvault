/**
 * NexVault Grid - Trusted Device Network (WebRTC)
 * 
 * Handles secure peer-to-peer communication between trusted devices.
 * Uses WebRTC data channels with end-to-end encryption via tweetnacl.
 * 
 * The proxy (NexVault Relay) is used only for connection discovery and
 * NAT traversal - it never sees decrypted data.
 */

const { NexVaultCrypto, nacl, naclUtil } = require('../core/crypto');
const EventEmitter = require('events');
const WebSocket = require('ws');

// STUN/TURN servers for NAT traversal
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // TURN servers would be added here in production
];

class NexGrid extends EventEmitter {
  constructor(options = {}) {
    super();
    this.peers = new Map();
    this.localKeyPairs = new Map();
    this.signalChannels = new Map();
    this.relayUrl = options.relayUrl || process.env.NEXVAULT_RELAY_URL || 'ws://127.0.0.1:46123';
    this.relaySocket = null;
    this.deviceId = null;
  }

  /**
   * Create a new peer connection
   */
  createPeerConnection(peerId, isInitiator = true) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    
    // Generate key pair for this connection
    const keyPair = NexVaultCrypto.generateKeyPair();
    this.localKeyPairs.set(peerId, keyPair);
    
    // Create data channel
    const dataChannel = pc.createDataChannel('nexvault-grid', {
      ordered: true,
      maxRetransmits: 3
    });
    
    this.setupDataChannel(dataChannel, peerId);
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.emit('ice-candidate', peerId, event.candidate);
      }
    };
    
    // Handle incoming data channels
    pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel, peerId);
    };
    
    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.emit('peer-connected', peerId);
      } else if (pc.connectionState === 'disconnected') {
        this.handlePeerDisconnect(peerId);
      }
    };
    
    // Handle negotiation needed
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
      } catch (err) {
        console.error('Negotiation error:', err);
      }
    };
    
    this.peers.set(peerId, { pc, keyPair, dataChannel, remotePublicKey: null });
    return { peerId, pc, keyPair, isInitiator };
  }

  /**
   * Set up a data channel for encrypted communication
   */
  setupDataChannel(dataChannel, peerId) {
    dataChannel.binaryType = 'arraybuffer';
    
    dataChannel.onopen = () => {
      console.log(`Data channel opened for peer: ${peerId}`);
      this.emit('data-channel-open', peerId);
    };
    
    dataChannel.onmessage = (event) => {
      this.handleMessage(event.data, peerId);
    };
    
    dataChannel.onclose = () => {
      console.log(`Data channel closed for peer: ${peerId}`);
      this.emit('data-channel-closed', peerId);
    };
  }

  /**
   * Handle incoming encrypted messages
   */
  handleMessage(data, peerId) {
    try {
      const message = typeof data === 'string' ? JSON.parse(data) : data;
      
      // Decrypt message if it's encrypted
      if (message.type === 'encrypted') {
        const decrypted = this.decryptMessage(message.payload, peerId);
        this.emit('secure-message', peerId, decrypted);
      } else {
        this.emit('message', peerId, message);
      }
    } catch (err) {
      console.error('Message handling error:', err);
    }
  }

  /**
   * Send an encrypted message to a peer
   */
  sendSecureMessage(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.dataChannel) {
      throw new Error(`Peer ${peerId} not connected`);
    }
    
    const encrypted = this.encryptMessage(message, peerId);
    peer.dataChannel.send(JSON.stringify({
      type: 'encrypted',
      payload: encrypted
    }));
  }

  setPeerPublicKey(peerId, publicKey) {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error(`Peer ${peerId} not found`);
    peer.remotePublicKey = publicKey;
  }

  /**
   * Send plaintext message (for signaling)
   */
  sendSignalingMessage(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.dataChannel) {
      throw new Error(`Peer ${peerId} not connected`);
    }
    
    peer.dataChannel.send(JSON.stringify(message));
  }

  /**
   * Encrypt a message using the peer's public key
   */
  encryptMessage(message, peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error(`Peer ${peerId} not found`);
    
    const messageStr = JSON.stringify(message);
    if (!peer.remotePublicKey) {
      throw new Error(`Peer ${peerId} has not completed key exchange`);
    }
    return NexVaultCrypto.encrypt(messageStr, peer.remotePublicKey);
  }

  /**
   * Decrypt a message using local secret key
   */
  decryptMessage(encrypted, peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error(`Peer ${peerId} not found`);
    
    const decrypted = NexVaultCrypto.decrypt(encrypted, peer.keyPair.secretKey);
    return JSON.parse(decrypted);
  }

  /**
   * Handle ICE signaling
   */
  async handleSignalingMessage(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    
    const { pc } = peer;
    
    switch (message.type) {
      case 'offer':
        await pc.setRemoteDescription(message.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.emit('answer-created', peerId, answer);
        break;
      
      case 'answer':
        await pc.setRemoteDescription(message.answer);
        break;
      
      case 'ice-candidate':
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        break;
    }
  }

  /**
   * Handle peer disconnection
   */
  handlePeerDisconnect(peerId) {
    console.log(`Peer ${peerId} disconnected`);
    this.emit('peer-disconnected', peerId);
    
    // Clean up
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.pc.close();
      this.peers.delete(peerId);
      this.localKeyPairs.delete(peerId);
    }
  }

  /**
   * Discover peers via the proxy (NexVault Relay)
   * The proxy only facilitates discovery - no data passes through it
   */
  async discoverPeers(token) {
    if (!token || !token.tokenId) throw new Error('Token is required for discovery');
    this.deviceId = token.publicKey;
    if (this.relaySocket && this.relaySocket.readyState === WebSocket.OPEN) {
      return this.requestPeerList(token);
    }

    return new Promise((resolve) => {
      const socket = new WebSocket(this.relayUrl);
      const timeout = setTimeout(() => {
        socket.close();
        resolve([]);
      }, 1500);
      socket.once('open', () => {
        this.relaySocket = socket;
        socket.send(JSON.stringify({
          type: 'device-auth',
          token,
          deviceId: this.deviceId,
          publicKey: this.localKeyPairs.get(this.deviceId)?.publicKey || token.publicKey
        }));
      });
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'peer-list') {
          clearTimeout(timeout);
          resolve(message.peers || []);
        } else if (message.type === 'signal') {
          this.handleSignalingMessage(message.from, message.payload).catch((error) => {
            this.emit('signaling-error', message.from, error);
          });
        }
      });
      socket.once('error', () => {
        clearTimeout(timeout);
        resolve([]);
      });
      socket.once('close', () => this.emit('relay-disconnected'));
    });
  }

  requestPeerList(token) {
    return new Promise((resolve) => {
      const listener = (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type !== 'peer-list') return;
        this.relaySocket.off('message', listener);
        resolve(message.peers || []);
      };
      this.relaySocket.on('message', listener);
      this.relaySocket.send(JSON.stringify({ type: 'peer-discover', tokenId: token.tokenId }));
    });
  }

  sendRelaySignal(peerId, payload) {
    if (!this.relaySocket || this.relaySocket.readyState !== WebSocket.OPEN) {
      throw new Error('Relay is not connected');
    }
    this.relaySocket.send(JSON.stringify({ type: 'signal', to: peerId, payload }));
  }

  /**
   * Connect to a peer
   */
  async connectToPeer(peerId) {
    const { pc, keyPair } = this.createPeerConnection(peerId, true);
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    return { peerId, offer, publicKey: keyPair.publicKey };
  }

  /**
   * Accept connection from a peer
   */
  async acceptConnection(peerId) {
    const { pc, keyPair } = this.createPeerConnection(peerId, false);
    return { peerId, publicKey: keyPair.publicKey };
  }

  /**
   * Close all connections
   */
  closeAll() {
    for (const [peerId, peer] of this.peers) {
      peer.pc.close();
    }
    this.peers.clear();
    this.localKeyPairs.clear();
  }
}

module.exports = NexGrid;