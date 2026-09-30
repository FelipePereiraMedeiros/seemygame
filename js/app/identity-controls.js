/** identity-controls: commands receive explicit compatibility ports; no page initialization. */
export function handleStreamBtnClick(compatibilityContext) {
  if (compatibilityContext.localStream) {
    compatibilityContext.stopLocalStream();
    return;
  }

  if (compatibilityContext.isDesktopApp()) {
    const desktopPickerModal = document.getElementById('desktop-picker-modal');
    if (desktopPickerModal) {
      desktopPickerModal.style.display = 'flex';
      const refreshBtn = document.getElementById('picker-refresh-btn');
      if (refreshBtn) refreshBtn.click();
      return;
    }
  }

  compatibilityContext.startLocalStream();
}

export function checkAutoWatchUrl(compatibilityContext) {
  if (window.location.pathname.endsWith('streamer.html')) return;

  const hash = window.location.hash;
  let targetId = null;

  if (hash.includes('watch=')) {
    targetId = hash.split('watch=')[1].split('&')[0];
  } else {
    const params = new URLSearchParams(window.location.search);
    targetId = params.get('watch');
  }

  if (targetId && targetId !== compatibilityContext.myId) {
    if (compatibilityContext.targetInput) compatibilityContext.targetInput.value = targetId;
    compatibilityContext.showToast(`ID detectado: ${targetId.slice(0, 6)}. Conectando...`, 'info');
    compatibilityContext.watchFriend(targetId);
  }
}

export function initFixedIdAndPinControls(compatibilityContext) {
  // 1. PIN na barra de tuning do Streamer ou Modal de Configuração da Sala
  if (compatibilityContext.roomPinInput) {
    if (compatibilityContext.isRoomMode()) {
      const { roomPin } = compatibilityContext.getRoomInfoFromUrl();
      const currentRoomPin = compatibilityContext.roomManager ? compatibilityContext.roomManager.roomPin : roomPin;
      if (currentRoomPin) compatibilityContext.roomPinInput.value = currentRoomPin;

      compatibilityContext.roomPinInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (compatibilityContext.roomManager) {
          compatibilityContext.roomManager.setRoomPin(val);
        }
      });

      compatibilityContext.roomPinInput.addEventListener('change', (e) => {
        const val = e.target.value.trim();
        if (val) {
          compatibilityContext.showToast('🔒 PIN da sala atualizado. Novos membros precisarão da senha para entrar.', 'info');
        } else {
          compatibilityContext.showToast('🔓 PIN removido. A sala agora é aberta a todos.', 'info');
        }
      });
    } else {
      const savedPin = compatibilityContext.getStoredRoomPin();
      if (savedPin) compatibilityContext.roomPinInput.value = savedPin;

      compatibilityContext.roomPinInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        compatibilityContext.setStoredRoomPin(val);
      });

      compatibilityContext.roomPinInput.addEventListener('change', (e) => {
        const val = e.target.value.trim();
        if (val) {
          compatibilityContext.showToast('🔒 PIN da sala salvo. Novos espectadores precisarão da senha.', 'info');
        } else {
          compatibilityContext.showToast('🔓 PIN removido. Sala agora é aberta ao público.', 'info');
        }
      });
    }
  }

  // 2. Modal de ID Fixo Permanente
  if (compatibilityContext.editIdBtn && compatibilityContext.customIdModal) {
    compatibilityContext.editIdBtn.addEventListener('click', () => {
      if (compatibilityContext.customIdInput) {
        compatibilityContext.customIdInput.value = compatibilityContext.getCustomStreamerId() || '';
      }
      if (compatibilityContext.customIdError) {
        compatibilityContext.customIdError.textContent = '';
        compatibilityContext.customIdError.style.display = 'none';
      }
      compatibilityContext.customIdModal.style.display = 'flex';
      if (compatibilityContext.customIdInput) compatibilityContext.customIdInput.focus();
    });
  }

  if (compatibilityContext.customIdCancelBtn && compatibilityContext.customIdModal) {
    compatibilityContext.customIdCancelBtn.addEventListener('click', () => {
      compatibilityContext.customIdModal.style.display = 'none';
    });
  }

  if (compatibilityContext.customIdResetBtn && compatibilityContext.customIdModal) {
    compatibilityContext.customIdResetBtn.addEventListener('click', () => {
      compatibilityContext.setCustomStreamerId(null);
      compatibilityContext.customIdModal.style.display = 'none';
      compatibilityContext.showToast('ID fixo removido. Gerando novo ID aleatório...', 'info');
      compatibilityContext.resetPeer();
      compatibilityContext.initPeer();
    });
  }

  if (compatibilityContext.customIdSaveBtn && compatibilityContext.customIdModal) {
    const handleSaveCustomId = () => {
      const rawVal = compatibilityContext.customIdInput ? compatibilityContext.customIdInput.value.trim() : '';
      if (!rawVal || rawVal.length < 3 || rawVal.length > 30 || !compatibilityContext.isValidPeerId(rawVal)) {
        if (compatibilityContext.customIdError) {
          compatibilityContext.customIdError.textContent = 'O ID deve ter entre 3 e 30 caracteres (letras, números, hífen ou underline).';
          compatibilityContext.customIdError.style.display = 'block';
        }
        return;
      }

      compatibilityContext.setCustomStreamerId(rawVal);
      compatibilityContext.customIdModal.style.display = 'none';
      compatibilityContext.showToast(`ID Fixo "${rawVal}" salvo com sucesso! Reiniciando sessão P2P...`, 'success');
      compatibilityContext.resetPeer();
      compatibilityContext.initPeer();
    };

    compatibilityContext.customIdSaveBtn.addEventListener('click', handleSaveCustomId);
    if (compatibilityContext.customIdInput) {
      compatibilityContext.customIdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          handleSaveCustomId();
        }
      });
    }
  }

  // 3. Modal de Desafio de PIN do Espectador
  if (compatibilityContext.viewerPinSubmitBtn) {
    compatibilityContext.viewerPinSubmitBtn.addEventListener('click', () => {
      const val = compatibilityContext.viewerPinInput ? compatibilityContext.viewerPinInput.value.trim() : '';
      compatibilityContext.submitViewerPin(val);
    });
  }

  if (compatibilityContext.viewerPinInput) {
    compatibilityContext.viewerPinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = compatibilityContext.viewerPinInput ? compatibilityContext.viewerPinInput.value.trim() : '';
        compatibilityContext.submitViewerPin(val);
      }
    });
  }

  if (compatibilityContext.viewerPinCancelBtn) {
    compatibilityContext.viewerPinCancelBtn.addEventListener('click', () => {
      if (compatibilityContext.currentPinTargetId) {
        compatibilityContext.disconnectHost(compatibilityContext.currentPinTargetId);
      }
      compatibilityContext.hideViewerPinModal();
    });
  }
}
