import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../js/core/event-bus.js';

describe('Kernel Core: EventBus', () => {
  it('deve registrar ouvintes e emitir eventos com payload', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('user:connected', handler);
    bus.emit('user:connected', { peerId: 'peer-123' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ peerId: 'peer-123' });
  });

  it('deve permitir desinscrição via off e via função de retorno', () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const unsubscribe1 = bus.on('test', handler1);
    bus.on('test', handler2);

    expect(bus.listenerCount('test')).toBe(2);

    unsubscribe1();
    expect(bus.listenerCount('test')).toBe(1);

    bus.off('test', handler2);
    expect(bus.listenerCount('test')).toBe(0);

    bus.emit('test', 'data');
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('deve respeitar a ordem de prioridade dos ouvintes (maior executa primeiro)', () => {
    const bus = new EventBus();
    const executionOrder = [];

    bus.on('order:test', () => executionOrder.push('low'), { priority: -10 });
    bus.on('order:test', () => executionOrder.push('high'), { priority: 100 });
    bus.on('order:test', () => executionOrder.push('normal'), { priority: 0 });

    bus.emit('order:test');

    expect(executionOrder).toEqual(['high', 'normal', 'low']);
  });

  it('deve suportar ouvintes de execução única (once)', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.once('single:event', handler);
    bus.emit('single:event', 1);
    bus.emit('single:event', 2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
    expect(bus.listenerCount('single:event')).toBe(0);
  });

  it('deve isolar falhas: um erro em um ouvinte não cancela os demais ouvintes', () => {
    const bus = new EventBus();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const errorHandler = vi.fn();

    const faultyHandler = vi.fn(() => {
      throw new Error('Falha simulada no plugin acessório');
    });
    const healthyHandler = vi.fn();

    bus.on('system:error', errorHandler);
    bus.on('data:ready', faultyHandler, { priority: 10 });
    bus.on('data:ready', healthyHandler, { priority: 0 });

    const count = bus.emit('data:ready', { data: 42 });

    expect(faultyHandler).toHaveBeenCalledTimes(1);
    expect(healthyHandler).toHaveBeenCalledTimes(1);
    expect(count).toBe(1); // 1 com sucesso
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith(expect.objectContaining({
      sourceEvent: 'data:ready',
      error: expect.any(Error)
    }));

    consoleErrorSpy.mockRestore();
  });

  it('deve isolar rejeições assíncronas e emitir system:error sem propagar unhandledRejection', async () => {
    const bus = new EventBus();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const errorHandler = vi.fn();

    const asyncFailingHandler = vi.fn(async () => {
      throw new Error('Falha assíncrona no listener');
    });
    const healthyHandler = vi.fn();

    bus.on('system:error', errorHandler);
    bus.on('async:event', asyncFailingHandler);
    bus.on('async:event', healthyHandler);

    bus.emit('async:event', { foo: 'bar' });

    expect(healthyHandler).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith(expect.objectContaining({
      sourceEvent: 'async:event',
      error: expect.any(Error)
    }));

    consoleErrorSpy.mockRestore();
  });
});
