import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  shouldPlayDesktopIntro, 
  markDesktopIntroPlayed, 
  initDesktopIntro, 
  INTRO_STORAGE_KEY 
} from '../js/desktop/intro.js';

describe('Módulo: desktop/intro.js (Abertura Cinematográfica Desktop)', () => {
  let mockOverlay;
  let mockVideo;
  let mockSkipBtn;
  let mockReplayBtn;
  const originalTauri = window.__TAURI_INTERNALS__;

  beforeEach(() => {
    delete window.__TAURI_INTERNALS__;
    delete window.__TAURI__;
    sessionStorage.clear();

    // Cria elementos de DOM simulados
    mockOverlay = document.createElement('div');
    mockOverlay.id = 'desktop-intro-overlay';
    mockOverlay.style.display = 'none';

    mockVideo = document.createElement('video');
    mockVideo.id = 'desktop-intro-video';
    mockVideo.play = vi.fn().mockResolvedValue(undefined);
    mockVideo.pause = vi.fn();
    mockVideo.volume = 1;

    mockSkipBtn = document.createElement('button');
    mockSkipBtn.id = 'desktop-intro-skip-btn';

    mockReplayBtn = document.createElement('button');
    mockReplayBtn.id = 'desktop-intro-btn';
    mockReplayBtn.style.display = 'none';

    document.body.appendChild(mockOverlay);
    document.body.appendChild(mockVideo);
    document.body.appendChild(mockSkipBtn);
    document.body.appendChild(mockReplayBtn);
  });

  afterEach(() => {
    if (originalTauri) {
      window.__TAURI_INTERNALS__ = originalTauri;
    } else {
      delete window.__TAURI_INTERNALS__;
    }
    delete window.__TAURI__;
    sessionStorage.clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('shouldPlayDesktopIntro', () => {
    it('deve retornar false em ambiente web comum sem parâmetros de URL', () => {
      expect(shouldPlayDesktopIntro('?room=test')).toBe(false);
    });

    it('deve retornar true quando intro=1 estiver nos parâmetros da URL', () => {
      expect(shouldPlayDesktopIntro('?intro=1')).toBe(true);
      expect(shouldPlayDesktopIntro('?previewIntro=1')).toBe(true);
    });

    it('deve retornar true em ambiente desktop na primeira abertura (sem flag no sessionStorage)', () => {
      window.__TAURI_INTERNALS__ = { invoke: vi.fn() };
      expect(shouldPlayDesktopIntro('')).toBe(true);
    });

    it('deve retornar false em ambiente desktop se a introdução já tiver sido reproduzida na sessão', () => {
      window.__TAURI_INTERNALS__ = { invoke: vi.fn() };
      sessionStorage.setItem(INTRO_STORAGE_KEY, '1');
      expect(shouldPlayDesktopIntro('')).toBe(false);
    });
  });

  describe('markDesktopIntroPlayed', () => {
    it('deve registrar no sessionStorage que a abertura foi reproduzida', () => {
      markDesktopIntroPlayed();
      expect(sessionStorage.getItem(INTRO_STORAGE_KEY)).toBe('1');
    });
  });

  describe('initDesktopIntro', () => {
    it('deve exibir overlay e disparar reprodução do vídeo', () => {
      const controller = initDesktopIntro({
        container: mockOverlay,
        video: mockVideo,
        skipBtn: mockSkipBtn,
        replayBtn: mockReplayBtn
      });

      expect(controller.active).toBe(true);
      expect(mockOverlay.style.display).toBe('flex');
      expect(mockOverlay.classList.contains('intro-fade-out')).toBe(false);
      expect(mockVideo.play).toHaveBeenCalled();
    });

    it('deve pular e aplicar fade out quando pressionada tecla Escape', async () => {
      vi.useFakeTimers();
      const onComplete = vi.fn();

      const controller = initDesktopIntro({
        container: mockOverlay,
        video: mockVideo,
        skipBtn: mockSkipBtn,
        onComplete
      });

      // Dispara tecla Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(mockOverlay.classList.contains('intro-fade-out')).toBe(true);
      expect(mockOverlay.getAttribute('aria-hidden')).toBe('true');
      expect(sessionStorage.getItem(INTRO_STORAGE_KEY)).toBe('1');

      // Avança timers para finalizar transição
      vi.advanceTimersByTime(600);

      expect(mockOverlay.style.display).toBe('none');
      expect(onComplete).toHaveBeenCalled();
      controller.dispose();
      vi.useRealTimers();
    });

    it('deve pular quando clicar no botão de skip ou no overlay', () => {
      vi.useFakeTimers();
      const controller = initDesktopIntro({
        container: mockOverlay,
        video: mockVideo,
        skipBtn: mockSkipBtn
      });

      mockSkipBtn.click();
      expect(mockOverlay.classList.contains('intro-fade-out')).toBe(true);

      controller.dispose();
      vi.useRealTimers();
    });

    it('deve finalizar quando o evento ended do vídeo for disparado', () => {
      vi.useFakeTimers();
      const onComplete = vi.fn();
      const controller = initDesktopIntro({
        container: mockOverlay,
        video: mockVideo,
        onComplete
      });

      mockVideo.dispatchEvent(new Event('ended'));
      expect(mockOverlay.classList.contains('intro-fade-out')).toBe(true);

      vi.advanceTimersByTime(600);
      expect(onComplete).toHaveBeenCalled();

      controller.dispose();
      vi.useRealTimers();
    });

    it('deve tentar reprodução muda (muted) caso autoplay com som seja rejeitado', async () => {
      const rejectedPromise = Promise.reject(new Error('Autoplay blocked'));
      mockVideo.play = vi.fn().mockImplementationOnce(() => rejectedPromise).mockResolvedValue(undefined);

      initDesktopIntro({
        container: mockOverlay,
        video: mockVideo
      });

      await rejectedPromise.catch(() => {});
      expect(mockVideo.muted).toBe(true);
      expect(mockVideo.play).toHaveBeenCalledTimes(2);
    });
  });
});
