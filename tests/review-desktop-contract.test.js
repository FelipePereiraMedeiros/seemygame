import { afterEach, expect, it, vi } from 'vitest';
import { startNativeCapture } from '../js/desktop.js';
afterEach(() => { delete window.__TAURI_INTERNALS__; });
it('L02: resolução/FPS/bitrate atravessam o adaptador IPC real', async () => {
  const invoke = vi.fn(async () => ({ session_id: 'review' }));
  window.__TAURI_INTERNALS__ = { invoke };
  await startNativeCapture({ sourceId: 'opaque', width: 1280, height: 720, fps: 30, bitrateKbps: 4000 });
  expect(invoke).toHaveBeenCalledWith('start_native_capture', expect.objectContaining({ width: 1280, height: 720, fps: 30, bitrateKbps: 4000 }));
});
