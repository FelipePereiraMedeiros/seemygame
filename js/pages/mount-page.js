/** The only automatic page lifecycle; importing services never mounts a page. */
import { exposePageSession } from '../diagnostics/session-api.js';
export function mountPage(role, initialize) {
  if (window.__SEEMYGAME_BOOTSTRAPPED__) return;
  window.__SEEMYGAME_BOOTSTRAPPED__ = role;
  const start = async () => {
    try {
      const application = await initialize();
      const unexpose = exposePageSession(application);
      window.addEventListener('pagehide', () => { unexpose(); application?.dispose?.(); }, { once: true });
    } catch (error) {
      console.error(`[${role}] Initialization failed`, error);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else void start();
}
