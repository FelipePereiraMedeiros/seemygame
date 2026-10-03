import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initGreenRoomLobby } from '../js/app/green-room.js';

let cleanup;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function ports() {
  return { getRoomInfoFromUrl: () => ({ roomId: 'lifecycle' }), isAudioOutputSupported: () => false,
    getAudioDevices: async () => ({ microphones: [], speakers: [] }), populateDeviceSelect: vi.fn(),
    getSavedAudioPreferences: () => ({}), saveAudioPreference: vi.fn(), getAudioContext: () => null,
    voiceManager: { setMuted: vi.fn() }, watchDeviceChanges: vi.fn(() => vi.fn()),
    registerCleanup: callback => { cleanup = callback; }, onProceed: vi.fn() };
}
beforeEach(() => {
  cleanup = null;
  document.body.innerHTML = '<div id="green-room-modal"><button id="green-room-join-btn">Entrar</button><button id="green-room-toggle-mic-btn">Mic</button><select id="green-room-mic-select"></select><input id="green-room-user-name" value="Tester"></div>';
});
afterEach(() => { cleanup?.(); vi.restoreAllMocks(); });
describe('Green Room: lifecycle after modularization', () => {
  it('stops a microphone granted after the session was disposed', async () => {
    let resolvePermission;
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(() => new Promise(resolve => { resolvePermission = resolve; }));
    const context = ports();
    await initGreenRoomLobby(context);
    cleanup();
    const track = { stop: vi.fn() };
    resolvePermission({ getTracks: () => [track] });
    await flush();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.onProceed).not.toHaveBeenCalled();
    expect(document.getElementById('green-room-join-btn').onclick).toBeNull();
  });
  it('transfers mute to the room and releases preview and device watcher on join', async () => {
    const track = { stop: vi.fn(), enabled: true };
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] });
    const context = ports();
    await initGreenRoomLobby(context); await flush();
    document.getElementById('green-room-toggle-mic-btn').click();
    expect(track.enabled).toBe(false);
    document.getElementById('green-room-join-btn').click();
    expect(context.voiceManager.setMuted).toHaveBeenCalledWith(true);
    expect(context.onProceed).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.watchDeviceChanges.mock.results[0].value).toHaveBeenCalledOnce();
    document.getElementById('green-room-join-btn').click();
    expect(context.onProceed).toHaveBeenCalledOnce();
  });

  it('recupera com fallback gracioso quando o dispositivo preferencial falha com OverconstrainedError', async () => {
    const fallbackTrack = { stop: vi.fn(), enabled: true };
    const overconstrainedErr = new DOMException('Device not found', 'OverconstrainedError');

    // Primeira chamada rejeita com OverconstrainedError; segunda chamada (fallback) sucede
    const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
      .mockRejectedValueOnce(overconstrainedErr)
      .mockResolvedValueOnce({ getTracks: () => [fallbackTrack], getAudioTracks: () => [fallbackTrack] });

    const context = ports();
    context.getSavedAudioPreferences = () => ({ inputId: 'stale-broken-device-id' });

    await initGreenRoomLobby(context);
    await flush();

    expect(getUserMediaSpy).toHaveBeenCalledTimes(2);
    // Deve limpar a preferência de microfone inválida
    expect(context.saveAudioPreference).toHaveBeenCalledWith('input', '');
  });
});

