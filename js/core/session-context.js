/**
 * SeeMyGame - Session Context & Composition Root (Lifecycle Management)
 *
 * Cria e gerencia o ciclo de vida unificado de uma sessão (Streamer, Viewer, Room ou Lobby):
 * 1. EventBus isolado ou compartilhado por sessão
 * 2. MessageDispatcher tipado para mensagens P2P
 * 3. PluginManager com registro e destruição determinística
 * 4. Registro de recursos de teardown (listeners DOM, MediaStreams, timers, conexões)
 * 5. Prevenção de inicialização concorrente e idempotência de dispose()
 */

import { EventBus, globalBus } from './event-bus.js';
import { MessageDispatcher, globalDispatcher } from './message-dispatcher.js';
import { PluginManager, globalPluginManager } from './plugin-manager.js';
import { createAudioScope } from '../audio/context-scope.js';

const activeExclusiveSessions = new Map();

export class SessionContext {
  /**
   * @param {Object} [options]
   * @param {string} [options.role='generic'] - 'streamer' | 'viewer' | 'room' | 'lobby'
   * @param {string} [options.sessionId]
   * @param {boolean} [options.useGlobal=false] - Se true, reutiliza as instâncias globais
   * @param {EventBus} [options.eventBus]
   * @param {MessageDispatcher} [options.messageDispatcher]
   * @param {PluginManager} [options.pluginManager]
   * @param {Object} [options.initialState]
   */
  constructor(options = {}) {
    this.role = options.role || 'generic';
    this.sessionId = options.sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.exclusiveKey = options.exclusiveKey || null;
    if (this.exclusiveKey && activeExclusiveSessions.has(this.exclusiveKey)) {
      throw new Error(`Já existe uma sessão ativa para "${String(this.exclusiveKey)}".`);
    }
    if (this.exclusiveKey) activeExclusiveSessions.set(this.exclusiveKey, this);
    this.eventBus = options.eventBus || (options.useGlobal ? globalBus : new EventBus());
    this.dispatcher = options.messageDispatcher || (options.useGlobal ? globalDispatcher : new MessageDispatcher({ eventBus: this.eventBus }));
    this.pluginManager = options.pluginManager || (options.useGlobal ? globalPluginManager : new PluginManager({ eventBus: this.eventBus, dispatcher: this.dispatcher }));

    this.state = options.initialState || {};
    this._cleanups = [];
    this._disposed = false;
    this.audioScope = options.audioScope || createAudioScope();
    this.abortController = new AbortController();
    this.signal = this.abortController.signal;
    this._pendingDisposals = [];
    if (!options.audioScope || options.ownsAudioScope === true) this.registerCleanup(() => this.audioScope.dispose());
  }

  /**
   * Registra um recurso para encerramento determinístico no dispose().
   * Suporta callbacks `() => void`, objetos com método `dispose()`, `destroy()`,
   * `close()`, `stop()`, ou instâncias de MediaStream.
   *
   * @param {Function|Object} resource
   * @returns {Function} Função para desregistrar o recurso manualmente se necessário
   */
  registerCleanup(resource) {
    if (!resource) return () => {};
    if (this._disposed) {
      this._releaseResource(resource);
      return () => {};
    }
    this._cleanups.push(resource);

    return () => {
      const idx = this._cleanups.indexOf(resource);
      if (idx !== -1) {
        this._cleanups.splice(idx, 1);
      }
    };
  }

  /**
   * Registra um listener de evento DOM que será automaticamente removido no dispose().
   *
   * @param {EventTarget} target
   * @param {string} event
   * @param {Function} listener
   * @param {boolean|AddEventListenerOptions} [options]
   * @returns {Function} Função de remoção antecipada
   */
  addEventListener(target, event, listener, options) {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(event, listener, options);

    const unbind = () => {
      try {
        target.removeEventListener(event, listener, options);
      } catch (e) {}
    };

    this.registerCleanup(unbind);
    return unbind;
  }

  /**
   * Encerra a sessão, destruindo plugins, executando cleanups e liberando recursos.
   * É garantidamente idempotente.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.abortController.abort();

    // 1. Destrói todos os plugins associados
    try {
      this._releaseResource(() => this.pluginManager.destroyAll());
    } catch (err) {
      console.warn(`[SessionContext:${this.role}] Erro ao destruir plugins:`, err);
    }

    // 2. Executa cleanups na ordem LIFO (último adicionado, primeiro encerrado)
    while (this._cleanups.length > 0) {
      const resource = this._cleanups.pop();
      this._releaseResource(resource);
    }

    // 3. Notifica encerramento no EventBus
    try {
      this.eventBus.emit('session:disposed', {
        sessionId: this.sessionId,
        role: this.role
      });
    } catch (e) {}

    if (this.exclusiveKey && activeExclusiveSessions.get(this.exclusiveKey) === this) {
      activeExclusiveSessions.delete(this.exclusiveKey);
    }
  }

  get isDisposed() {
    return this._disposed;
  }

  _releaseResource(resource) {
    try {
      let result;
      if (typeof resource === 'function') result = resource();
      else if (typeof resource.dispose === 'function') result = resource.dispose();
      else if (typeof resource.destroy === 'function') result = resource.destroy();
      else if (typeof resource.close === 'function') result = resource.close();
      else if (typeof resource.stop === 'function') result = resource.stop();
      else if (typeof resource.getTracks === 'function') resource.getTracks().forEach(track => track.stop());
      if (result && typeof result.then === 'function') {
        this._pendingDisposals.push(Promise.resolve(result).catch(error => {
          this.eventBus.emit('system:error', { sourceEvent: 'session:dispose', error });
        }));
      }
    } catch (error) {
      this.eventBus.emit('system:error', { sourceEvent: 'session:dispose', error });
    }
  }

  async disposeAsync() {
    this.dispose();
    // A pending subscription may register its unlisten callback after disposal.
    // Drain newly registered asynchronous releases before declaring completion.
    let cursor = 0;
    while (cursor < this._pendingDisposals.length) {
      const pending = this._pendingDisposals.slice(cursor);
      cursor = this._pendingDisposals.length;
      await Promise.allSettled(pending);
    }
  }
}

/**
 * Fábrica para criação de contexto de sessão
 * @param {Object} [options]
 * @returns {SessionContext}
 */
export function createSessionContext(options = {}) {
  return new SessionContext(options);
}
