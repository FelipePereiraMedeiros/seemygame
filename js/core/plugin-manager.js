/**
 * SeeMyGame - PluginManager (Kernel Core)
 * 
 * Gerenciador de ciclo de vida de plugins. Permite registro,
 * inicialização unificada e encerramento ordenado com barreira de falha.
 */

export class PluginManager {
  constructor({ eventBus = null, dispatcher = null } = {}) {
    this.eventBus = eventBus;
    this.dispatcher = dispatcher;
    this.plugins = new Map(); // name -> pluginInstance
  }

  /**
   * Registra um plugin no gerenciador.
   * @param {import('../plugins/base-plugin.js').BasePlugin} plugin
   * @returns {import('../plugins/base-plugin.js').BasePlugin}
   */
  register(plugin) {
    if (!plugin || !plugin.name) {
      throw new TypeError('[PluginManager] Plugin inválido fornecido.');
    }
    this.plugins.set(plugin.name, plugin);
    return plugin;
  }

  /**
   * Inicializa todos os plugins registrados injetando o contexto do Kernel.
   * @param {Object} [customContext={}]
   */
  initAll(customContext = {}) {
    const mergedContext = {
      eventBus: this.eventBus,
      dispatcher: this.dispatcher,
      ...customContext
    };

    for (const [name, plugin] of this.plugins.entries()) {
      try {
        plugin.init(mergedContext);
      } catch (err) {
        console.error(`[PluginManager] Falha ao inicializar o plugin "${name}":`, err);
      }
    }
  }

  /**
   * Retorna um plugin pelo seu nome.
   * @param {string} name
   */
  get(name) {
    return this.plugins.get(name);
  }

  /**
   * Encerra um plugin individualmente.
   * @param {string} name
   */
  destroy(name) {
    const plugin = this.plugins.get(name);
    if (plugin) {
      try {
        plugin.destroy();
      } catch (err) {
        console.error(`[PluginManager] Falha ao encerrar o plugin "${name}":`, err);
      }
      this.plugins.delete(name);
    }
  }

  /**
   * Encerra todos os plugins registrados.
   */
  destroyAll() {
    for (const [name, plugin] of this.plugins.entries()) {
      try {
        plugin.destroy();
      } catch (err) {
        console.error(`[PluginManager] Falha ao encerrar o plugin "${name}":`, err);
      }
    }
    this.plugins.clear();
  }
}
