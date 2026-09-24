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
