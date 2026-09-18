import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getAudioDevices,
  isAudioOutputSupported,
  getSavedAudioPreferences,
  saveAudioPreference,
  populateDeviceSelect,
  playTestTone,
  watchDeviceChanges,
  STORAGE_KEY_INPUT,
  STORAGE_KEY_OUTPUT
} from '../js/audio-devices.js';

describe('Módulo: audio-devices.js (Gerenciamento de Dispositivos de Áudio)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Preferências Salvas no LocalStorage', () => {
    it('deve retornar vazio se não houver preferências salvas', () => {
      const prefs = getSavedAudioPreferences();
      expect(prefs).toEqual({ inputId: '', outputId: '' });
    });

    it('deve salvar e carregar preferências de microfone e alto-falante', () => {
      saveAudioPreference('input', 'mic-hyperx-quadcast');
      saveAudioPreference('output', 'headphone-sony-wh1000');

      expect(localStorage.getItem(STORAGE_KEY_INPUT)).toBe('mic-hyperx-quadcast');
      expect(localStorage.getItem(STORAGE_KEY_OUTPUT)).toBe('headphone-sony-wh1000');

      const prefs = getSavedAudioPreferences();
      expect(prefs.inputId).toBe('mic-hyperx-quadcast');
      expect(prefs.outputId).toBe('headphone-sony-wh1000');
    });

    it('deve remover chave ao passar valor vazio', () => {
      saveAudioPreference('input', 'mic-1');
      expect(localStorage.getItem(STORAGE_KEY_INPUT)).toBe('mic-1');

      saveAudioPreference('input', '');
      expect(localStorage.getItem(STORAGE_KEY_INPUT)).toBeNull();
    });
  });

  describe('Detecção e Enumeração de Dispositivos', () => {
    it('isAudioOutputSupported deve refletir a presença de setSinkId em HTMLMediaElement', () => {
      const originalProto = HTMLMediaElement.prototype.setSinkId;

      HTMLMediaElement.prototype.setSinkId = vi.fn();
      expect(isAudioOutputSupported()).toBe(true);

      delete HTMLMediaElement.prototype.setSinkId;
      expect(isAudioOutputSupported()).toBe(false);

      if (originalProto) {
        HTMLMediaElement.prototype.setSinkId = originalProto;
      }
    });

    it('getAudioDevices deve filtrar corretamente microfones e alto-falantes', async () => {
      const fakeDevices = [
        { kind: 'audioinput', deviceId: 'mic-1', label: 'Microfone Realtek' },
        { kind: 'audioinput', deviceId: 'mic-2', label: 'Microfone Headset USB' },
        { kind: 'audiooutput', deviceId: 'speaker-1', label: 'Alto-falantes Realtek' },
        { kind: 'videoinput', deviceId: 'cam-1', label: 'Webcam C920' },
      ];

      navigator.mediaDevices = {
        enumerateDevices: vi.fn().mockResolvedValue(fakeDevices),
      };

      const result = await getAudioDevices();
      expect(result.microphones).toHaveLength(2);
      expect(result.microphones[0].deviceId).toBe('mic-1');
      expect(result.microphones[1].deviceId).toBe('mic-2');

      expect(result.speakers).toHaveLength(1);
      expect(result.speakers[0].deviceId).toBe('speaker-1');
    });

    it('getAudioDevices deve degradar graciosamente se navigator.mediaDevices for ausente', async () => {
      const origMediaDevices = navigator.mediaDevices;
      delete navigator.mediaDevices;

      const result = await getAudioDevices();
      expect(result.microphones).toEqual([]);
      expect(result.speakers).toEqual([]);

      navigator.mediaDevices = origMediaDevices;
    });
  });

  describe('Preenchimento de Selects (populateDeviceSelect)', () => {
    it('deve preencher o select com opções dos dispositivos e marcar o selecionado', () => {
      const select = document.createElement('select');
      const devices = [
        { kind: 'audioinput', deviceId: 'mic-1', label: 'Microfone 1' },
        { kind: 'audioinput', deviceId: 'mic-2', label: 'Microfone 2' },
      ];

      populateDeviceSelect(select, devices, 'mic-2', 'Padrão do Sistema');

      // Opção padrão + 2 dispositivos = 3 opções
      expect(select.options).toHaveLength(3);
      expect(select.options[0].value).toBe('');
      expect(select.options[0].textContent).toBe('Padrão do Sistema');

      expect(select.options[1].value).toBe('mic-1');
      expect(select.options[1].selected).toBe(false);

      expect(select.options[2].value).toBe('mic-2');
      expect(select.options[2].selected).toBe(true);
      expect(select.value).toBe('mic-2');
    });

    it('deve selecionar a opção padrão se o ID selecionado não existir', () => {
      const select = document.createElement('select');
      const devices = [
        { kind: 'audioinput', deviceId: 'mic-1', label: 'Microfone 1' },
      ];

      populateDeviceSelect(select, devices, 'mic-inexistente', 'Microfone Padrão');

      expect(select.options[0].selected).toBe(true);
      expect(select.value).toBe('');
    });
  });

  describe('Watcher de Mudança de Dispositivos', () => {
    it('deve registrar e remover o listener do evento devicechange', () => {
      const addSpy = vi.fn();
      const removeSpy = vi.fn();

      navigator.mediaDevices = {
        addEventListener: addSpy,
        removeEventListener: removeSpy,
      };

      const cb = vi.fn();
      const cleanup = watchDeviceChanges(cb);

      expect(addSpy).toHaveBeenCalledWith('devicechange', expect.any(Function));

      cleanup();
      expect(removeSpy).toHaveBeenCalledWith('devicechange', expect.any(Function));
    });
  });

  describe('Teste de Áudio (playTestTone)', () => {
    it('deve executar o teste de tom sem falhas', async () => {
      const origAudioContext = globalThis.AudioContext;
      const origWebkitAudioContext = globalThis.webkitAudioContext;
      const origAudio = globalThis.Audio;

      const mockOsc = {
        type: 'sine',
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      const mockGain = {
        gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      };
      const mockDest = { stream: {} };
      const mockAudioCtx = {
        currentTime: 0,
        state: 'running',
        createOscillator: vi.fn(() => mockOsc),
        createGain: vi.fn(() => mockGain),
        createMediaStreamDestination: vi.fn(() => mockDest),
        destination: {},
        close: vi.fn().mockResolvedValue(undefined),
      };

      globalThis.AudioContext = vi.fn(function() { return mockAudioCtx; });
      globalThis.webkitAudioContext = vi.fn(function() { return mockAudioCtx; });

      const mockSetSinkId = vi.fn().mockResolvedValue(undefined);
      globalThis.Audio = vi.fn(function () {
        return {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          setSinkId: mockSetSinkId,
          srcObject: null,
        };
      });

      await expect(playTestTone('speaker-test-id')).resolves.not.toThrow();

      expect(mockAudioCtx.createOscillator).toHaveBeenCalled();
      expect(mockOsc.start).toHaveBeenCalled();
      expect(mockOsc.stop).toHaveBeenCalled();
      expect(mockSetSinkId).toHaveBeenCalledWith('speaker-test-id');

      globalThis.AudioContext = origAudioContext;
      globalThis.webkitAudioContext = origWebkitAudioContext;
      globalThis.Audio = origAudio;
    });
  });
});
