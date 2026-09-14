import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleIncomingP2PMessage,
  initTacticalPing,
  initFloatingReactions,
  initAdaptiveBitrate,
  initFacecam,
  initGamerFeatures,
  toggleFacecam,
  openClipPostModal,
  closeClipPostModal,
} from '../js/app.js';
import { tacticalPingManager } from '../js/ping.js';
import { floatingReactionsManager } from '../js/reactions.js';
import { soundboardManager } from '../js/soundboard.js';
import { adaptiveBitrateController } from '../js/abr.js';
import { clipRecorder } from '../js/clipping.js';

describe('Integração de Recursos Gamer Profissionais (app.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    document.body.innerHTML = `
      <div id="toast-container"></div>
      <div id="video-grid">
        <canvas id="ping-canvas" width="1280" height="720"></canvas>
        <div id="reactions-overlay"></div>
        <div id="reactions-dock" style="display: none;">
          <button class="reaction-dock-btn" data-emoji="🔥">🔥</button>
          <button class="reaction-dock-btn" data-emoji="GG">GG</button>
          <div class="ping-mode-bar">
            <button id="ping-mode-btn" class="ping-mode-btn active">📍 Ping</button>
            <button id="danger-mode-btn" class="ping-mode-btn">⚠️ Alerta</button>
          </div>
        </div>
        <div id="facecam-container" style="display: none;">
          <div class="facecam-header">
            <span>Facecam</span>
            <button id="facecam-close-btn">✕</button>
          </div>
          <video id="facecam-video"></video>
        </div>
        <video id="test-remote-video"></video>
      </div>
      <button id="clip-btn"><span>🎬</span> Clipa isso!</button>
      <button id="abr-toggle-btn" class="active"><span>⚡</span> ABR (Auto)</button>
      <button id="pip-btn"><span>📺</span> PiP</button>
      <button id="toggle-facecam-btn"><span>📷</span> Facecam</button>

      <div id="clip-post-modal" style="display: none;">
        <button id="clip-post-close-btn">✕</button>
        <button id="clip-download-video-btn">Baixar Vídeo</button>
        <span id="clip-audio-status"></span>
        <input type="range" id="clip-trim-start-slider" value="0">
        <input type="range" id="clip-trim-end-slider" value="3">
        <span id="clip-trim-start-val">0.0s</span>
        <span id="clip-trim-end-val">3.0s</span>
        <span id="clip-trim-duration-val">3.0s</span>
        <button class="btn-preset-quick" data-preset-range="first3">Primeiros 3s</button>
        <button class="btn-preset-quick" data-preset-range="last3">Últimos 3s</button>
        <button class="btn-preset-quick" data-preset-range="last5">Últimos 5s</button>
        <button class="btn-preset-quick" data-preset-range="all">Tudo</button>
        <div id="clip-effects-grid"></div>
        <button id="clip-preview-audio-btn">Ouvir Prévia</button>
        <button id="clip-download-wav-btn">Baixar WAV</button>
        <button id="clip-broadcast-voice-btn">Tocar na Voz</button>
      </div>
    `;
  });

  afterEach(() => {
    tacticalPingManager.clear();
  });

  describe('Mensagens P2P de Recursos Gamer', () => {
    it('deve processar TACTICAL_PING e registrar no tacticalPingManager', () => {
      const addPingSpy = vi.spyOn(tacticalPingManager, 'addPing');
      const pingData = {
        type: 'TACTICAL_PING',
        ping: { x: 0.4, y: 0.6, type: 'danger', senderName: 'PlayerX' }
      };

      handleIncomingP2PMessage(pingData, null);

      expect(addPingSpy).toHaveBeenCalledWith(pingData.ping);
    });

    it('deve processar TACTICAL_LASER e adicionar ponto no tacticalPingManager', () => {
      const addLaserSpy = vi.spyOn(tacticalPingManager, 'addLaserPoint');
      const laserData = {
        type: 'TACTICAL_LASER',
        point: { x: 0.25, y: 0.35, color: '#00ffff' }
      };

      handleIncomingP2PMessage(laserData, null);

      expect(addLaserSpy).toHaveBeenCalledWith(laserData.point);
    });

    it('deve processar EMOJI_REACTION e instanciar reação flutuante', () => {
      const spawnSpy = vi.spyOn(floatingReactionsManager, 'spawnReaction');
      const reactionData = {
        type: 'EMOJI_REACTION',
        emoji: '🔥',
        xPercent: 50,
        senderName: 'Torcedor'
      };

      handleIncomingP2PMessage(reactionData, null);

      expect(spawnSpy).toHaveBeenCalledWith({
        emoji: '🔥',
        xPercent: 50,
        senderName: 'Torcedor'
      });
    });

    it('deve processar SOUNDBOARD_PLAY e tocar o efeito de som solicitado', () => {
      const playSpy = vi.spyOn(soundboardManager, 'playSound').mockReturnValue(true);
      const soundData = {
        type: 'SOUNDBOARD_PLAY',
        soundId: 'victory',
        senderName: 'Capitão'
      };

      handleIncomingP2PMessage(soundData, null);

      expect(playSpy).toHaveBeenCalledWith('victory');
    });

    it('deve processar SOUNDBOARD_PLAY_CUSTOM e disparar notificação com áudio', () => {
      const customData = {
        type: 'SOUNDBOARD_PLAY_CUSTOM',
        audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        effectName: '🐿️ Esquilo',
        senderName: 'Streamer'
      };

      expect(() => handleIncomingP2PMessage(customData, null)).not.toThrow();
    });
  });

  describe('Tactical Ping Canvas & Interação', () => {
    it('initTacticalPing deve associar o canvas e alternar entre modos ping e danger', () => {
      initTacticalPing();

      const pingBtn = document.getElementById('ping-mode-btn');
      const dangerBtn = document.getElementById('danger-mode-btn');

      expect(pingBtn.classList.contains('active')).toBe(true);

      dangerBtn.click();
      expect(dangerBtn.classList.contains('active')).toBe(true);
      expect(pingBtn.classList.contains('active')).toBe(false);

      pingBtn.click();
      expect(pingBtn.classList.contains('active')).toBe(true);
      expect(dangerBtn.classList.contains('active')).toBe(false);
    });

    it('clique no canvas deve disparar addPing com coordenadas relativas normalizadas', () => {
      initTacticalPing();
      const canvas = document.getElementById('ping-canvas');
      const addPingSpy = vi.spyOn(tacticalPingManager, 'addPing');

      canvas.getBoundingClientRect = () => ({
        left: 100,
        top: 50,
        width: 1000,
        height: 500,
      });

      const pointerEvent = new MouseEvent('pointerdown', {
        clientX: 600,
        clientY: 300,
        button: 0,
      });

      canvas.dispatchEvent(pointerEvent);

      expect(addPingSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 0.5,
          y: 0.5,
          type: 'ping'
        })
      );
    });
  });

  describe('Reações Rápidas e Adaptive Bitrate', () => {
    it('clicar em botão do reactions-dock deve chamar spawnReaction', () => {
      initFloatingReactions();
      const spawnSpy = vi.spyOn(floatingReactionsManager, 'spawnReaction');
      const reactionBtn = document.querySelector('.reaction-dock-btn');

      reactionBtn.click();

      expect(spawnSpy).toHaveBeenCalled();
    });

    it('initAdaptiveBitrate deve permitir alternar estado ativo do ABR', () => {
      initAdaptiveBitrate();
      const btn = document.getElementById('abr-toggle-btn');

      expect(adaptiveBitrateController.isEnabled).toBe(true);

      btn.click();
      expect(adaptiveBitrateController.isEnabled).toBe(false);

      btn.click();
      expect(adaptiveBitrateController.isEnabled).toBe(true);
    });
  });

  describe('Facecam Overlay', () => {
    it('toggleFacecam deve iniciar getUserMedia e exibir o container de facecam', async () => {
      const mockTrack = { stop: vi.fn(), kind: 'video' };
      const mockStream = {
        getTracks: () => [mockTrack],
        getVideoTracks: () => [mockTrack],
      };

      navigator.mediaDevices = {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      };

      const container = document.getElementById('facecam-container');
      const videoEl = document.getElementById('facecam-video');
      const toggleBtn = document.getElementById('toggle-facecam-btn');

      initFacecam();
      expect(container.style.display).toBe('none');

      await toggleFacecam();

      expect(container.style.display).toBe('flex');
      expect(toggleBtn.classList.contains('active')).toBe(true);
      expect(videoEl.srcObject).toBe(mockStream);

      await toggleFacecam();

      expect(container.style.display).toBe('none');
      expect(mockTrack.stop).toHaveBeenCalled();
      expect(toggleBtn.classList.contains('active')).toBe(false);
    });
  });

  describe('Clipping e PiP via Botões', () => {
    it('clique em #clip-btn com gravação inativa deve alertar o usuário', () => {
      initGamerFeatures();
      const clipBtn = document.getElementById('clip-btn');

      clipRecorder.isRecording = false;
      const exportSpy = vi.spyOn(clipRecorder, 'exportClip');

      clipBtn.click();

      expect(exportSpy).not.toHaveBeenCalled();
    });

    it('clique em #clip-btn com gravação ativa deve chamar exportClip', async () => {
      initGamerFeatures();
      const clipBtn = document.getElementById('clip-btn');

      clipRecorder.isRecording = true;
      const exportSpy = vi.spyOn(clipRecorder, 'exportClip').mockResolvedValue({
        blob: new Blob(['clip'], { type: 'video/webm' }),
        fileName: 'clip-test.webm'
      });

      clipBtn.click();

      expect(exportSpy).toHaveBeenCalled();
      clipRecorder.isRecording = false;
    });

    it('clique em #pip-btn deve invocar requestPictureInPicture no vídeo', async () => {
      initGamerFeatures();
      const pipBtn = document.getElementById('pip-btn');
      const videoEl = document.getElementById('test-remote-video');

      document.pictureInPictureEnabled = true;
      videoEl.requestPictureInPicture = vi.fn().mockResolvedValue({});

      pipBtn.click();

      expect(videoEl.requestPictureInPicture).toHaveBeenCalled();
    });
  });

  describe('Modal Pós-Clipping e Gerador de Áudio Meme', () => {
    it('clique em #clip-btn com gravação ativa deve abrir #clip-post-modal', async () => {
      initGamerFeatures();
      const clipBtn = document.getElementById('clip-btn');
      const modal = document.getElementById('clip-post-modal');

      clipRecorder.isRecording = true;
      const fakeBlob = new Blob(['clip'], { type: 'video/webm' });
      fakeBlob.fileName = 'clip-test.webm';
      vi.spyOn(clipRecorder, 'exportClip').mockResolvedValue(fakeBlob);

      clipBtn.click();
      await new Promise(r => setTimeout(r, 10));

      expect(modal.style.display).toBe('flex');
      clipRecorder.isRecording = false;
    });

    it('openClipPostModal deve renderizar chips de efeitos sonoros', async () => {
      const fakeBlob = new Blob(['clip'], { type: 'video/webm' });
      await openClipPostModal(fakeBlob);

      const modal = document.getElementById('clip-post-modal');
      expect(modal.style.display).toBe('flex');

      const grid = document.getElementById('clip-effects-grid');
      const chips = grid.querySelectorAll('.clip-effect-chip');
      expect(chips.length).toBeGreaterThanOrEqual(8);

      // Clicar no chip de esquilo
      const chipmunkChip = Array.from(chips).find(c => c.dataset.effectId === 'chipmunk');
      expect(chipmunkChip).toBeDefined();
      chipmunkChip.click();
      expect(chipmunkChip.classList.contains('active')).toBe(true);
    });

    it('sliders de trimming e atalhos rápidos devem atualizar os labels de tempo', async () => {
      const fakeBlob = new Blob(['clip'], { type: 'video/webm' });
      await openClipPostModal(fakeBlob);

      const startSlider = document.getElementById('clip-trim-start-slider');
      const endSlider = document.getElementById('clip-trim-end-slider');
      const startVal = document.getElementById('clip-trim-start-val');
      const endVal = document.getElementById('clip-trim-end-val');
      const durationVal = document.getElementById('clip-trim-duration-val');

      endSlider.value = '9.5';
      startSlider.value = '5.0';
      startSlider.oninput();
      expect(startVal.textContent).toBe('5.0s');
      expect(endVal.textContent).toBe('9.5s');
      expect(durationVal.textContent).toBe('4.5s');

      // Testar botão de atalho rápido
      const btnFirst3 = document.querySelector('.btn-preset-quick[data-preset-range="first3"]');
      btnFirst3.click();
      expect(startSlider.value).toBe('0');
      expect(startVal.textContent).toBe('0.0s');
    });

    it('closeClipPostModal e botão de fechar devem ocultar o modal', async () => {
      const fakeBlob = new Blob(['clip'], { type: 'video/webm' });
      await openClipPostModal(fakeBlob);
      const modal = document.getElementById('clip-post-modal');
      expect(modal.style.display).toBe('flex');

      const closeBtn = document.getElementById('clip-post-close-btn');
      closeBtn.click();
      expect(modal.style.display).toBe('none');

      await openClipPostModal(fakeBlob);
      expect(modal.style.display).toBe('flex');
      closeClipPostModal();
      expect(modal.style.display).toBe('none');
    });
  });
});
