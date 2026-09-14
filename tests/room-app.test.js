import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import {
  MockMediaStream,
  MockMediaStreamTrack,
  MockRTCPeerConnection
} from './mocks/webrtc.mock.js';

class MockDataConnection {
  constructor(peer) {
    this.peer = peer;
    this.events = {};
    this.send = vi.fn();
    this.close = vi.fn(() => {
      if (this.events['close']) this.events['close']();
    });
  }

  on(event, cb) {
    this.events[event] = cb;
  }

  emit(event, ...args) {
    if (this.events[event]) {
      this.events[event](...args);
    }
  }
}

class MockMediaConnection {
  constructor(peer) {
    this.peer = peer;
    this.events = {};
    this.peerConnection = new MockRTCPeerConnection();
    this.answer = vi.fn();
    this.close = vi.fn(() => {
      if (this.events['close']) this.events['close']();
    });
  }

  on(event, cb) {
    this.events[event] = cb;
  }

  emit(event, ...args) {
    if (this.events[event]) {
      this.events[event](...args);
    }
  }
}

class MockPeer {
  constructor(idOrConfig, maybeConfig) {
    if (typeof idOrConfig === 'string') {
      this.id = idOrConfig;
      this.config = maybeConfig;
    } else {
      this.id = null;
      this.config = idOrConfig;
    }
    this.events = {};
    this.destroyed = false;
    MockPeer.lastInstance = this;
  }

  on(event, cb) {
    this.events[event] = cb;
  }

  emit(event, ...args) {
    if (this.events[event]) {
      this.events[event](...args);
    }
  }

  destroy() {
    this.destroyed = true;
  }

  connect(targetId) {
    const conn = new MockDataConnection(targetId);
    MockPeer.lastDataConnection = conn;
    return conn;
  }

  call(targetId, stream) {
    const call = new MockMediaConnection(targetId);
    MockPeer.lastMediaCall = call;
    return call;
  }
}

MockPeer.lastInstance = null;
MockPeer.lastDataConnection = null;
MockPeer.lastMediaCall = null;

let app;

describe('Integração Room-First no app.js (Paradigma Discord)', () => {
  beforeAll(async () => {
    // Simula ambiente de room.html
    delete window.location;
    window.location = {
      pathname: '/room.html',
      origin: 'http://localhost:3000',
      hash: '#room=resenha',
      search: ''
    };

    document.body.innerHTML = `
      <div id="toast-container"></div>
      <header>
        <span id="room-header-badge">Sala: #geral</span>
        <span id="copy-badge" class="id-badge">Gerando ID...</span>
        <button id="share-link-btn" style="display:none;">Convidar Amigos</button>
        <span id="viewer-count">0 online</span>
      </header>
      <div class="room-layout-container">
        <aside class="room-sidebar">
          <span id="sidebar-room-name">🔊 Canal</span>
          <span id="sidebar-members-count">0 online</span>
          <div id="room-participants-list"></div>
          <div id="local-user-card">
            <span id="local-user-name">Você</span>
            <div id="local-avatar">V</div>
            <button id="quick-mic-btn">🎙️</button>
            <button id="quick-deaf-btn">🎧</button>
            <button id="quick-tuning-btn">⚙️</button>
          </div>
        </aside>
        <section class="room-stage">
          <div id="voice-stage-grid"></div>
          <div id="video-grid" style="display: none;"></div>
          <div class="bottom-control-dock">
            <button id="dock-mic-btn">Microfone</button>
            <button id="dock-deaf-btn">Áudio</button>
            <button id="dock-stream-btn">Transmitir Jogo</button>
            <button id="dock-tuning-btn">Tuning</button>
            <button id="dock-whiteboard-btn">Lousa</button>
            <button id="dock-leave-btn">Sair</button>
          </div>
        </section>
      </div>
      <div id="tuning-modal" style="display: none;">
        <button id="close-tuning-modal-btn">✕</button>
        <button id="save-tuning-btn">Salvar</button>
        <select id="quality-preset"><option value="ultra">Ultra</option></select>
        <input type="range" id="bitrate-slider" value="9000000">
        <select id="audio-mode-select"><option value="system">Sistema</option></select>
        <select id="coop-mode-select"><option value="disabled">Desativado</option></select>
      </div>
      <div id="terms-modal" style="display: none;">
        <input type="checkbox" id="check-age">
        <input type="checkbox" id="check-terms">
        <button id="accept-btn">Aceitar</button>
      </div>
    `;

    globalThis.Peer = MockPeer;
    app = await import('../js/app.js');
  });

  it('isRoomMode deve retornar true na página room.html', () => {
    expect(app.isRoomMode()).toBe(true);
  });

  it('getRoomInfoFromUrl deve extrair o roomId e pin do hash ou query', () => {
    window.location.hash = '#room=esquadrao-fps&pin=9988';
    const info = app.getRoomInfoFromUrl();
    expect(info.roomId).toBe('esquadrao-fps');
    expect(info.roomPin).toBe('9988');
  });

  it('setupRoomSession deve inicializar o RoomManager e configurar badges na UI', () => {
    window.location.hash = '#room=clube';
    localStorage.setItem('seemygame_user_name', 'DiogoGamer');

    app.setupRoomSession('smg_room_clube_host');

    expect(app.roomManager).toBeDefined();
    expect(app.roomManager.roomId).toBe('clube');
    expect(app.roomManager.userName).toBe('DiogoGamer');
    expect(app.roomManager.isMaster).toBe(true);

    const roomBadge = document.getElementById('room-header-badge');
    expect(roomBadge.textContent).toContain('Sala: #clube (Host)');

    const localName = document.getElementById('local-user-name');
    expect(localName.textContent).toBe('DiogoGamer');

    const localAvatar = document.getElementById('local-avatar');
    expect(localAvatar.textContent).toBe('D');
  });

  it('transmissão desacoplada: startLocalStream e stopLocalStream devem sincronizar com RoomManager e discordUI', async () => {
    window.location.hash = '#room=clube';
    app.setupRoomSession('smg_room_clube_host');

    const fakeTrack = new MockMediaStreamTrack('video');
    const fakeStream = new MockMediaStream([fakeTrack]);

    navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(fakeStream);

    await app.startLocalStream();

    expect(app.roomManager.localStreamingState.isStreaming).toBe(true);

    const dockBtn = document.getElementById('dock-stream-btn');
    if (dockBtn) {
      expect(dockBtn.classList.contains('is-streaming')).toBe(true);
    }

    app.stopLocalStream();

    expect(app.roomManager.localStreamingState.isStreaming).toBe(false);
    if (dockBtn) {
      expect(dockBtn.classList.contains('is-streaming')).toBe(false);
    }
  });
});
