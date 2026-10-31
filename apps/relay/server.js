const express = require('express');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const { NexVaultToken } = require('@nexvault/core/crypto');

function createRelayServer({
  host = process.env.HOST || '0.0.0.0',
  port = Number(process.env.PORT || 46123),
} = {}) {
  const app = express();
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer });
  const rooms = new Map();

  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  wss.on('connection', (socket) => {
    let session;

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());

        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          socket.close(1003, 'Invalid message');
          return;
        }

        if (!session) {
          const token = message.token;
          const expiresAt = token?.expiresAt
            ? new Date(token.expiresAt).getTime()
            : NaN;

          if (
            message.type !== 'device-auth' ||
            typeof message.deviceId !== 'string' ||
            !message.deviceId ||
            typeof message.publicKey !== 'string' ||
            !message.publicKey ||
            typeof token?.tokenId !== 'string' ||
            !token.tokenId ||
            !token.signature ||
            !token.publicKey ||
            !Number.isFinite(expiresAt) ||
            Date.now() >= expiresAt ||
            !NexVaultToken.verify(
              token.tokenId,
              token.signature,
              token.publicKey
            )
          ) {
            socket.close(1008, 'Invalid device authentication');
            return;
          }

          session = {
            tokenId: token.tokenId,
            deviceId: message.deviceId,
            publicKey: message.publicKey,
            ...(message.deviceName ? { deviceName: message.deviceName } : {}),
            socket,
          };

          if (!rooms.has(session.tokenId)) {
            rooms.set(session.tokenId, new Map());
          }

          const room = rooms.get(session.tokenId);
          const existing = room.get(session.deviceId);

          // Prevent two live connections from claiming the same device ID.
          if (existing && existing.socket !== socket) {
            existing.socket.close(1008, 'Device connected elsewhere');
          }

          room.set(session.deviceId, session);

          sendPeerList(socket, room, session.deviceId);

          for (const peer of room.values()) {
            if (peer.deviceId !== session.deviceId) {
              sendJson(peer.socket, {
                type: 'peer-joined',
                peer: publicPeer(session),
              });
            }
          }

          return;
        }

        const room = rooms.get(session.tokenId);

        if (!room || room.get(session.deviceId) !== session) {
          socket.close(1008, 'Session no longer active');
          return;
        }

        if (message.type === 'peer-discover') {
          sendPeerList(socket, room, session.deviceId);
        } else if (message.type === 'signal') {
          if (
            typeof message.to !== 'string' ||
            !message.payload ||
            typeof message.payload !== 'object' ||
            Array.isArray(message.payload)
          ) {
            socket.close(1003, 'Invalid signal');
            return;
          }

          if (message.to === '*') {
            for (const peer of room.values()) {
              if (peer.deviceId !== session.deviceId && peer.socket.readyState === peer.socket.OPEN) {
                sendJson(peer.socket, {
                  type: 'signal',
                  from: session.deviceId,
                  payload: message.payload,
                });
              }
            }
            return;
          }

          const peer = room.get(message.to);

          if (peer && peer.socket.readyState === peer.socket.OPEN) {
            sendJson(peer.socket, {
              type: 'signal',
              from: session.deviceId,
              payload: message.payload,
            });
          }
        }
      } catch {
        if (socket.readyState === socket.OPEN) {
          socket.close(1003, 'Invalid message');
        }
      }
    });

    socket.on('close', () => {
      if (!session) return;

      const room = rooms.get(session.tokenId);

      // Do not remove a replacement connection when an old one closes.
      if (room?.get(session.deviceId) !== session) return;

      room.delete(session.deviceId);

      for (const peer of room.values()) {
        sendJson(peer.socket, {
          type: 'peer-left',
          deviceId: session.deviceId,
        });
      }

      if (room.size === 0) {
        rooms.delete(session.tokenId);
      }
    });

    socket.on('error', () => {
      // Prevent unhandled socket errors from crashing the process.
    });
  });

  httpServer.listen(port, host);

  return httpServer;
}

function sendJson(socket, data) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function publicPeer(peer) {
  const result = {
    deviceId: peer.deviceId,
    publicKey: peer.publicKey,
  };
  if (peer.deviceName) {
    result.deviceName = peer.deviceName;
  }
  return result;
}

function sendPeerList(socket, room, deviceId) {
  const peers = [...room.values()]
    .filter(
      (peer) =>
        peer.deviceId !== deviceId &&
        peer.socket.readyState === peer.socket.OPEN
    )
    .map(publicPeer);

  sendJson(socket, { type: 'peer-list', peers });
}

if (require.main === module) {
  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT || 46123);

  const server = createRelayServer({ host, port });

  server.on('listening', () => {
    console.log(`NexVault relay listening on http://${host}:${port}`);
  });
}

module.exports = { createRelayServer };
