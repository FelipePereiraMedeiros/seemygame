import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleIncomingP2PMessage,
  initTacticalPing,
  initFloatingReactions,
  initAdaptiveBitrate,
  initFacecam,
  initGamerFeatures,
  toggleFacecam,
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
});
