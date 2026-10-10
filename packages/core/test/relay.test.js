const WebSocket = require('ws');
const { NexVaultToken } = require('@nexvault/core/crypto');
const { createRelayServer } = require('@nexvault/relay');

function waitForMessage(socket, type) {
  return new Promise((resolve) => {
    const handler = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === type) {
        socket.off('message', handler);
        resolve(message);
      }
    };
    socket.on('message', handler);
  });
}

test('routes discovery without handling vault payloads', async () => {
  const server = createRelayServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const token = new NexVaultToken();
  token.generate();
  const bootstrapToken = token.generateBootstrapToken();
  const first = new WebSocket(`ws://127.0.0.1:${port}`);
  const second = new WebSocket(`ws://127.0.0.1:${port}`);
  await Promise.all([
    new Promise((resolve) => first.once('open', resolve)),
    new Promise((resolve) => second.once('open', resolve))
  ]);

  const firstPeerList = waitForMessage(first, 'peer-list');
  first.send(JSON.stringify({ type: 'device-auth', token: bootstrapToken, deviceId: 'one', publicKey: 'key-one' }));
  await firstPeerList;
  const secondPeerList = waitForMessage(second, 'peer-list');
  second.send(JSON.stringify({ type: 'device-auth', token: bootstrapToken, deviceId: 'two', publicKey: 'key-two' }));
  const peers = await secondPeerList;

  expect(peers.peers).toEqual([{ deviceId: 'one', publicKey: 'key-one' }]);
  first.close();
  second.close();
  await new Promise((resolve) => server.close(resolve));
});
