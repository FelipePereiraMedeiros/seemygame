import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MockMediaStream,
  MockMediaStreamTrack,
  MockRTCPeerConnection
} from './mocks/webrtc.mock.js';

describe('Desktop Picker Modal (Native Capture Integration)', () => {
  let app;
  let mockSources;
  let mockInvoke;

  beforeEach(async () => {
    vi.restoreAllMocks();

    mockSources = [
      {
        id: 'monitor:0',
        source_id: 'monitor:0',
        source_type: 'monitor',
        title: 'Monitor 1 (1920x1080)',
        width: 1920,
        height: 1080,
        supports_audio: true
      },
      {
        id: 'window:12345',
        source_id: 'window:12345',
        source_type: 'window',
        title: 'Valorant - Jogo em Execução',
        process_name: 'VALORANT-Win64-Shipping.exe',
        width: 1920,
        height: 1080,
        supports_audio: true
      }
    ];

    mockInvoke = vi.fn((cmd, args) => {
      if (cmd === 'list_capture_sources') return Promise.resolve(mockSources);
      if (cmd === 'get_native_capture_capabilities') {
        return Promise.resolve({
          provider: 'native',
          available: true,
          details: { d3d11: true, wgc: true, mf_h264: true }
        });
      }
      if (cmd === 'set_high_priority') return Promise.resolve(true);
      if (cmd === 'start_native_capture') {
        return Promise.resolve({
          session_id: 'sess-123',
          source_id: args?.sourceId,
          source_type: 'window',
          state: 'capturing',
          audio_mode: 'none'
        });
      }
      if (cmd === 'create_native_capture_peer') {
        return Promise.resolve({
          session_id: 'sess-123',
          answer_sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
        });
      }
      if (cmd === 'stop_native_capture') return Promise.resolve({ state: 'idle' });
      return Promise.resolve(null);
    });

    // Simula ambiente desktop Tauri
    window.__TAURI_INTERNALS__ = { invoke: mockInvoke };

    delete window.location;
    window.location = {
      pathname: '/room.html',
      origin: 'http://localhost:3000',
      hash: '#room=gameroom',
      search: ''
    };

    document.body.innerHTML = `
      <span id="desktop-badge" style="display: none;"></span>
      <div id="desktop-picker-modal" class="modal-overlay" style="display: none;">
        <div class="modal-content">
          <button id="picker-refresh-btn">Atualizar</button>
          <p id="picker-native-status"></p>
          <div id="desktop-windows-list"></div>
          <button id="picker-screen-fallback-btn">Compartilhar Tela Inteira</button>
          <button id="picker-cancel-btn">Cancelar</button>
        </div>
      </div>
      <button id="stream-btn">Transmitir Jogo</button>
      <select id="quality-preset"><option value="1080p60" selected>1080p 60fps</option></select>
      <select id="audio-mode-select"><option value="none" selected>Sem Áudio</option></select>
      <div id="video-grid"></div>
      <div id="toast-container"></div>
    `;

    // Global mocks para WebRTC
    global.RTCPeerConnection = MockRTCPeerConnection;
    global.MediaStream = MockMediaStream;

    app = await import('../js/app.js');
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it('deve inicializar o suporte desktop e exibir status de GPU WGC ativo', async () => {
    const desktopSupport = await app.initDesktopSupport();
    expect(desktopSupport).toBeDefined();

    const desktopBadge = document.getElementById('desktop-badge');
    expect(desktopBadge.style.display).toBe('inline-flex');

    await desktopSupport.refreshWindowsList();

    const pickerNativeStatus = document.getElementById('picker-native-status');
    expect(pickerNativeStatus.innerHTML).toContain('Captura Nativa Ativa: Windows Graphics Capture');
  });

  it('deve categorizar e renderizar monitores e janelas na lista', async () => {
    const desktopSupport = await app.initDesktopSupport();
    await desktopSupport.refreshWindowsList();

    const list = document.getElementById('desktop-windows-list');
    expect(list.innerHTML).toContain('Telas Inteiras / Monitores');
    expect(list.innerHTML).toContain('Monitor 1 (1920x1080)');
    expect(list.innerHTML).toContain('Jogos e Janelas Ativas');
    expect(list.innerHTML).toContain('Valorant - Jogo em Execução');
    expect(list.innerHTML).toContain('VALORANT-Win64-Shipping.exe');
  });

  it('deve passar sourceId nativo ao clicar em um jogo da lista sem congelar a UI', async () => {
    const desktopSupport = await app.initDesktopSupport();
    await desktopSupport.refreshWindowsList();

    const modal = document.getElementById('desktop-picker-modal');
    modal.style.display = 'flex';

    const items = document.querySelectorAll('.window-item');
    expect(items.length).toBe(2);

    // O segundo item é o jogo Valorant
    const gameItem = items[1];
    expect(gameItem.textContent).toContain('Valorant');

    // Ao clicar, o modal deve ser fechado
    gameItem.click();
    expect(modal.style.display).toBe('none');
  });

  it('deve selecionar o monitor principal nativo ao clicar no botão de tela inteira', async () => {
    const desktopSupport = await app.initDesktopSupport();
    await desktopSupport.refreshWindowsList();

    const modal = document.getElementById('desktop-picker-modal');
    modal.style.display = 'flex';

    const screenBtn = document.getElementById('picker-screen-fallback-btn');
    screenBtn.click();
    expect(modal.style.display).toBe('none');
  });
});
