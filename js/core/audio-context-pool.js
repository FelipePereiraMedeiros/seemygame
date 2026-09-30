/**
 * SeeMyGame - AudioContextPool (Kernel Core)
 * 
 * Gerenciador centralizado e seguro de AudioContext para Web Audio API.
 * Evita vazamentos de instâncias (limite do navegador é ~6 instâncias)
 * e fornece auto-resume em resposta a gestos do usuário.
 */

class AudioContextPoolManager {
  constructor() {
    this._context = null;
    this._gestureListenersBound = false;
    this._gestureCleanup = null;
  }

  /**
   * Obtém ou cria a instância singleton ativa de AudioContext.
   * @returns {AudioContext|null}
   */
  getAudioContext() {
    if (typeof window === 'undefined') return null;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!this._context || this._context.state === 'closed') {
      try {
        this._context = new AudioContextClass();
      } catch (err) {
        console.warn('[AudioContextPool] Falha ao instanciar AudioContext:', err);
        return null;
      }
    }

    if (this._context.state === 'suspended') {
      try { Promise.resolve(this._context.resume()).catch(() => {}); } catch (_) {}
      if (!this._gestureListenersBound) this._bindGestureResume();
    }

    return this._context;
  }

  _bindGestureResume() {
    if (typeof document === 'undefined') return;
    this._gestureListenersBound = true;

    const resume = () => {
      if (this._context && this._context.state === 'suspended') {
        try {
          this._context.resume().catch(() => {});
        } catch (_) {}
      }
      document.removeEventListener('click', resume);
      document.removeEventListener('keydown', resume);
      document.removeEventListener('touchstart', resume);
      this._gestureListenersBound = false;
      this._gestureCleanup = null;
    };

    document.addEventListener('click', resume, { once: true, passive: true });
    document.addEventListener('keydown', resume, { once: true, passive: true });
    document.addEventListener('touchstart', resume, { once: true, passive: true });
    this._gestureCleanup = () => {
      for (const event of ['click', 'keydown', 'touchstart']) document.removeEventListener(event, resume);
    };
  }

  /**
   * Encerra o AudioContext e libera recursos de hardware de áudio.
   */
  close() {
    this._gestureCleanup?.();
    this._gestureCleanup = null;
    if (this._context && this._context.state !== 'closed') {
      try {
        this._context.close().catch(() => {});
      } catch (_) {}
    }
    this._context = null;
    this._gestureListenersBound = false;
  }
}

export const audioContextPool = new AudioContextPoolManager();
export const getSharedAudioContext = () => audioContextPool.getAudioContext();
