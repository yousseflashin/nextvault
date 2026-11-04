/**
 * NexVault Grid - Trusted Device Network (WebRTC)
 * 
 * Handles secure peer-to-peer communication between trusted devices.
 * Uses WebRTC data channels with end-to-end encryption via tweetnacl.
 * 
 * The proxy (NexVault Relay) is used only for connection discovery and
 * NAT traversal - it never sees decrypted data.
 */

const { NexVaultCrypto, nacl, naclUtil } = require('./crypto');
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
    this.remotePeerKeys = new Map();
    this.connectedRelayPeers = new Map();
    this.relayUrl = options.relayUrl || process.env.NEXVAULT_RELAY_URL || 'ws://127.0.0.1:46123';
    this.relaySocket = null;
    this.deviceId = null;
  }

  /**
   * Create a new peer connection
   */
  createPeerConnection(peerId, isInitiator = true) {
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('WebRTC (RTCPeerConnection) is not available in this environment');
    }
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
        if (decrypted && decrypted.type === 'vault-sync') {
          this.emit('vault-sync-received', peerId, decrypted.vaultData);
        }
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
    
    // 1. If WebRTC data channel is open, send via WebRTC
    if (peer && peer.dataChannel && peer.dataChannel.readyState === 'open') {
      const encrypted = this.encryptMessage(message, peerId);
      peer.dataChannel.send(JSON.stringify({
        type: 'encrypted',
        payload: encrypted
      }));
      return;
    }

    // 2. Relay-tunneled E2E encrypted message
    if (this.relaySocket && this.relaySocket.readyState === WebSocket.OPEN) {
      const remotePublicKey = peer?.remotePublicKey || this.remotePeerKeys?.get(peerId);
      if (remotePublicKey) {
        const encrypted = NexVaultCrypto.encrypt(JSON.stringify(message), remotePublicKey);
        this.sendRelaySignal(peerId, {
          type: 'encrypted',
          payload: encrypted
        });
      } else {
        this.sendRelaySignal(peerId, message);
      }
      return;
    }

    throw new Error(`Peer ${peerId} is not connected via WebRTC or Relay`);
  }

  /**
   * Synchronize vault data securely with a peer
   */
  syncVault(peerId, vaultData) {
    this.sendSecureMessage(peerId, {
      type: 'vault-sync',
      vaultData,
      timestamp: Date.now()
    });
  }

  setPeerPublicKey(peerId, publicKey) {
    if (!this.remotePeerKeys) this.remotePeerKeys = new Map();
    this.remotePeerKeys.set(peerId, publicKey);
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.remotePublicKey = publicKey;
    }
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
    this.token = token;
    this.deviceId = token.devicePublicKey || token.deviceId || token.publicKey;
    
    // Ensure local X25519 keypair exists for this device connection
    if (!this.localKeyPairs.has(this.deviceId)) {
      this.localKeyPairs.set(this.deviceId, NexVaultCrypto.generateKeyPair());
    }

    if (this.relaySocket && this.relaySocket.readyState === WebSocket.OPEN) {
      return this.requestPeerList(token);
    }

    return new Promise((resolve) => {
      const socket = new WebSocket(this.relayUrl);
      const timeout = setTimeout(() => {
        socket.close();
        resolve([]);
      }, 3000);
      socket.once('open', () => {
        this.relaySocket = socket;
        const myX25519Key = this.localKeyPairs.get(this.deviceId).publicKey;
        socket.send(JSON.stringify({
          type: 'device-auth',
          token,
          deviceId: this.deviceId,
          publicKey: myX25519Key,
          deviceName: this.deviceName || 'NexVault Desktop'
        }));
      });
      socket.on('message', (raw) => {
        try {
          const message = JSON.parse(raw.toString());
          if (message.type === 'peer-list') {
            clearTimeout(timeout);
            const peers = message.peers || [];
            this.connectedRelayPeers.clear();
            peers.forEach(p => {
              if (p.publicKey) this.setPeerPublicKey(p.deviceId, p.publicKey);
              this.connectedRelayPeers.set(p.deviceId, p);
            });
            resolve(peers);
            this.emit('peer-list', peers);
          } else if (message.type === 'peer-joined') {
            if (message.peer?.publicKey) {
              this.setPeerPublicKey(message.peer.deviceId, message.peer.publicKey);
            }
            if (message.peer?.deviceId) {
              this.connectedRelayPeers.set(message.peer.deviceId, message.peer);
            }
            this.emit('peer-joined', message.peer);
          } else if (message.type === 'peer-left') {
            if (message.deviceId) {
              this.connectedRelayPeers.delete(message.deviceId);
            }
            this.handlePeerDisconnect(message.deviceId);
          } else if (message.type === 'signal') {
            if (message.from && !this.connectedRelayPeers.has(message.from)) {
              this.connectedRelayPeers.set(message.from, { deviceId: message.from });
            }
            this.handleIncomingSignal(message.from, message.payload);
          }
        } catch (err) {
          console.error('[NexGrid] Error parsing relay message:', err);
        }
      });
      socket.once('error', () => {
        clearTimeout(timeout);
        this.relaySocket = null;
        resolve([]);
      });
      socket.once('close', () => {
        this.relaySocket = null;
        this.connectedRelayPeers.clear();
        this.emit('relay-disconnected');
      });
    });
  }

  handleIncomingSignal(fromPeerId, payload) {
    if (!payload || typeof payload !== 'object') return;

    // WebRTC signaling
    if (payload.type === 'offer' || payload.type === 'answer' || payload.type === 'ice-candidate') {
      this.handleSignalingMessage(fromPeerId, payload).catch((error) => {
        this.emit('signaling-error', fromPeerId, error);
      });
      return;
    }

    // Direct encrypted tunnel via relay
    if (payload.type === 'encrypted') {
      try {
        const localKeyPair = this.localKeyPairs.get(this.deviceId);
        if (localKeyPair) {
          const decrypted = JSON.parse(NexVaultCrypto.decrypt(payload.payload, localKeyPair.secretKey));
          if (decrypted && decrypted.type === 'vault-sync') {
            this.emit('vault-sync-received', fromPeerId, decrypted.vaultData);
          } else if (decrypted && decrypted.type === 'vault-sync-request') {
            this.emit('vault-sync-requested', fromPeerId, decrypted);
          } else if (decrypted && decrypted.type === 'credential-deleted') {
            this.emit('credential-deleted', fromPeerId, decrypted);
          } else if (decrypted && decrypted.type === 'extension-approval-request') {
            this.emit('extension-approval-request', fromPeerId, decrypted);
          } else if (decrypted && (decrypted.type === 'extension-approval-response' || decrypted.type === 'extension-approval')) {
            this.emit('extension-approval-response', fromPeerId, decrypted);
          }
          this.emit('secure-message', fromPeerId, decrypted);
          this.emit('message', fromPeerId, decrypted);
          return;
        }
      } catch (err) {
        console.error('[NexGrid] Failed to decrypt relay signal:', err);
      }
    }

    // Structured pairing and sync protocol
    if (payload.type === 'pair-request') {
      if (payload.publicKey) this.setPeerPublicKey(fromPeerId, payload.publicKey);
      this.emit('pair-request', {
        from: fromPeerId,
        deviceName: payload.deviceName || payload.fromDeviceName || 'NexVault Device',
        publicKey: payload.publicKey,
        code: payload.code,
        timestamp: payload.timestamp || Date.now()
      });
    } else if (payload.type === 'pair-approved') {
      if (payload.publicKey) this.setPeerPublicKey(fromPeerId, payload.publicKey);
      this.emit('pair-approved', {
        from: fromPeerId,
        deviceName: payload.deviceName || payload.fromDeviceName || 'NexVault Device',
        publicKey: payload.publicKey
      });
    } else if (payload.type === 'pair-rejected') {
      this.emit('pair-rejected', {
        from: fromPeerId,
        reason: payload.reason || 'Pairing rejected'
      });
    } else if (payload.type === 'vault-sync') {
      this.emit('vault-sync-received', fromPeerId, payload.vaultData);
    } else if (payload.type === 'vault-sync-request') {
      this.emit('vault-sync-requested', fromPeerId, payload);
    } else if (payload.type === 'credential-deleted') {
      this.emit('credential-deleted', fromPeerId, payload);
      this.emit('secure-message', fromPeerId, payload);
      this.emit('message', fromPeerId, payload);
    } else if (payload.type === 'extension-approval-request') {
      this.emit('extension-approval-request', fromPeerId, payload);
      this.emit('message', fromPeerId, payload);
    } else if (payload.type === 'extension-approval-response' || payload.type === 'extension-approval') {
      this.emit('extension-approval-response', fromPeerId, payload);
      this.emit('message', fromPeerId, payload);
    } else {
      this.emit('message', fromPeerId, payload);
    }
  }

  broadcastSecureMessage(message) {
    if (!this.connectedRelayPeers || this.connectedRelayPeers.size === 0) {
      return 0;
    }
    let count = 0;
    for (const peerId of this.connectedRelayPeers.keys()) {
      try {
        this.sendSecureMessage(peerId, message);
        count++;
      } catch (err) {
        console.warn(`[NexGrid] Failed to send secure message to ${peerId}:`, err.message);
      }
    }
    return count;
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