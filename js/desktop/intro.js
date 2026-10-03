/**
 * SeeMyGame - Desktop Intro Overlay (Splash Screen)
 * Gerencia a reprodução da abertura cinematográfica do SeeMyGame no Desktop (Tauri).
 * Oferece suporte a skip por teclado (Esc, Espaço, Enter) ou clique,
 * transição suave de fade-out e persistência na sessão.
 */

import { isDesktopApp } from './ipc.js';

export const INTRO_STORAGE_KEY = 'smg_desktop_intro_played';

/**
 * Determina se a introdução de desktop deve ser reproduzida automaticamente.
 * @param {URLSearchParams|string} [customParams]
 * @returns {boolean}
 */
export function shouldPlayDesktopIntro(customParams) {
  if (typeof window === 'undefined') return false;

  const searchParams = customParams instanceof URLSearchParams
    ? customParams
    : new URLSearchParams(typeof customParams === 'string' ? customParams : window.location?.search || '');

  // Parâmetro de URL explícito para testes ou pré-visualização
  if (searchParams.get('intro') === '1' || searchParams.get('previewIntro') === '1') {
    return true;
  }

  // Apenas no aplicativo Desktop nativo
  if (!isDesktopApp()) {
    return false;
  }

  // Toca uma vez por sessão do aplicativo
  try {
    return sessionStorage.getItem(INTRO_STORAGE_KEY) !== '1';
  } catch {
    return true;
  }
}

/**
 * Marca a introdução como reproduzida na sessão atual.
 */
export function markDesktopIntroPlayed() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(INTRO_STORAGE_KEY, '1');
  } catch {}
}

/**
 * Inicializa e controla o overlay de abertura cinematográfica.
 * @param {Object} [options]
 * @param {HTMLElement} [options.container]
 * @param {HTMLVideoElement} [options.video]
 * @param {HTMLElement} [options.skipBtn]
 * @param {HTMLElement} [options.replayBtn]
 * @param {Function} [options.onComplete]
 * @returns {Object} Controlador com métodos de skip e dispose
 */
export function initDesktopIntro(options = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { active: false, skip: () => {}, replay: () => {}, dispose: () => {} };
  }

  const overlay = options.container || document.getElementById('desktop-intro-overlay');
  const video = options.video || document.getElementById('desktop-intro-video');
  const skipBtn = options.skipBtn || document.getElementById('desktop-intro-skip-btn');
  const replayBtn = options.replayBtn || document.getElementById('desktop-intro-btn');

  if (!overlay || !video) {
    return { active: false, skip: () => {}, replay: () => {}, dispose: () => {} };
  }

  let completed = false;
  let audioFadeInterval = null;

  function finishIntro() {
    if (completed) return;
    completed = true;
    markDesktopIntroPlayed();

    // Inicia transição visual
    overlay.classList.add('intro-fade-out');
    overlay.setAttribute('aria-hidden', 'true');

    // Suaviza o áudio se ainda estiver tocando
    try {
      if (audioFadeInterval) clearInterval(audioFadeInterval);
      audioFadeInterval = setInterval(() => {
        if (video.volume > 0.15) {
          video.volume = Math.max(0, video.volume - 0.2);
        } else {
          clearInterval(audioFadeInterval);
          audioFadeInterval = null;
          try {
            video.pause();
            video.currentTime = 0;
            video.volume = 1;
          } catch {}
        }
      }, 40);
    } catch {
      try {
        video.pause();
      } catch {}
    }

    setTimeout(() => {
      overlay.style.display = 'none';
      if (typeof options.onComplete === 'function') {
        options.onComplete();
      }
      // Devolve o foco para o apelido no lobby
      const nickInput = document.getElementById('lobby-user-name');
      nickInput?.focus();
    }, 550);

    cleanupListeners();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      finishIntro();
    }
  }

  function handleOverlayClick(e) {
    finishIntro();
  }

  function cleanupListeners() {
    document.removeEventListener('keydown', handleKeyDown);
    if (skipBtn) skipBtn.removeEventListener('click', finishIntro);
    overlay.removeEventListener('click', handleOverlayClick);
    video.removeEventListener('ended', finishIntro);
  }

  function startPlayback() {
    completed = false;
    overlay.style.display = 'flex';
    overlay.classList.remove('intro-fade-out');
    overlay.removeAttribute('aria-hidden');

    cleanupListeners();
    document.addEventListener('keydown', handleKeyDown);
    if (skipBtn) skipBtn.addEventListener('click', finishIntro);
    overlay.addEventListener('click', handleOverlayClick);
    video.addEventListener('ended', finishIntro);

    try {
      video.currentTime = 0;
      video.volume = 1;
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('[DesktopIntro] Autoplay com áudio restrito; tentando mudo:', err);
          video.muted = true;
          video.play().catch((playErr) => {
            console.warn('[DesktopIntro] Autoplay falhou por completo, dispensando:', playErr);
            finishIntro();
          });
        });
      }
    } catch (err) {
      console.warn('[DesktopIntro] Erro ao iniciar vídeo:', err);
      finishIntro();
    }
  }

  // Inicializa o botão de rever abertura se disponível
  if (replayBtn) {
    if (isDesktopApp()) {
      replayBtn.style.display = 'inline-flex';
    }
    replayBtn.addEventListener('click', () => {
      startPlayback();
    });
  }

  // Inicia reprodução
  startPlayback();

  return {
    active: true,
    skip: finishIntro,
    replay: startPlayback,
    dispose: () => {
      if (audioFadeInterval) clearInterval(audioFadeInterval);
      cleanupListeners();
      try {
        video.pause();
      } catch {}
    }
  };
}
