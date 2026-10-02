import { describe, it, expect, vi } from 'vitest';
import { SessionContext, createSessionContext } from '../js/core/session-context.js';
import { EventBus } from '../js/core/event-bus.js';
import { MessageDispatcher } from '../js/core/message-dispatcher.js';
import { PluginManager } from '../js/core/plugin-manager.js';

describe('Core: SessionContext (Lifecycle & Resource Management)', () => {
  it('deve instanciar contexto com barramento, dispatcher e plugin manager isolados', () => {
    const ctx = createSessionContext({ role: 'viewer' });
    expect(ctx.role).toBe('viewer');
    expect(ctx.sessionId).toBeDefined();
    expect(ctx.eventBus).toBeInstanceOf(EventBus);
    expect(ctx.dispatcher).toBeInstanceOf(MessageDispatcher);
    expect(ctx.pluginManager).toBeInstanceOf(PluginManager);
    expect(ctx.isDisposed).toBe(false);
  });

  it('deve executar cleanups registrados em ordem LIFO no dispose', () => {
    const ctx = createSessionContext();
    const callOrder = [];

    ctx.registerCleanup(() => callOrder.push('first'));
    ctx.registerCleanup({ dispose: () => callOrder.push('second') });
    ctx.registerCleanup({ destroy: () => callOrder.push('third') });
    ctx.registerCleanup({ close: () => callOrder.push('fourth') });
    ctx.registerCleanup({ stop: () => callOrder.push('fifth') });

    ctx.dispose();

    expect(callOrder).toEqual(['fifth', 'fourth', 'third', 'second', 'first']);
    expect(ctx.isDisposed).toBe(true);
  });

  it('deve desregistrar listener DOM automaticamente no dispose', () => {
    const ctx = createSessionContext();
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
    const handler = () => {};

    ctx.addEventListener(target, 'click', handler, false);
    expect(target.addEventListener).toHaveBeenCalledWith('click', handler, false);

    ctx.dispose();
    expect(target.removeEventListener).toHaveBeenCalledWith('click', handler, false);
  });

  it('deve acionar pluginManager.destroyAll no dispose', () => {
    const ctx = createSessionContext();
    const destroyAllSpy = vi.spyOn(ctx.pluginManager, 'destroyAll');

    ctx.dispose();
    expect(destroyAllSpy).toHaveBeenCalledOnce();
  });

  it('deve ser idempotente caso dispose() seja chamado repetidas vezes', () => {
    const ctx = createSessionContext();
    const cleanup = vi.fn();
    ctx.registerCleanup(cleanup);

    ctx.dispose();
    ctx.dispose();
    ctx.dispose();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('deve emitir session:disposed no eventBus da sessão', () => {
    const ctx = createSessionContext({ role: 'streamer' });
    let emitted = null;
    ctx.eventBus.on('session:disposed', (data) => {
      emitted = data;
    });

    ctx.dispose();
    expect(emitted).toEqual({ sessionId: ctx.sessionId, role: 'streamer' });
  });
});
