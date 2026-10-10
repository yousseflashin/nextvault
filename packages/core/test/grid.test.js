jest.mock('electron-store', () => {
  return jest.fn().mockImplementation(() => {
    return {
      data: {},
      get: jest.fn((key) => {}),
      set: jest.fn((key, value) => {}),
      delete: jest.fn((key) => {}),
      clear: jest.fn(() => {})
    };
  });
});

// Mock WebRTC APIs
global.RTCPeerConnection = class MockRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.iceCandidates = [];
    this.dataChannels = [];
    this.connectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.onicecandidate = null;
    this.ondatachannel = null;
    this.onconnectionstatechange = null;
    this.onnegotiationneeded = null;
  }

  async createOffer() {
    return { type: 'offer', sdp: 'mock-offer-sdp-' + Math.random() };
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'mock-answer-sdp-' + Math.random() };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
  }

  async addIceCandidate(candidate) {
    this.iceCandidates.push(candidate);
  }

  createDataChannel(label, options) {
    const channel = new MockRTCDataChannel(label);
    this.dataChannels.push(channel);
    return channel;
  }

  close() {
    this.connectionState = 'closed';
  }
};

class MockRTCDataChannel {
  constructor(label) {
    this.label = label;
    this.binaryType = 'blob';
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
  }

  send(data) {
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }

  close() {
    if (this.onclose) this.onclose();
  }
}

global.RTCIceCandidate = class MockRTCIceCandidate {
  constructor(candidate) {
    this.candidate = candidate.candidate;
    this.sdpMid = candidate.sdpMid;
    this.sdpMLineIndex = candidate.sdpMLineIndex;
  }
};

const NexVaultCrypto = require('@nexvault/core/crypto').NexVaultCrypto;
const NexGrid = require('@nexvault/core/grid');

describe('NexGrid', () => {
  let grid;

  beforeEach(() => {
    grid = new NexGrid();
  });

  test('should create a peer connection', async () => {
    const { pc, keyPair } = grid.createPeerConnection('test-peer', true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    expect(keyPair.publicKey).toBeDefined();
    expect(offer.type).toBe('offer');
    expect(grid.peers.size).toBe(1);
  });

  test('should accept a connection', () => {
    grid.acceptConnection('test-peer');
    
    expect(grid.peers.size).toBe(1);
    expect(grid.localKeyPairs.size).toBe(1);
  });

  test('should generate keys for peer connections', () => {
    const { keyPair: initiatorKeys } = grid.createPeerConnection('peer1', true);
    const { keyPair: responderKeys } = grid.createPeerConnection('peer2', false);
    
    expect(initiatorKeys.publicKey).toBeDefined();
    expect(initiatorKeys.secretKey).toBeDefined();
    expect(responderKeys.publicKey).toBeDefined();
    expect(responderKeys.secretKey).toBeDefined();
  });

  test('should start with empty peer map', () => {
    expect(grid.peers.size).toBe(0);
    expect(grid.localKeyPairs.size).toBe(0);
  });

  test('should handle signaling messages', async () => {
    grid.createPeerConnection('test-peer', true);
    
    const peer = grid.peers.get('test-peer');
    
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    
    await grid.handleSignalingMessage('test-peer', {
      type: 'offer',
      offer: offer
    });
    
    expect(peer.pc.remoteDescription).toBeDefined();
    expect(peer.pc.remoteDescription.type).toBe('offer');
  });

  test('should encrypt and decrypt messages between peers', () => {
    grid.createPeerConnection('peer1', true);
    const keyPair = grid.localKeyPairs.get('peer1');
    
    expect(keyPair.publicKey).toBeDefined();
    
    const message = { type: 'test', data: 'hello-world' };
    const messageStr = JSON.stringify(message);
    
    // Use crypto module directly for encryption
    const encrypted = NexVaultCrypto.encrypt(messageStr, keyPair.publicKey);
    const decrypted = NexVaultCrypto.decrypt(encrypted, keyPair.secretKey);
    
    expect(JSON.parse(decrypted)).toEqual(message);
  });

  test('should reject decryption with wrong peer', () => {
    grid.createPeerConnection('peer1', true);
    grid.createPeerConnection('peer2', false);
    
    const keyPair1 = grid.localKeyPairs.get('peer1');
    const keyPair2 = grid.localKeyPairs.get('peer2');
    
    expect(keyPair1.publicKey).toBeDefined();
    expect(keyPair2.publicKey).toBeDefined();
    
    const message = { type: 'test', data: 'hello' };
    const messageStr = JSON.stringify(message);
    
    const encrypted = NexVaultCrypto.encrypt(messageStr, keyPair1.publicKey);
    
    expect(() => NexVaultCrypto.decrypt(encrypted, keyPair2.secretKey)).toThrow();
  });

  test('should handle peer disconnection', () => {
    grid.createPeerConnection('peer1', true);
    expect(grid.peers.size).toBe(1);
    
    grid.handlePeerDisconnect('peer1');
    expect(grid.peers.size).toBe(0);
    expect(grid.localKeyPairs.size).toBe(0);
  });

  test('should close all connections', () => {
    grid.createPeerConnection('peer1', true);
    grid.createPeerConnection('peer2', false);
    expect(grid.peers.size).toBe(2);
    
    grid.closeAll();
    expect(grid.peers.size).toBe(0);
    expect(grid.localKeyPairs.size).toBe(0);
  });
});