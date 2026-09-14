/**
 * SeeMyGame - Módulo de Clipping e Instant Replay (30 segundos em Buffer Circular)
 * Permite salvar os últimos 30 segundos da transmissão diretamente no computador sem servidores.
 */

export class ClipRecorder {
  constructor(options = {}) {
    this.maxDurationSeconds = options.maxDurationSeconds || 30;
    this.chunks = []; // Array de { blob, timestamp }
    this.mediaRecorder = null;
    this.stream = null;
    this.isRecording = false;
    this.mimeType = this._resolveSupportedMimeType();
  }

  _resolveSupportedMimeType() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return 'video/webm';
    }

    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ];

    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return 'video/webm';
  }

  /**
   * Inicia o buffer circular gravando fatias de 1 segundo
   * @param {MediaStream} stream
   */
  start(stream) {
    if (!stream || typeof MediaRecorder === 'undefined') return false;

    this.stop();
    this.stream = stream;
    this.chunks = [];

    try {
      const options = this.mimeType ? { mimeType: this.mimeType } : {};
      this.mediaRecorder = new MediaRecorder(stream, options);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          const now = Date.now();
          this.chunks.push({ blob: e.data, timestamp: now });

          // Descarte circular: mantém apenas os últimos maxDurationSeconds
          const cutoff = now - (this.maxDurationSeconds * 1000);
          while (this.chunks.length > 0 && this.chunks[0].timestamp < cutoff) {
            this.chunks.shift();
          }
        }
      };

      // Fatias de 1 segundo (1000ms)
      this.mediaRecorder.start(1000);
      this.isRecording = true;
      return true;
    } catch (err) {
      console.warn('[ClipRecorder] Falha ao iniciar gravação em buffer circular:', err);
      this.isRecording = false;
      return false;
    }
  }

  /**
   * Exporta o clipe gravado dos últimos segundos em arquivo para download
   * @param {string} [customFilename]
   * @returns {Blob|null}
   */
  exportClip(customFilename = null) {
    if (!this.chunks || this.chunks.length === 0) {
      return null;
    }

    const rawBlobs = this.chunks.map(item => item.blob);
    const clipBlob = new Blob(rawBlobs, { type: this.mimeType || 'video/webm' });

    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = customFilename || `SeeMyGame-Clip-${dateStr}.webm`;

    clipBlob.fileName = filename;
    clipBlob.blob = clipBlob;
    this.lastClipBlob = clipBlob;
    this.lastClipFileName = filename;

    if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try {
        const url = URL.createObjectURL(clipBlob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1500);
      } catch (err) {
        console.warn('[ClipRecorder] Falha no download automático do clipe:', err);
      }
    }

    return clipBlob;
  }

  /**
   * Retorna o último Blob de clipe gerado
   * @returns {Blob|null}
   */
  getRecentClipBlob() {
    return this.lastClipBlob || null;
  }

  /**
   * Verifica se há um clipe recente pronto para edição
   * @returns {boolean}
   */
  hasRecentClip() {
    return !!this.lastClipBlob;
  }

  /**
   * Encerra a gravação e limpa o buffer
   */
  stop() {
    if (this.mediaRecorder) {
      try {
        if (this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
        }
      } catch (e) {}
      this.mediaRecorder = null;
    }
    this.isRecording = false;
    this.stream = null;
  }

  clear() {
    this.chunks = [];
    this.lastClipBlob = null;
    this.lastClipFileName = null;
  }
}

export const clipRecorder = new ClipRecorder();
