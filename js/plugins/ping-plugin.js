/**
 * SeeMyGame - TacticalPingPlugin (Isolated Feature Plugin)
 * 
 * Encapsula o ciclo de vida dos pings táticos sobre o jogo,
 * renderização em canvas, ponteiro laser sincronizado e limpeza de listeners.
 */

import { BasePlugin } from './base-plugin.js';
import { tacticalPingManager } from '../ping.js';

export class TacticalPingPlugin extends BasePlugin {
  constructor(options = {}) {
    super('tactical-ping', options);
    this.manager = options.manager || tacticalPingManager;
    this.ownsManager = Boolean(options.manager);
    this._abortController = null;
    this._dispatcherUnsubs = [];
  }

  setupListeners() {
    const dispatcher = this.context?.dispatcher;
    const eventBus = this.context?.eventBus;
    const shouldRelay = () => !this.context?.isRoomMode?.() && (this.context?.getViewersCount?.() > 0);
    const broadcast = (data, excludePeer) => this.context?.broadcastDataMessage?.(data, excludePeer);

    if (dispatcher) {
      this._dispatcherUnsubs.push(
        dispatcher.register('TACTICAL_PING', (data, sourceConn) => {
          if (data.ping) {
            this.manager.addPing(data.ping);
            if (eventBus) eventBus.emit('ping:added', data.ping);
            if (shouldRelay()) broadcast(data, sourceConn?.peer);
          }
        }, { description: 'Ping: Tactical Marker' })
      );

      this._dispatcherUnsubs.push(
        dispatcher.register('TACTICAL_LASER', (data, sourceConn) => {
          const peer = sourceConn?.peer;
          // Só o host conhecido pode atestar a origem de um laser retransmitido.
          // Em conexões diretas a identidade sempre vem da conexão, não do payload.
          const senderId = peer
            ? (this.context?.isTrustedLaserRelayPeer?.(peer) && typeof data.laserOriginPeerId === 'string' && data.laserOriginPeerId.length > 0
              ? data.laserOriginPeerId : peer)
            : 'local';
          const point = data.point && { ...data.point, senderId };
          const message = { ...data, senderId, laserOriginPeerId: senderId, ...(point ? { point } : {}) };
          if (data.action === 'stop') {
            this.manager.stopLaserTrail(senderId);
            if (shouldRelay()) broadcast(message, peer);
            return;
          }
          if (data.point) {
            this.manager.addLaserPoint(point);
            if (shouldRelay()) broadcast(message, peer);
          }
        }, { description: 'Ping: Laser Pointer' })
      );
    }

    this.registerCleanup(() => {
      this._dispatcherUnsubs.forEach(unsub => unsub());
      this._dispatcherUnsubs = [];
      if (this._abortController) {
        this._abortController.abort();
        this._abortController = null;
      }
    });
  }

  /**
   * Vincula um elemento <canvas> do DOM ao sistema de pings.
   * @param {HTMLCanvasElement} canvas
   */
  bindCanvas(canvas) {
    if (!canvas) return;
    this.manager.setCanvas(canvas);

    if (this._abortController) {
      this._abortController.abort();
    }
    this._abortController = new AbortController();
    const { signal } = this._abortController;

    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        const w = parent.clientWidth || 1280;
        const h = parent.clientHeight || 720;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      }
    };
    resize();

    window.addEventListener('resize', resize, { signal });
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      const ro = new ResizeObserver(resize);
      ro.observe(canvas.parentElement);
      signal.addEventListener('abort', () => ro.disconnect());
    }
  }

  destroy() {
    super.destroy();
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    if (this.ownsManager) this.manager.dispose?.();
  }
}

export const tacticalPingPlugin = new TacticalPingPlugin();
