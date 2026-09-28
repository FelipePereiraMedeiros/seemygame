import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildDisplayMediaOptions, requestBrowserDisplayMedia } from '../js/browser-capture.js';

afterEach(() => vi.restoreAllMocks());

describe('Seletor web: áudio e falhas de captura', () => {
  it('solicita áudio de sistema com parâmetros de alta fidelidade sem APM e windowAudio system', () => {
    const options = buildDisplayMediaOptions({ audioMode: 'system' });
    expect(options.audio).toMatchObject({
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      suppressLocalAudioPlayback: false,
      restrictOwnAudio: true
    });
    expect(options.systemAudio).toBe('include');
    expect(options.windowAudio).toBe('system');
  });

  it('solicita windowAudio window quando modo for process (janela isolada)', () => {
    const options = buildDisplayMediaOptions({ audioMode: 'process' });
    expect(options.audio).toMatchObject({
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      suppressLocalAudioPlayback: false,
      restrictOwnAudio: true
    });
    expect(options.systemAudio).toBe('include');
    expect(options.windowAudio).toBe('window');
  });

  it('permite sobrescrever windowAudio explicitamente se fornecido', () => {
    const options = buildDisplayMediaOptions({ audioMode: 'system', windowAudio: 'window' });
    expect(options.windowAudio).toBe('window');
  });

  it('permite passar constraints de áudio customizadas quando explicitamente informadas', () => {
    const options = buildDisplayMediaOptions({ audioMode: 'system', audio: { echoCancellation: true } });
    expect(options.audio).toMatchObject({ echoCancellation: true, autoGainControl: false });
  });

  it.each(['none', 'mic'])('não captura áudio do sistema em %s', (audioMode) => {
    expect(buildDisplayMediaOptions({ audioMode })).toMatchObject({
      audio: false, systemAudio: 'exclude', windowAudio: 'exclude'
    });
  });

  it('preserva as opções de vídeo e superfície do E2E', () => {
    expect(buildDisplayMediaOptions({ video: { frameRate: { max: 60 } }, displaySurface: 'monitor', monitorTypeSurfaces: 'include' }))
      .toMatchObject({ video: { frameRate: { max: 60 }, displaySurface: 'monitor' }, monitorTypeSurfaces: 'include' });
  });

  it.each([
    ['TypeError', "Invalid value for windowAudio"],
    ['NotReadableError', 'Audio device unavailable'],
    ['NotAllowedError', 'Permission denied'],
    ['OverconstrainedError', 'Audio constraint failed']
  ])('preserva %s sem abrir outro seletor sem áudio', async (name, message) => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = Object.assign(new Error(message), { name });
    const mediaDevices = { getDisplayMedia: vi.fn().mockRejectedValue(error) };
    await expect(requestBrowserDisplayMedia({ audioMode: 'system' }, mediaDevices)).rejects.toBe(error);
    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(mediaDevices.getDisplayMedia.mock.calls[0][0].audio).not.toBe(false);
  });

  it('aceita resultado sem trilha de áudio sem repetir seletor ou inventar falha de driver', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const stream = { getAudioTracks: () => [] };
    const mediaDevices = { getDisplayMedia: vi.fn().mockResolvedValue(stream) };
    await expect(requestBrowserDisplayMedia({ audioMode: 'system' }, mediaDevices)).resolves.toBe(stream);
    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
  });
});
