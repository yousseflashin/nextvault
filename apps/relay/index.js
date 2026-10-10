const { WebSocketServer } = require('ws');
const { NexVaultToken } = require('@nexvault/core/crypto');

function createRelayServer({ host = process.env.HOST || '0.0.0.0', port = Number(process.env.PORT || 46123) } = {}) {
  const rooms = new Map();
  const server = new WebSocketServer({ host, port });

  server.on('connection', (socket) => {
    let session;
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (!session) {
          if (message.type !== 'device-auth' || !message.token ||
              !message.token.expiresAt || Date.now() >= new Date(message.token.expiresAt).getTime() ||
              !NexVaultToken.verify(message.token.tokenId, message.token.signature, message.token.publicKey)) {
            socket.close(1008, 'Invalid device authentication');
            return;
          }
          session = {
            tokenId: message.token.tokenId,
            deviceId: message.deviceId,
            publicKey: message.publicKey,
            socket
          };
          if (!rooms.has(session.tokenId)) rooms.set(session.tokenId, new Map());
          const room = rooms.get(session.tokenId);
          room.set(session.deviceId, session);
          sendPeerList(socket, room, session.deviceId);
          for (const peer of room.values()) {
            if (peer.deviceId !== session.deviceId) {
              peer.socket.send(JSON.stringify({ type: 'peer-joined', peer: publicPeer(session) }));
            }
          }
          return;
        }

        const room = rooms.get(session.tokenId);
        if (message.type === 'peer-discover') {
          sendPeerList(socket, room, session.deviceId);
        } else if (message.type === 'signal') {
          const peer = room.get(message.to);
          if (peer) peer.socket.send(JSON.stringify({
            type: 'signal',
            from: session.deviceId,
            payload: message.payload
          }));
        }
      } catch {
        socket.close(1003, 'Invalid message');
      }
    });

    socket.on('close', () => {
      if (!session) return;
      const room = rooms.get(session.tokenId);
      room?.delete(session.deviceId);
      if (room?.size === 0) rooms.delete(session.tokenId);
    });
  });

  return server;
}

function publicPeer(peer) {
  return { deviceId: peer.deviceId, publicKey: peer.publicKey };
}

function sendPeerList(socket, room, deviceId) {
  const peers = [...room.values()]
    .filter((peer) => peer.deviceId !== deviceId)
    .map(publicPeer);
  socket.send(JSON.stringify({ type: 'peer-list', peers }));
}

if (require.main === module) {
  createRelayServer();
  console.log(`NexVault relay listening on ${process.env.HOST || '0.0.0.0'}:${process.env.PORT || 46123}`);
}

module.exports = { createRelayServer };
