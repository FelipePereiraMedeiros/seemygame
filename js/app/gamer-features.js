/** gamer-features: commands receive explicit compatibility ports; no page initialization. */
export async function toggleFacecam(compatibilityContext) {
  if (compatibilityContext.isTogglingFacecam) return;
  compatibilityContext.isTogglingFacecam = true;

  try {
    const container = document.getElementById('facecam-container');
    const videoEl = document.getElementById('facecam-video');
    const toggleBtn = document.getElementById('toggle-facecam-btn');
    if (!container || !videoEl) return;

    if (compatibilityContext.facecamStream) {
      compatibilityContext.facecamStream.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      compatibilityContext.facecamStream = null;
      videoEl.srcObject = null;
      container.style.display = 'none';
      if (toggleBtn) {
        toggleBtn.classList.remove('active');
        toggleBtn.innerHTML = '<span>📷</span> Ligar Câmera';
        toggleBtn.title = 'Ativar câmera webcam flutuante';
      }
      compatibilityContext.showToast('📷 Facecam desativada.', 'info');
    } else {
      try {
        compatibilityContext.facecamStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
          audio: false
        });
        videoEl.srcObject = compatibilityContext.facecamStream;
        container.style.display = 'flex';
        if (toggleBtn) {
          toggleBtn.classList.add('active');
          toggleBtn.innerHTML = '<span>🛑</span> Desligar Facecam';
          toggleBtn.title = 'Desativar câmera webcam flutuante';
        }
        compatibilityContext.facecamStream.getVideoTracks().forEach(t => {
          t.onended = () => {
            if (compatibilityContext.facecamStream) {
              compatibilityContext.toggleFacecam();
            }
          };
        });
        compatibilityContext.showToast('📷 Facecam ativada!', 'success');
      } catch (err) {
        console.warn('Erro ao ativar facecam:', err);
        compatibilityContext.showToast('Não foi possível acessar a câmera para a Facecam.', 'error');
      }
    }
  } finally {
    compatibilityContext.isTogglingFacecam = false;
  }
}

export function initTacticalPing(compatibilityContext) {
  const canvas = document.getElementById('ping-canvas');
  if (!canvas) return;

  compatibilityContext.tacticalPingManager.setCanvas(canvas);

  if (compatibilityContext.tacticalPingAbortController) {
    compatibilityContext.tacticalPingAbortController.abort();
  }
  compatibilityContext.tacticalPingAbortController = new AbortController();
  const { signal } = compatibilityContext.tacticalPingAbortController;

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

  let currentPingMode = 'ping';
  const pingModeBtn = document.getElementById('ping-mode-btn');
  const dangerModeBtn = document.getElementById('danger-mode-btn');
  const laserModeBtn = document.getElementById('laser-mode-btn');

  const updateModeButtons = (mode) => {
    currentPingMode = mode;
    if (pingModeBtn) pingModeBtn.classList.toggle('active', mode === 'ping');
    if (dangerModeBtn) dangerModeBtn.classList.toggle('active', mode === 'danger');
    if (laserModeBtn) laserModeBtn.classList.toggle('active', mode === 'laser');
    if (canvas) {
      canvas.style.cursor = 'crosshair';
    }
  };

  if (pingModeBtn) {
    pingModeBtn.addEventListener('click', () => updateModeButtons('ping'), { signal });
  }
  if (dangerModeBtn) {
    dangerModeBtn.addEventListener('click', () => updateModeButtons('danger'), { signal });
  }
  if (laserModeBtn) {
    laserModeBtn.addEventListener('click', () => updateModeButtons('laser'), { signal });
  }

  let isPointerDown = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (compatibilityContext.getCoopState().isPlayer2) return;

    if (typeof document !== 'undefined') {
      const clickedEl = document.elementFromPoint ? document.elementFromPoint(e.clientX, e.clientY) : null;
      if (clickedEl && (
        clickedEl.closest('.video-card-header') ||
        clickedEl.closest('.card-controls') ||
        clickedEl.closest('.card-btn') ||
        clickedEl.closest('.reactions-dock') ||
        clickedEl.closest('.bottom-control-dock') ||
        clickedEl.closest('.facecam-overlay') ||
        clickedEl.closest('.audio-unmute-overlay') ||
        clickedEl.closest('button') ||
        clickedEl.closest('header') ||
        clickedEl.closest('nav') ||
        clickedEl.closest('aside')
      )) {
        return;
      }
    }

    isPointerDown = true;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / (rect.height || 1)));

    const isHost = !window.location.pathname.endsWith('viewer.html');
    const coopState = compatibilityContext.getCoopState();
    const senderName = compatibilityContext.isRoomMode() && compatibilityContext.roomManager?.userName
      ? compatibilityContext.roomManager.userName
      : (isHost ? 'Streamer' : (coopState.isPlayer2 ? 'Player 2' : (compatibilityContext.myId ? `Amigo ${compatibilityContext.myId.slice(0, 4)}` : 'Espectador')));

    const isLaser = currentPingMode === 'laser' || e.shiftKey || e.button === 2;

    if (isLaser) {
      const color = isHost ? '#10b981' : '#00ffff';
      compatibilityContext.tacticalPingManager.startLaserTrail({ color });
      compatibilityContext.tacticalPingManager.addLaserPoint({ x, y, color });
      compatibilityContext.broadcastDataMessage({ type: 'TACTICAL_LASER', point: { x, y, color } });
    } else {
      const ping = { x, y, type: currentPingMode, senderName };
      compatibilityContext.tacticalPingManager.addPing(ping);
      compatibilityContext.broadcastDataMessage({ type: 'TACTICAL_PING', ping });
    }
  }, { signal });

  canvas.addEventListener('pointermove', (e) => {
    if (!isPointerDown) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / (rect.height || 1)));

    if (compatibilityContext.tacticalPingManager.isDrawingLaser) {
      const isHost = !window.location.pathname.endsWith('viewer.html');
      const color = isHost ? '#10b981' : '#00ffff';
      compatibilityContext.tacticalPingManager.addLaserPoint({ x, y, color });
      compatibilityContext.broadcastDataMessage({ type: 'TACTICAL_LASER', point: { x, y, color } });
    }
  }, { signal });

  const stopDrawing = () => {
    if (isPointerDown) {
      isPointerDown = false;
      if (compatibilityContext.tacticalPingManager.isDrawingLaser) {
        compatibilityContext.tacticalPingManager.stopLaserTrail();
      }
    }
  };

  canvas.addEventListener('pointerup', stopDrawing, { signal });
  canvas.addEventListener('pointercancel', stopDrawing, { signal });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
}

export function initFloatingReactions(compatibilityContext) {
  const overlay = document.getElementById('reactions-overlay');
  if (overlay) {
    compatibilityContext.floatingReactionsManager.setContainer(overlay);
  }

  const dock = document.getElementById('reactions-dock');
  if (dock) {
    if (compatibilityContext.floatingReactionsAbortController) {
      compatibilityContext.floatingReactionsAbortController.abort();
    }
    compatibilityContext.floatingReactionsAbortController = new AbortController();
    const { signal } = compatibilityContext.floatingReactionsAbortController;

    dock.querySelectorAll('.reaction-dock-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        if (!emoji || !compatibilityContext.floatingReactionsManager.canSend()) return;

        const isHost = !window.location.pathname.endsWith('viewer.html');
        const coopState = compatibilityContext.getCoopState();
        const senderName = compatibilityContext.isRoomMode() && compatibilityContext.roomManager?.userName
          ? compatibilityContext.roomManager.userName
          : (isHost ? 'Streamer' : (coopState.isPlayer2 ? 'Player 2' : (compatibilityContext.myId ? `Amigo ${compatibilityContext.myId.slice(0, 4)}` : 'Espectador')));
        const xPercent = Math.random() * 70 + 15;

        compatibilityContext.floatingReactionsManager.spawnReaction({ emoji, xPercent, senderName });
        compatibilityContext.broadcastDataMessage({
          type: 'EMOJI_REACTION',
          emoji,
          xPercent,
          senderName
        });
      }, { signal });
    });
  }
}

export function initAdaptiveBitrate(compatibilityContext) {
  compatibilityContext.adaptiveBitrateController.setTargetBitrate(compatibilityContext.customBitrateBps);

  compatibilityContext.adaptiveBitrateController.onBitrateChange = (newBitrateBps) => {
    compatibilityContext.customBitrateBps = newBitrateBps;
    if (compatibilityContext.bitrateSlider) compatibilityContext.bitrateSlider.value = Math.round(compatibilityContext.customBitrateBps / 1000);
    if (compatibilityContext.bitrateDisplay) compatibilityContext.bitrateDisplay.innerText = `${(compatibilityContext.customBitrateBps / 1000000).toFixed(1)} Mbps`;
    compatibilityContext.applyLiveBitrateChange(true);

    const abrToggleBtn = document.getElementById('abr-toggle-btn');
    if (abrToggleBtn) {
      abrToggleBtn.innerHTML = `<span>⚡</span> ABR: ${(newBitrateBps / 1000000).toFixed(1)}M`;
    }
  };

  const abrToggleBtn = document.getElementById('abr-toggle-btn');
  if (abrToggleBtn) {
    abrToggleBtn.addEventListener('click', () => {
      const isCurrentlyActive = abrToggleBtn.classList.contains('active');
      const newState = !isCurrentlyActive;
      abrToggleBtn.classList.toggle('active', newState);
      compatibilityContext.adaptiveBitrateController.setEnabled(newState);
      if (!newState) {
        abrToggleBtn.innerHTML = '<span>⚡</span> ABR (Auto)';
      }
      compatibilityContext.showToast(newState ? '⚡ ABR Automático ativado (otimização dinâmica contra perdas).' : '⚡ ABR desativado (taxa de bitrate fixa).', 'info');
    });
  }
}

export function initFacecam(compatibilityContext) {
  const toggleBtn = document.getElementById('toggle-facecam-btn');
  const closeBtn = document.getElementById('facecam-close-btn');
  const container = document.getElementById('facecam-container');
  const header = container?.querySelector('.facecam-header');

  if (toggleBtn && !toggleBtn.dataset.facecamBound) {
    toggleBtn.dataset.facecamBound = 'true';
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      compatibilityContext.toggleFacecam();
    });
  }
  if (closeBtn && !closeBtn.dataset.facecamBound) {
    closeBtn.dataset.facecamBound = 'true';
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      compatibilityContext.toggleFacecam();
    });
  }

  if (container && header) {
    let isDragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target === closeBtn) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = container.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      const onMouseMove = (ev) => {
        if (!isDragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        container.style.position = 'fixed';
        container.style.left = `${Math.max(10, Math.min(window.innerWidth - 200, startLeft + dx))}px`;
        container.style.top = `${Math.max(10, Math.min(window.innerHeight - 150, startTop + dy))}px`;
        container.style.right = 'auto';
        container.style.bottom = 'auto';
      };

      const onMouseUp = () => {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
}
