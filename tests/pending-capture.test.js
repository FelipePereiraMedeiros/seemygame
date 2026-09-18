import { afterEach, describe, expect, it } from 'vitest';
import { BrowserCaptureProvider, CaptureManager } from '../js/capture.js';
import { MockMediaStream, MockMediaStreamTrack } from './mocks/webrtc.mock.js';

describe('Pendência: cancelar e reiniciar captura', () => {
  const streams = [];
  afterEach(() => streams.splice(0).forEach(s => s.getTracks().forEach(t => t.stop())));

  it.each(['old-first', 'new-first'])('preserva B quando A termina atrasada (%s)', async (order) => {
    const resolve = [];
    const provider = new BrowserCaptureProvider({
      mediaDevices: { getDisplayMedia: () => new Promise(r => resolve.push(r)) }
    });
    const manager = new CaptureManager({ browserProvider: provider });
    const a = new MockMediaStream([new MockMediaStreamTrack('video')]);
    const b = new MockMediaStream([new MockMediaStreamTrack('video')]);
    streams.push(a, b);
    const first = manager.start().catch(error => error);
    await manager.stop();
    const second = manager.start().catch(error => error);

    if (order === 'old-first') {
      resolve[0](a);
      await first;
      resolve[1](b);
    } else {
      resolve[1](b);
      await second;
      resolve[0](a);
    }
    const [cancelled, current] = await Promise.all([first, second]);
    expect.soft(cancelled.name).toBe('CaptureCancelledError');
    expect.soft(current.stream).toBe(b);
    expect.soft(manager.state).toBe('live');
    expect.soft(manager.session).not.toBeNull();
    expect.soft(a.getVideoTracks()[0].readyState).toBe('ended');
    expect.soft(b.getVideoTracks()[0].readyState).toBe('live');
    await manager.stop();
    expect(b.getVideoTracks()[0].readyState).toBe('ended');
  });
});
