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

describe('syncMediaControlsEnvironment (Web vs Desktop)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="video-codec-select">
        <option value="h264">H.264</option>
        <option value="av1">AV1</option>
        <option value="hevc">HEVC</option>
      </select>
      <div id="video-codec-note"></div>
      <div id="h264-encoder-group" style="display: block;">
        <select id="h264-encoder-select">
          <option value="auto">Auto</option>
          <option value="cpu">CPU</option>
        </select>
      </div>
    `;
    delete globalThis.__TAURI_INTERNALS__;
    delete globalThis.__TAURI__;
  });

  afterEach(() => {
    delete globalThis.__TAURI_INTERNALS__;
    delete globalThis.__TAURI__;
  });

  it('no ambiente Web: mantém encoder visível, gerenciado pelo navegador, sem confundir codec e encoder', async () => {
    const { syncMediaControlsEnvironment } = await import('../js/app.js');
    syncMediaControlsEnvironment();

    const encoderGroup = document.getElementById('h264-encoder-group');
    const codecSelect = document.getElementById('video-codec-select');
    const note = document.getElementById('video-codec-note');

    expect(encoderGroup.style.display).not.toBe('none');
    expect(document.getElementById('h264-encoder-select').disabled).toBe(true);
    expect(codecSelect.value).toBe('h264');

    const optAv1 = Array.from(codecSelect.options).find(o => o.value === 'av1');
    const optHevc = Array.from(codecSelect.options).find(o => o.value === 'hevc');
    const optH264 = Array.from(codecSelect.options).find(o => o.value === 'h264');

    expect(optAv1.disabled).toBe(false);
    expect(optHevc.disabled).toBe(false);
    expect(optH264.disabled).toBe(false);
    expect(note.textContent).toContain('No navegador');
  });

  it('no ambiente Desktop: exibe encoder quando H.264 e permite todos os codecs', async () => {
    globalThis.__TAURI_INTERNALS__ = { invoke: vi.fn() };
    const { syncMediaControlsEnvironment, syncH264EncoderVisibility } = await import('../js/app.js');

    syncMediaControlsEnvironment();

    const encoderGroup = document.getElementById('h264-encoder-group');
    const codecSelect = document.getElementById('video-codec-select');
    const note = document.getElementById('video-codec-note');

    expect(encoderGroup.style.display).not.toBe('none');

    const optAv1 = Array.from(codecSelect.options).find(o => o.value === 'av1');
    const optHevc = Array.from(codecSelect.options).find(o => o.value === 'hevc');
    expect(optAv1.disabled).toBe(false);
    expect(optHevc.disabled).toBe(false);
    expect(note.textContent).toContain('Pipeline nativo');

    // AV1 mantém o campo separado e identifica o encoder por CPU.
    codecSelect.value = 'av1';
    syncH264EncoderVisibility();
    expect(encoderGroup.style.display).not.toBe('none');
    expect(document.getElementById('h264-encoder-select').disabled).toBe(false);
  });
});

