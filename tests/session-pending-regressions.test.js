import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionContext } from '../js/core/session-context.js';
import { chatManager } from '../js/chat.js';
import { createWhiteboardPlugin, createClippingPlugin } from '../js/plugins/factories.js';
import { getRoomMasterPeerId } from '../js/room.js';
import { setupRoomSession, roomState } from '../js/entries/room-entry.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Regressões das pendências da verificação de modularização', () => {
  it('fábricas criam engines distintas e o descarte libera os recursos da sessão', () => {
    const boardA = createWhiteboardPlugin();
    const boardB = createWhiteboardPlugin();
    const clipA = createClippingPlugin();
    const clipB = createClippingPlugin();
    expect(boardA.manager).not.toBe(boardB.manager);
    expect(clipA.recorder).not.toBe(clipB.recorder);

    const session = createSessionContext();
    session.pluginManager.register(boardA);
    session.pluginManager.register(clipA);
    session.pluginManager.initAll({ eventBus: session.eventBus, dispatcher: session.dispatcher });
    session.dispose();
    expect(boardA.manager.canvas).toBeNull();
    expect(clipA.recorder.isRecording).toBe(false);
  });

  it('impede duas sessões simultâneas que compartilham estado de entrypoint e libera a chave ao descartar', () => {
    const first = createSessionContext({ role: 'viewer', exclusiveKey: 'test-viewer-entry' });
    expect(() => createSessionContext({ role: 'viewer', exclusiveKey: 'test-viewer-entry' }))
      .toThrow(/Já existe uma sessão ativa/);
    first.dispose();
    const second = createSessionContext({ role: 'viewer', exclusiveKey: 'test-viewer-entry' });
    expect(second.isDisposed).toBe(false);
    second.dispose();
  });

  it('o dispatcher do Viewer recebe chat na sessão e persiste a mensagem', async () => {
    const viewerEntry = await import('../js/entries/viewer-entry.js');
    const app = await viewerEntry.initViewerApp({ targetStreamerId: null });
    const id = `received_${Date.now()}`;
    const hostConnection = { peer: 'remote-host', open: true };
    app.state.targetHostId = hostConnection.peer;
    app.state.activeConn = hostConnection;
    const result = app.session.dispatcher.dispatch({
      type: 'CHAT_MESSAGE',
      message: { id, senderId: 'remote-host', senderName: 'Host', role: 'host', channel: 'geral', text: 'mensagem recebida' }
    }, hostConnection);
    expect(result.handled).toBe(true);
    expect(app.session.services.chatManager.getMessages('geral').some((message) => message.id === id)).toBe(true);
    app.dispose();
  });

  it('habilita o controle de transmissão assim que o PeerJS registra o streamer', async () => {
    const oldPeer = globalThis.Peer;
    document.body.innerHTML = '<button id="stream-btn" disabled>Transmitir</button><span id="copy-badge"></span><button id="share-link-btn"></button>';
    globalThis.Peer = class MockPeer {
      constructor(id) { this.id = id; this.destroyed = false; this.listeners = new Map(); }
      on(event, callback) {
        this.listeners.set(event, callback);
        if (event === 'open') setTimeout(() => callback(this.id), 0);
      }
      destroy() { this.destroyed = true; }
    };
    try {
      const streamerEntry = await import('../js/entries/streamer-entry.js');
      const app = await streamerEntry.initStreamerApp();
      await streamerEntry.initStreamerPeer('streamer-audit', app.session);
      expect(document.getElementById('stream-btn').disabled).toBe(false);
      expect(document.getElementById('copy-badge').textContent).toBe('streamer-audit');
      app.dispose();
    } finally {
      globalThis.Peer = oldPeer;
    }
  });

  it('Room conecta ao coordenador e permite reenviar pedido após solicitar PIN', async () => {
    class MockConnection {
      constructor(peer) { this.peer = peer; this.open = false; this.listeners = new Map(); this.send = vi.fn(); }
      on(event, callback) { this.listeners.set(event, callback); }
      emit(event, payload) { this.listeners.get(event)?.(payload); }
      close() { this.listeners.get('close')?.(); }
    }
    const connections = [];
    const roomId = 'entry-regression';
    const roomKey = '0123456789abcdef0123456789abcdef';
    const masterId = getRoomMasterPeerId(roomId, roomKey);
    const peerListeners = new Map();
    const peer = {
      id: 'random-room-peer',
      destroyed: false,
      on: (event, callback) => peerListeners.set(event, callback),
      connect: vi.fn((peerId) => {
        const conn = new MockConnection(peerId);
        connections.push(conn);
        return conn;
      }),
      destroy: vi.fn()
    };
    roomState.peer = peer;
    roomState.userName = 'Testador';
    delete window.location;
    window.location = new URL(`http://localhost/room.html#room=${roomId}&key=${roomKey}`);
    document.body.innerHTML = `
      <div id="pin-prompt-modal" style="display:none"></div>
      <input id="viewer-pin-input">
      <div id="viewer-pin-error"></div>
      <button id="viewer-pin-submit-btn"></button>
      <button id="viewer-pin-cancel-btn"></button>
    `;

    const session = createSessionContext({ role: 'room-test' });
    await setupRoomSession(peer.id, session);
    expect(peer.connect).toHaveBeenCalledWith(masterId, expect.any(Object));
    const firstConnection = connections[0];
    firstConnection.open = true;
    firstConnection.emit('open');
    expect(firstConnection.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ROOM_JOIN_REQUEST', roomId, roomKey,
      clientSessionId: sessionStorage.getItem('seemygame_client_session_id')
    }));

    firstConnection.emit('data', { type: 'ROOM_PIN_REQUIRED', error: 'PIN incorreto' });
    expect(document.getElementById('pin-prompt-modal').style.display).toBe('flex');
    document.getElementById('viewer-pin-input').value = '1234';
    document.getElementById('viewer-pin-submit-btn').click();
    expect(connections).toHaveLength(2);
    connections[1].open = true;
    connections[1].emit('open');
    expect(connections[1].send).toHaveBeenCalledWith(expect.objectContaining({ type: 'ROOM_JOIN_REQUEST', pin: '1234' }));

    roomState.roomManager?.leave();
    roomState.discordUI?.destroy();
    peer.destroy();
    roomState.peer = null;
    roomState.roomManager = null;
    roomState.relayManager = null;
    roomState.discordUI = null;
    roomState.coordinatorConn = null;
    session.dispose();
  });
});
