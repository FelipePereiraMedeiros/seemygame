import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

/** Local PeerJS wire fixture. Media/data use actual RTCPeerConnections. */
export async function startSignalingServer() {
  const peers = new Map();
  const server = http.createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Type', 'text/plain');
    response.end(randomUUID());
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (socket, request) => {
    const id = new URL(request.url, 'http://localhost').searchParams.get('id');
    if (!id || peers.has(id)) { socket.send(JSON.stringify({ type: 'ID-TAKEN' })); socket.close(); return; }
    peers.set(id, socket);
    socket.send(JSON.stringify({ type: 'OPEN' }));
    socket.on('message', raw => {
      try {
        const message = JSON.parse(raw.toString());
        if (['OFFER', 'ANSWER', 'CANDIDATE', 'LEAVE'].includes(message.type)) {
          peers.get(message.dst)?.send(JSON.stringify({ ...message, src: id }));
        }
      } catch (_) {}
    });
    socket.on('close', () => { if (peers.get(id) === socket) peers.delete(id); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    config: { host: '127.0.0.1', port: server.address().port, path: '/', secure: false, config: { iceServers: [] } },
    close: async () => {
      for (const socket of peers.values()) socket.terminate();
      await new Promise(resolve => sockets.close(resolve));
      await new Promise(resolve => server.close(resolve));
    }
  };
}
