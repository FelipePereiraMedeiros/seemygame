import { initLegacyBindings } from '../js/app.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiscordUIController } from '../js/discord-ui.js';
import { reconfigureNativeCapture } from '../js/desktop.js';
import { NativeCaptureProvider } from '../js/capture.js';
import { setCoopEnabled, getMaxCoopPlayers, isPartyModeEnabled, getCoopState } from '../js/coop.js';
import { applyCoopModeChange } from '../js/app.js';

describe('Tuning Dinâmico e Hot-Reload (WebRTC e Desktop)', () => {
  let mockInvoke;

  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke = vi.fn().mockResolvedValue({
      state: 'live',
      session_id: 'session-tuning-1',
      width: 1280,
      height: 720,
      fps: 60,
      video_codec: 'h264',
      h264_encoder: 'cpu',
      audio_mode: 'system'
    });
    globalThis.__TAURI_INTERNALS__ = {
      invoke: mockInvoke
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it('reconfigureNativeCapture repassa todos os argumentos ao backend nativo Tauri', async () => {
    const result = await reconfigureNativeCapture({
      sessionId: 'session-tuning-1',
      width: 1280,
      height: 720,
      fps: 60,
      bitrateKbps: 4500,
      videoCodec: 'h264',
      h264Encoder: 'cpu',
      showCursor: false,
      audioMode: 'system'
    });

    expect(mockInvoke).toHaveBeenCalledWith('reconfigure_native_capture', {
      sessionId: 'session-tuning-1',
      width: 1280,
      height: 720,
      fps: 60,
      bitrateKbps: 4500,
      videoCodec: 'h264',
      h264Encoder: 'cpu',
      showCursor: false,
      audioMode: 'system'
    });

    expect(result.sessionId).toBe('session-tuning-1');
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.videoCodec).toBe('h264');
  });

  it('NativeCaptureProvider.reconfigure atualiza a sessão interna do provider', async () => {
    const provider = new NativeCaptureProvider({ mediaBridge: { createStream: vi.fn(), closeStream: vi.fn() } });
    provider.session = { sessionId: 'session-provider-test', width: 1920, height: 1080 };

    mockInvoke.mockResolvedValueOnce({
      state: 'live',
      session_id: 'session-provider-test',
      width: 1280,
      height: 720
    });

    const res = await provider.reconfigure({ width: 1280, height: 720 });
    expect(res).toBeTruthy();
    expect(provider.session.width).toBe(1280);
    expect(provider.session.height).toBe(720);
  });

  it('applyCoopModeChange configura adequadamente os modos 4P, Party, 2P e Disabled', () => {
    applyCoopModeChange('enabled_4p');
    let state = getCoopState();
    expect(state.isCoopEnabled).toBe(true);
    expect(getMaxCoopPlayers()).toBe(4);
    expect(isPartyModeEnabled()).toBe(false);

    applyCoopModeChange('party_4p');
    state = getCoopState();
    expect(state.isCoopEnabled).toBe(true);
    expect(getMaxCoopPlayers()).toBe(4);
    expect(isPartyModeEnabled()).toBe(true);

    applyCoopModeChange('enabled_2p');
    state = getCoopState();
    expect(state.isCoopEnabled).toBe(true);
    expect(getMaxCoopPlayers()).toBe(1);
    expect(isPartyModeEnabled()).toBe(false);

    applyCoopModeChange('disabled');
    state = getCoopState();
    expect(state.isCoopEnabled).toBe(false);
  });
});

describe('Ocultação Automática da Barra Inferior e Reações (DiscordUI)', () => {
  let discordUI;
  let dock;
  let reactions;
  let stage;
  let modal;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <section class="room-stage" id="room-stage">
        <div id="video-grid"></div>
        <div id="voice-stage-grid"></div>
        <div id="reactions-dock" class="reactions-dock"></div>
        <div id="bottom-control-dock" class="bottom-control-dock">
          <button id="dock-stream-btn">Stream</button>
        </div>
      </section>
      <div id="tuning-modal" class="modal-overlay" style="display: none;"></div>
    `;

    dock = document.getElementById('bottom-control-dock');
    reactions = document.getElementById('reactions-dock');
    stage = document.getElementById('room-stage');
    modal = document.getElementById('tuning-modal');

    discordUI = new DiscordUIController();
    discordUI.init();
    discordUI.setStreamingState(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('inicia com as docks visíveis (sem .dock-hidden)', () => {
    expect(dock.classList.contains('dock-hidden')).toBe(false);
    expect(reactions.classList.contains('dock-hidden')).toBe(false);
  });

  it('adiciona .dock-hidden após 3.5 segundos de inatividade', () => {
    expect(dock.classList.contains('dock-hidden')).toBe(false);
    expect(reactions.classList.contains('dock-hidden')).toBe(false);

    vi.advanceTimersByTime(3499);
    expect(dock.classList.contains('dock-hidden')).toBe(false);

    vi.advanceTimersByTime(2);
    expect(dock.classList.contains('dock-hidden')).toBe(true);
    expect(reactions.classList.contains('dock-hidden')).toBe(true);
  });

  it('remove .dock-hidden imediatamente quando o mouse se move sobre o palco', () => {
    vi.advanceTimersByTime(3500);
    expect(dock.classList.contains('dock-hidden')).toBe(true);

    stage.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(dock.classList.contains('dock-hidden')).toBe(false);
    expect(reactions.classList.contains('dock-hidden')).toBe(false);
  });

  it('não oculta a barra enquanto o mouse estiver sobre o dock (hover immunity)', () => {
    dock.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    vi.advanceTimersByTime(5000);
    expect(dock.classList.contains('dock-hidden')).toBe(false);
    expect(reactions.classList.contains('dock-hidden')).toBe(false);

    dock.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    vi.advanceTimersByTime(3500);
    expect(dock.classList.contains('dock-hidden')).toBe(true);
  });

  it('não oculta a barra se houver um modal overlay aberto', () => {
    modal.style.display = 'flex';

    vi.advanceTimersByTime(5000);
    expect(dock.classList.contains('dock-hidden')).toBe(false);
    expect(reactions.classList.contains('dock-hidden')).toBe(false);
  });
});

describe('Controles de Áudio no Modal de Tuning da Sala (room.html)', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <div id="tuning-modal" class="modal-overlay" style="display: none;">
        <button id="close-tuning-modal-btn">✕</button>
        <button id="save-tuning-btn">Salvar</button>
        <select id="tuning-mic-select" class="custom-id-field"></select>
        <input type="range" id="tuning-mic-volume" min="0" max="200" step="1" value="100">
        <span id="tuning-mic-volume-val">100%</span>
        <select id="tuning-speaker-select" class="custom-id-field"></select>
        <button id="tuning-test-speaker-btn">Testar</button>
        <div id="tuning-speaker-note"></div>
        <input type="range" id="tuning-speaker-volume" min="0" max="200" step="1" value="100">
        <span id="tuning-speaker-volume-val">100%</span>
      </div>
    `;
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    vi.restoreAllMocks();
  });

  it('initTuningAudioDeviceControls popula microfones e saídas e reconcilia IDs obsoletos', async () => {
    const { initTuningAudioDeviceControls } = await import('../js/app/tuning-controller.js');
    const { populateDeviceSelect } = await import('../js/audio-devices.js');

    const mockMicrophones = [
      { deviceId: 'mic-1', label: 'Microfone Realtek', kind: 'audioinput' },
      { deviceId: 'mic-2', label: 'Headset USB', kind: 'audioinput' }
    ];
    const mockSpeakers = [
      { deviceId: 'spk-1', label: 'Alto-falantes Realtek', kind: 'audiooutput' }
    ];

    let savedInput = 'stale-mic-id';
    let savedOutput = 'spk-1';

    const savedAudioPreferenceCalls = [];
    const context = {
      isAudioOutputSupported: () => true,
      getAudioDevices: vi.fn().mockResolvedValue({
        microphones: mockMicrophones,
        speakers: mockSpeakers,
        supportsOutput: true
      }),
      populateDeviceSelect,
      playTestTone: vi.fn().mockResolvedValue(undefined),
      getSavedAudioPreferences: () => ({ inputId: savedInput, outputId: savedOutput }),
      saveAudioPreference: (kind, val) => {
        savedAudioPreferenceCalls.push({ kind, val });
        if (kind === 'input') savedInput = val;
        if (kind === 'output') savedOutput = val;
      },
      watchDeviceChanges: vi.fn().mockReturnValue(() => {}),
      voiceManager: {
        selectedMicId: 'stale-mic-id',
        selectedSpeakerId: 'spk-1',
        inputVolume: 100,
        outputVolume: 100,
        setInputVolume: vi.fn((v) => v),
        setOutputVolume: vi.fn((v) => v),
        setAudioInputDevice: vi.fn().mockResolvedValue(true),
        setAudioOutputDevice: vi.fn().mockResolvedValue(true),
        on: vi.fn()
      }
    };

    const controls = await initTuningAudioDeviceControls(context);
    expect(controls).toBeTruthy();

    const micSelect = document.getElementById('tuning-mic-select');
    const speakerSelect = document.getElementById('tuning-speaker-select');

    // Deve ter populado os selects
    expect(micSelect.options.length).toBe(3); // default + 2 mics
    expect(speakerSelect.options.length).toBe(2); // default + 1 spk

    // Como stale-mic-id não existe nos microfones, deve ter limpado e revertido para padrão
    expect(micSelect.value).toBe('');
    expect(savedAudioPreferenceCalls).toContainEqual({ kind: 'input', val: '' });

    // Alto-falante válido deve estar selecionado
    expect(speakerSelect.value).toBe('spk-1');

    controls.destroy();
  });

  it('room-session setupTuningModal inicializa controles de áudio e salva configurações no voiceManager', async () => {
    const { createRoomSession } = await import('../js/session/room-session.js');

    const mockVoiceManager = {
      selectedMicId: '',
      selectedSpeakerId: '',
      inputVolume: 100,
      outputVolume: 100,
      setInputVolume: vi.fn((v) => v),
      setOutputVolume: vi.fn((v) => v),
      setAudioInputDevice: vi.fn().mockResolvedValue(true),
      setAudioOutputDevice: vi.fn().mockResolvedValue(true),
      on: vi.fn(),
      leaveVoice: vi.fn()
    };

    // Simula navigator.mediaDevices e suporte a setSinkId
    const origMediaDevices = navigator.mediaDevices;
    const origSetSinkId = HTMLMediaElement.prototype.setSinkId;
    HTMLMediaElement.prototype.setSinkId = vi.fn().mockResolvedValue(undefined);
    navigator.mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValue([
        { deviceId: 'mic-test', label: 'Microfone HyperX', kind: 'audioinput' },
        { deviceId: 'spk-test', label: 'Fone HyperX', kind: 'audiooutput' }
      ]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };

    try {
      const room = createRoomSession({ voiceManager: mockVoiceManager });
      const modal = document.getElementById('tuning-modal');

      room.setupTuningModal();

      // Aguarda microtask para resolução das promises de controles
      await new Promise((r) => setTimeout(r, 50));

      const micSelect = document.getElementById('tuning-mic-select');
      const speakerSelect = document.getElementById('tuning-speaker-select');
      const saveBtn = document.getElementById('save-tuning-btn');

      expect(micSelect.options.length).toBeGreaterThan(1);
      expect(speakerSelect.options.length).toBeGreaterThan(1);

      // Simula alteração do usuário e clique em Salvar
      micSelect.value = 'mic-test';
      speakerSelect.value = 'spk-test';

      modal.style.display = 'flex';
      saveBtn.click();

      // Aguarda save handler
      await new Promise((r) => setTimeout(r, 20));

      expect(modal.style.display).toBe('none');
      expect(mockVoiceManager.setAudioInputDevice).toHaveBeenCalledWith('mic-test');
      expect(mockVoiceManager.setAudioOutputDevice).toHaveBeenCalledWith('spk-test');
      expect(localStorage.getItem('seemygame_audio_input_id')).toBe('mic-test');
      expect(localStorage.getItem('seemygame_audio_output_id')).toBe('spk-test');
    } finally {
      navigator.mediaDevices = origMediaDevices;
      if (origSetSinkId) {
        HTMLMediaElement.prototype.setSinkId = origSetSinkId;
      } else {
        delete HTMLMediaElement.prototype.setSinkId;
      }
      localStorage.removeItem('seemygame_audio_input_id');
      localStorage.removeItem('seemygame_audio_output_id');
    }
  });
});

initLegacyBindings();
