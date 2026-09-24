import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  MockMediaStream,
  MockMediaStreamTrack,
  MockRTCPeerConnection
} from './mocks/webrtc.mock.js';
import { RoomManager, getRoomMasterPeerId } from '../js/room.js';

class MockDataConnection {
  constructor(peer) {
    this.peer = peer;
    this.open = true;
    this.events = {};
    this.send = vi.fn();
    this.close = vi.fn(() => {
      this.open = false;
      if (this.events['close']) this.events['close']();
    });
  }

  on(event, cb) {
    this.events[event] = cb;
  }

  once(event, cb) {
    this.events[event] = (...args) => {
      delete this.events[event];
      cb(...args);
    };
  }

  emit(event, ...args) {
    if (event === 'open') this.open = true;
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
    MockPeer.connectionsByPeer.set(targetId, conn);
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
MockPeer.connectionsByPeer = new Map();
MockPeer.lastMediaCall = null;

let app;

describe('Salas Multi-Instâncias (3+ Participantes: Múltiplos Desktops e Web)', () => {
  beforeAll(async () => {
    delete window.location;
    window.location = {
      pathname: '/room.html',
      origin: 'http://localhost:3000',
      hash: '#room=arena-trio',
      search: ''
    };

    document.body.innerHTML = `
      <div id="video-grid" class="video-grid"></div>
      <div id="voice-stage-grid"></div>
      <div id="reactions-dock" style="display:none;"></div>
      <div id="room-header-badge"></div>
      <div id="sidebar-room-name"></div>
      <div id="viewer-count-badge"></div>
      <div id="toast-container"></div>
      <div id="copy-badge"></div>
      <button id="stream-btn"></button>
      <div id="desktop-picker-modal" style="display:none;"></div>
    `;

    globalThis.RTCPeerConnection = MockRTCPeerConnection;
    globalThis.MediaStream = MockMediaStream;
    globalThis.MediaStreamTrack = MockMediaStreamTrack;
    globalThis.Peer = MockPeer;

    app = await import('../js/app.js');
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    MockPeer.instances = [];
    MockPeer.lastInstance = null;
    MockPeer.lastDataConnection = null;
    MockPeer.connectionsByPeer = new Map();
    MockPeer.lastMediaCall = null;

    globalThis.__SEEMYGAME_NATIVE_CAPTURE__ = {
      createStream: vi.fn().mockResolvedValue(new MockMediaStream([
        new MockMediaStreamTrack('video')
      ])),
      closeStream: vi.fn().mockResolvedValue(undefined)
    };
  });

  afterEach(() => {
    if (app?.roomManager) {
      app.roomManager.leave();
    }
    vi.restoreAllMocks();
  });

  it('Cenário 1: Host Desktop transmitindo em sala com 2 espectadores (Desktop + Web) com captura nativa Direct3D 11', async () => {
    const roomId = 'arena-trio';
    const masterId = getRoomMasterPeerId(roomId);
    const viewerDesktopId = 'smg_guest_desktop_101';
    const viewerWebId = 'smg_guest_web_202';

    // Mock do backend Tauri para captura nativa no Host
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn(async (cmd, args) => {
        if (cmd === 'start_native_capture') {
          return {
            state: 'live',
            session_id: 'sess-trio-001',
            source_id: args.sourceId,
            source_type: 'monitor',
            video_codec: 'H264',
            video_rtp_port: 5004,
            audio_rtp_port: 5006
          };
        }
        if (cmd === 'create_native_capture_peer') {
          return { type: 'answer', sdp: 'v=0\r\no=local-preview...' };
        }
        if (cmd === 'create_native_viewer_peer') {
          return { type: 'answer', sdp: `v=0\r\no=viewer-${args.viewerId}...` };
        }
        if (cmd === 'add_native_viewer_ice_candidate') {
          return null;
        }
        if (cmd === 'stop_native_capture') {
          return { state: 'idle' };
        }
        return null;
      }),
      transformCallback: vi.fn((cb) => cb)
    };

    // Inicializa Host (Master)
    const hostPeerInstance = app.initPeer();
    hostPeerInstance.emit('open', masterId);

    const room = app.roomManager;
    expect(room).toBeDefined();
    expect(room.isMaster).toBe(true);

    // Conecta Espectador 1 (Desktop)
    const connDesktop = new MockDataConnection(viewerDesktopId);
    hostPeerInstance.emit('connection', connDesktop);
    connDesktop.emit('open');
    connDesktop.emit('data', {
      type: 'ROOM_JOIN_REQUEST',
      roomId,
      name: 'Desktop Convidado'
    });

    // Conecta Espectador 2 (Web)
    const connWeb = new MockDataConnection(viewerWebId);
    hostPeerInstance.emit('connection', connWeb);
    connWeb.emit('open');
    connWeb.emit('data', {
      type: 'ROOM_JOIN_REQUEST',
      roomId,
      name: 'Navegador Web'
    });

    // Confirma que os 3 participantes estão autorizados e na lista de membros do Host
    expect(room.members.size).toBe(3);
    expect(room.isPeerAuthorized(viewerDesktopId)).toBe(true);
    expect(room.isPeerAuthorized(viewerWebId)).toBe(true);

    // Host inicia transmissão de tela nativa (Direct3D 11)
    await app.startLocalStream({ sourceId: 'monitor:0', sourceType: 'monitor' });
    expect(room.localStreamingState.isStreaming).toBe(true);

    // Verifica que ambos os espectadores receberam START_DIRECT_STREAM exatamente 1 vez
    const desktopStartMessages = connDesktop.send.mock.calls
      .map(call => call[0])
      .filter(msg => msg?.type === 'START_DIRECT_STREAM');
    const webStartMessages = connWeb.send.mock.calls
      .map(call => call[0])
      .filter(msg => msg?.type === 'START_DIRECT_STREAM');

    expect(desktopStartMessages.length).toBe(1);
    expect(webStartMessages.length).toBe(1);
    expect(desktopStartMessages[0].sessionId).toBe('sess-trio-001');
    expect(webStartMessages[0].sessionId).toBe('sess-trio-001');

    // Ambos os espectadores respondem com DIRECT_STREAM_OFFER
    connDesktop.emit('data', {
      type: 'DIRECT_STREAM_OFFER',
      sessionId: 'sess-trio-001',
      sdp: 'v=0\r\no=offer-from-desktop-viewer...'
    });

    connWeb.emit('data', {
      type: 'DIRECT_STREAM_OFFER',
      sessionId: 'sess-trio-001',
      sdp: 'v=0\r\no=offer-from-web-viewer...'
    });

    // Aguarda processamento assíncrono do handleDirectStreamOffer
    await new Promise(resolve => setTimeout(resolve, 50));

    // O Host deve ter chamado create_native_viewer_peer para AMBOS os espectadores
    expect(window.__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith('create_native_viewer_peer', expect.objectContaining({
      sessionId: 'sess-trio-001',
      viewerId: viewerDesktopId
    }));
    expect(window.__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith('create_native_viewer_peer', expect.objectContaining({
      sessionId: 'sess-trio-001',
      viewerId: viewerWebId
    }));

    // Verifica que ambos receberam DIRECT_STREAM_ANSWER correspondente
    expect(connDesktop.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'DIRECT_STREAM_ANSWER',
      sdp: expect.stringContaining(`viewer-${viewerDesktopId}`)
    }));
    expect(connWeb.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'DIRECT_STREAM_ANSWER',
      sdp: expect.stringContaining(`viewer-${viewerWebId}`)
    }));

    // Encerra stream
    app.stopLocalStream();
    expect(room.localStreamingState.isStreaming).toBe(false);
  });

  it('Cenário 2: Convidado Desktop transmitindo e Coordenador retransmitindo ROOM_STREAM_PUBLISHED para Convidado Web', () => {
    const roomId = 'arena-trio';
    const masterId = getRoomMasterPeerId(roomId);
    const guestDesktopId = 'guest-desktop-101';
    const guestWebId = 'guest-web-202';

    // 1. Simulação do Coordenador da Sala
    const coordinatorRoom = new RoomManager({ roomId });
    coordinatorRoom.join(masterId, true);

    const connDesktopToCoord = { peer: guestDesktopId, open: true, send: vi.fn() };
    const connWebToCoord = { peer: guestWebId, open: true, send: vi.fn() };

    coordinatorRoom.registerConnection(guestDesktopId, connDesktopToCoord);
    coordinatorRoom.promoteConnection(guestDesktopId, connDesktopToCoord, { name: 'Convidado Desktop' });

    coordinatorRoom.registerConnection(guestWebId, connWebToCoord);
    coordinatorRoom.promoteConnection(guestWebId, connWebToCoord, { name: 'Convidado Web' });

    expect(coordinatorRoom.members.size).toBe(3);

    // 2. Simulação do Convidado Web recebendo as mensagens do Coordenador
    const webRoom = new RoomManager({ roomId });
    webRoom.join(guestWebId, false);
    const connCoordToWeb = { peer: masterId, open: true, send: vi.fn() };
    webRoom.registerConnection(masterId, connCoordToWeb);
    webRoom.promoteConnection(masterId, connCoordToWeb, { isMaster: true });

    // WebRoom sincroniza membros
    webRoom.handleRoomMessage(masterId, {
      type: 'ROOM_SYNC_ALL',
      roomId,
      members: coordinatorRoom.getMembersList()
    }, connCoordToWeb);

    expect(webRoom.members.has(guestDesktopId)).toBe(true);

    const webStreamPublishedSpy = vi.fn();
    webRoom.on('streamPublished', webStreamPublishedSpy);

    // 3. Convidado Desktop inicia transmissão e envia ROOM_STREAM_PUBLISHED para o Coordenador
    coordinatorRoom.handleRoomMessage(guestDesktopId, {
      type: 'ROOM_STREAM_PUBLISHED',
      peerId: guestDesktopId,
      details: { title: 'CS2 60FPS Direct3D', fps: 60, height: 1080 }
    }, connDesktopToCoord);

    // O Coordenador deve ter retransmitido ROOM_STREAM_PUBLISHED para o Convidado Web com o peerId do Desktop!
    expect(connWebToCoord.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ROOM_STREAM_PUBLISHED',
      peerId: guestDesktopId,
      details: expect.objectContaining({ title: 'CS2 60FPS Direct3D' })
    }));

    // 4. O Convidado Web recebe a mensagem retransmitida pelo Coordenador
    const forwardedMessage = connWebToCoord.send.mock.calls.find(call => call[0].type === 'ROOM_STREAM_PUBLISHED')[0];
    webRoom.handleRoomMessage(masterId, forwardedMessage, connCoordToWeb);

    // O Convidado Web deve ter emitido streamPublished para o guestDesktopId (e NÃO para o masterId!)
    expect(webStreamPublishedSpy).toHaveBeenCalledWith(expect.objectContaining({
      peerId: guestDesktopId,
      details: expect.objectContaining({ title: 'CS2 60FPS Direct3D' })
    }));
    expect(webRoom.getActiveStreamers()[0].peerId).toBe(guestDesktopId);

    // 5. Convidado Desktop encerra transmissão
    const webStreamUnpublishedSpy = vi.fn();
    webRoom.on('streamUnpublished', webStreamUnpublishedSpy);

    coordinatorRoom.handleRoomMessage(guestDesktopId, {
      type: 'ROOM_STREAM_UNPUBLISHED',
      peerId: guestDesktopId
    }, connDesktopToCoord);

    // O Coordenador retransmite o encerramento para o Convidado Web
    expect(connWebToCoord.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ROOM_STREAM_UNPUBLISHED',
      peerId: guestDesktopId
    }));

    const forwardedUnpublish = connWebToCoord.send.mock.calls.find(call => call[0].type === 'ROOM_STREAM_UNPUBLISHED')[0];
    webRoom.handleRoomMessage(masterId, forwardedUnpublish, connCoordToWeb);

    expect(webStreamUnpublishedSpy).toHaveBeenCalledWith(expect.objectContaining({
      peerId: guestDesktopId
    }));
    expect(webRoom.getActiveStreamers().length).toBe(0);
  });

  it('Cenário 3: Promoção automática de conexões P2P pendentes entre Convidado Desktop e Convidado Web ao receber autorização do Coordenador', () => {
    const roomId = 'arena-trio';
    const masterId = getRoomMasterPeerId(roomId);
    const guestDesktopId = 'desktop-user-1';
    const guestWebId = 'web-user-2';

    // Cria a sala do Convidado Desktop
    const desktopRoom = new RoomManager({ roomId });
    desktopRoom.join(guestDesktopId, false);

    const masterConn = { peer: masterId, open: true, send: vi.fn() };
    desktopRoom.registerConnection(masterId, masterConn);
    desktopRoom.promoteConnection(masterId, masterConn, { isMaster: true });

    // Convidado Web tenta abrir DataConnection com Convidado Desktop ANTES do Coordenador anunciar
    const incomingWebConn = { peer: guestWebId, open: true, send: vi.fn() };
    const registered = desktopRoom.registerConnection(guestWebId, incomingWebConn);

    expect(registered).toBe(true);
    expect(desktopRoom.pendingConnections.has(guestWebId)).toBe(true);
    expect(desktopRoom.meshConnections.has(guestWebId)).toBe(false);
    expect(desktopRoom.isPeerAuthorized(guestWebId)).toBe(false);

    // Coordenador entrega ROOM_MEMBER_JOINED com os dados do Convidado Web
    desktopRoom.handleRoomMessage(masterId, {
      type: 'ROOM_MEMBER_JOINED',
      member: {
        peerId: guestWebId,
        name: 'Convidado Web Autorizado'
      }
    }, masterConn);

    // A conexão deve ter sido promovida para meshConnections e autorizada!
    expect(desktopRoom.pendingConnections.has(guestWebId)).toBe(false);
    expect(desktopRoom.meshConnections.has(guestWebId)).toBe(true);
    expect(desktopRoom.isPeerAuthorized(guestWebId)).toBe(true);
    expect(desktopRoom.members.get(guestWebId).name).toBe('Convidado Web Autorizado');
  });

  it('Cenário 4: Retransmissão de atualizações de voz (Mute/Deafen) do membro pelo Coordenador para toda a sala 3+', () => {
    const roomId = 'arena-trio';
    const masterId = getRoomMasterPeerId(roomId);
    const guest1Id = 'member-voice-1';
    const guest2Id = 'member-voice-2';

    const coordRoom = new RoomManager({ roomId });
    coordRoom.join(masterId, true);

    const conn1 = { peer: guest1Id, open: true, send: vi.fn() };
    const conn2 = { peer: guest2Id, open: true, send: vi.fn() };

    coordRoom.registerConnection(guest1Id, conn1);
    coordRoom.promoteConnection(guest1Id, conn1, { name: 'Membro 1' });
    coordRoom.registerConnection(guest2Id, conn2);
    coordRoom.promoteConnection(guest2Id, conn2, { name: 'Membro 2' });

    // Membro 1 envia mute
    coordRoom.handleRoomMessage(guest1Id, {
      type: 'ROOM_MEMBER_STATE_UPDATE',
      peerId: guest1Id,
      isMuted: true,
      isDeafened: false
    }, conn1);

    // Coordenador deve ter retransmitido para o Membro 2
    expect(conn2.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ROOM_MEMBER_STATE_UPDATE',
      peerId: guest1Id,
      isMuted: true
    }));
  });

  it('Cenário 5: Deduplicação de notificações de transmissão (sem chamadas duplicadas para o mesmo participante)', async () => {
    const roomId = 'arena-trio';
    const masterId = getRoomMasterPeerId(roomId);
    const viewerId = 'viewer-dedup-303';

    // Inicializa Host
    const hostPeerInstance = app.initPeer();
    hostPeerInstance.emit('open', masterId);

    const viewerConn = new MockDataConnection(viewerId);
    hostPeerInstance.emit('connection', viewerConn);
    viewerConn.emit('open');
    viewerConn.emit('data', {
      type: 'ROOM_JOIN_REQUEST',
      roomId,
      name: 'Viewer Dedup'
    });

    // Inicia stream
    await app.startLocalStream({ sourceId: 'monitor:0', sourceType: 'monitor' });

    // Conta quantas mensagens START_DIRECT_STREAM foram enviadas para o viewer
    const startMessages = viewerConn.send.mock.calls
      .map(c => c[0])
      .filter(m => m?.type === 'START_DIRECT_STREAM');

    // Deve ser exatamente 1 (sem duplicação mesmo constando em meshConnections e connectedViewers)
    expect(startMessages.length).toBe(1);

    app.stopLocalStream();
  });
});
