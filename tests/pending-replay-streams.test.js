import { afterEach, expect, it, vi } from 'vitest';
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

let app;
afterEach(() => {
  app?.disconnectHost('replay-host-a');
  app?.disconnectHost('replay-host-b');
  Recorder.instances.forEach(r => r.stop());
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('mantém buffers independentes quando dois hosts transmitem e um encerra', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('Peer', Peer);
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  localStorage.clear();
  document.body.innerHTML = '<div id="video-grid"></div><div id="toast-container"></div>';
  app = await import('../js/app.js');
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
  expect(Recorder.instances).toHaveLength(2);
  expect.soft(Recorder.instances[0].state, 'B não pode parar o buffer de A').toBe('recording');
  expect(Recorder.instances[1].state).toBe('recording');
  calls[0].emit('close');
  expect(Recorder.instances[1].state, 'Encerrar A não pode parar o buffer de B').toBe('recording');
});
