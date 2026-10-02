// Read-only behavioral probes for the code review. Assertions describe observed defects.
// Run: node docs/audit-2026-10-02-reproductions.mjs
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/room.html?room=audit-room' });
for (const key of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'CustomEvent', 'AbortController', 'AbortSignal', 'Event', 'EventTarget']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.fetch = async () => ({ ok: false });
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
const results = [];
const record = (name, evidence) => { results.push({ name, evidence }); console.log('CONFIRMED', name, JSON.stringify(evidence)); };
const { createSessionContext } = await import('../js/core/session-context.js');
const { createStreamerSession } = await import('../js/session/streamer-session.js');
const { createViewerSession } = await import('../js/session/viewer-session.js');
const { createRoomSession } = await import('../js/session/room-session.js');
const { bindSessionMessageHandlers } = await import('../js/protocol/session-handlers.js');
const { WhiteboardManager } = await import('../js/whiteboard.js');
const { isSafeWhiteboardElement } = await import('../js/whiteboard/shared.js');
const { ChatManager } = await import('../js/chat.js');
const { getPeerConfig } = await import('../js/config.js');
const { RoomManager } = await import('../js/room.js');
const { WhiteboardPlugin } = await import('../js/plugins/whiteboard-plugin.js');
const { isWithinMessageLimit } = await import('../js/room/shared.js');

class Connection extends EventEmitter {
  constructor(peer) { super(); this.peer = peer; this.open = false; this.sent = []; }
  send(data) { this.sent.push(data); }
  close() { this.open = false; this.emit('close'); }
}
class Call extends EventEmitter {
  constructor(peer, metadata = {}) {
    super(); this.peer = peer; this.metadata = metadata; this.closed = false;
    this.peerConnection = { setLocalDescription: async () => {}, getTransceivers: () => [], getSenders: () => [], getStats: async () => new Map(), addEventListener() {}, removeEventListener() {} };
  }
  answer(stream) { this.answeredWith = stream; }
  close() { this.closed = true; this.emit('close'); }
}
class Peer extends EventEmitter {
  constructor(id) { super(); this.id = typeof id === 'string' ? id : 'random-peer'; this.destroyed = false; this.calls = []; queueMicrotask(() => this.emit('open', this.id)); }
  call(id, stream, options) { const call = new Call(id, options?.metadata); this.calls.push(call); return call; }
  connect(id) { return new Connection(id); }
  destroy() { this.destroyed = true; }
}
globalThis.Peer = Peer;

// Real open -> REQUEST_STREAM handshake triggers two independent media calls.
{
  const runtime = createStreamerSession();
  const session = createSessionContext();
  runtime.streamerState.session = session;
  runtime.streamerState.localStream = { getTracks: () => [] };
  const peer = await runtime.initStreamerPeer('audit-host', session);
  const conn = new Connection('audit-viewer');
  peer.emit('connection', conn); conn.open = true; conn.emit('open');
  conn.emit('data', { type: 'REQUEST_STREAM' });
  assert.equal(peer.calls.length, 2);
  assert.equal(runtime.streamerState.activeCalls.size, 1);
  conn.close();
  assert.equal(peer.calls.filter(call => !call.closed).length, 2);
  record('duplicate-media-and-disconnect-leak', { createdCalls: peer.calls.length, trackedCallsAfterDisconnect: runtime.streamerState.activeCalls.size, openCallsAfterDisconnect: 2 });
  session.dispose(); peer.calls.forEach(call => call.close());
}

// A call from a peer unrelated to the selected host obtains the active microphone.
{
  const runtime = createViewerSession();
  const session = createSessionContext();
  const microphone = { marker: 'active-local-microphone' };
  const voiceManager = { isInVoice: true, localStream: microphone, removeRemoteParticipant() {}, addRemoteParticipant() {} };
  runtime.viewerState.session = session;
  runtime.viewerState.targetHostId = 'trusted-host';
  runtime.viewerState.messageHandlers = bindSessionMessageHandlers(session, { role: 'viewer', voiceManager });
  const peer = await runtime.initViewerPeer(session);
  const call = new Call('unrelated-peer', { type: 'VOICE_CHAT' });
  peer.emit('call', call);
  assert.equal(call.answeredWith, microphone);
  record('viewer-microphone-sent-to-unrelated-peer', { selectedHost: 'trusted-host', caller: call.peer, sentMicrophone: true });
  session.dispose();
}

// Coordinator membership triggers repeated synchronous connects before open.
{
  const runtime = createRoomSession();
  const session = createSessionContext();
  const peer = new Peer('aaa-guest');
  let meshAttempts = 0;
  peer.connect = id => {
    if (id === 'zzz-guest' && ++meshAttempts > 6) throw new Error('audit bounded recursion');
    return new Connection(id);
  };
  runtime.roomState.peer = peer;
  runtime.roomState.session = session;
  await runtime.setupRoomSession(peer.id, session);
  const rm = runtime.roomState.roomManager;
  const coordinator = runtime.roomState.coordinatorConn;
  coordinator.open = true; coordinator.emit('open');
  const originalError = console.error; console.error = () => {};
  try {
    coordinator.emit('data', { type: 'ROOM_SYNC_ALL', roomId: rm.roomId, members: [{ peerId: rm.masterPeerId, isMaster: true }, { peerId: 'zzz-guest', name: 'Guest Z' }] });
  } finally { console.error = originalError; }
  assert.ok(meshAttempts > 6);
  record('room-reentrant-mesh-connections', { attemptsBeforeFirstOpen: meshAttempts, boundedByProbe: true });
  rm.leave(); runtime.roomState.discordUI?.destroy(); session.dispose();
}

// The advertised random-ID retry keeps selecting the occupied custom ID.
{
  const ids = [];
  globalThis.Peer = class extends Peer {
    constructor(id) { super(id); ids.push(this.id); }
    emit(type, ...args) {
      if (type === 'open' && ids.length < 4) return super.emit('error', { type: 'unavailable-id' });
      return super.emit(type, ...args);
    }
  };
  const runtime = createStreamerSession(); const session = createSessionContext();
  runtime.streamerState.customId = 'occupied-custom-id';
  const originalError = console.error; console.error = () => {};
  try { await runtime.initStreamerPeer('occupied-custom-id', session); } finally { console.error = originalError; }
  assert.deepEqual(ids, Array(4).fill('occupied-custom-id'));
  record('custom-id-retry-never-randomizes', { requestedIds: ids });
  session.dispose(); globalThis.Peer = Peer;
}

// Updates of existing elements bypass the validator applied to additions.
{
  const board = new WhiteboardManager();
  board.addElement({ id: 'element-1', type: 'pencil', points: [{ x: 1, y: 1 }] }, false);
  const invalid = { id: 'element-1', type: 'pencil', points: [null, null] };
  assert.equal(isSafeWhiteboardElement(invalid), false);
  board.updateElement(invalid, false);
  assert.equal(board.elements[0], invalid);
  assert.throws(() => board.renderPencil({ beginPath() {}, moveTo() {} }, invalid), TypeError);
  record('whiteboard-update-validation-bypass', { rejectedByValidator: true, persistedByUpdate: true, renderThrows: true });
  board.setCanvas(null);
}

// Permission denial after successful screen acquisition leaves the screen track alive.
{
  let stopped = 0;
  const track = new EventTarget(); track.kind = 'video'; track.readyState = 'live'; track.stop = () => { stopped++; track.readyState = 'ended'; };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [], addTrack() {} };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia: async () => stream, getUserMedia: async () => { throw new Error('microphone denied'); } } });
  const runtime = createRoomSession(); const app = await runtime.initRoomApp();
  app.state.roomManager = new RoomManager({ roomId: 'audit-room' });
  const originalError = console.error; console.error = () => {};
  try { await app.startCapture({ audioMode: 'mic' }); } finally { console.error = originalError; }
  assert.equal(app.state.localStream, null); assert.equal(stopped, 0);
  app.dispose(); assert.equal(stopped, 0);
  record('room-capture-leak-on-microphone-denial', { stoppedTracksAfterFailureAndDispose: stopped, trackedStream: false });
  track.stop();
}

// Browser "Stop sharing" does not run the Streamer's stopCapture path.
{
  const track = new EventTarget(); track.kind = 'video'; track.readyState = 'live'; track.stop = () => { track.readyState = 'ended'; };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
  navigator.mediaDevices.getDisplayMedia = async () => stream;
  const runtime = createStreamerSession(); const app = await runtime.initStreamerApp();
  await app.startCapture({ audioMode: 'none' });
  track.readyState = 'ended'; track.dispatchEvent(new Event('ended'));
  assert.equal(app.state.localStream, stream);
  record('streamer-ended-track-retains-streaming-state', { endedTrack: true, localStreamStillPresent: true });
  app.dispose();
}

// The card offers Co-op, but the Viewer supplies no callback to wire the button.
{
  document.body.innerHTML = '<div id="video-grid"></div>';
  dom.window.HTMLMediaElement.prototype.play = async () => {};
  dom.window.HTMLMediaElement.prototype.pause = () => {};
  const runtime = createViewerSession(); const session = createSessionContext();
  runtime.viewerState.session = session;
  const peer = await runtime.initViewerPeer(session);
  const call = new Call('trusted-host'); peer.emit('call', call);
  const stream = { getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] };
  call.emit('stream', stream);
  const button = document.getElementById('btn-coop-trusted-host');
  assert.ok(button); assert.equal(button.onclick, null);
  record('viewer-coop-button-has-no-handler', { buttonRendered: true, onclick: button.onclick });
  call.close(); session.dispose(); document.body.innerHTML = '';
}

// The envelope identity does not constrain the identity inside a chat message.
{
  const session = createSessionContext(); const chatManager = new ChatManager();
  bindSessionMessageHandlers(session, { role: 'streamer', chatManager });
  const result = session.dispatcher.dispatch({ type: 'CHAT_MESSAGE', senderPeerId: 'guest', message: { id: 'forged-chat', senderId: 'host', senderName: 'Host', role: 'host', channel: 'geral', text: 'forged-author' } }, { peer: 'guest' });
  assert.equal(result.handled, true);
  assert.equal(chatManager.getMessages()[0].senderId, 'host');
  record('chat-author-spoofing', { transportPeer: 'guest', storedAuthor: chatManager.getMessages()[0].senderId });
  session.dispose();
}

// One large image uses the unchunked full-sync path, exceeding the Room transport limit.
{
  const session = createSessionContext(); const board = new WhiteboardManager();
  board.addElement({ id: 'large-image', type: 'image', startX: 0, startY: 0, endX: 20, endY: 20, dataUrl: 'data:image/png;base64,' + 'A'.repeat(300000) }, false);
  const plugin = new WhiteboardPlugin({ manager: board });
  session.pluginManager.register(plugin); session.pluginManager.initAll({ isRoomMode: () => true });
  const conn = new Connection('late-viewer'); conn.open = true;
  session.dispatcher.dispatch({ type: 'WHITEBOARD_REQUEST_SYNC' }, conn);
  assert.equal(conn.sent.length, 1); assert.equal(conn.sent[0].type, 'WHITEBOARD_SYNC');
  assert.equal(isWithinMessageLimit(conn.sent[0]), false);
  record('whiteboard-late-sync-exceeds-room-limit', { imageCharacters: 300000, messagesSent: conn.sent.length, acceptedByRoomByteLimit: false });
  session.dispose();
}

// A live member is treated as a stale session solely because its display name matches.
{
  const rm = new RoomManager({ roomId: 'name-collision' }); rm.join('room-host', true);
  const first = new Connection('first-guest'); first.open = true;
  const second = new Connection('second-guest'); second.open = true;
  rm.registerConnection(first.peer, first);
  rm.handleRoomMessage(first.peer, { type: 'ROOM_JOIN_REQUEST', name: 'Player', clientSessionId: 'first-tab' }, first);
  rm.registerConnection(second.peer, second);
  rm.handleRoomMessage(second.peer, { type: 'ROOM_JOIN_REQUEST', name: 'Player', clientSessionId: 'second-tab' }, second);
  assert.equal(rm.members.has(first.peer), false); assert.equal(rm.members.has(second.peer), true);
  record('duplicate-display-name-removes-live-member', { firstMemberStillConnected: first.open, firstMemberStillAuthorized: rm.isPeerAuthorized(first.peer), differentSessions: true });
  rm.leave();
}

// Production HTTPS fallback still contains the development OpenRelay credentials.
{
  dom.reconfigure({ url: 'https://seemygame.vercel.app/viewer.html' });
  const turns = getPeerConfig().config.iceServers.filter(server => /^turns?:/.test(server.urls));
  assert.ok(turns.length > 0);
  record('production-static-turn-fallback', { productionOrigin: window.location.origin, publicTurnEntries: turns.length });
}
console.log(JSON.stringify({ confirmed: results.length, results }, null, 2));
dom.window.close();
