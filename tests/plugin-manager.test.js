import { describe, it, expect, vi } from 'vitest';
import { BasePlugin } from '../js/plugins/base-plugin.js';
import { PluginManager } from '../js/core/plugin-manager.js';
import { EventBus } from '../js/core/event-bus.js';
import { MessageDispatcher } from '../js/core/message-dispatcher.js';

describe('Kernel Core: PluginManager & BasePlugin', () => {
  it('deve registrar plugins e inicializá-los com o contexto', () => {
    const eventBus = new EventBus();
    const dispatcher = new MessageDispatcher();
    const pm = new PluginManager({ eventBus, dispatcher });

    class TestPlugin extends BasePlugin {
      setupListeners() {
        this.registerCleanup(() => {
          this.cleanedUp = true;
        });
      }
    }

    const plugin = new TestPlugin('test-feature');
    pm.register(plugin);

    expect(pm.get('test-feature')).toBe(plugin);
    expect(plugin.enabled).toBe(false);

    pm.initAll({ customData: 123 });

    expect(plugin.enabled).toBe(true);
    expect(plugin.context.customData).toBe(123);
    expect(plugin.context.eventBus).toBe(eventBus);

    pm.destroy('test-feature');
    expect(plugin.enabled).toBe(false);
    expect(plugin.cleanedUp).toBe(true);
  });

  it('deve emitir eventos de ciclo de vida no EventBus ao inicializar e destruir', () => {
    const eventBus = new EventBus();
    const initSpy = vi.fn();
    const destroySpy = vi.fn();

    eventBus.on('plugin:sample:initialized', initSpy);
    eventBus.on('plugin:sample:destroyed', destroySpy);

    const plugin = new BasePlugin('sample');
    plugin.init({ eventBus });

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(initSpy).toHaveBeenCalledWith({ name: 'sample' });

    plugin.destroy();

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(destroySpy).toHaveBeenCalledWith({ name: 'sample' });
  });

  it('deve isolar exceções lançadas durante o setupListeners de um plugin', () => {
    const pm = new PluginManager();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    class BuggyPlugin extends BasePlugin {
      setupListeners() {
        throw new Error('Falha no setup do plugin!');
      }
    }

    const plugin = new BuggyPlugin('buggy');
    pm.register(plugin);

    // initAll captura o erro e não interrompe a aplicação
    expect(() => pm.initAll()).not.toThrow();
    expect(plugin.enabled).toBe(false);

    consoleErrorSpy.mockRestore();
  });
});
