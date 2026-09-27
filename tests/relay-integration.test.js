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
  constructor(peer, options = {}) {
    this.peer = peer;
    this.metadata = options.metadata || {};
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

  call(targetId, stream, options) {
    const call = new MockMediaConnection(targetId, options);
    MockPeer.lastMediaCall = call;
    MockPeer.callsByPeer.set(targetId, call);
    return call;
  }
}

MockPeer.instances = [];
MockPeer.lastInstance = null;
MockPeer.lastDataConnection = null;
MockPeer.connectionsByPeer = new Map();
MockPeer.callsByPeer = new Map();
MockPeer.lastMediaCall = null;

let app;

describe('Integração de P2P Tree Relay Mesh na Sala', () => {
  beforeAll(async () => {
    delete window.location;
    window.location = {
      pathname: '/room.html',
      origin: 'http://localhost:3000',
      hash: '#room=sala-relay-test',
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
    MockPeer.callsByPeer = new Map();
    MockPeer.lastMediaCall = null;
  });

  afterEach(() => {
    if (app?.roomManager) {
      app.roomManager.leave();
    }
    vi.restoreAllMocks();
  });

  it('deve permitir ativar/desativar Tree Relay via flag exportada', () => {
    expect(app.isTreeRelayEnabled).toBe(true);
    app.setTreeRelayEnabled(false);
    expect(app.isTreeRelayEnabled).toBe(false);
    app.setTreeRelayEnabled(true);
    expect(app.isTreeRelayEnabled).toBe(true);
  });

  it('quando 3 espectadores entram, o 3º deve ser alocado como RELAY sob o melhor espectador direto', async () => {
    const roomId = 'sala-relay-test';
    const masterId = getRoomMasterPeerId(roomId);

    // Inicializa sessão como Master
    const peerInstance = app.initPeer();
    peerInstance.emit('open', masterId);

    const room = app.roomManager;
    expect(room).toBeDefined();

    // Inicia stream local com MockMediaStream
    const mockTrack = new MockMediaStreamTrack('video');
    const mockStream = new MockMediaStream([mockTrack]);
    navigator.mediaDevices = {
      getDisplayMedia: vi.fn().mockResolvedValue(mockStream)
    };

    // Simula 2 espectadores diretos (v1 e v2)
    const v1Id = 'viewer-direto-1';
    const v2Id = 'viewer-direto-2';

    const connV1 = new MockDataConnection(v1Id);
    room.meshConnections.set(v1Id, connV1);
    room.members.set(v1Id, { peerId: v1Id, name: 'V1', isMaster: false, isStreaming: false });
    room.authenticatedPeers.add(v1Id);

    const connV2 = new MockDataConnection(v2Id);
    room.meshConnections.set(v2Id, connV2);
    room.members.set(v2Id, { peerId: v2Id, name: 'V2', isMaster: false, isStreaming: false });
    room.authenticatedPeers.add(v2Id);

    // Inicia stream
    await app.startLocalStream();
    expect(app.roomRelayManager).not.toBeNull();

    // Registra telemetria: V1 tem RTT menor (20ms) que V2 (70ms)
    app.roomRelayManager.updateTelemetry(v1Id, { rtt: 20 });
    app.roomRelayManager.updateTelemetry(v2Id, { rtt: 70 });

    // 3º espectador entra (v3)
    const v3Id = 'viewer-relay-3';
    const connV3 = new MockDataConnection(v3Id);
    room.meshConnections.set(v3Id, connV3);
    room.members.set(v3Id, { peerId: v3Id, name: 'V3', isMaster: false, isStreaming: false });
    room.authenticatedPeers.add(v3Id);

    // Host despacha início de stream para v3
    app.initiateMediaCallToViewer(v3Id);

    // V3 deve ter sido delegado via RELAY_FORWARD_REQUEST para V1 (menor RTT)!
    expect(connV1.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'RELAY_FORWARD_REQUEST',
      targetPeerId: v3Id,
      hostPeerId: masterId
    }));

    // V3 deve ter sido notificado sobre seu nó pai
    expect(connV3.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'RELAY_UPSTREAM_ASSIGNED',
      parentPeerId: v1Id,
      hostPeerId: masterId
    }));

    // Verifica topologia calculada pela árvore
    const topo = app.roomRelayManager.getTopology();
    expect(topo.totalViewers).toBe(3);
    expect(topo.directCount).toBe(2);
    expect(topo.relayedCount).toBe(1);
    expect(topo.relayed[0].parentPeerId).toBe(v1Id);

    // Economia de banda do Host: para 3 viewers a 7.5 Mbps:
    // Full Mesh = 3 * 7.5 = 22.5 Mbps
    // Tree = 2 * 7.5 = 15.0 Mbps
    // Economia = 7.5 Mbps (33%)
    const savings = app.roomRelayManager.calculateBandwidthSavings(7500000);
    expect(savings.fullMeshUploadBps).toBe(22500000);
    expect(savings.treeUploadBps).toBe(15000000);
    expect(savings.percentSaved).toBe(33);
  });
});
