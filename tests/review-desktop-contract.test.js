import { afterEach, expect, it, vi } from 'vitest';
import { startNativeCapture } from '../js/desktop.js';
afterEach(() => { delete window.__TAURI_INTERNALS__; });
it('L02: resolução/FPS/bitrate atravessam o adaptador IPC real', async () => {
  const invoke = vi.fn(async () => ({ session_id: 'review' }));
  window.__TAURI_INTERNALS__ = { invoke };
  await startNativeCapture({ sourceId: 'opaque', width: 1280, height: 720, fps: 30, bitrateKbps: 4000 });
  expect(invoke).toHaveBeenCalledWith('start_native_capture', expect.objectContaining({ width: 1280, height: 720, fps: 30, bitrateKbps: 4000 }));
});

it('encaminha videoCodec e h264Encoder para o comando IPC start_native_capture', async () => {
  const invoke = vi.fn(async () => ({ session_id: 'review', video_codec: 'h264', h264_encoder: 'cpu' }));
  window.__TAURI_INTERNALS__ = { invoke };
  const state = await startNativeCapture({
    sourceId: 'window:123',
    videoCodec: 'h264',
    h264Encoder: 'cpu',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateKbps: 8000
  });
  expect(invoke).toHaveBeenCalledWith('start_native_capture', expect.objectContaining({
    videoCodec: 'h264',
    h264Encoder: 'cpu'
  }));
  expect(state.h264Encoder).toBe('cpu');
});

