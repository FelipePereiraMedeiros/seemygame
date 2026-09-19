import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockMediaStream, MockMediaStreamTrack } from './mocks/webrtc.mock.js';
import { NativeCaptureProvider } from '../js/capture.js';
import * as desktop from '../js/desktop.js';

describe('H.264 Encoder UI & Provider Integration', () => {
  let startNativeSpy;
  let mockBridge;

  beforeEach(() => {
    startNativeSpy = vi.spyOn(desktop, 'startNativeCapture').mockImplementation(async (opts) => ({
      sessionId: 'test-session-123',
      videoCodec: opts.videoCodec || 'h264',
      h264Encoder: opts.h264Encoder || 'auto'
    }));

    mockBridge = {
      createStream: vi.fn().mockResolvedValue(new MockMediaStream([
        new MockMediaStreamTrack('video')
      ])),
      closeStream: vi.fn().mockResolvedValue(undefined)
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('repassa h264Encoder para startNativeCapture através do NativeCaptureProvider', async () => {
    const provider = new NativeCaptureProvider({ mediaBridge: mockBridge });
    const result = await provider.start({
      sourceId: 'window:456',
      videoCodec: 'h264',
      h264Encoder: 'cpu',
      width: 1920,
      height: 1080,
      fps: 60,
      bitrateKbps: 8000
    });

    expect(startNativeSpy).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'window:456',
      videoCodec: 'h264',
      h264Encoder: 'cpu'
    }));
    expect(result.session.h264Encoder).toBe('cpu');
  });

  it('permite valor default auto para h264Encoder quando não especificado', async () => {
    const provider = new NativeCaptureProvider({ mediaBridge: mockBridge });
    const result = await provider.start({
      sourceId: 'window:789'
    });

    expect(startNativeSpy).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'window:789',
      h264Encoder: null
    }));
    expect(result.session.h264Encoder).toBe('auto');
  });
});
