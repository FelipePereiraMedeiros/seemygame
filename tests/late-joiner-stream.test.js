import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  MockMediaStream,
  MockMediaStreamTrack,
  MockRTCPeerConnection
} from './mocks/webrtc.mock.js';
import { getRoomMasterPeerId } from '../js/room.js';

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

describe('Transmissão em Andamento: Novo Participante na Sala (Late-Joiner)', () => {
  beforeAll(async () => {
    delete window.location;
    window.location = {
      pathname: '/room.html',
      origin: 'http://localhost:3000',
      hash: '#room=sala-gamer',
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
  });

  afterEach(() => {
    if (app?.roomManager) {
      app.roomManager.leave();
    }
    vi.restoreAllMocks();
  });

  it('Convidado que entra na sala deve detectar automaticamente e solicitar stream do Host já em andamento', async () => {
    const roomId = 'sala-gamer';
    const masterId = getRoomMasterPeerId(roomId);
    const guestPeerId = 'guest-user-42';

    // Inicializa a sessão da sala como o Convidado
    const peerInstance = app.initPeer();
    peerInstance.emit('open', guestPeerId);

    const room = app.roomManager;
    expect(room).toBeDefined();

    // A conexão com o Master foi criada automaticamente pelo join
    const masterConn = MockPeer.connectionsByPeer.get(masterId) || MockPeer.lastDataConnection;
    expect(masterConn).toBeDefined();
    masterConn.emit('open');

    // 1. Master envia confirmação de PIN / Admissão
    masterConn.emit('data', {
      type: 'ROOM_PIN_ACCEPTED',
      roomId
    });

    // 2. Master envia ROOM_SYNC_ALL onde Master já está transmitindo
    masterConn.emit('data', {
      type: 'ROOM_SYNC_ALL',
      roomId,
      members: [
        {
          peerId: masterId,
          name: 'Host Master',
          isMaster: true,
          isStreaming: true,
          streamDetails: { title: 'CS2 Pro Match', fps: 60, height: 1080 }
        },
        {
          peerId: guestPeerId,
          name: 'Convidado',
          isMaster: false,
          isStreaming: false
        }
      ]
    });

    // O Convidado deve ter reconhecido que o Master é um streamer ativo
    expect(room.getActiveStreamers().length).toBe(1);
    expect(room.isPeerAuthorized(masterId)).toBe(true);

    // O Convidado deve ter criado o card do Host e enviado REQUEST_STREAM
    const hostCard = document.getElementById(`card-${masterId}`);
    expect(hostCard).not.toBeNull();
    expect(masterConn.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'REQUEST_STREAM'
    }));

    // 3. Simula chegada do stream remoto via WebRTC call
    const incomingCall = new MockMediaConnection(masterId);
    peerInstance.emit('call', incomingCall);

    expect(incomingCall.answer).toHaveBeenCalled();

    const remoteStream = new MockMediaStream([new MockMediaStreamTrack('video')]);
    incomingCall.emit('stream', remoteStream);

    // O card do Host deve estar ativo com o vídeo
    const videoElem = hostCard.querySelector('video');
    expect(videoElem).not.toBeNull();
    expect(videoElem.srcObject).toBe(remoteStream);
  });

  it('Convidado que entra na sala deve conseguir assistir stream de membro comum (não-Master) já transmitindo', async () => {
    const roomId = 'sala-gamer';
    const masterId = getRoomMasterPeerId(roomId);
    const guestPeerId = 'guest-viewer-99';
    const streamerMemberId = 'member-streamer-88';

    // Inicializa o Convidado
    const peerInstance = app.initPeer();
    peerInstance.emit('open', guestPeerId);

    const room = app.roomManager;
    const masterConn = MockPeer.connectionsByPeer.get(masterId) || MockPeer.lastDataConnection;
    expect(masterConn).toBeDefined();
    masterConn.emit('open');

    // Convidado é aceito pelo Master
    masterConn.emit('data', { type: 'ROOM_PIN_ACCEPTED', roomId });

    // Master envia ROOM_SYNC_ALL informando que streamerMemberId está transmitindo
    masterConn.emit('data', {
      type: 'ROOM_SYNC_ALL',
      roomId,
      members: [
        {
          peerId: masterId,
          name: 'Host Master',
          isMaster: true,
          isStreaming: false
        },
        {
          peerId: streamerMemberId,
          name: 'Membro Streamer',
          isMaster: false,
          isStreaming: true,
          streamDetails: { title: 'Dota 2 Grand Finals', fps: 60 }
        },
        {
          peerId: guestPeerId,
          name: 'Convidado',
          isMaster: false,
          isStreaming: false
        }
      ]
    });

    // O streamerMemberId deve ser autorizado e constar nos streamers ativos
    expect(room.isPeerAuthorized(streamerMemberId)).toBe(true);
    expect(room.getActiveStreamers().length).toBe(1);

    // O Convidado deve ter criado o card para o streamerMemberId
    const streamerCard = document.getElementById(`card-${streamerMemberId}`);
    expect(streamerCard).not.toBeNull();

    // A conexão com o streamerMemberId deve ter sido iniciada
    const streamerConn = MockPeer.connectionsByPeer.get(streamerMemberId);
    expect(streamerConn).toBeDefined();

    streamerConn.emit('open');
    expect(streamerConn.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'REQUEST_STREAM'
    }));
  });
});
