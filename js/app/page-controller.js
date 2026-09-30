/** page-controller: commands receive explicit compatibility ports; no page initialization. */
export function initGamerFeatures(compatibilityContext) {
  compatibilityContext.initTacticalPing();
  compatibilityContext.initFloatingReactions();
  compatibilityContext.initAdaptiveBitrate();
  compatibilityContext.initFacecam();
  compatibilityContext.initWhiteboard();
  compatibilityContext.setupGamepadTesterModal();

  // Botão de Clipping instantâneo ("Clipa isso! - 30s")
  const clipBtn = document.getElementById('clip-btn');
  if (clipBtn) {
    clipBtn.addEventListener('click', async () => {
      if (!compatibilityContext.clipRecorder.isRecording) {
        compatibilityContext.showToast('Nenhuma transmissão ativa para clipar.', 'warning');
        return;
      }
      const prevHtml = clipBtn.innerHTML;
      clipBtn.innerHTML = '<span>⏳</span> Gravando Clip...';
      clipBtn.disabled = true;
      clipBtn.classList.add('saving');
      try {
        const result = await compatibilityContext.clipRecorder.exportClip();
        if (result) {
          compatibilityContext.showToast(`🎬 Clip salvo com sucesso: ${result.fileName || 'vídeo.webm'}!`, 'success');
          compatibilityContext.openClipPostModal(result);
        } else {
          compatibilityContext.showToast('Aguarde alguns segundos de gravação antes de clipar.', 'info');
        }
      } catch (err) {
        console.error('Erro ao gerar clip:', err);
        compatibilityContext.showToast('Erro ao exportar clip.', 'error');
      } finally {
        clipBtn.innerHTML = prevHtml;
        clipBtn.disabled = false;
        clipBtn.classList.remove('saving');
      }
    });
  }

  // Botão de Picture-in-Picture nativo
  const pipBtn = document.getElementById('pip-btn');
  if (pipBtn) {
    pipBtn.addEventListener('click', async () => {
      try {
        const videoEl = document.querySelector('#video-grid video:not(#facecam-video)') || document.querySelector('video');
        if (!videoEl) {
          compatibilityContext.showToast('Nenhum vídeo em reprodução para Picture-in-Picture.', 'warning');
          return;
        }
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled && typeof videoEl.requestPictureInPicture === 'function') {
          await videoEl.requestPictureInPicture();
          compatibilityContext.showToast('📺 Picture-in-Picture ativado!', 'info');
        } else {
          compatibilityContext.showToast('Picture-in-Picture não suportado neste navegador.', 'warning');
        }
      } catch (err) {
        console.warn('Erro ao alternar Picture-in-Picture:', err);
        compatibilityContext.showToast('Não foi possível ativar Picture-in-Picture.', 'error');
      }
    });
  }

  // Atalho de teclado para Clipping (C)
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      const clipBtnEl = document.getElementById('clip-btn');
      if (clipBtnEl && clipBtnEl.style.display !== 'none') {
        clipBtnEl.click();
      }
    }
  });
}

export function initAppDom(compatibilityContext) {
  if (compatibilityContext.appDomInitialized) return;
  compatibilityContext.appDomInitialized = true;

  // Pré-busca credenciais TURN da API serverless em segundo plano se disponível
  compatibilityContext.fetchIceServersFromApi().catch(() => {});

  // Sincroniza capacidades de áudio com a plataforma (Web / Desktop)
  compatibilityContext.syncAudioModeCapabilities().catch(() => {});

  // Inicializa suporte e prioridade nativa se estiver rodando em Desktop Tauri
  compatibilityContext.initDesktopSupport().catch((err) => console.warn('[Desktop Init]', err));

  // Inicializa plugins da sessão legada
  compatibilityContext.initPlugins();

  // Inicializa recursos Discord (Chat e Voz P2P)
  compatibilityContext.initDiscordFeatures();

  // Inicializa controles de ID fixo e PIN
  compatibilityContext.initFixedIdAndPinControls();

  // Inicializa recursos Gamer (Clipping, Pings, Reações, ABR, PiP, Facecam)
  compatibilityContext.initGamerFeatures();

  // Inicializa atalhos de teclado gamer
  compatibilityContext.initGamerKeybindings();

  // Modal de termos: garante que se já aceito, chama o fluxo imediatamente
  compatibilityContext.initTermsModal(() => {
    if (compatibilityContext.isRoomMode()) {
      compatibilityContext.initGreenRoomLobby();
    } else {
      compatibilityContext.initPeer();
    }
  });
}

export function initGamerKeybindings(compatibilityContext) {
  if (compatibilityContext.gamerKeybindingsInitialized || typeof window === 'undefined') return;
  compatibilityContext.gamerKeybindingsInitialized = true;

  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
      return;
    }

    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      const video = document.querySelector('.video-card:not(#card-local-me) video') || 
                    document.querySelector('video');
      if (video) {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          if (video.requestFullscreen) {
            video.requestFullscreen().catch(err => console.warn(err));
          } else if (video.webkitRequestFullscreen) {
            video.webkitRequestFullscreen();
          }
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen().catch(err => console.warn(err));
          } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
          }
        }
      }
    } else if (e.key === 'm' || e.key === 'M') {
      const video = document.querySelector('.video-card:not(#card-local-me) video') || 
                    document.querySelector('video');
      if (video) {
        video.muted = !video.muted;
        compatibilityContext.showToast(video.muted ? '🔇 Áudio mutado' : '🔊 Áudio desmutado', 'info', 2000);
        document.querySelectorAll('.volume-slider').forEach(s => {
          s.value = video.muted ? '0' : '1';
        });
        document.querySelectorAll('.overlay-btn').forEach(btn => {
          if (btn.innerHTML.includes('🔊') || btn.innerHTML.includes('🔇')) {
            btn.innerHTML = video.muted ? '🔇' : '🔊';
          }
        });
      }
    }

    // Push-to-Talk (PTT) Hotkey (CapsLock ou ControlRight)
    if (compatibilityContext.voiceManager.isInVoice && compatibilityContext.voiceManager.voiceMode === 'ptt' && (e.code === 'CapsLock' || e.code === 'ControlRight')) {
      e.preventDefault();
      if (!compatibilityContext.voiceManager.isPttActive) {
        compatibilityContext.voiceManager.setPttActive(true);
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (compatibilityContext.voiceManager.isInVoice && compatibilityContext.voiceManager.voiceMode === 'ptt' && (e.code === 'CapsLock' || e.code === 'ControlRight')) {
      e.preventDefault();
      compatibilityContext.voiceManager.setPttActive(false);
    }
  });
}
