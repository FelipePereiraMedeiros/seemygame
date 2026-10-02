import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import { MockMediaStream, MockMediaStreamTrack } from './mocks/webrtc.mock.js';

class Connection {
  constructor(peer) { this.peer = peer; this.events = {}; this.open = true; }
  on(name, callback) { this.events[name] = callback; }
  emit(name, ...args) { this.events[name]?.(...args); }
  send() {}
  answer() {}
  close() { this.open = false; }
}
class Peer extends Connection {
  constructor() { super('local-review-peer'); this.destroyed = false; }
  connect(id) { return new Connection(id); }
  destroy() { this.destroyed = true; }
}
class Recorder {
  static instances = [];
  static isTypeSupported = () => true;
  constructor(stream) { this.stream = stream; Recorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
}

let app, clipRecorder;
afterEach(() => {
  app?.disconnectHost('replay-host-a');
  app?.disconnectHost('replay-host-b');
  Recorder.instances.forEach(r => r.stop());
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

// Module linking belongs to setup, outside the timed replay behavior and fake clock.
beforeAll(async () => {
  vi.stubGlobal('Peer', Peer);
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  localStorage.clear();
  document.body.innerHTML = '<div id="video-grid"></div><div id="toast-container"></div>';
  app = await import('../js/app.js');
  ({ clipRecorder } = await import('../js/clipping.js'));
}, 15000);

it('grava somente o host selecionado e preserva seu replay quando outro encerra', async () => {
  vi.useFakeTimers();
  // This unit fixture mocks tracks, not canvas capture. The real reduced
  // recording profile and clip decoding are covered by the browser E2E.
  clipRecorder.setPreferences({ enabled: true, profile: 'source' });
  app.initLegacyBindings();
  const peer = await app.initPeer();
  peer.emit('open', 'local-review-peer');
  const calls = [];
  for (const host of ['replay-host-a', 'replay-host-b']) {
    await app.watchFriend(host);
    const call = new Connection(host);
    peer.emit('call', call);
    call.emit('stream', new MockMediaStream([new MockMediaStreamTrack('video')]));
    calls.push(call);
  }
  expect(Recorder.instances).toHaveLength(1);
  expect(Recorder.instances[0].state, 'Chegada de B não deve reiniciar A').toBe('recording');
  expect(clipRecorder.sources.size).toBe(2);
  clipRecorder.selectSource('replay-host-b');
  expect(Recorder.instances).toHaveLength(2);
  expect(Recorder.instances[0].state).toBe('inactive');
  expect(Recorder.instances[1].state).toBe('recording');
  calls[0].emit('close');
  expect(Recorder.instances[1].state, 'Encerrar A não pode parar o buffer de B').toBe('recording');
});
