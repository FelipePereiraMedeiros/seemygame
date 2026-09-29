import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Fase 3: Separação de Entrypoints de Páginas (js/entries)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <div id="toast-container"></div>
      <div id="terms-modal" class="modal-overlay" style="display:none;"></div>
      <main id="video-grid" class="video-grid"></main>
    `;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('viewer-entry.js', () => {
    it('deve exportar flags e isolar recursos pesados de streamer', async () => {
      const viewerEntry = await import('../js/entries/viewer-entry.js');
      expect(viewerEntry.isViewerPage).toBe(true);
      expect(viewerEntry.isHost).toBe(false);
      expect(typeof viewerEntry.initViewerApp).toBe('function');
      expect(typeof viewerEntry.connectToStreamer).toBe('function');
      expect(viewerEntry.watchingHosts).toBeInstanceOf(Map);
    });

    it('deve extrair targetStreamerId da hash da URL', async () => {
      const viewerEntry = await import('../js/entries/viewer-entry.js');
      delete window.location;
      window.location = new URL('http://localhost/viewer.html#watch=streamer-alpha-99');

      const id = viewerEntry.getTargetStreamerId();
      expect(id).toBe('streamer-alpha-99');
    });

    it('deve inicializar aplicação de espectador e registrar plugins com role viewer', async () => {
      const viewerEntry = await import('../js/entries/viewer-entry.js');
      const app = await viewerEntry.initViewerApp({ targetStreamerId: null });

      expect(app.isViewer).toBe(true);
      expect(typeof app.connect).toBe('function');
      expect(typeof app.requestCoop).toBe('function');
      expect(typeof app.releaseCoop).toBe('function');
    });
  });

  describe('streamer-entry.js', () => {
    it('deve exportar flags e métodos de controle do host', async () => {
      const streamerEntry = await import('../js/entries/streamer-entry.js');
      expect(streamerEntry.isStreamerPage).toBe(true);
      expect(streamerEntry.isHost).toBe(true);
      expect(typeof streamerEntry.initStreamerApp).toBe('function');
      expect(typeof streamerEntry.startCapture).toBe('function');
      expect(typeof streamerEntry.stopCapture).toBe('function');
      expect(typeof streamerEntry.setQualityProfile).toBe('function');
    });

    it('setQualityProfile deve atualizar bitrate e fps alvo no streamerState', async () => {
      const streamerEntry = await import('../js/entries/streamer-entry.js');
      streamerEntry.setQualityProfile('ultra');

      expect(streamerEntry.streamerState.currentProfile).toBe('ultra');
      expect(streamerEntry.streamerState.fpsTarget).toBe(60);
      expect(streamerEntry.streamerState.targetBitrateBps).toBeGreaterThan(0);
    });
  });

  describe('room-entry.js', () => {
    it('deve exportar flags e métodos de Room multi-usuário', async () => {
      const roomEntry = await import('../js/entries/room-entry.js');
      expect(roomEntry.isRoomPage).toBe(true);
      expect(typeof roomEntry.initRoomApp).toBe('function');
      expect(typeof roomEntry.getRoomInfoFromUrl).toBe('function');
      expect(typeof roomEntry.initGreenRoomLobby).toBe('function');
    });

    it('getRoomInfoFromUrl deve extrair roomId e PIN da URL hash', async () => {
      const roomEntry = await import('../js/entries/room-entry.js');
      delete window.location;
      window.location = new URL('http://localhost/room.html#room=campeonato-fifa&pin=9876');

      const info = roomEntry.getRoomInfoFromUrl();
      expect(info.roomId).toBe('campeonato-fifa');
      expect(info.roomPin).toBe('9876');
    });
  });

  describe('lobby-entry.js', () => {
    it('deve exportar flags e utilitários de lobby e preflight', async () => {
      const lobbyEntry = await import('../js/entries/lobby-entry.js');
      expect(lobbyEntry.isLobbyPage).toBe(true);
      expect(typeof lobbyEntry.initLobbyApp).toBe('function');
      expect(typeof lobbyEntry.initGreenRoomPreflight).toBe('function');
      expect(typeof lobbyEntry.initDesktopAlwaysOnTop).toBe('function');
    });

    it('initLobbyApp deve configurar listeners do formulário', async () => {
      document.body.innerHTML = `
        <div id="toast-container"></div>
        <form id="lobby-form">
          <input id="lobby-user-name" value="Jogador1">
          <input id="lobby-room-id" value="">
          <button id="lobby-create-random-btn" type="button">Criar</button>
          <button id="lobby-join-btn" type="submit">Entrar</button>
        </form>
      `;

      const lobbyEntry = await import('../js/entries/lobby-entry.js');
      const app = lobbyEntry.initLobbyApp();
      expect(app.active).toBe(true);

      const randomBtn = document.getElementById('lobby-create-random-btn');
      const roomIdInput = document.getElementById('lobby-room-id');
      randomBtn.click();

      expect(roomIdInput.value.length).toBeGreaterThan(0);
    });
  });

  describe('Fachada unificada em app.js', () => {
    it('deve re-exportar os inicializadores de cada entrypoint mantendo compatibilidade total', async () => {
      const app = await import('../js/app.js');
      expect(typeof app.initViewerApp).toBe('function');
      expect(typeof app.initStreamerApp).toBe('function');
      expect(typeof app.initRoomApp).toBe('function');
      expect(typeof app.initLobbyApp).toBe('function');
    });
  });
});
