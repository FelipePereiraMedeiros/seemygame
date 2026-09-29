/**
 * SeeMyGame - ClippingPlugin (Isolated Feature Plugin)
 * 
 * Encapsula o ciclo de vida da gravação circular de 30s (Instant Replay),
 * isolamento de trilhas MediaRecorder e limpeza idempotente de listeners de áudio.
 */

import { BasePlugin } from './base-plugin.js';
import { clipRecorder, ClipRecorder } from '../clipping.js';

export class ClippingPlugin extends BasePlugin {
  constructor(options = {}) {
    super('clipping', options);
    this.recorder = options.recorder || clipRecorder;
    this._activeStream = null;
  }

  setupListeners() {
    const eventBus = this.context?.eventBus;

    if (eventBus) {
      this.registerCleanup(
        eventBus.on('stream:started', ({ stream }) => {
          if (stream) {
            this.start(stream);
          }
        })
      );

      this.registerCleanup(
        eventBus.on('stream:stopped', () => {
          this.stop();
        })
      );
    }
  }

  /**
   * Inicia a gravação do buffer circular com o MediaStream fornecido.
   * @param {MediaStream} stream
   */
  start(stream) {
    if (!stream) return;
    this._activeStream = stream;
    try {
      this.recorder.start(stream);
    } catch (err) {
      console.warn('[ClippingPlugin] Falha ao iniciar gravação circular:', err);
    }
  }

  /**
   * Encerra a gravação e limpa listeners associados.
   */
  stop() {
    try {
      this.recorder.stop();
    } catch (err) {
      console.warn('[ClippingPlugin] Erro ao encerrar gravador:', err);
    }
    this._activeStream = null;
  }

  /**
   * Exporta os últimos segundos em um Blob WebM.
   * @param {number} [durationSeconds=30]
   * @returns {Promise<Blob|null>}
   */
  async exportClip(durationSeconds = 30) {
    try {
      return await this.recorder.exportClip(durationSeconds);
    } catch (err) {
      console.error('[ClippingPlugin] Falha ao exportar clipe:', err);
      return null;
    }
  }

  destroy() {
    super.destroy();
    this.stop();
  }
}

export const clippingPlugin = new ClippingPlugin();
