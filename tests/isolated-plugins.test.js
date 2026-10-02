import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../js/core/event-bus.js';
import { MessageDispatcher } from '../js/core/message-dispatcher.js';
import {
  WhiteboardPlugin,
  SoundboardPlugin,
  TacticalPingPlugin,
  ReactionsPlugin,
  ClippingPlugin
} from '../js/plugins/index.js';

describe('Fase 2: Plugins Autônomos de Periféricos', () => {
  let eventBus;
  let dispatcher;
  let context;

  beforeEach(() => {
    eventBus = new EventBus();
    dispatcher = new MessageDispatcher();
    context = {
      eventBus,
      dispatcher,
      broadcastDataMessage: vi.fn(),
      isRoomMode: () => false,
      getViewersCount: () => 1
    };
  });

  it('WhiteboardPlugin: registra mensagens na rede e desregistra no destroy()', () => {
    const mockManager = {
      elements: [],
      addElement: vi.fn(),
      updateElement: vi.fn(),
      removeElement: vi.fn(),
      clear: vi.fn(),
      updateRemoteCursor: vi.fn(),
      setElements: vi.fn(),
    };

    const plugin = new WhiteboardPlugin({ manager: mockManager });
    plugin.init(context);

    expect(dispatcher.getMetrics().registeredTypes).toBeGreaterThanOrEqual(8);

    // Dispara adição de elemento
    dispatcher.dispatch({
      type: 'WHITEBOARD_ELEMENT_ADD',
      element: { id: 'el-1', type: 'rectangle' }
    });

    expect(mockManager.addElement).toHaveBeenCalledWith({ id: 'el-1', type: 'rectangle' }, false);
    expect(context.broadcastDataMessage).toHaveBeenCalled();

    // Destroi o plugin e verifica remoção dos handlers
    plugin.destroy();
    expect(dispatcher.getMetrics().registeredTypes).toBe(0);
  });

  it('SoundboardPlugin: registra execução de som e meme customizado com desregistro limpo', () => {
    const mockManager = {
      playSound: vi.fn()
    };
    const showToast = vi.fn();

    const plugin = new SoundboardPlugin({ manager: mockManager });
    plugin.init({ ...context, showToast });

    dispatcher.dispatch({
      type: 'SOUNDBOARD_PLAY',
      soundId: 'airhorn',
      senderName: 'Gamer'
    });

    expect(mockManager.playSound).toHaveBeenCalledWith('airhorn');
    expect(showToast).toHaveBeenCalled();
    expect(context.broadcastDataMessage).toHaveBeenCalled();

    plugin.destroy();
    expect(dispatcher.getMetrics().registeredTypes).toBe(0);
  });

  it('TacticalPingPlugin: gerencia ping e laser com desregistro limpo', () => {
    const mockManager = {
      addPing: vi.fn(),
      addLaserPoint: vi.fn(),
      setCanvas: vi.fn()
    };

    const plugin = new TacticalPingPlugin({ manager: mockManager });
    plugin.init(context);

    dispatcher.dispatch({
      type: 'TACTICAL_PING',
      ping: { x: 0.5, y: 0.5, type: 'danger' }
    });

    expect(mockManager.addPing).toHaveBeenCalledWith({ x: 0.5, y: 0.5, type: 'danger' });
    expect(context.broadcastDataMessage).toHaveBeenCalled();

    plugin.destroy();
    expect(dispatcher.getMetrics().registeredTypes).toBe(0);
  });

  it('ReactionsPlugin: processa reações flutuantes e limpa ouvintes ao destruir', () => {
    const mockManager = {
      spawnReaction: vi.fn(),
      setContainer: vi.fn(),
      canSend: () => true
    };

    const plugin = new ReactionsPlugin({ manager: mockManager });
    plugin.init(context);

    dispatcher.dispatch({
      type: 'EMOJI_REACTION',
      emoji: '🔥',
      xPercent: 50,
      senderName: 'Amigo'
    });

    expect(mockManager.spawnReaction).toHaveBeenCalledWith({
      emoji: '🔥',
      xPercent: 50,
      senderName: 'Amigo'
    });

    plugin.destroy();
    expect(dispatcher.getMetrics().registeredTypes).toBe(0);
  });

  it('ClippingPlugin: inicia e encerra gravação reagindo a eventos de stream', async () => {
    const mockRecorder = {
      start: vi.fn(),
      stop: vi.fn(),
      exportClip: vi.fn().mockResolvedValue(new Blob(['video-data']))
    };

    const plugin = new ClippingPlugin({ recorder: mockRecorder });
    plugin.init(context);

    const dummyStream = { id: 'stream-1' };
    eventBus.emit('stream:started', { stream: dummyStream });

    expect(mockRecorder.start).toHaveBeenCalledWith(dummyStream, 'local-me');

    const clipBlob = await plugin.exportClip('clip.webm', 'host-a');
    expect(clipBlob).not.toBeNull();
    expect(mockRecorder.exportClip).toHaveBeenCalledWith('clip.webm', 'host-a');

    eventBus.emit('stream:stopped');
    expect(mockRecorder.stop).toHaveBeenCalledWith(null);

    plugin.destroy();
  });
});
