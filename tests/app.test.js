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
  constructor(config) {
    this.config = config;
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
}

MockPeer.lastInstance = null;
MockPeer.lastDataConnection = null;
MockPeer.lastMediaCall = null;

let app;

describe('Módulo: app.js', () => {
  beforeAll(async () => {
    // Configura o DOM completo similar ao index.html antes do módulo ser importado
    document.body.innerHTML = `
      <div id="toast-container"></div>
      <header>
        <span id="copy-badge" class="id-badge">Gerando ID...</span>
        <button id="share-link-btn" style="display:none;">Copiar Link</button>
        <button id="stream-btn" disabled>Transmitir Jogo</button>
        <span id="viewer-count">0 espectadores</span>
        <input type="text" id="target-id">
        <button id="connect-btn">Assistir Amigo</button>
      </header>
      <div class="tuning-bar">
        <select id="audio-mode-select">
          <option value="system" selected>Sistema</option>
          <option value="mic">Microfone</option>
          <option value="none">Mudo</option>
        </select>
        <select id="coop-mode-select">
          <option value="disabled" selected>Desativado</option>
          <option value="enabled">Ativado</option>
        </select>
        <select id="quality-preset">
          <option value="ultra">Ultra</option>
          <option value="balanced" selected>Balanced</option>
          <option value="high">High</option>
        </select>
        <input type="range" id="bitrate-slider" min="2500" max="16000" step="500" value="7500">
        <span id="bitrate-display">7.5 Mbps</span>
      </div>
      <div id="audio-tip-banner">
        <button id="close-banner-btn">✕</button>
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
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (app && typeof app.stopLocalStream === 'function') {
      app.stopLocalStream();
    }
  });

  describe('Controles de Tuning, Slider e Banner', () => {
    it('deve atualizar bitrate e display ao alterar o preset de qualidade', () => {
      const select = document.getElementById('quality-preset');
      const slider = document.getElementById('bitrate-slider');
      const display = document.getElementById('bitrate-display');

      select.value = 'ultra';
      select.dispatchEvent(new Event('change'));

      expect(slider.value).toBe('4500');
      expect(display.textContent).toBe('4.5 Mbps');

      select.value = 'high';
      select.dispatchEvent(new Event('change'));

      expect(slider.value).toBe('12000');
      expect(display.textContent).toBe('12.0 Mbps');
    });

    it('deve atualizar o display ao mover o slider de bitrate manualmente', () => {
      const slider = document.getElementById('bitrate-slider');
      const display = document.getElementById('bitrate-display');

      slider.value = '10000';
      slider.dispatchEvent(new Event('input'));

      expect(display.textContent).toBe('10.0 Mbps');
    });

    it('deve fechar o banner de dica de áudio ao clicar no botão fechar', () => {
      const banner = document.getElementById('audio-tip-banner');
      const closeBtn = document.getElementById('close-banner-btn');

      banner.style.display = 'block';
      closeBtn.click();

      expect(banner.style.display).toBe('none');
    });

    it('deve disparar clique de conexão ao pressionar Enter no campo de target-id', () => {
      const input = document.getElementById('target-id');
      const connectBtn = document.getElementById('connect-btn');
      const clickSpy = vi.spyOn(connectBtn, 'click');

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('initPeer e Ciclo de Vida P2P', () => {
    it('deve inicializar PeerJS e atualizar UI no evento open', () => {
      app.initPeer();

      const peerInstance = MockPeer.lastInstance;
      expect(peerInstance).not.toBeNull();

      peerInstance.emit('open', 'my-test-id-123');

      const copyBadge = document.getElementById('copy-badge');
      const shareLinkBtn = document.getElementById('share-link-btn');
      const streamBtn = document.getElementById('stream-btn');

      expect(copyBadge.textContent).toContain('my-test-id-123');
      expect(shareLinkBtn.style.display).toBe('inline-flex');
      expect(streamBtn.disabled).toBe(false);
    });

    it('deve copiar ID para clipboard ao clicar no copy-badge', () => {
      const copyBadge = document.getElementById('copy-badge');
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText');

      copyBadge.click();

      expect(writeTextSpy).toHaveBeenCalledWith('my-test-id-123');
    });

    it('deve copiar link direto apontando para viewer.html com hash watch ao clicar em shareLinkBtn', () => {
      const shareLinkBtn = document.getElementById('share-link-btn');
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText');

      shareLinkBtn.click();

      expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('viewer.html#watch=my-test-id-123'));
    });

    it('deve gerenciar conexões de dados recebidas (connection) e atualizar o contador de espectadores', () => {
      const peerInstance = MockPeer.lastInstance;
      const mockConn = new MockDataConnection('viewer-peer-1');
      const countBadge = document.getElementById('viewer-count');

      peerInstance.emit('connection', mockConn);
      mockConn.emit('open');

      expect(countBadge.textContent).toContain('1 espectador');

      expect(mockConn.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'STREAM_STATUS' })
      );

      mockConn.emit('data', { type: 'REQUEST_STREAM' });
      mockConn.emit('close');

      expect(countBadge.textContent).toContain('0 espectadores');
    });

    it('deve gerenciar chamadas de mídia recebidas (call) e renderizar vídeo remoto quando solicitadas', () => {
      const peerInstance = MockPeer.lastInstance;
      const mockCall = new MockMediaConnection('streamer-host-789');

      // Registra que estamos assistindo a este host
      app.watchFriend('streamer-host-789');

      peerInstance.emit('call', mockCall);
      expect(mockCall.answer).toHaveBeenCalled();

      const remoteStream = new MockMediaStream([new MockMediaStreamTrack('video')]);
      mockCall.emit('stream', remoteStream);

      const card = document.getElementById('card-streamer-host-789');
      expect(card).not.toBeNull();

      mockCall.emit('close');
      expect(document.getElementById('card-streamer-host-789')).toBeNull();
    });

    it('deve rejeitar chamadas de mídia não solicitadas de peers desconhecidos', () => {
      const peerInstance = MockPeer.lastInstance;
      const unsolicitedCall = new MockMediaConnection('unknown-spammer');

      peerInstance.emit('call', unsolicitedCall);
      expect(unsolicitedCall.answer).not.toHaveBeenCalled();
      expect(unsolicitedCall.close).toHaveBeenCalled();
    });

    it('deve tratar evento de erro peer-unavailable', () => {
      const peerInstance = MockPeer.lastInstance;
      const targetInput = document.getElementById('target-id');
      targetInput.value = 'offline-user-id';

      expect(() => {
        peerInstance.emit('error', { type: 'peer-unavailable', message: 'Peer not found' });
      }).not.toThrow();
    });
  });

  describe('watchFriend e Conexão de Espectador', () => {
    it('deve impedir conectar com ID vazio ou com o próprio ID', () => {
      const resultEmpty = app.watchFriend('');
      expect(document.getElementById('card-')).toBeNull();

      // myId atual é 'my-test-id-123'
      app.watchFriend('my-test-id-123');
      expect(document.getElementById('card-my-test-id-123')).toBeNull();
    });

    it('deve extrair target ID de link com query param ?watch=ID ou fragmento #watch=ID', () => {
      app.watchFriend('https://seemygame.com/?watch=friend-param-id');
      expect(document.getElementById('card-friend-param-id')).not.toBeNull();
      app.disconnectHost('friend-param-id');

      app.watchFriend('https://seemygame.com/#watch=friend-hash-id&audio=1');
      expect(document.getElementById('card-friend-hash-id')).not.toBeNull();
      app.disconnectHost('friend-hash-id');
    });

    it('deve criar placeholder e enviar REQUEST_STREAM ao conectar', async () => {
      app.watchFriend('friend-target-999');

      const card = document.getElementById('card-friend-target-999');
      expect(card).not.toBeNull();

      const conn = MockPeer.lastDataConnection;
      expect(conn).not.toBeNull();

      // Simula resposta de status
      conn.emit('data', { type: 'STREAM_STATUS', isStreaming: false });
      expect(card.textContent).toContain('Aguardando ele iniciar o jogo');

      conn.emit('data', { type: 'STREAM_STATUS', isStreaming: true });
      expect(card.textContent).toContain('Sincronizando stream');

      conn.emit('data', { type: 'STREAM_STOPPED' });
      expect(card.textContent).toContain('Transmissão pausada');

      app.disconnectHost('friend-target-999');
      expect(document.getElementById('card-friend-target-999')).toBeNull();
    });
  });

  describe('startLocalStream e stopLocalStream', () => {
    it('deve iniciar transmissão de tela em alta fluidez e atualizar UI', async () => {
      const videoTrack = new MockMediaStreamTrack('video');
      const audioTrack = new MockMediaStreamTrack('audio');
      const mockStream = new MockMediaStream([videoTrack, audioTrack]);

      navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(mockStream);

      await app.startLocalStream();

      expect(videoTrack.contentHint).toBe('motion');

      const localCard = document.getElementById('card-local-me');
      expect(localCard).not.toBeNull();

      const streamBtn = document.getElementById('stream-btn');
      expect(streamBtn.textContent).toContain('Parar Transmissão');
      expect(streamBtn.classList.contains('btn-stop')).toBe(true);

      app.stopLocalStream();

      expect(document.getElementById('card-local-me')).toBeNull();
      expect(streamBtn.textContent).toContain('Transmitir Jogo');
      expect(streamBtn.classList.contains('btn-stop')).toBe(false);
    });

    it('deve chamar getUserMedia e anexar faixa de áudio quando audioMode for mic', async () => {
      const audioSelect = document.getElementById('audio-mode-select');
      audioSelect.value = 'mic';

      const videoTrack = new MockMediaStreamTrack('video');
      const micTrack = new MockMediaStreamTrack('audio', 'mic-track-1');
      const screenStream = new MockMediaStream([videoTrack]);
      const micStream = new MockMediaStream([micTrack]);

      navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(screenStream);
      navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(micStream);

      await app.startLocalStream();

      expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
      expect(screenStream.getAudioTracks().length).toBeGreaterThan(0);

      app.stopLocalStream();
    });

    it('deve realizar hot swapping de áudio ao vivo quando o streamer altera audioModeSelect durante a transmissão', async () => {
      const audioSelect = document.getElementById('audio-mode-select');
      audioSelect.value = 'system';

      const videoTrack = new MockMediaStreamTrack('video');
      const screenStream = new MockMediaStream([videoTrack]);
      const micTrack = new MockMediaStreamTrack('audio', 'live-mic-track');
      const micStream = new MockMediaStream([micTrack]);

      navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(screenStream);
      navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(micStream);

      await app.startLocalStream();

      // Conecta um espectador de teste
      const mockConn = new MockDataConnection('viewer-live-audio');
      MockPeer.lastInstance.emit('connection', mockConn);
      mockConn.emit('open');

      // Troca para microfone ao vivo
      audioSelect.value = 'mic';
      audioSelect.dispatchEvent(new Event('change'));

      // Aguarda tick das promises do listener assíncrono
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
      expect(mockConn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'STREAM_CONFIG_UPDATED',
        audioMode: 'mic'
      }));

      // Troca para mudo/none ao vivo
      audioSelect.value = 'none';
      audioSelect.dispatchEvent(new Event('change'));
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockConn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'STREAM_CONFIG_UPDATED',
        audioMode: 'none'
      }));

      mockConn.emit('close');
      app.stopLocalStream();
    });

    it('deve notificar espectadores conectados com STREAM_CONFIG_UPDATED quando qualityPresetSelect for alterado', async () => {
      const presetSelect = document.getElementById('quality-preset');
      const videoTrack = new MockMediaStreamTrack('video');
      const mockStream = new MockMediaStream([videoTrack]);
      navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(mockStream);

      await app.startLocalStream();

      const mockConn = new MockDataConnection('viewer-preset-test');
      MockPeer.lastInstance.emit('connection', mockConn);
      mockConn.emit('open');

      presetSelect.value = 'ultra';
      presetSelect.dispatchEvent(new Event('change'));

      expect(mockConn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'STREAM_CONFIG_UPDATED',
        preset: 'ultra'
      }));

      mockConn.emit('close');
      app.stopLocalStream();
    });

    it('deve transmitir COOP_CONFIG para espectadores conectados ao alternar coopModeSelect', () => {
      const mockConn = new MockDataConnection('viewer-coop-sync');
      MockPeer.lastInstance.emit('connection', mockConn);
      mockConn.emit('open');

      const selectElem = document.getElementById('coop-mode-select');
      selectElem.value = 'enabled';
      selectElem.dispatchEvent(new Event('change'));

      expect(mockConn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'COOP_CONFIG',
        enabled: true
      }));

      selectElem.value = 'disabled';
      selectElem.dispatchEvent(new Event('change'));

      expect(mockConn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'COOP_CONFIG',
        enabled: false
      }));

      mockConn.emit('close');
    });

    it('deve interromper o stream automaticamente quando a faixa de vídeo disparar onended', async () => {
      const videoTrack = new MockMediaStreamTrack('video');
      const mockStream = new MockMediaStream([videoTrack]);

      navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(mockStream);

      await app.startLocalStream();
      expect(document.getElementById('card-local-me')).not.toBeNull();

      // Simula o usuário clicando no botão nativo do navegador "Interromper compartilhamento"
      videoTrack.stop();
      if (typeof videoTrack.onended === 'function') {
        videoTrack.onended();
      }

      expect(document.getElementById('card-local-me')).toBeNull();
    });

    it('deve tratar gracefully quando o usuário cancela a seleção de tela (NotAllowedError)', async () => {
      navigator.mediaDevices.getDisplayMedia = vi.fn().mockRejectedValue({
        name: 'NotAllowedError',
        message: 'Permission denied'
      });

      await expect(app.startLocalStream()).resolves.not.toThrow();
      expect(document.getElementById('card-local-me')).toBeNull();
    });

    it('deve fechar todas as chamadas de mídia ativas dos espectadores ao invocar stopLocalStream', async () => {
      const videoTrack = new MockMediaStreamTrack('video');
      const mockStream = new MockMediaStream([videoTrack]);
      navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(mockStream);

      await app.startLocalStream();

      // Simula conexão de um espectador
      const peerInstance = MockPeer.lastInstance;
      const mockConn = new MockDataConnection('viewer-close-test');
      peerInstance.emit('connection', mockConn);
      mockConn.emit('open');

      const mediaCall = MockPeer.lastMediaCall;
      expect(mediaCall).not.toBeNull();
      const closeSpy = vi.spyOn(mediaCall, 'close');

      app.stopLocalStream();

      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('Auditoria: Idempotência de Chamadas e Cancelamento Pendente', () => {
    it('deve garantir idempotência: conexão + REQUEST_STREAM não devem disparar duas chamadas de mídia', async () => {
      const videoTrack = new MockMediaStreamTrack('video');
      const mockStream = new MockMediaStream([videoTrack]);
      navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(mockStream);

      await app.startLocalStream();

      const peerInstance = MockPeer.lastInstance;
      const callSpy = vi.spyOn(peerInstance, 'call');

      const mockConn = new MockDataConnection('viewer-idempotent-1');
      peerInstance.emit('connection', mockConn);

      // Evento 1: open dispara primeira chamada
      mockConn.emit('open');
      expect(callSpy).toHaveBeenCalledTimes(1);

      // Evento 2: REQUEST_STREAM NÃO deve disparar segunda chamada
      mockConn.emit('data', { type: 'REQUEST_STREAM' });
      expect(callSpy).toHaveBeenCalledTimes(1);

      app.stopLocalStream();
    });

    it('deve cancelar conexão pendente imediatamente ao desconectar antes do evento open', () => {
      // Simula conexão lenta cujo open ainda não ocorreu
      const conn = new MockDataConnection('pending-host-1');
      const closeSpy = vi.spyOn(conn, 'close');
      const sendSpy = vi.spyOn(conn, 'send');

      const peerInstance = MockPeer.lastInstance;
      vi.spyOn(peerInstance, 'connect').mockReturnValue(conn);

      app.watchFriend('pending-host-1');

      // Usuário clica em desconectar antes do open
      app.disconnectHost('pending-host-1');
      expect(closeSpy).toHaveBeenCalled();

      // Quando o evento open finalmente ocorrer no WebSocket atrasado
      conn.emit('open');

      // Não deve ter enviado REQUEST_STREAM pois foi cancelado
      expect(sendSpy).not.toHaveBeenCalledWith({ type: 'REQUEST_STREAM' });
    });
  });
});
