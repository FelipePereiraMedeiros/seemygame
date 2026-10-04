// Controlled read-only probes of residual audit issues. No application source changes.
// Run: node docs/revalidacao-achados-probes.mjs
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/room.html?room=revalidation' });
for (const key of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'CustomEvent', 'AbortController', 'AbortSignal', 'Event', 'EventTarget']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.fetch = async () => ({ ok: false });
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
const { createSessionContext } = await import('../js/core/session-context.js');
const { createStreamerSession } = await import('../js/session/streamer-session.js');
const { bindSessionMessageHandlers } = await import('../js/protocol/session-handlers.js');
const { WhiteboardManager } = await import('../js/whiteboard.js');
const { WhiteboardPlugin } = await import('../js/plugins/whiteboard-plugin.js');
const { ChatManager } = await import('../js/chat.js');
const { isWithinMessageLimit } = await import('../js/room/shared.js');
const evidence = [];
const record = (id, observations) => { evidence.push({ id, ...observations }); console.log(JSON.stringify(evidence.at(-1))); };
class Connection extends EventEmitter {
  constructor(peer) { super(); this.peer = peer; this.open = false; this.sent = []; }
  send(data) { this.sent.push(data); }
  close() { this.open = false; this.emit('close'); }
}
class Call extends EventEmitter {
  constructor(peer) {
    super(); this.peer = peer; this.closed = false; this.open = false;
    this.peerConnection = { connectionState: 'new', setLocalDescription: async () => {}, getTransceivers: () => [], getSenders: () => [], getStats: async () => new Map(), addEventListener() {}, removeEventListener() {} };
  }
  close() { this.closed = true; this.emit('close'); }
}
class Peer extends EventEmitter {
  constructor(id) { super(); this.id = id || 'random-peer'; this.calls = []; queueMicrotask(() => this.emit('open', this.id)); }
  call(id) { const call = new Call(id); this.calls.push(call); return call; }
  destroy() { this.destroyed = true; }
}
globalThis.Peer = Peer;
{
  const runtime = createStreamerSession(), session = createSessionContext();
  runtime.streamerState.session = session;
  runtime.streamerState.localStream = { getTracks: () => [] };
  const peer = await runtime.initStreamerPeer('host', session), conn = new Connection('viewer');
  peer.emit('connection', conn); conn.open = true; conn.emit('open');
  conn.emit('data', { type: 'REQUEST_STREAM' });
  assert.equal(peer.calls.length, 2);
  assert.equal(peer.calls[0].closed, true);
  conn.close();
  assert.equal(peer.calls.every(call => call.closed), true);
  record('A03/A04', { initialConnectionState: 'new', callsCreated: peer.calls.length, firstCallAborted: true, allClosedOnDisconnect: true });
  session.dispose();
}
{
  const runtime = createStreamerSession(), session = createSessionContext();
  localStorage.setItem('seemygame_streamer_pin', '1234');
  runtime.streamerState.session = session;
  const peer = await runtime.initStreamerPeer('pin-host', session);
  const first = new Connection('same-guest');
  peer.emit('connection', first); first.open = true; first.emit('open');
  for (let i = 0; i < 5; i++) first.emit('data', { type: 'REQUEST_STREAM', pin: 'wrong' });
  assert.equal(first.open, false);
  assert.equal(runtime.streamerState.admissionGate.isRateLimited(first.peer), false);
  const second = new Connection(first.peer);
  peer.emit('connection', second); second.open = true; second.emit('open');
  second.emit('data', { type: 'REQUEST_STREAM', pin: 'wrong' });
  assert.equal(second.open, true);
  assert.equal(runtime.streamerState.admissionGate.failedAttempts.get(second.peer), 1);
  record('Static5', { initialFailureLimit: 5, firstConnectionClosed: true, cooldownAfterDisconnect: false, newFailureCountForSamePeer: 1 });
  second.close(); session.dispose(); localStorage.removeItem('seemygame_streamer_pin');
}
{
  for (const role of ['streamer', 'room']) {
    const session = createSessionContext(), chat = new ChatManager();
    bindSessionMessageHandlers(session, { role, chatManager: chat });
    const result = session.dispatcher.dispatch({ type: 'CHAT_MESSAGE', message: { id: 'forged-' + role, senderId: 'host', senderName: 'Host', role: 'system', isSystem: true, channel: 'geral', text: 'spoofed' } }, { peer: 'guest' });
    assert.equal(result.handled, true);
    const message = chat.getMessages()[0];
    assert.equal(message.senderId, 'guest');
    assert.equal(message.role, 'system');
    if (role === 'room') assert.equal(message.isSystem, true);
    record('A10-' + role, { senderId: message.senderId, claimedName: message.senderName, claimedRole: message.role, isSystem: message.isSystem });
    session.dispose();
  }
  const host = createSessionContext(), viewer = createSessionContext(), hostChat = new ChatManager(), viewerChat = new ChatManager();
  let relayed;
  bindSessionMessageHandlers(host, { role: 'streamer', chatManager: hostChat, broadcast: data => { relayed = data; } });
  bindSessionMessageHandlers(viewer, { role: 'viewer', chatManager: viewerChat });
  host.dispatcher.dispatch({ type: 'CHAT_MESSAGE', message: { id: 'relayed', senderId: 'guest', senderName: 'Guest', role: 'viewer', channel: 'geral', text: 'hello' } }, { peer: 'guest' });
  viewer.dispatcher.dispatch(relayed, { peer: 'host' });
  assert.equal(viewerChat.getMessages()[0].senderId, 'host');
  record('A10-relay', { originalAuthor: 'guest', authorStoredAtViewer: viewerChat.getMessages()[0].senderId });
  host.dispose(); viewer.dispose();
}
function boardSession(board, extra = {}) {
  const session = createSessionContext();
  session.pluginManager.register(new WhiteboardPlugin({ manager: board }));
  session.pluginManager.initAll({ isRoomMode: () => true, ...extra });
  return session;
}
const image = (id, dataUrl) => ({ id, type: 'image', startX: 0, startY: 0, endX: 20, endY: 20, dataUrl });
{
  const source = new WhiteboardManager(), target = new WhiteboardManager(), fresh = new WhiteboardManager();
  const newData = 'data:image/png;base64,' + 'A'.repeat(300000);
  source.addElement(image('same-image', newData), false);
  target.addElement(image('same-image', 'data:image/png;base64,AAAA'), false);
  target.addElement({ id: 'stale', type: 'rectangle', startX: 0, startY: 0, endX: 10, endY: 10 }, false);
  const senderSession = boardSession(source), receiverSession = boardSession(target), freshSession = boardSession(fresh);
  const conn = new Connection('late-viewer'); conn.open = true;
  senderSession.dispatcher.dispatch({ type: 'WHITEBOARD_REQUEST_SYNC' }, conn);
  assert.equal(conn.sent.every(isWithinMessageLimit), true);
  for (const data of conn.sent) {
    receiverSession.dispatcher.dispatch(data, { peer: 'host' });
    freshSession.dispatcher.dispatch(data, { peer: 'host' });
  }
  assert.equal(fresh.elements[0].dataUrl, newData);
  assert.notEqual(target.elements[0].dataUrl, newData);
  assert.equal(target.elements.some(el => el.id === 'stale'), true);
  record('A11', { chunksSent: conn.sent.length, allFitRoomLimit: true, emptyLateJoinCorrect: true, existingImageUpdated: false, staleElementRemoved: false });
  senderSession.dispose(); receiverSession.dispose(); freshSession.dispose();
}
{
  const board = new WhiteboardManager(), session = boardSession(board);
  const originalSet = Map.prototype.set;
  let entry;
  Map.prototype.set = function (key, value) {
    if (value?.total === 1.5 && value.received instanceof Map) entry = value;
    return originalSet.call(this, key, value);
  };
  try {
    for (let i = 0; i < 256; i++) session.dispatcher.dispatch({ type: 'WHITEBOARD_ELEMENT_CHUNK', chunkId: 'fractional', index: i / 1000, total: 1.5, chunk: 'AAAA', meta: image('partial', '') }, { peer: 'guest' });
  } finally { Map.prototype.set = originalSet; }
  assert.equal(entry.received.size, 256);
  record('Static1', { declaredTotal: 1.5, acceptedDistinctIndices: entry.received.size, limitOf200Bypassed: true });
  session.dispose();
}
{
  const board = new WhiteboardManager(), canvas = document.createElement('canvas');
  canvas.getContext = () => new Proxy({}, { get: (_target, key) => key === 'measureText' ? () => ({ width: 10 }) : () => {} });
  board.setCanvas(canvas); board.selectedTool = 'select'; board.selectedElementId = 'rect';
  board.elements = [{ id: 'rect', type: 'rectangle', startX: 0, startY: 0, endX: 20, endY: 20 }];
  board.undoStack = [];
  for (let i = 0; i < 61; i++) {
    const el = board.elements[0];
    board.isDraggingElement = true; board.dragInitialState = { ...el }; board._dragUndoSnapshot = [{ ...el }];
    el.startX += 2; el.endX += 2;
    window.dispatchEvent(new Event('mouseup'));
  }
  assert.equal(board.undoStack.length, 61);
  record('Static2', { completedDrags: 61, undoSnapshots: board.undoStack.length, declaredLimit: 50 });
  board.setCanvas(null);
}
{
  const port = 31000 + Math.floor(Math.random() * 10000);
  const server = spawn(process.execPath, ['tools/serve.mjs'], { cwd: new URL('../', import.meta.url), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(server, 'exit');
  await Promise.race([once(server.stdout, 'data'), new Promise((_, reject) => setTimeout(() => reject(new Error('Server startup timeout')), 5000))]);
  const request = requestPath => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: requestPath }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
  });
  try {
    const direct = await request('/.git/HEAD'), encoded = await request('/%5C.git%5CHEAD');
    const malformed = await request('/%ZZ'), healthy = await request('/');
    assert.equal(direct, 403); assert.equal(malformed, 400); assert.equal(healthy, 200);
    if (process.platform === 'win32') assert.equal(encoded, 200);
    record('A14/A15', { platform: process.platform, directHiddenFile: direct, encodedBackslashHiddenFile: encoded, invalidURI: malformed, subsequentHealth: healthy });
  } finally { server.kill(); await exited; }
}
dom.window.close();
console.log(JSON.stringify({ probes: evidence.length, evidence }, null, 2));
