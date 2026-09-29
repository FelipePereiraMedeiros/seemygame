import { describe, it, expect, vi } from 'vitest';
import { MessageDispatcher } from '../js/core/message-dispatcher.js';

describe('Kernel Core: MessageDispatcher', () => {
  it('deve registrar handlers e despachar mensagens com base no type', () => {
    const dispatcher = new MessageDispatcher();
    const chatHandler = vi.fn();

    dispatcher.register('CHAT_MESSAGE', chatHandler);

    const message = { type: 'CHAT_MESSAGE', text: 'Olá mundo' };
    const conn = { peer: 'peer-abc' };

    const result = dispatcher.dispatch(message, conn);

    expect(result.handled).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.errorCount).toBe(0);
    expect(chatHandler).toHaveBeenCalledTimes(1);
    expect(chatHandler).toHaveBeenCalledWith(message, conn);
  });

  it('deve detectar e descartar mensagens duplicadas pelo msgId', () => {
    const dispatcher = new MessageDispatcher();
    const pingHandler = vi.fn();

    dispatcher.register('TACTICAL_PING', pingHandler);

    const message1 = { type: 'TACTICAL_PING', msgId: 'ping-uuid-1', x: 50 };
    const message2 = { type: 'TACTICAL_PING', msgId: 'ping-uuid-1', x: 50 };

    const res1 = dispatcher.dispatch(message1);
    const res2 = dispatcher.dispatch(message2);

    expect(res1.handled).toBe(true);
    expect(res1.duplicate).toBe(false);
    expect(res2.handled).toBe(false);
    expect(res2.duplicate).toBe(true);
    expect(pingHandler).toHaveBeenCalledTimes(1);
  });

  it('deve isolar falhas de execução: exceções em handlers não explodem o despachante', () => {
    const dispatcher = new MessageDispatcher();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const brokenWhiteboardHandler = vi.fn(() => {
      throw new Error('Falha catastrófica ao deserializar elemento da lousa');
    });
    const secondaryHandler = vi.fn();

    dispatcher.register('WHITEBOARD_DRAW', brokenWhiteboardHandler, { priority: 10 });
    dispatcher.register('WHITEBOARD_DRAW', secondaryHandler, { priority: 0 });

    const result = dispatcher.dispatch({ type: 'WHITEBOARD_DRAW', data: {} });

    expect(result.handled).toBe(true);
    expect(result.errorCount).toBe(1);
    expect(brokenWhiteboardHandler).toHaveBeenCalledTimes(1);
    expect(secondaryHandler).toHaveBeenCalledTimes(1); // Executa mesmo após a falha do anterior

    const metrics = dispatcher.getMetrics();
    expect(metrics.errors).toBe(1);
    expect(metrics.dispatched).toBe(1);

    consoleErrorSpy.mockRestore();
  });

  it('deve utilizar fallbackHandler para tipos de mensagens desconhecidos', () => {
    const dispatcher = new MessageDispatcher();
    const fallback = vi.fn();

    dispatcher.setFallbackHandler(fallback);

    const unknownMsg = { type: 'CUSTOM_EXPERIMENTAL_FEATURE', val: 123 };
    const res = dispatcher.dispatch(unknownMsg);

    expect(res.handled).toBe(true);
    expect(fallback).toHaveBeenCalledWith(unknownMsg, null);
  });
});
