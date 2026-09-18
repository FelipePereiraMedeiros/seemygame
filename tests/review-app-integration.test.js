import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockMediaStream, MockMediaStreamTrack, MockRTCPeerConnection } from './mocks/webrtc.mock.js';
class Connection {
  constructor(peer) { this.peer = peer; this.open = true; this.events = {}; this.send = vi.fn(); this.answer = vi.fn(); this.close = vi.fn(); }
  on(e, cb) { this.events[e] = cb; } emit(e, ...args) { return this.events[e]?.(...args); }
}
class Peer extends Connection {
  static instances = [];
  constructor() { super('review-local'); this.destroyed = false; Peer.instances.push(this); this.connect = vi.fn(id => new Connection(id)); this.call = vi.fn(id => { const c = new Connection(id); c.peerConnection = new MockRTCPeerConnection(); return c; }); }
  destroy() { this.destroyed = true; }
}
let app, peer, voice;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); Peer.instances = [];
  vi.stubGlobal('Peer', Peer); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  localStorage.clear(); document.body.innerHTML = '<div id="video-grid"></div><div id="toast-container"></div>';
  app = await import('../js/app.js'); voice = (await import('../js/voice.js')).voiceManager;
  peer = app.initPeer(); peer.emit('open', 'review-local');
});
afterEach(async () => { await app?.stopLocalStream?.(); voice?.leaveVoice(); app?.roomManager?.leave?.(); peer?.destroy(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('R01: conectar dados sem PIN não dá acesso ao microfone', () => {
  localStorage.setItem('seemygame_streamer_pin', '1234');
  const conn = new Connection('review-attacker'); peer.emit('connection', conn); conn.emit('open');
  voice.localStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  const call = new Connection(conn.peer); app.handleIncomingVoiceCall(call);
  expect(call.answer).not.toHaveBeenCalled(); expect(call.close).toHaveBeenCalled();
});
it('R01: sinal de voz não pode redirecionar microfone para terceiro', () => {
  voice.isInVoice = true; voice.localStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  app.handleIncomingP2PMessage({ type: 'VOICE_SIGNAL', action: 'HOST_VOICE_ACTIVE', peerId: 'review-third' }, new Connection('review-sender'));
  expect(peer.call).not.toHaveBeenCalled();
});
it('R02: sync de outra sala vindo do master autenticado não cria conexões', () => {
  app.setupRoomSession('review-local');
  const room = app.roomManager; room.masterPeerId = 'review-master';
  const conn = new Connection(room.masterPeerId);
  peer.emit('connection', conn); conn.emit('open');
  room.promoteConnection(conn.peer, conn, { isMaster: true });
  expect(room.isPeerAuthorized(conn.peer)).toBe(true);
  peer.connect.mockClear();
  conn.emit('data', { type: 'ROOM_SYNC_ALL', roomId: 'definitely-other-room', members: [{ peerId: 'review-injected' }] });
  expect(room.members.has('review-injected')).toBe(false);
  expect(peer.connect).not.toHaveBeenCalledWith('review-injected', expect.anything());
});
it('R07: broadcast não vaza para participante aguardando PIN', () => {
  localStorage.setItem('seemygame_streamer_pin', '1234');
  const conn = new Connection('review-pending'); peer.emit('connection', conn); conn.emit('open'); conn.send.mockClear();
  app.broadcastDataMessage({ type: 'CHAT_MESSAGE', message: { id: 'review-private', text: 'private' } });
  expect(conn.send).not.toHaveBeenCalled();
});
it('R07: mensagem repetida é processada uma única vez', async () => {
  const chat = (await import('../js/chat.js')).chatManager; chat.clearChannel('geral');
  const conn = new Connection('review-sender');
  const message = { type: 'CHAT_MESSAGE', msgId: 'review-dedup', message: { id: 'review-dedup', text: 'hello', channel: 'geral', senderId: conn.peer, senderName: 'Review', role: 'viewer', timestamp: Date.now() } };
  app.handleIncomingP2PMessage(message, conn); app.handleIncomingP2PMessage(message, conn);
  expect(chat.getMessages('geral')).toHaveLength(1);
});
it('R08: entrada direta não constrói Peer antes do TURN pendente', async () => {
  peer.destroy();
  const config = await import('../js/config.js'); config._resetDynamicIceCache();
  let settle; vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { settle = r; })));
  const ready = config.fetchIceServersFromApi(); const before = Peer.instances.length;
  app.initPeer();
  const premature = Peer.instances.length > before;
  settle({ ok: false }); await ready;
  expect(premature).toBe(false);
});

it('L03: replay pode ser desativado sem impedir transmissão', async () => {
  const registry = (await import('../js/clipping.js')).clipRecorder;
  const recording = vi.spyOn(registry, 'start');
  await app.startLocalStream({ replayEnabled: false });
  expect(recording).not.toHaveBeenCalled();
});

it('L08: telemetria de uma chamada alimenta o ABR com o peer correto', async () => {
  const abr = (await import('../js/abr.js')).adaptiveBitrateController;
  const sample = vi.spyOn(abr, 'processSample');
  const conn = new Connection('review-viewer'); peer.emit('connection', conn); conn.emit('open');
  await app.startLocalStream(); await vi.advanceTimersByTimeAsync(1000);
  expect(sample).toHaveBeenCalled();
  expect(sample.mock.calls.every(args => args[1] === conn.peer)).toBe(true);
});
