/** Owns AudioContexts for one session. Consumers disconnect nodes; the owner closes contexts. */
export class AudioScope {
  constructor({ AudioContextClass = null } = {}) {
    this.AudioContextClass = AudioContextClass;
    this.contexts = new Map();
    this.disposed = false;
    this.gestureCleanups = new Map();
  }

  getContext(purpose = 'playback') {
    if (this.disposed) throw new Error('Audio scope has been disposed.');
    const Context = this.AudioContextClass || globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
    if (!Context) return null;
    let context = this.contexts.get(purpose);
    if (!context || context.state === 'closed') {
      context = new Context();
      this.contexts.set(purpose, context);
    }
    if (context.state === 'suspended') {
      if (!this.gestureCleanups.has(purpose) && globalThis.window?.addEventListener) {
        const target = window;
        const events = ['click', 'keydown', 'touchstart'];
        const cleanup = () => {
          events.forEach(event => target.removeEventListener(event, resume));
          this.gestureCleanups.delete(purpose);
        };
        const resume = () => {
          if (context.state === 'suspended') {
            try { Promise.resolve(context.resume()).catch(() => {}); } catch (_) {}
          }
          if (context.state !== 'suspended') cleanup();
        };
        events.forEach(event => target.addEventListener(event, resume, { passive: true }));
        this.gestureCleanups.set(purpose, cleanup);
      }
      try { Promise.resolve(context.resume()).catch(() => {}); } catch (_) {}
    }
    return context;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    [...this.gestureCleanups.values()].forEach(cleanup => cleanup());
    const contexts = [...this.contexts.values()];
    this.contexts.clear();
    await Promise.allSettled(contexts.map(context => {
      try { return context.state === 'closed' ? undefined : context.close(); } catch (_) { return undefined; }
    }));
  }
}

export const createAudioScope = options => new AudioScope(options);
