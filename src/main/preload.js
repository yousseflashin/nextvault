const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexVault', {
  initializeNewUser: (username, password) => ipcRenderer.invoke('initialize-new-user', username, password),
  initializeExistingUser: (tokenId, publicKey, signature, password, expiresAt) => ipcRenderer.invoke(
    'initialize-existing-user', tokenId, publicKey, signature, password, expiresAt
  ),
  authenticate: (username, password) => ipcRenderer.invoke('authenticate-user', username, password),
  getToken: () => ipcRenderer.invoke('get-token'),
  authorizeToken: (token) => ipcRenderer.invoke('authorize-token', token),
  getTrustHistory: () => ipcRenderer.invoke('get-trust-history'),
  startNexGrid: () => ipcRenderer.invoke('start-nex-grid'),
  connectPeer: (peerId) => ipcRenderer.invoke('connect-peer', peerId),
  acceptConnection: (peerId) => ipcRenderer.invoke('accept-connection', peerId),
  sendSecureMessage: (peerId, message) => ipcRenderer.invoke('send-secure-message', peerId, message),
  setPeerPublicKey: (peerId, publicKey) => ipcRenderer.invoke('set-peer-public-key', peerId, publicKey),
  addPassword: (serviceName, password) => ipcRenderer.invoke('add-password', serviceName, password),
  getPassword: (serviceName) => ipcRenderer.invoke('get-password', serviceName),
  addOtpSecret: (otpType, secret) => ipcRenderer.invoke('add-otp-secret', otpType, secret),
  getOtpSecret: (otpType) => ipcRenderer.invoke('get-otp-secret', otpType),
  getOtpCode: (otpType) => ipcRenderer.invoke('get-otp-code', otpType),
  getSecurityStatus: () => ipcRenderer.invoke('get-security-status'),
  startSecurityCountdown: () => ipcRenderer.invoke('start-security-countdown'),
  stopSecurityCountdown: () => ipcRenderer.invoke('stop-security-countdown'),
  approveExtension: (peerId) => ipcRenderer.invoke('approve-extension', peerId),
  onSecurityCountdownStarted: (callback) => ipcRenderer.on(
    'security-countdown-started', (event, status) => callback(status)
  ),
  onSecurityCountdownStopped: (callback) => ipcRenderer.on(
    'security-countdown-stopped', () => callback()
  ),
  onPeerRequestsApproval: (callback) => ipcRenderer.on(
    'peer-requests-approval', (event, { peerId, duration }) => callback(peerId, duration)
  ),
  onBroadcastApprovalRequest: (callback) => ipcRenderer.on(
    'broadcast-approval-request', (event, { duration }) => callback(duration)
  ),
  onExtensionApproved: (callback) => ipcRenderer.on(
    'extension-approved', (event, { duration }) => callback(duration)
  ),
  extendSecurityWindow: (duration) => ipcRenderer.invoke('extend-security-window', duration),
  nuke: () => ipcRenderer.invoke('nuke'),
  onPeerData: (callback) => ipcRenderer.on('peer-data', (event, data) => callback(data)),
  onExtensionMessage: (callback) => ipcRenderer.on('extension-message', (event, data) => callback(data))
});