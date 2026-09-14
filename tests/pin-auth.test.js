import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
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
    MockPeer.instances.push(this);
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

  connect(targetId, opts) {
    const conn = new MockDataConnection(targetId);
    MockPeer.lastDataConnection = conn;
    setTimeout(() => conn.emit('open'), 0);
    return conn;
  }

  call(targetId, stream) {
    const call = new MockMediaConnection(targetId);
    MockPeer.lastMediaCall = call;
    return call;
  }

  destroy() {
    this.destroyed = true;
    this.emit('close');
  }
}

MockPeer.instances = [];
MockPeer.lastInstance = null;
MockPeer.lastDataConnection = null;
MockPeer.lastMediaCall = null;

describe('ID Fixo do Streamer e Proteção de Sala por Senha (PIN)', () => {
  let app;

  beforeAll(async () => {
    document.body.innerHTML = `
      <div id="toast-container"></div>
      <header>
        <span id="copy-badge" class="id-badge">Gerando ID...</span>
        <button id="edit-id-btn">✏️ ID Fixo</button>
        <button id="share-link-btn" style="display:none;">Copiar Link</button>
        <button id="stream-btn" disabled>Transmitir Jogo</button>
        <span id="viewer-count">0 espectadores</span>
        <input type="text" id="target-id">
        <button id="connect-btn">Assistir Amigo</button>
      </header>

      <div class="tuning-bar">
        <select id="audio-mode-select">
          <option value="system" selected>Sistema</option>
        </select>
        <select id="coop-mode-select">
          <option value="disabled" selected>Desativado</option>
        </select>
        <select id="quality-preset">
          <option value="balanced" selected>Balanced</option>
        </select>
        <input type="range" id="bitrate-slider" value="7500">
        <span id="bitrate-display">7.5 Mbps</span>
        <input type="password" id="room-pin-input" placeholder="Opcional">
      </div>

      <!-- Modal de ID Fixo -->
      <div id="custom-id-modal" style="display: none;">
        <input type="text" id="custom-id-input">
        <div id="custom-id-error" style="display: none;"></div>
        <button id="custom-id-save-btn">Salvar</button>
        <button id="custom-id-reset-btn">Restaurar Aleatório</button>
        <button id="custom-id-cancel-btn">Cancelar</button>
      </div>

      <!-- Modal de Desafio de PIN do Espectador -->
      <div id="pin-prompt-modal" style="display: none;">
        <input type="password" id="viewer-pin-input">
        <div id="viewer-pin-error" style="display: none;"></div>
        <button id="viewer-pin-submit-btn">Entrar na Sala</button>
        <button id="viewer-pin-cancel-btn">Cancelar</button>
      </div>

      <main id="video-grid" class="video-grid">
        <div class="empty-state" id="empty-state" style="display: flex;"></div>
      </main>
      <div id="terms-modal" style="display: none;">
        <input type="checkbox" id="check-age">
        <input type="checkbox" id="check-terms">
        <button id="accept-btn">Aceitar</button>
      </div>
    `;

    globalThis.Peer = MockPeer;
    app = await import('../js/app.js');
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    const customIdModal = document.getElementById('custom-id-modal');
    if (customIdModal) customIdModal.style.display = 'none';
    const pinModal = document.getElementById('pin-prompt-modal');
    if (pinModal) pinModal.style.display = 'none';
    if (app && typeof app.resetPeer === 'function') {
      app.resetPeer();
    }
    MockPeer.instances = [];
    MockPeer.lastInstance = null;
    MockPeer.lastDataConnection = null;
    MockPeer.lastMediaCall = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (app && typeof app.stopLocalStream === 'function') {
      app.stopLocalStream();
    }
  });

  describe('Funções Utilitárias: getCustomStreamerId & setCustomStreamerId', () => {
    it('deve validar e persistir ID fixo válido (3 a 30 caracteres alfanuméricos)', () => {
      const ok = app.setCustomStreamerId('diogo');
      expect(ok).toBe(true);
      expect(localStorage.getItem('seemygame_custom_id')).toBe('diogo');
      expect(app.getCustomStreamerId()).toBe('diogo');
    });

    it('deve aceitar caracteres alfanuméricos, traço e sublinhado', () => {
      const ok = app.setCustomStreamerId('streamer_pro-99');
      expect(ok).toBe(true);
      expect(app.getCustomStreamerId()).toBe('streamer_pro-99');
    });

    it('deve rejeitar IDs com menos de 3 caracteres ou mais de 30 caracteres', () => {
      expect(app.setCustomStreamerId('ab')).toBe(false);
      expect(app.setCustomStreamerId('a'.repeat(31))).toBe(false);
      expect(app.getCustomStreamerId()).toBeNull();
    });

    it('deve rejeitar caracteres especiais ou espaços', () => {
      expect(app.setCustomStreamerId('meu canal')).toBe(false);
      expect(app.setCustomStreamerId('diogo@stream')).toBe(false);
      expect(app.setCustomStreamerId('live#1')).toBe(false);
      expect(app.getCustomStreamerId()).toBeNull();
    });

    it('deve remover ID fixo quando fornecido valor nulo ou vazio', () => {
      app.setCustomStreamerId('diogo');
      expect(app.getCustomStreamerId()).toBe('diogo');

      const cleared = app.setCustomStreamerId(null);
      expect(cleared).toBe(true);
      expect(app.getCustomStreamerId()).toBeNull();
      expect(localStorage.getItem('seemygame_custom_id')).toBeNull();
    });
  });

  describe('Funções Utilitárias: getStoredRoomPin & setStoredRoomPin', () => {
    it('deve salvar e recuperar PIN da sala com trim', () => {
      app.setStoredRoomPin(' 123456 ');
      expect(app.getStoredRoomPin()).toBe('123456');
      expect(localStorage.getItem('seemygame_streamer_pin')).toBe('123456');
    });

    it('deve limpar o PIN da sala quando fornecido valor vazio ou nulo', () => {
      app.setStoredRoomPin('secret');
      expect(app.getStoredRoomPin()).toBe('secret');

      app.setStoredRoomPin('');
      expect(app.getStoredRoomPin()).toBe('');
      expect(localStorage.getItem('seemygame_streamer_pin')).toBeNull();
    });
  });

  describe('Inicialização do PeerJS com ID Fixo', () => {
    it('deve inicializar PeerJS passando o ID fixo se configurado no localStorage', () => {
      app.setCustomStreamerId('gamer-diogo');
      app.initPeer();

      const instance = MockPeer.lastInstance;
      expect(instance).not.toBeNull();
      expect(instance.id).toBe('gamer-diogo');
    });

    it('deve inicializar PeerJS sem ID fixo se nenhum estiver configurado', () => {
      app.setCustomStreamerId(null);
      app.initPeer();

      const instance = MockPeer.lastInstance;
      expect(instance).not.toBeNull();
      expect(instance.id).toBeNull();
    });

    it('deve exibir aviso e abrir modal quando o PeerJS emitir erro unavailable-id para ID não pertencente à sessão', () => {
      app.setCustomStreamerId('diogo');
      app.initPeer();

      const instance = MockPeer.lastInstance;
      instance.emit('error', { type: 'unavailable-id', message: 'ID is taken' });

      const copyBadge = document.getElementById('copy-badge');
      const customIdModal = document.getElementById('custom-id-modal');
      const customIdError = document.getElementById('custom-id-error');

      expect(copyBadge.innerHTML).toContain('em uso');
      expect(customIdModal.style.display).toBe('flex');
      expect(customIdError.style.display).toBe('block');
      expect(customIdError.textContent).toContain('já está em uso');
    });

    it('deve tentar reconectar automaticamente em reload/mesma sessão quando unavailable-id for emitido', () => {
      sessionStorage.setItem('seemygame_last_id', 'diogo');
      app.setCustomStreamerId('diogo');
      app.initPeer();

      const instance = MockPeer.lastInstance;
      instance.emit('error', { type: 'unavailable-id', message: 'ID is taken' });

      const copyBadge = document.getElementById('copy-badge');
      const customIdModal = document.getElementById('custom-id-modal');

      expect(app.getCustomIdRetryAttempts()).toBe(1);
      expect(copyBadge.innerHTML).toContain('Liberando ID');
      expect(customIdModal.style.display).not.toBe('flex');
    });

    it('quando reconexão for bem sucedida no open, deve zerar customIdRetryAttempts e persistir na sessionStorage', () => {
      app.setCustomStreamerId('diogo');
      app.setCustomIdRetryAttempts(2);
      app.initPeer();

      const instance = MockPeer.lastInstance;
      instance.emit('open', 'diogo');

      expect(app.getCustomIdRetryAttempts()).toBe(0);
      expect(sessionStorage.getItem('seemygame_last_id')).toBe('diogo');
    });

    it('deve abrir modal após esgotar tentativas de reconexão de ID', () => {
      sessionStorage.setItem('seemygame_last_id', 'diogo');
      app.setCustomStreamerId('diogo');
      app.setCustomIdRetryAttempts(app.MAX_CUSTOM_ID_RETRIES);
      app.initPeer();

      const instance = MockPeer.lastInstance;
      instance.emit('error', { type: 'unavailable-id', message: 'ID is taken' });

      const customIdModal = document.getElementById('custom-id-modal');
      const customIdError = document.getElementById('custom-id-error');
      const copyBadge = document.getElementById('copy-badge');

      expect(customIdModal.style.display).toBe('flex');
      expect(customIdError.style.display).toBe('block');
      expect(copyBadge.innerHTML).toContain('em uso');
      expect(sessionStorage.getItem('seemygame_last_id')).toBeNull();
    });

    it('deve chamar peer.destroy() no evento beforeunload para liberar o ID de forma limpa', () => {
      app.initPeer();
      const inst = MockPeer.lastInstance;
      expect(inst.destroyed).toBe(false);

      window.dispatchEvent(new Event('beforeunload'));
      expect(inst.destroyed).toBe(true);
    });

    it('em viewer.html, não deve inicializar com o ID customizado do streamer', () => {
      const origLocation = window.location;
      delete window.location;
      window.location = new URL('http://localhost/viewer.html');

      try {
        app.setCustomStreamerId('streamer-mason');
        app.resetPeer();
        app.initPeer();

        const inst = MockPeer.lastInstance;
        expect(inst.id).toBeNull();
      } finally {
        window.location = origLocation;
      }
    });
  });

  describe('Handshake de Proteção por Senha (PIN)', () => {
    it('em sala SEM PIN, deve autorizar espectador e enviar STREAM_STATUS imediatamente', () => {
      app.setStoredRoomPin('');
      app.initPeer();

      const peerInstance = MockPeer.lastInstance;
      const conn = new MockDataConnection('viewer-no-pin');

      peerInstance.emit('connection', conn);
      conn.emit('open');

      expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'STREAM_STATUS'
      }));
      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({
        type: 'PIN_REQUIRED'
      }));
      expect(app.authenticatedViewers.has('viewer-no-pin')).toBe(true);
      conn.emit('close');
    });

    it('em sala COM PIN, deve enviar PIN_REQUIRED e NÃO autorizar antes da senha', () => {
      app.setStoredRoomPin('senha123');
      app.initPeer();

      const peerInstance = MockPeer.lastInstance;
      const conn = new MockDataConnection('viewer-with-pin');

      peerInstance.emit('connection', conn);
      conn.emit('open');

      expect(conn.send).toHaveBeenCalledWith({ type: 'PIN_REQUIRED' });
      expect(app.authenticatedViewers.has('viewer-with-pin')).toBe(false);
      conn.emit('close');
    });

    it('em sala COM PIN, deve rejeitar REQUEST_STREAM com PIN incorreto', () => {
      app.setStoredRoomPin('senha123');
      app.initPeer();

      const peerInstance = MockPeer.lastInstance;
      const conn = new MockDataConnection('viewer-wrong-pin');

      peerInstance.emit('connection', conn);
      conn.emit('open');

      // Espectador envia PIN errado
      conn.emit('data', { type: 'REQUEST_STREAM', pin: 'errada' });

      expect(conn.send).toHaveBeenCalledWith({
        type: 'PIN_REQUIRED',
        error: 'PIN incorreto. Tente novamente.'
      });
      expect(app.authenticatedViewers.has('viewer-wrong-pin')).toBe(false);
      conn.emit('close');
    });

    it('em sala COM PIN, deve aceitar REQUEST_STREAM com PIN correto e autorizar o espectador', () => {
      app.setStoredRoomPin('senha123');
      app.initPeer();

      const peerInstance = MockPeer.lastInstance;
      const conn = new MockDataConnection('viewer-correct-pin');

      peerInstance.emit('connection', conn);
      conn.emit('open');

      // Espectador envia PIN correto
      conn.emit('data', { type: 'REQUEST_STREAM', pin: 'senha123' });

      expect(conn.send).toHaveBeenCalledWith({ type: 'PIN_ACCEPTED' });
      expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'STREAM_STATUS'
      }));
      expect(app.authenticatedViewers.has('viewer-correct-pin')).toBe(true);
      conn.emit('close');
    });

    it('deve bloquear mensagens de chat e voz se espectador não autenticou o PIN', () => {
      app.setStoredRoomPin('senha123');
      app.initPeer();

      const peerInstance = MockPeer.lastInstance;
      const conn = new MockDataConnection('viewer-unauthed');

      peerInstance.emit('connection', conn);
      conn.emit('open');

      conn.emit('data', {
        type: 'CHAT_MESSAGE',
        message: { text: 'Ola!' }
      });

      expect(conn.send).toHaveBeenCalledWith({
        type: 'PIN_REQUIRED',
        error: 'Autenticação necessária com PIN.'
      });
      conn.emit('close');
    });

    it('deve remover espectador de authenticatedViewers ao fechar a conexão', () => {
      app.setStoredRoomPin('senha123');
      app.initPeer();

      const peerInstance = MockPeer.lastInstance;
      const conn = new MockDataConnection('viewer-leave');

      peerInstance.emit('connection', conn);
      conn.emit('open');
      conn.emit('data', { type: 'REQUEST_STREAM', pin: 'senha123' });

      expect(app.authenticatedViewers.has('viewer-leave')).toBe(true);

      conn.emit('close');
      expect(app.authenticatedViewers.has('viewer-leave')).toBe(false);
    });
  });

  describe('Interface do Espectador: promptViewerPin & submitViewerPin', () => {
    it('promptViewerPin deve exibir o modal de PIN e mensagem de erro se informada', () => {
      app.promptViewerPin('host-123', 'PIN incorreto');

      const modal = document.getElementById('pin-prompt-modal');
      const err = document.getElementById('viewer-pin-error');

      expect(modal.style.display).toBe('flex');
      expect(err.style.display).toBe('block');
      expect(err.textContent).toBe('PIN incorreto');
    });

    it('hideViewerPinModal deve ocultar o modal e limpar o erro', () => {
      app.hideViewerPinModal();

      const modal = document.getElementById('pin-prompt-modal');
      const err = document.getElementById('viewer-pin-error');

      expect(modal.style.display).toBe('none');
      expect(err.style.display).toBe('none');
      expect(err.textContent).toBe('');
    });

    it('submitViewerPin deve exibir erro se PIN estiver em branco', () => {
      app.promptViewerPin('host-123');
      app.submitViewerPin('');

      const err = document.getElementById('viewer-pin-error');
      expect(err.style.display).toBe('block');
      expect(err.textContent).toContain('digite');
    });
  });

  describe('Interações DOM nos Modais de ID e PIN', () => {
    it('clicar em edit-id-btn deve abrir o modal de ID Fixo', () => {
      const editBtn = document.getElementById('edit-id-btn');
      const modal = document.getElementById('custom-id-modal');

      editBtn.click();
      expect(modal.style.display).toBe('flex');
    });

    it('clicar em custom-id-cancel-btn deve fechar o modal', () => {
      const cancelBtn = document.getElementById('custom-id-cancel-btn');
      const modal = document.getElementById('custom-id-modal');

      modal.style.display = 'flex';
      cancelBtn.click();
      expect(modal.style.display).toBe('none');
    });

    it('clicar em custom-id-save-btn com valor inválido deve mostrar erro', () => {
      const input = document.getElementById('custom-id-input');
      const saveBtn = document.getElementById('custom-id-save-btn');
      const errorDiv = document.getElementById('custom-id-error');

      input.value = 'x'; // menos de 3 chars
      saveBtn.click();

      expect(errorDiv.style.display).toBe('block');
      expect(errorDiv.textContent).toContain('3 e 30');
    });

    it('clicar em custom-id-save-btn com valor válido deve salvar e fechar modal', () => {
      const input = document.getElementById('custom-id-input');
      const saveBtn = document.getElementById('custom-id-save-btn');
      const modal = document.getElementById('custom-id-modal');

      input.value = 'meu-canal-fixo';
      saveBtn.click();

      expect(localStorage.getItem('seemygame_custom_id')).toBe('meu-canal-fixo');
      expect(modal.style.display).toBe('none');
    });

    it('clicar em custom-id-reset-btn deve remover ID e fechar modal', () => {
      app.setCustomStreamerId('meu-canal-fixo');
      const resetBtn = document.getElementById('custom-id-reset-btn');
      const modal = document.getElementById('custom-id-modal');

      modal.style.display = 'flex';
      resetBtn.click();

      expect(localStorage.getItem('seemygame_custom_id')).toBeNull();
      expect(modal.style.display).toBe('none');
    });

    it('digitar no room-pin-input deve atualizar localStorage', () => {
      const pinInput = document.getElementById('room-pin-input');
      pinInput.value = 'senha999';
      pinInput.dispatchEvent(new Event('input'));

      expect(localStorage.getItem('seemygame_streamer_pin')).toBe('senha999');

      pinInput.value = '';
      pinInput.dispatchEvent(new Event('input'));
      expect(localStorage.getItem('seemygame_streamer_pin')).toBeNull();
    });
  });
});
