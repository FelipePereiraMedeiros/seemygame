import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoomSession } from '../js/session/room-session.js';
import { NativeCaptureProvider } from '../js/capture.js';
import { MockMediaStream, MockMediaStreamTrack, MockRTCPeerConnection, MockRTCRtpSender } from './mocks/webrtc.mock.js';

let runtime;
afterEach(() => { runtime?.dispose(); runtime = null; vi.restoreAllMocks(); });

async function roomFixture() {
  localStorage.clear();
  document.body.innerHTML = '<div id="video-grid"></div><div id="toast-container"></div>';
  const factory = createRoomSession();
  runtime = await factory.initRoomApp();
  const stream = new MockMediaStream([new MockMediaStreamTrack('video')]);
  const trackEvents = new EventTarget();
  stream.getVideoTracks()[0].addEventListener = trackEvents.addEventListener.bind(trackEvents);
  const pc = new MockRTCPeerConnection();
  const sender = new MockRTCRtpSender(stream.getVideoTracks()[0]);
  pc._senders = [sender];
  const listeners = new Map();
  const call = { peer: 'viewer', peerConnection: pc,
    on: (event, callback) => listeners.set(event, callback),
    close: vi.fn(() => { pc.close(); listeners.get('close')?.(); }) };
  const connection = { peer: 'viewer', open: true };
  runtime.state.peer = { call: vi.fn(() => call), destroy: vi.fn() };
  runtime.state.roomManager = { userName: 'Host', myPeerId: 'host',
    meshConnections: new Map([['viewer', connection], ['unauthorized', { peer: 'unauthorized', open: true }]]),
    isPeerAuthorized: id => id === 'viewer', setLocalStreaming: vi.fn(), broadcast: vi.fn(), leave: vi.fn() };
  const native = runtime.state.features.nativeMedia;
  vi.spyOn(native, 'broadcastTo').mockReturnValue(false);
  vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockResolvedValue(stream);
  return { stream, pc, sender, call, native, connection };
}

describe('Room media after modularization', () => {
  it('applies negotiated FPS/bitrate, excludes unauthorized peers and cleans up on stop', async () => {
    const { sender, call } = await roomFixture();
    await runtime.startCapture({ audioMode: 'none', bitrateKbps: 4500, fps: 60 });
    expect(runtime.state.peer.call).toHaveBeenCalledTimes(1);
    const initialTransform=runtime.state.peer.call.mock.calls[0][2].sdpTransform;
    const initialOffer='m=video 9 UDP/TLS/RTP/SAVPF 96 102\r\na=rtpmap:96 VP8/90000\r\na=rtpmap:102 H264/90000\r\n';
    expect(initialTransform(initialOffer)).toContain('SAVPF 102 96');
    await vi.waitFor(() => expect(sender.getParameters().encodings[0].maxBitrate).toBe(4500000));
    expect(sender.getParameters().encodings[0]).toMatchObject({ maxBitrate: 4500000, maxFramerate: 60 });
    expect(sender.track.contentHint).toBe('motion');
    runtime.stopCapture();
    expect(call.close).toHaveBeenCalledTimes(1);
    expect(runtime.state.screenCalls.size).toBe(0);
  });

  it('uses direct native transport for existing spectators without a browser re-encode', async () => {
    const { stream, native, connection } = await roomFixture();
    native.broadcastTo.mockReturnValue(true);
    vi.spyOn(NativeCaptureProvider.prototype, 'start').mockImplementation(async function () {
      this.session = { sessionId: 'capture-test' }; this.stream = stream;
      return { stream, session: this.session };
    });
    vi.spyOn(NativeCaptureProvider.prototype, 'stop').mockResolvedValue({ state: 'idle' });
    await runtime.startCapture({ sourceId: 'dedicated-source', audioMode: 'none' });
    expect(native.broadcastTo).toHaveBeenCalledWith(connection);
    expect(runtime.state.peer.call).not.toHaveBeenCalled();
    expect(runtime.state.screenCalls.size).toBe(0);
  });
});
