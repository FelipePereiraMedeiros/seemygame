import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockMediaStream, MockMediaStreamTrack, MockRTCPeerConnection } from './mocks/webrtc.mock.js';
const desktop = vi.hoisted(() => ({
  isDesktopApp: () => true,
  createNativeCapturePeer: vi.fn(async () => ({ type: 'answer', sdp: 'v=0' })),
  addNativeCaptureIceCandidate: vi.fn(async () => {}), closeNativeCapturePeer: vi.fn(async () => {}),
  stopNativeCapture: vi.fn(async () => {}), startNativeCapture: vi.fn(async () => ({ sessionId: 'review-session' })),
  getNativeCaptureState: vi.fn(), setNativeCaptureAudioMode: vi.fn(), listenNativeCapture: vi.fn(),
  listenNativeCaptureBridge: vi.fn(async () => () => {}), logDiagnostic: vi.fn()
}));
vi.mock('../js/desktop.js', () => desktop);
import { createNativeWebRtcBridge } from '../js/native-webrtc.js';
import { NativeCaptureProvider } from '../js/capture.js';
let connection, bridge, video;
class Connection extends MockRTCPeerConnection {
  constructor() { super(); connection = this; this.iceGatheringState = 'complete'; }
  addTransceiver(...args) { const t = super.addTransceiver(...args); t.receiver.jitterBufferTarget = 100; t.receiver.playoutDelayHint = 0.1; return t; }
  async setRemoteDescription(sdp) {
    await super.setRemoteDescription(sdp);
    const stream = new MockMediaStream([new MockMediaStreamTrack('video')]);
    const e = new Event('track'); e.track = stream.getVideoTracks()[0]; e.streams = [stream]; this.dispatchEvent(e);
  }
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('RTCPeerConnection', Connection);
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((name, ...args) => { const el = create(name, ...args); if (name === 'video') video = el; return el; });
  bridge = createNativeWebRtcBridge();
});
afterEach(async () => { await bridge.closeStream('review-session'); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('R09: SDP/trilha sem frame não é transmissão pronta', async () => {
  let done = false;
  const result = bridge.createStream({ sessionId: 'review-session' }).then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(0);
  expect(done).toBe(false); expect(video).toBeTruthy();
  video.dispatchEvent(new Event('loadeddata')); await result;
  expect(done).toBe(true);
});
it('R09: ausência de frames termina com erro e desmonta ponte', async () => {
  const result = bridge.createStream({ sessionId: 'review-session' }).catch(e => e);
  await vi.advanceTimersByTimeAsync(11000);
  expect(await result).toBeInstanceOf(Error);
  expect(desktop.closeNativeCapturePeer).toHaveBeenCalledWith('review-session');
});
it('R09: falha ICE após primeiro frame também encerra worker', async () => {
  const result = bridge.createStream({ sessionId: 'review-session' });
  await vi.advanceTimersByTimeAsync(0); video.dispatchEvent(new Event('loadeddata')); await result;
  connection.connectionState = 'failed'; connection.dispatchEvent(new Event('connectionstatechange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(desktop.stopNativeCapture).toHaveBeenCalledWith('review-session');
});
it('L04: receptor local usa alvo de jitter apropriado ao loopback', async () => {
  const result = bridge.createStream({ sessionId: 'review-session' });
  await vi.advanceTimersByTimeAsync(0); video.dispatchEvent(new Event('loadeddata')); await result;
  expect(connection.getTransceivers()[0].receiver.jitterBufferTarget).toBeLessThanOrEqual(20);
});
it('L02: perfil de qualidade chega ao comando nativo', async () => {
  const stream = new MockMediaStream([new MockMediaStreamTrack('video')]);
  const provider = new NativeCaptureProvider({ mediaBridge: { createStream: async () => stream } });
  await provider.start({ sourceId: 'opaque-source', width: 1280, height: 720, fps: 30, bitrateKbps: 4000 });
  expect(desktop.startNativeCapture).toHaveBeenCalledWith(expect.objectContaining({ width: 1280, height: 720, fps: 30, bitrateKbps: 4000 }));
  await provider.stop();
});
