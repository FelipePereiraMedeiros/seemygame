import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClipRecorder } from '../js/clipping.js';
import { handleHostCoopMessage, registerCoopPromptHandler, revokeAllCoopPlayers, setCoopEnabled, setMaxCoopPlayers, isTauriEnvironment } from '../js/coop.js';

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); setCoopEnabled(true); setMaxCoopPlayers(1); });
afterEach(() => { revokeAllCoopPlayers(); delete window.__TAURI_INTERNALS__; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('R10: flush aguarda bloco atrasado ou rejeita explicitamente, nunca confirma exportação incompleta', async () => {
  const recorder = new ClipRecorder();
  const media = new EventTarget();
  media.state = 'recording';
  media.requestData = () => setTimeout(() => media.dispatchEvent(new Event('dataavailable')), 350);
  recorder.mediaRecorder = media;
  let outcome = 'pending';
  const flush = recorder.flushPendingData().then(() => { outcome = 'complete'; }, () => { outcome = 'error'; });
  await vi.advanceTimersByTimeAsync(150);
  expect.soft(outcome, '120 ms não comprovam entrega do último bloco').not.toBe('complete');
  await vi.advanceTimersByTimeAsync(300);
  await flush;
});

it('R10: timeout do flush remove o listener pendente', async () => {
  const recorder = new ClipRecorder();
  const media = new EventTarget();
  media.state = 'recording'; media.requestData = vi.fn();
  const remove = vi.spyOn(media, 'removeEventListener'); recorder.mediaRecorder = media;
  const flush = recorder.flushPendingData().catch(() => {});
  await vi.advanceTimersByTimeAsync(15000); await flush;
  expect(remove).toHaveBeenCalledWith('dataavailable', expect.any(Function));
});

it('R06: __TAURI_INTERNALS__ funciona e driver rejeitado não anuncia capacidade', async () => {
  window.__TAURI_INTERNALS__ = { invoke: vi.fn().mockRejectedValue(new Error('driver ausente')) };
  expect(isTauriEnvironment()).toBe(true);
  const conn = { peer: 'review-player', send: vi.fn() };
  registerCoopPromptHandler(({ approve }) => approve());
  handleHostCoopMessage(conn.peer, { type: 'COOP_REQUEST' }, conn);
  await vi.advanceTimersByTimeAsync(0);
  expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'COOP_RESPONSE', approved: false }));
  expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ gamepad: true }));
});

it('R06: revogar enquanto plug está pendente impede aprovação tardia', async () => {
  let resolvePlug;
  window.__TAURI_INTERNALS__ = { invoke: vi.fn(cmd => cmd === 'plug_virtual_gamepad' ? new Promise(r => { resolvePlug = r; }) : Promise.resolve()) };
  const conn = { peer: 'review-player', send: vi.fn() };
  registerCoopPromptHandler(({ approve }) => approve());
  handleHostCoopMessage(conn.peer, { type: 'COOP_REQUEST' }, conn);
  expect(resolvePlug).toBeTypeOf('function');
  revokeAllCoopPlayers(); conn.send.mockClear(); resolvePlug();
  await vi.advanceTimersByTimeAsync(0);
  expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ approved: true }));
});
