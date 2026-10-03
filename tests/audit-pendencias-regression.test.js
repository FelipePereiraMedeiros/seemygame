import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createSessionContext } from '../js/core/session-context.js';
import { createStreamerSession } from '../js/session/streamer-session.js';
import { bindSessionMessageHandlers } from '../js/protocol/session-handlers.js';
import { PinAttemptLimiter } from '../js/protocol/pin-attempt-limiter.js';
import { ChatManager } from '../js/chat.js';
import { RoomManager } from '../js/room.js';
import { WhiteboardManager } from '../js/whiteboard.js';
import { WhiteboardPlugin } from '../js/plugins/whiteboard-plugin.js';
import { createWhiteboardTransfers, sendWhiteboardImage } from '../js/whiteboard/transfer.js';
import { isWithinMessageLimit } from '../js/room/shared.js';

const cleanups = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup());
  localStorage.removeItem('seemygame_streamer_pin');
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function session() {
  const context = createSessionContext(); cleanups.push(() => context.dispose()); return context;
}
function boardSession(board, options = {}) {
  const context = session();
  context.pluginManager.register(new WhiteboardPlugin({ manager: board }));
  context.pluginManager.initAll({ isRoomMode: () => true, ...options });
  return context;
}
const image = (id, payload = 'AAAA') => ({ id, type: 'image', startX: 0, startY: 0, endX: 20, endY: 20, dataUrl: 'data:image/png;base64,' + payload });
const rectangle = id => ({ id, type: 'rectangle', startX: 0, startY: 0, endX: 100, endY: 100 });
class Connection extends EventEmitter {
  constructor(peer) { super(); this.peer = peer; this.open = true; this.sent = []; }
  send(data) { this.sent.push(data); }
  close() { this.open = false; this.emit('close'); }
}
function streamer() {
  class Call extends EventEmitter {
    constructor(peer) {
      super(); this.peer = peer; this.open = false; this.closed = false;
      this.peerConnection = { connectionState: 'new', getSenders: () => [], getTransceivers: () => [],
        getStats: async () => new Map(), addEventListener() {}, removeEventListener() {} };
    }
    close() { this.closed = true; this.emit('close'); }
  }
  class Peer extends EventEmitter {
    constructor(id) { super(); this.id = id; this.calls = []; queueMicrotask(() => this.emit('open', id)); }
    call(id) { const call = new Call(id); this.calls.push(call); return call; }
    destroy() { this.destroyed = true; }
  }
  vi.stubGlobal('Peer', Peer); vi.stubGlobal('fetch', async () => ({ ok: false }));
  return createStreamerSession();
}

describe('S5: bloqueio de PIN', () => {
  it('mantém cooldown do Streamer após reconectar e permite recuperação', async () => {
    vi.useFakeTimers(); localStorage.setItem('seemygame_streamer_pin', '1234');
    const runtime = streamer(), context = session(); runtime.streamerState.session = context;
    const peer = await runtime.initStreamerPeer('host', context);
    const connect = () => { const conn = new Connection('guest'); peer.emit('connection', conn); conn.emit('open'); return conn; };
    const conn = connect();
    for (let i = 0; i < 5; i++) conn.emit('data', { type: 'REQUEST_STREAM', pin: 'wrong' });
    expect(conn.open).toBe(false);
    const retry = connect(); retry.emit('data', { type: 'REQUEST_STREAM', pin: '1234' });
    expect(retry.open).toBe(false); expect(runtime.streamerState.admissionGate.isAuthenticated('guest')).toBe(false);
    vi.advanceTimersByTime(30_001);
    const recovered = connect(); recovered.emit('data', { type: 'REQUEST_STREAM', pin: '1234' });
    expect(runtime.streamerState.admissionGate.isAuthenticated('guest')).toBe(true); recovered.close();
  });

  it('Room bloqueia inclusive o PIN correto até expirar o cooldown', () => {
    vi.useFakeTimers(); const room = new RoomManager({ roomId: 'pin-test', roomPin: '1234' });
    room.join('room-host', true); cleanups.push(() => room.leave());
    const attempt = (conn, pin) => {
      room.registerConnection(conn.peer, conn);
      room.handleRoomMessage(conn.peer, { type: 'ROOM_JOIN_REQUEST', roomId: room.roomId, name: 'Guest', pin }, conn);
    };
    const conn = new Connection('guest'); for (let i = 0; i < 5; i++) attempt(conn, 'wrong');
    expect(conn.open).toBe(false);
    const retry = new Connection('guest'); attempt(retry, '1234');
    expect(retry.open).toBe(false); expect(room.isPeerAuthorized('guest')).toBe(false);
    vi.advanceTimersByTime(30_001); attempt(new Connection('guest'), '1234');
    expect(room.isPeerAuthorized('guest')).toBe(true);
  });

  it('rotacionar IDs não contorna o orçamento global de erros', () => {
    vi.useFakeTimers(); const limiter = new PinAttemptLimiter();
    for (let i = 0; i < 50; i++) limiter.recordFailedAttempt('peer-' + i);
    expect(limiter.isRateLimited('fresh-peer')).toBe(true);
    vi.advanceTimersByTime(30_001); expect(limiter.isRateLimited('fresh-peer')).toBe(false);
    expect(limiter.failedAttempts.size).toBe(0);
  });

  it('limita a memória mesmo com IDs diferentes', () => {
    const limiter = new PinAttemptLimiter({ maxPeers: 2 });
    limiter.recordFailedAttempt('a'); limiter.recordFailedAttempt('b'); limiter.recordFailedAttempt('c');
    expect(limiter.failedAttempts.size).toBe(2); expect(limiter.isRateLimited('c')).toBe(true);
  });
});

describe('A10: identidade direta e relay confiável', () => {
  it.each(['streamer', 'room'])('neutraliza papel, nome e mensagens de sistema no %s', role => {
    const context = session(), chatManager = new ChatManager();
    bindSessionMessageHandlers(context, { role, chatManager,
      getChatIdentity: id => id === 'guest' ? { name: 'Jogador admitido', role: 'viewer' } : null });
    for (const claimedRole of ['host', 'player2', 'system']) context.dispatcher.dispatch({ type: 'CHAT_MESSAGE', relayedBy: 'host', message: {
      id: claimedRole, senderId: 'host', senderName: 'Host', role: claimedRole, isSystem: true, channel: 'geral', text: 'spoof' } }, { peer: 'guest' });
    expect(chatManager.getMessages()).toHaveLength(3);
    chatManager.getMessages().forEach(message => expect(message).toMatchObject({
      senderId: 'guest', senderName: 'Jogador admitido', role: 'viewer', isSystem: false }));
  });

  it('preserva o autor sanitizado no relay e diferencia mensagens do host', () => {
    const host = session(), viewer = session(), hostChat = new ChatManager(), viewerChat = new ChatManager(); let relayed;
    bindSessionMessageHandlers(host, { role: 'streamer', chatManager: hostChat, getLocalPeerId: () => 'host',
      getChatIdentity: () => ({ name: 'Guest', role: 'viewer' }), broadcast: data => { relayed = data; } });
    bindSessionMessageHandlers(viewer, { role: 'viewer', chatManager: viewerChat, isTrustedChatRelayPeer: id => id === 'host' });
    host.dispatcher.dispatch({ type: 'CHAT_MESSAGE', message: { id: 'relayed', senderId: 'fake', senderName: 'Host', role: 'system', text: 'hello' } }, { peer: 'guest' });
    viewer.dispatcher.dispatch(relayed, { peer: 'host' });
    viewer.dispatcher.dispatch({ type: 'CHAT_MESSAGE', message: { id: 'host-message', senderId: 'host', text: 'host says hello' } }, { peer: 'host' });
    expect(viewerChat.getMessages()[0]).toMatchObject({ senderId: 'guest', senderName: 'Guest', role: 'viewer', isSystem: false });
    expect(viewerChat.getMessages()[1]).toMatchObject({ senderId: 'host', role: 'host' });
  });

  it('não confia em relay alegado por outro peer nem em mensagem sem conexão', () => {
    const context = session(), chatManager = new ChatManager();
    bindSessionMessageHandlers(context, { role: 'viewer', chatManager, isTrustedChatRelayPeer: id => id === 'host' });
    context.dispatcher.dispatch({ type: 'CHAT_MESSAGE', relayedBy: 'host', message: { id: 'spoof', senderId: 'host', role: 'system', text: 'fake' } }, { peer: 'guest' });
    context.dispatcher.dispatch({ type: 'CHAT_MESSAGE', message: { id: 'no-source', senderId: 'host', text: 'fake' } });
    expect(chatManager.getMessages()).toHaveLength(1);
    expect(chatManager.getMessages()[0]).toMatchObject({ senderId: 'guest', role: 'viewer', isSystem: false });
  });

  it('Room deriva papel do cadastro e não retransmite identidade de outro membro', () => {
    const context = session(), chatManager = new ChatManager(), broadcast = vi.fn();
    bindSessionMessageHandlers(context, { role: 'room', chatManager, broadcast,
      getChatIdentity: () => ({ name: 'Coordenador', role: 'host' }) });
    context.dispatcher.dispatch({ type: 'CHAT_MESSAGE', message: { id: 'room-host', text: 'hello', role: 'system', isSystem: true } }, { peer: 'master' });
    expect(chatManager.getMessages()[0]).toMatchObject({ senderId: 'master', role: 'host', isSystem: false });
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('A11 e S1: snapshots e reassembly', () => {
  it.each([false, true])('substitui a lousa atomicamente em snapshot com imagens (misto=%s)', mixed => {
    const source = new WhiteboardManager(), target = new WhiteboardManager();
    source.setElements([image('same', 'B'.repeat(300000)), ...(mixed ? [rectangle('new')] : [])]);
    target.setElements([image('same'), rectangle('stale')]);
    const sender = boardSession(source), receiver = boardSession(target), conn = new Connection('viewer');
    sender.dispatcher.dispatch({ type: 'WHITEBOARD_REQUEST_SYNC' }, conn);
    expect(conn.sent.every(isWithinMessageLimit)).toBe(true);
    conn.sent.slice(0, -1).forEach(data => receiver.dispatcher.dispatch(data, { peer: 'host' }));
    expect(target.elements.map(el => el.id)).toEqual(['same', 'stale']);
    receiver.dispatcher.dispatch(conn.sent.at(-1), { peer: 'host' });
    expect(target.elements.find(el => el.id === 'same').dataUrl).toBe(source.elements[0].dataUrl);
    expect(target.elements.some(el => el.id === 'stale')).toBe(false); expect(target.elements).toHaveLength(mixed ? 2 : 1);
    expect(target.elements).toEqual(source.elements);
  });

  it('snapshot vazio remove elementos obsoletos', () => {
    const source = boardSession(new WhiteboardManager()), target = new WhiteboardManager(); target.setElements([rectangle('old')]);
    const receiver = boardSession(target), conn = new Connection('viewer');
    source.dispatcher.dispatch({ type: 'WHITEBOARD_REQUEST_SYNC' }, conn);
    conn.sent.forEach(data => receiver.dispatcher.dispatch(data, { peer: 'host' })); expect(target.elements).toEqual([]);
  });

  it('não mistura chunks de peers distintos', () => {
    const board = new WhiteboardManager(), context = boardSession(board), { dataUrl, ...meta } = image('separate');
    const chunk = (peer, index, value) => context.dispatcher.dispatch({ type: 'WHITEBOARD_ELEMENT_CHUNK', chunkId: 'same-id', index, total: 2, chunk: value, meta }, { peer });
    chunk('a', 0, 'data:image/png;base64,'); chunk('b', 1, 'BBBB'); expect(board.elements).toHaveLength(0);
    chunk('a', 1, 'AAAA'); expect(board.elements[0].dataUrl).toBe(dataUrl);
  });

  it('descarta índices e totais fracionários sem reservar recursos', () => {
    vi.useFakeTimers(); const board = new WhiteboardManager(), context = boardSession(board), { dataUrl, ...meta } = image('fractional');
    for (let i = 0; i < 256; i++) context.dispatcher.dispatch({ type: 'WHITEBOARD_ELEMENT_CHUNK', chunkId: 'bad', index: i / 1000, total: 1.5, chunk: dataUrl, meta }, { peer: 'guest' });
    expect(board.elements).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });

  it('rejeita mudanças de total ou metadados na mesma transferência', () => {
    const board = new WhiteboardManager(), context = boardSession(board), { dataUrl, ...meta } = image('changed');
    const base = { type: 'WHITEBOARD_ELEMENT_CHUNK', chunkId: 'changed', index: 0, total: 2, chunk: dataUrl, meta };
    context.dispatcher.dispatch(base, { peer: 'guest' });
    context.dispatcher.dispatch({ ...base, index: 1, total: 3, chunk: 'AAAA' }, { peer: 'guest' }); expect(board.elements).toHaveLength(0);
    context.dispatcher.dispatch({ ...base, chunkId: 'meta' }, { peer: 'guest' });
    context.dispatcher.dispatch({ ...base, chunkId: 'meta', index: 1, chunk: 'AAAA', meta: { ...meta, id: 'forged' } }, { peer: 'guest' }); expect(board.elements).toHaveLength(0);
  });

  it('libera chunks incompletos por TTL sem depender de novas mensagens', () => {
    vi.useFakeTimers(); const board = new WhiteboardManager(), context = boardSession(board), { dataUrl, ...meta } = image('expired');
    const base = { type: 'WHITEBOARD_ELEMENT_CHUNK', chunkId: 'expires', index: 0, total: 2, chunk: dataUrl, meta };
    context.dispatcher.dispatch(base, { peer: 'guest' }); expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(60_001); expect(vi.getTimerCount()).toBe(0);
    context.dispatcher.dispatch({ ...base, index: 1, chunk: 'AAAA' }, { peer: 'guest' }); expect(board.elements).toHaveLength(0);
  });

  it('expira snapshot incompleto e mantém a lousa anterior intacta', () => {
    vi.useFakeTimers(); const source = new WhiteboardManager(), target = new WhiteboardManager();
    source.setElements([image('new', 'A'.repeat(300000))]); target.setElements([rectangle('keep')]);
    const sender = boardSession(source), receiver = boardSession(target), conn = new Connection('viewer');
    sender.dispatcher.dispatch({ type: 'WHITEBOARD_REQUEST_SYNC' }, conn);
    conn.sent.slice(0, -1).forEach(data => receiver.dispatcher.dispatch(data, { peer: 'host' }));
    vi.advanceTimersByTime(60_001);
    receiver.dispatcher.dispatch(conn.sent.at(-1), { peer: 'host' });
    expect(target.elements).toEqual([rectangle('keep')]); expect(vi.getTimerCount()).toBe(0);
  });

  it('limita transferências simultâneas e libera recursos ao descartar a sessão', () => {
    vi.useFakeTimers(); const board = new WhiteboardManager(), context = boardSession(board), { dataUrl, ...meta } = image('limited');
    const base = { type: 'WHITEBOARD_ELEMENT_CHUNK', index: 0, total: 2, chunk: dataUrl, meta };
    for (let i = 0; i < 26; i++) context.dispatcher.dispatch({ ...base, chunkId: 'entry-' + i }, { peer: 'guest' });
    context.dispatcher.dispatch({ ...base, chunkId: 'entry-25', index: 1, chunk: 'AAAA' }, { peer: 'guest' });
    expect(board.elements).toHaveLength(0);
    context.dispatcher.dispatch({ ...base, chunkId: 'entry-0', index: 1, chunk: 'AAAA' }, { peer: 'guest' });
    expect(board.elements[0].dataUrl).toBe(dataUrl + 'AAAA');
    context.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it('limita bytes antes de concatenar e libera o orçamento ao descartar', () => {
    const board = new WhiteboardManager(), transfers = createWhiteboardTransfers(board, { maxBufferedBytes: 250 }); cleanups.push(() => transfers.dispose());
    const { dataUrl, ...meta } = image('budget');
    transfers.receiveChunk({ chunkId: 'over', index: 0, total: 2, chunk: dataUrl + 'A'.repeat(100), meta }, { peer: 'guest' });
    transfers.receiveChunk({ chunkId: 'over', index: 1, total: 2, chunk: 'A'.repeat(100), meta }, { peer: 'guest' }); expect(board.elements).toHaveLength(0);
    transfers.receiveChunk({ chunkId: 'fits', index: 0, total: 1, chunk: dataUrl, meta }, { peer: 'guest' }); expect(board.elements[0].dataUrl).toBe(dataUrl);
  });

  it('retransmite imagem grande em chunks que cabem no transporte', () => {
    const hostBoard = new WhiteboardManager(), viewerBoard = new WhiteboardManager(), sent = [];
    const host = boardSession(hostBoard, { isRoomMode: () => false, getViewersCount: () => 1, broadcastDataMessage: data => sent.push(data) });
    const viewer = boardSession(viewerBoard), element = image('relay', 'A'.repeat(1_100_000));
    sendWhiteboardImage(element, data => host.dispatcher.dispatch(data, { peer: 'guest' }));
    expect(sent.length).toBeGreaterThan(1); expect(sent.every(isWithinMessageLimit)).toBe(true);
    sent.forEach(data => viewer.dispatcher.dispatch(data, { peer: 'host' })); expect(viewerBoard.elements[0]).toEqual(element);
  });
});

describe('S2: histórico de gestos', () => {
  it.each(['drag', 'resize'])('limita 61 commits de %s a 50 snapshots e preserva undo', gesture => {
    const board = new WhiteboardManager(), canvas = document.createElement('canvas'); canvas.getContext = () => new Proxy({}, { get: () => () => {} });
    vi.spyOn(board, 'render').mockImplementation(() => {}); board.setCanvas(canvas); cleanups.push(() => board.setCanvas(null));
    board.selectedTool = 'select'; board.selectedElementId = 'rect'; board.elements = [rectangle('rect')];
    for (let i = 0; i < 61; i++) {
      const initial = { ...board.elements[0] };
      if (gesture === 'drag') { board.isDraggingElement = true; board.dragInitialState = initial; board._dragUndoSnapshot = [initial]; }
      else { board.isResizingElement = true; board._resizeUndoSnapshot = [initial]; }
      board.elements[0] = { ...initial, startX: initial.startX + 2 }; window.dispatchEvent(new Event('mouseup'));
    }
    expect(board.undoStack).toHaveLength(50); expect(board.elements[0].startX).toBe(122);
    expect(board.undo()).toBe(true); expect(board.elements[0].startX).toBe(120);
  });
});
