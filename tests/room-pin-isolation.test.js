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
    this.open = true;
    this.send = vi.fn();
    this.close = vi.fn(() => {
      this.open = false;
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

  destroy() {
    this.destroyed = true;
    this.emit('close');
  }

  connect(targetId) {
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

MockPeer.instances = [];
MockPeer.lastInstance = null;
MockPeer.lastDataConnection = null;
MockPeer.lastMediaCall = null;

let app;

describe('Isolamento de PIN em Salas (Correção do Bug de Solicitação Indevida de PIN)', () => {
  beforeAll(async () => {
    delete window.location;
    window.location = {
      pathname: '/room.html',
      origin: 'http://localhost:3000',
      hash: '#room=squad-fps',
      search: ''
    };

    document.body.innerHTML = `
      <div id="toast-container"></div>
      <header>
        <span id="room-header-badge">Sala: #squad-fps</span>
        <span id="copy-badge" class="id-badge">Gerando ID...</span>
        <button id="share-link-btn">Convidar Amigos</button>
        <span id="viewer-count">0 online</span>
        <button id="stream-btn">Transmitir Jogo</button>
      </header>
      <div class="tuning-bar">
        <input type="password" id="room-pin-input" placeholder="PIN da Sala">
      </div>
      <div id="pin-prompt-modal" style="display: none;">
        <input type="password" id="viewer-pin-input">
        <div id="viewer-pin-error" style="display: none;"></div>
        <button id="viewer-pin-submit-btn">Entrar na Sala</button>
        <button id="viewer-pin-cancel-btn">Cancelar</button>
      </div>
      <main id="video-grid" class="video-grid"></main>
    `;

    globalThis.Peer = MockPeer;
    app = await import('../js/app.js');
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    MockPeer.instances = [];
    MockPeer.lastInstance = null;
    MockPeer.lastDataConnection = null;
    MockPeer.lastMediaCall = null;
    const modal = document.getElementById('pin-prompt-modal');
    if (modal) modal.style.display = 'none';
  });

  afterEach(async () => {
    if (app) {
      await app.stopLocalStream?.();
      app.roomManager?.leave?.();
      app.resetPeer?.();
    }
  });

  it('Cenário do Bug: 3 participantes na sala; Usuário 3 com PIN residual em seemygame_streamer_pin transmite e NÃO solicita PIN aos outros', async () => {
    // Simula que o Usuário 3 (local) possuía um PIN residual de streamer salvo no localStorage
    localStorage.setItem('seemygame_streamer_pin', 'senha_antiga_999');

    // Inicializa a sessão da sala como Usuário 3 (membro comum)
    const peerInstance = app.initPeer();
    peerInstance.emit('open', 'peer-user-3');

    const room = app.roomManager;
    expect(room).toBeDefined();

    // Adiciona Pessoa 1 (Master) e Pessoa 2 (Membro) como conexões admitidas e autorizadas na malha
    const connUser1 = new MockDataConnection('peer-user-1');
    const connUser2 = new MockDataConnection('peer-user-2');

    room.promoteConnection('peer-user-1', connUser1, { name: 'Pessoa 1 (Host)', isMaster: true });
    room.promoteConnection('peer-user-2', connUser2, { name: 'Pessoa 2', isMaster: false });

    expect(room.isPeerAuthorized('peer-user-1')).toBe(true);
    expect(room.isPeerAuthorized('peer-user-2')).toBe(true);

    // Registra conexões via peer.emit('connection')
    peerInstance.emit('connection', connUser1);
    connUser1.emit('open');
    peerInstance.emit('connection', connUser2);
    connUser2.emit('open');

    connUser1.send.mockClear();
    connUser2.send.mockClear();

    // Simula Usuário 3 iniciando a transmissão local
    const fakeTrack = new MockMediaStreamTrack('video');
    const fakeStream = new MockMediaStream([fakeTrack]);
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(fakeStream);

    await app.startLocalStream();

    expect(room.localStreamingState.isStreaming).toBe(true);

    // Pessoa 1 e Pessoa 2 conectam/solicitam o stream com REQUEST_STREAM (sem PIN)
    connUser1.emit('data', { type: 'REQUEST_STREAM' });
    connUser2.emit('data', { type: 'REQUEST_STREAM' });

    // VERIFICAÇÃO CRÍTICA: O Usuário 3 NUNCA deve responder PIN_REQUIRED para membros da sala
    expect(connUser1.send).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'PIN_REQUIRED'
    }));
    expect(connUser2.send).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'PIN_REQUIRED'
    }));

    // Membros da sala devem ser autorizados
    expect(app.authenticatedViewers.has('peer-user-1')).toBe(true);
    expect(app.authenticatedViewers.has('peer-user-2')).toBe(true);

    // Modal de PIN não deve ter sido aberto
    const pinModal = document.getElementById('pin-prompt-modal');
    expect(pinModal.style.display).toBe('none');
  });

  it('em room.html, digitar em #room-pin-input atualiza o PIN da sala sem poluir seemygame_streamer_pin', () => {
    const peerInstance = app.initPeer();
    peerInstance.emit('open', 'smg-room-squad-fps');

    const room = app.roomManager;
    expect(room).toBeDefined();

    app.initFixedIdAndPinControls();

    const pinInput = document.getElementById('room-pin-input');
    pinInput.value = 'sala-secreta-42';
    pinInput.dispatchEvent(new Event('input'));

    expect(room.roomPin).toBe('sala-secreta-42');
    expect(localStorage.getItem('seemygame_streamer_pin')).toBeNull();
  });

  it('ao clicar em shareLinkBtn com PIN na sala, gera link com parâmetro &pin=', async () => {
    const peerInstance = app.initPeer();
    peerInstance.emit('open', 'smg-room-squad-fps');

    const room = app.roomManager;
    room.setRoomPin('chave123');

    let copiedText = '';
    navigator.clipboard = {
      writeText: vi.fn(async (text) => { copiedText = text; })
    };

    const shareBtn = document.getElementById('share-link-btn');
    shareBtn.click();

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(copiedText).toContain('#room=squad-fps&pin=chave123');
  });

  it('quando convidado recebe ROOM_PIN_REQUIRED, exibe o modal de PIN e submitViewerPin reenvia ROOM_JOIN_REQUEST', () => {
    const peerInstance = app.initPeer();
    peerInstance.emit('open', 'peer-guest-local');

    const room = app.roomManager;
    room.masterPeerId = 'smg-room-squad-fps';

    const masterConn = new MockDataConnection(room.masterPeerId);
    room.pendingConnections.set(room.masterPeerId, masterConn);

    // Master envia ROOM_PIN_REQUIRED
    room.emit('pinRequired', { error: 'PIN incorreto para esta sala.' });

    const pinModal = document.getElementById('pin-prompt-modal');
    const pinError = document.getElementById('viewer-pin-error');
    expect(pinModal.style.display).toBe('flex');
    expect(pinError.textContent).toBe('PIN incorreto para esta sala.');

    // Convidado digita o PIN correto
    masterConn.send.mockClear();
    app.submitViewerPin('pin_correto_123');

    expect(masterConn.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ROOM_JOIN_REQUEST',
      pin: 'pin_correto_123'
    }));

    // Quando Master aceita
    room.emit('pinAccepted', { peerId: room.masterPeerId, roomId: 'squad-fps' });
    expect(pinModal.style.display).toBe('none');
  });

  it('P1 Regressão: conexão não admitida em sala protegida NÃO deve receber chamada de vídeo nem status de streaming', async () => {
    const p = app.initPeer();
    p.emit('open', 'peer-review-host');
    app.roomManager.setRoomPin('room-secret');

    const fakeTrack = new MockMediaStreamTrack('video');
    const fakeStream = new MockMediaStream([fakeTrack]);
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(fakeStream);

    await app.startLocalStream();

    const stranger = new MockDataConnection('peer-review-stranger');
    const callSpy = vi.spyOn(p, 'call');

    p.emit('connection', stranger);
    stranger.emit('open');

    expect(app.roomManager.isPeerAuthorized(stranger.peer)).toBe(false);
    expect(app.isPeerAuthorizedForMedia(stranger.peer)).toBe(false);
    expect(callSpy).not.toHaveBeenCalledWith(stranger.peer, expect.anything());
    expect(app.authenticatedViewers.has(stranger.peer)).toBe(false);
    expect(stranger.send).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'STREAM_STATUS',
      isStreaming: true
    }));
  });

  it('P1: ROOM_JOIN_REQUEST com PIN incorreto é rejeitado e REQUEST_STREAM não autorizado é descartado', async () => {
    const p = app.initPeer();
    p.emit('open', 'peer-host-room');
    app.roomManager.isMaster = true;
    app.roomManager.setRoomPin('segredo-da-sala');

    const fakeTrack = new MockMediaStreamTrack('video');
    const fakeStream = new MockMediaStreamTrack('video');
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(new MockMediaStream([fakeTrack]));
    await app.startLocalStream();

    const intruder = new MockDataConnection('peer-intruder');
    const callSpy = vi.spyOn(p, 'call');

    p.emit('connection', intruder);
    intruder.emit('open');

    intruder.send.mockClear();
    callSpy.mockClear();

    // 1. Intruso tenta entrar com PIN incorreto
    intruder.emit('data', { type: 'ROOM_JOIN_REQUEST', pin: 'senha-errada' });

    expect(callSpy).not.toHaveBeenCalled();
    expect(intruder.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ROOM_PIN_REQUIRED',
      error: 'PIN incorreto para esta sala.'
    }));
    expect(app.authenticatedViewers.has(intruder.peer)).toBe(false);

    // 2. Intruso tenta enviar REQUEST_STREAM direto sem autenticação
    intruder.send.mockClear();
    intruder.emit('data', { type: 'REQUEST_STREAM' });

    expect(callSpy).not.toHaveBeenCalled();
    expect(app.authenticatedViewers.has(intruder.peer)).toBe(false);
  });

  it('P1: iniciar transmissão com conexões pendentes não envia mídia para peers não autorizados', async () => {
    const p = app.initPeer();
    p.emit('open', 'peer-host-room-pending');
    app.roomManager.setRoomPin('pin-123');

    const pendingStranger = new MockDataConnection('peer-pending');
    p.emit('connection', pendingStranger);
    pendingStranger.emit('open');

    expect(app.roomManager.isPeerAuthorized(pendingStranger.peer)).toBe(false);

    const callSpy = vi.spyOn(p, 'call');
    const fakeTrack = new MockMediaStreamTrack('video');
    const fakeStream = new MockMediaStream([fakeTrack]);
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(fakeStream);

    await app.startLocalStream();

    expect(callSpy).not.toHaveBeenCalledWith(pendingStranger.peer, expect.anything());
    expect(pendingStranger.send).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'STREAM_STATUS',
      isStreaming: true
    }));
  });

  it('P1: participante removido da sala perde autorização e tem chamada encerrada', async () => {
    const p = app.initPeer();
    p.emit('open', 'peer-host-removal');

    const memberConn = new MockDataConnection('peer-to-remove');
    app.roomManager.promoteConnection('peer-to-remove', memberConn, { name: 'Membro Teste' });

    expect(app.isPeerAuthorizedForMedia('peer-to-remove')).toBe(true);

    const fakeTrack = new MockMediaStreamTrack('video');
    const fakeStream = new MockMediaStream([fakeTrack]);
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(fakeStream);
    await app.startLocalStream();

    p.emit('connection', memberConn);
    memberConn.emit('open');

    expect(app.authenticatedViewers.has('peer-to-remove')).toBe(true);

    // Remove membro da sala
    app.roomManager.removeMember('peer-to-remove');

    expect(app.roomManager.isPeerAuthorized('peer-to-remove')).toBe(false);
    expect(app.isPeerAuthorizedForMedia('peer-to-remove')).toBe(false);
    expect(app.authenticatedViewers.has('peer-to-remove')).toBe(false);
  });
});
