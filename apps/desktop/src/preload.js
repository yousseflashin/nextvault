const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexVault', {
  getVaultProfile: () => ipcRenderer.invoke('get-vault-profile'),
  initializeNewUser: (username, password) => ipcRenderer.invoke('initialize-new-user', username, password),
  initializeExistingUser: (tokenId, publicKey, signature, password, expiresAt) => ipcRenderer.invoke(
    'initialize-existing-user', tokenId, publicKey, signature, password, expiresAt
  ),
  authenticate: (username, password) => ipcRenderer.invoke('authenticate-user', username, password),
  lockVault: () => ipcRenderer.invoke('lock-vault'),
  getToken: () => ipcRenderer.invoke('get-token'),
  authorizeToken: (token) => ipcRenderer.invoke('authorize-token', token),
  getTrustHistory: () => ipcRenderer.invoke('get-trust-history'),
  startNexGrid: (customRelayUrl) => ipcRenderer.invoke('start-nex-grid', customRelayUrl),
  connectPeer: (peerId) => ipcRenderer.invoke('connect-peer', peerId),
  acceptConnection: (peerId) => ipcRenderer.invoke('accept-connection', peerId),
  sendSecureMessage: (peerId, message) => ipcRenderer.invoke('send-secure-message', peerId, message),
  setPeerPublicKey: (peerId, publicKey) => ipcRenderer.invoke('set-peer-public-key', peerId, publicKey),
  stopNexGrid: () => ipcRenderer.invoke('stop-nex-grid'),
  requestPairingCode: () => ipcRenderer.invoke('request-pairing-code'),
  approvePairRequest: (peerId) => ipcRenderer.invoke('approve-pair-request', peerId),
  rejectPairRequest: (peerId) => ipcRenderer.invoke('reject-pair-request', peerId),
  syncVaultToPeers: () => ipcRenderer.invoke('sync-vault-to-peers'),
  addPassword: (serviceName, password, username) => ipcRenderer.invoke('add-password', serviceName, password, username),
  getPassword: (serviceName) => ipcRenderer.invoke('get-password', serviceName),
  listPasswords: () => ipcRenderer.invoke('list-passwords'),
  deletePassword: (serviceName) => ipcRenderer.invoke('delete-password', serviceName),
  deleteAllPasswords: () => ipcRenderer.invoke('delete-all-passwords'),
  bulkImportPasswords: (items) => ipcRenderer.invoke('bulk-import-passwords', items),
  bulkImportOTPs: (items) => ipcRenderer.invoke('bulk-import-otps', items),
  parseBulkImport: (content) => ipcRenderer.invoke('parse-bulk-import', content),
  addOTP: (serviceName, secret) => ipcRenderer.invoke('add-otp', serviceName, secret),
  listOTPs: () => ipcRenderer.invoke('list-otps'),
  getOTP: (serviceName) => ipcRenderer.invoke('get-otp', serviceName),
  getOTPDetails: (serviceName) => ipcRenderer.invoke('get-otp-details', serviceName),
  deleteOTP: (serviceName) => ipcRenderer.invoke('delete-otp', serviceName),
  deleteAllOTPs: () => ipcRenderer.invoke('delete-all-otps'),
  deleteAllVault: () => ipcRenderer.invoke('delete-all-vault'),
  addOtpSecret: (otpType, secret) => ipcRenderer.invoke('add-otp-secret', otpType, secret),
  getOtpSecret: (otpType) => ipcRenderer.invoke('get-otp-secret', otpType),
  getOtpCode: (otpType) => ipcRenderer.invoke('get-otp-code', otpType),
  getSecurityStatus: () => ipcRenderer.invoke('get-security-status'),
  startSecurityCountdown: () => ipcRenderer.invoke('start-security-countdown'),
  stopSecurityCountdown: () => ipcRenderer.invoke('stop-security-countdown'),
  startTamperMonitor: () => ipcRenderer.invoke('start-tamper-monitor'),
  runIntegrityCheck: () => ipcRenderer.invoke('run-integrity-check'),
  checkIntegrity: () => ipcRenderer.invoke('check-integrity'),
  triggerEmergencyNuke: () => ipcRenderer.invoke('trigger-emergency-nuke'),
  approveExtension: (peerId, requestId, duration, newDeadline) => ipcRenderer.invoke('approve-extension', peerId, requestId, duration, newDeadline),
  rejectExtension: (peerId, requestId, reason) => ipcRenderer.invoke('reject-extension', peerId, requestId, reason),
  onSecurityCountdownStarted: (callback) => ipcRenderer.on(
    'security-countdown-started', (event, status) => callback(status)
  ),
  onSecurityCountdownStopped: (callback) => ipcRenderer.on(
    'security-countdown-stopped', () => callback()
  ),
  onPeerRequestsApproval: (callback) => ipcRenderer.on(
    'peer-requests-approval', (event, data) => callback(data)
  ),
  onBroadcastApprovalRequest: (callback) => ipcRenderer.on(
    'broadcast-approval-request', (event, data) => callback(data)
  ),
  onExtensionApproved: (callback) => ipcRenderer.on(
    'extension-approved', (event, data) => callback(data)
  ),
  onExtensionRejected: (callback) => ipcRenderer.on(
    'extension-rejected', (event, data) => callback(data)
  ),
  grantPeerExtension: (targetPeerId, duration) => ipcRenderer.invoke('grant-peer-extension', targetPeerId, duration),
  requestPeerToExtend: (targetPeerId, duration) => ipcRenderer.invoke('request-peer-to-extend', targetPeerId, duration),
  onExtensionGrantReceived: (callback) => ipcRenderer.on(
    'extension-grant-received', (event, data) => callback(data)
  ),
  onExtensionGrantAcknowledged: (callback) => ipcRenderer.on(
    'extension-grant-acknowledged', (event, data) => callback(data)
  ),
  onExtensionPromptReceived: (callback) => ipcRenderer.on(
    'extension-prompt-received', (event, data) => callback(data)
  ),
  extendSecurityWindow: (duration, options) => ipcRenderer.invoke('extend-security-window', duration, options),
  nuke: () => ipcRenderer.invoke('nuke'),
  onPeerData: (callback) => ipcRenderer.on('peer-data', (event, data) => callback(data)),
  onExtensionMessage: (callback) => ipcRenderer.on('extension-message', (event, data) => callback(data)),
  onIncomingPairRequest: (callback) => ipcRenderer.on('incoming-pair-request', (event, data) => callback(data)),
  onPeerJoined: (callback) => ipcRenderer.on('peer-joined', (event, data) => callback(data)),
  onPeerPaired: (callback) => ipcRenderer.on('peer-paired', (event, data) => callback(data)),
  onVaultUpdated: (callback) => ipcRenderer.on('vault-updated', () => callback()),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  applyUpdate: (downloadUrl) => ipcRenderer.invoke('apply-update', downloadUrl),
  onUpdateProgress: (callback) => {
    ipcRenderer.removeAllListeners('update-download-progress');
    ipcRenderer.on('update-download-progress', (event, data) => callback(data));
  },
  onTriggerUpdateCheck: (callback) => {
    ipcRenderer.removeAllListeners('trigger-update-check');
    ipcRenderer.on('trigger-update-check', () => callback());
  },
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  getTrustedDevices: () => ipcRenderer.invoke('get-trusted-devices'),
  removeTrustedDevice: (deviceId) => ipcRenderer.invoke('remove-trusted-device', deviceId),
  setGithubToken: (token) => ipcRenderer.invoke('set-github-token', token),
  getGithubToken: () => ipcRenderer.invoke('get-github-token'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  pairWithCode: (code) => ipcRenderer.invoke('pair-with-code', code),
  getRelayUrl: () => ipcRenderer.invoke('get-relay-url'),
  setRelayUrl: (url) => ipcRenderer.invoke('set-relay-url', url),
  onVaultSyncedToPeers: (callback) => ipcRenderer.on('vault-synced-to-peers', (event, data) => callback(data)),
  onGridStatus: (callback) => ipcRenderer.on('grid-status', (event, data) => callback(data)),
  installBrowserExtension: () => ipcRenderer.invoke('install-browser-extension'),
  getBrowserExtensionStatus: () => ipcRenderer.invoke('get-browser-extension-status')
});