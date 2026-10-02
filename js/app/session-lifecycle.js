/** session-lifecycle: commands receive explicit compatibility ports; no page initialization. */
export function getCustomIdRetryAttempts(compatibilityContext) {
  return compatibilityContext.customIdRetryAttempts;
}

export function setCustomIdRetryAttempts(compatibilityContext, val) {
  compatibilityContext.customIdRetryAttempts = Number(val) || 0;
}

export function setConfirmedReload(compatibilityContext, val) {
  compatibilityContext.isConfirmedReload = Boolean(val);
}

export function handlePageUnload(compatibilityContext) {
  if (compatibilityContext.customIdRetryTimer) {
    clearTimeout(compatibilityContext.customIdRetryTimer);
    compatibilityContext.customIdRetryTimer = null;
  }
  if (compatibilityContext.roomManager && compatibilityContext.roomManager.isInRoom) {
    try {
      compatibilityContext.roomManager.leave();
    } catch (e) {}
  }
  if (compatibilityContext.peer && !compatibilityContext.peer.destroyed) {
    try {
      compatibilityContext.peer.destroy();
    } catch (e) {}
  }
  try {
    compatibilityContext.pluginManager.destroyAll();
  } catch (e) {}
  compatibilityContext.appBootstrapped = false;
  compatibilityContext.appDomInitialized = false;
  if (typeof window !== 'undefined' && window.__SEEMYGAME_BOOTSTRAPPED__ === 'app') {
    window.__SEEMYGAME_BOOTSTRAPPED__ = null;
  }
}

export function isReloadConfirmationPending(compatibilityContext) {
  const modal = document.getElementById('reload-confirm-modal');
  return Boolean(modal && modal.style.display !== 'none');
}

export function showReloadConfirmationModal(compatibilityContext) {
  let modal = document.getElementById('reload-confirm-modal');
  if (!modal && typeof document !== 'undefined') {
    modal = document.createElement('div');
    modal.id = 'reload-confirm-modal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '10002';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 460px; background: var(--bg-card); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 14px; padding: 24px; box-shadow: 0 24px 48px rgba(0, 0, 0, 0.8);">
        <h3 id="reload-confirm-title" style="color: var(--accent-text); margin: 0 0 12px 0; font-size: 1.25rem; display: flex; align-items: center; gap: 8px;">
          <span>⚠️</span> Recarregar a Sala?
        </h3>
        <p id="reload-confirm-desc" style="color: var(--text-muted); font-size: 13.5px; line-height: 1.55; margin: 0 0 16px 0;">
          Você está em uma sessão ativa na sala. Recarregar agora interromperá conexões e transmissões temporariamente.
        </p>
        <div id="reload-confirm-warnings" style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px; padding: 12px; font-size: 12.5px; line-height: 1.5; color: var(--accent-text); margin-bottom: 20px; display: none;"></div>
        <div class="modal-actions" style="display: flex; justify-content: flex-end; gap: 10px;">
          <button id="reload-confirm-cancel-btn" class="btn-secondary" style="padding: 9px 18px; font-size: 13px; border-radius: 8px; cursor: pointer;">
            Continuar na Sala
          </button>
          <button id="reload-confirm-ok-btn" style="background: #ef4444; color: #fff; border: none; border-radius: 8px; padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s;">
            Recarregar
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  if (!modal) return;

  const warningsEl = modal.querySelector('#reload-confirm-warnings');
  const cancelBtn = modal.querySelector('#reload-confirm-cancel-btn');
  const okBtn = modal.querySelector('#reload-confirm-ok-btn');

  const isStreaming = Boolean(compatibilityContext.localStream || compatibilityContext.activeNativeCaptureProvider?.session?.sessionId || (compatibilityContext.roomManager && compatibilityContext.roomManager.localStreamingState?.isStreaming));
  const isInVoice = Boolean(compatibilityContext.voiceManager && compatibilityContext.voiceManager.isInVoice);
  const isHost = Boolean(compatibilityContext.isRoomMode() && compatibilityContext.roomManager && compatibilityContext.roomManager.isMaster);

  const warnings = [];
  if (isStreaming) {
    warnings.push('🎮 Sua transmissão de tela ao vivo será encerrada para todos os espectadores.');
  }
  if (isInVoice) {
    warnings.push('🎙️ Você será desconectado do canal de voz da sala.');
  }
  if (isHost) {
    warnings.push('👑 Você continuará sendo o Host da sala ao reconectar.');
  }

  if (warningsEl) {
    if (warnings.length > 0) {
      warningsEl.innerHTML = warnings.map(w => `<div style="margin-bottom: 4px;">${w}</div>`).join('');
      warningsEl.style.display = 'block';
    } else {
      warningsEl.style.display = 'none';
    }
  }

  const handleModalKeys = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      compatibilityContext.hideReloadConfirmationModal();
    }
  };

  if (cancelBtn) {
    cancelBtn.onclick = () => compatibilityContext.hideReloadConfirmationModal();
    cancelBtn.focus?.();
  }

  if (okBtn) {
    okBtn.onclick = () => {
      compatibilityContext.isConfirmedReload = true;
      compatibilityContext.hideReloadConfirmationModal();
      compatibilityContext.handlePageUnload();
      if (typeof window !== 'undefined' && window.location) {
        window.location.reload();
      }
    };
  }

  window.addEventListener('keydown', handleModalKeys);
  modal._smg_removeKeyHandler = () => window.removeEventListener('keydown', handleModalKeys);
  modal.style.display = 'flex';
}

export function hideReloadConfirmationModal(compatibilityContext) {
  const modal = document.getElementById('reload-confirm-modal');
  if (modal) {
    modal.style.display = 'none';
    if (typeof modal._smg_removeKeyHandler === 'function') {
      modal._smg_removeKeyHandler();
      modal._smg_removeKeyHandler = null;
    }
  }
}

export function handleReloadKeypress(compatibilityContext, e) {
  if (!e) return false;
  const isF5 = e.key === 'F5' || e.code === 'F5';
  const isCtrlR = (e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R' || e.code === 'KeyR');
  if (!isF5 && !isCtrlR) return false;

  const isStreaming = Boolean(compatibilityContext.localStream || compatibilityContext.activeNativeCaptureProvider?.session?.sessionId || (compatibilityContext.roomManager && compatibilityContext.roomManager.localStreamingState?.isStreaming));
  const isInVoice = Boolean(compatibilityContext.voiceManager && compatibilityContext.voiceManager.isInVoice);
  const isConnected = Boolean(compatibilityContext.connectedViewers.size > 0 || compatibilityContext.watchingHosts.size > 0 || (compatibilityContext.roomManager && compatibilityContext.roomManager.members.size > 1));
  const isRoom = compatibilityContext.isRoomMode();

  if (isStreaming || isInVoice || isConnected || isRoom) {
    e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    compatibilityContext.showReloadConfirmationModal();
    return true;
  }
  return false;
}

export function resetPeer(compatibilityContext) {
  if (compatibilityContext.customIdRetryTimer) {
    clearTimeout(compatibilityContext.customIdRetryTimer);
    compatibilityContext.customIdRetryTimer = null;
  }
  if (compatibilityContext.reconnectTimer) {
    clearTimeout(compatibilityContext.reconnectTimer);
    compatibilityContext.reconnectTimer = null;
  }
  compatibilityContext.customIdRetryAttempts = 0;
  if (compatibilityContext.peer) {
    try {
      compatibilityContext.peer.destroy();
    } catch (e) {}
    compatibilityContext.peer = null;
  }
}
