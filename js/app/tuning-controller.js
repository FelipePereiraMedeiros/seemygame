/** tuning-controller: commands receive explicit compatibility ports; no page initialization. */
export async function initTuningAudioDeviceControls(compatibilityContext) {
  const micSelect = document.getElementById('tuning-mic-select');
  const speakerSelect = document.getElementById('tuning-speaker-select');
  const testSpeakerBtn = document.getElementById('tuning-test-speaker-btn');
  const speakerNote = document.getElementById('tuning-speaker-note');

  if (!micSelect && !speakerSelect) return null;

  const supportsOutput = compatibilityContext.isAudioOutputSupported();
  if (speakerNote) {
    if (!supportsOutput) {
      speakerNote.textContent = 'Seleção de saída não suportada neste navegador (usando padrão do sistema).';
    } else {
      speakerNote.textContent = '';
    }
  }
  if (speakerSelect && !supportsOutput) {
    speakerSelect.disabled = true;
  }
  if (testSpeakerBtn && !supportsOutput) {
    testSpeakerBtn.disabled = true;
  }

  async function refreshDevices(requestPermission = false) {
    const { microphones, speakers } = await compatibilityContext.getAudioDevices(requestPermission);
    const prefs = compatibilityContext.getSavedAudioPreferences ? compatibilityContext.getSavedAudioPreferences() : { inputId: '', outputId: '' };

    if (micSelect) {
      let currentMicId = micSelect.value || prefs.inputId || (compatibilityContext.voiceManager?.selectedMicId) || '';
      if (currentMicId && microphones.length > 0 && !microphones.some((m) => m.deviceId === currentMicId)) {
        currentMicId = '';
        compatibilityContext.saveAudioPreference?.('input', '');
      }
      compatibilityContext.populateDeviceSelect(micSelect, microphones, currentMicId, 'Microfone Padrão do Sistema');
    }

    if (speakerSelect) {
      if (supportsOutput) {
        let currentSpeakerId = speakerSelect.value || prefs.outputId || (compatibilityContext.voiceManager?.selectedSpeakerId) || '';
        if (currentSpeakerId && speakers.length > 0 && !speakers.some((s) => s.deviceId === currentSpeakerId)) {
          currentSpeakerId = '';
          compatibilityContext.saveAudioPreference?.('output', '');
        }
        compatibilityContext.populateDeviceSelect(speakerSelect, speakers, currentSpeakerId, 'Alto-falante Padrão do Sistema');
      } else {
        compatibilityContext.populateDeviceSelect(speakerSelect, [], '', 'Alto-falante Padrão do Sistema');
      }
    }
  }

  // Preenche inicialmente os selects de áudio
  await refreshDevices(false);

  // Monitora alterações físicas de dispositivos (conectar/desconectar fones)
  const unwatch = compatibilityContext.watchDeviceChanges?.(() => {
    refreshDevices(false).catch(() => {});
  });

  if (micSelect) {
    micSelect.addEventListener('change', async () => {
      const deviceId = micSelect.value;
      compatibilityContext.saveAudioPreference('input', deviceId);
      if (compatibilityContext.voiceManager) {
        await compatibilityContext.voiceManager.setAudioInputDevice(deviceId).catch((err) => {
          console.warn('[AudioDevices] Falha ao alternar microfone no voiceManager:', err);
        });
      }
    });
  }

  if (speakerSelect && supportsOutput) {
    speakerSelect.addEventListener('change', async () => {
      const deviceId = speakerSelect.value;
      compatibilityContext.saveAudioPreference('output', deviceId);
      if (compatibilityContext.voiceManager) {
        await compatibilityContext.voiceManager.setAudioOutputDevice(deviceId).catch((err) => {
          console.warn('[AudioDevices] Falha ao alternar saída no voiceManager:', err);
        });
      }
    });
  }

  if (testSpeakerBtn) {
    testSpeakerBtn.addEventListener('click', async () => {
      const selectedSinkId = speakerSelect ? speakerSelect.value : '';
      const originalText = testSpeakerBtn.innerHTML;
      testSpeakerBtn.disabled = true;
      testSpeakerBtn.innerHTML = '🔊 Testando...';
      try {
        await compatibilityContext.playTestTone(selectedSinkId);
      } catch (e) {
        console.warn('[AudioDevices] Erro ao reproduzir tom de teste:', e);
      } finally {
        testSpeakerBtn.disabled = false;
        testSpeakerBtn.innerHTML = originalText;
      }
    });
  }

  const micVolumeSlider = document.getElementById('tuning-mic-volume');
  const micVolumeVal = document.getElementById('tuning-mic-volume-val');
  const speakerVolumeSlider = document.getElementById('tuning-speaker-volume');
  const speakerVolumeVal = document.getElementById('tuning-speaker-volume-val');

  function syncVolumeUI() {
    if (compatibilityContext.voiceManager) {
      if (micVolumeSlider) {
        micVolumeSlider.value = compatibilityContext.voiceManager.inputVolume;
        if (micVolumeVal) micVolumeVal.textContent = `${compatibilityContext.voiceManager.inputVolume}%`;
      }
      if (speakerVolumeSlider) {
        speakerVolumeSlider.value = compatibilityContext.voiceManager.outputVolume;
        if (speakerVolumeVal) speakerVolumeVal.textContent = `${compatibilityContext.voiceManager.outputVolume}%`;
      }
    }
  }

  syncVolumeUI();

  if (micVolumeSlider && compatibilityContext.voiceManager) {
    micVolumeSlider.addEventListener('input', () => {
      const vol = compatibilityContext.voiceManager.setInputVolume(micVolumeSlider.value);
      if (micVolumeVal) micVolumeVal.textContent = `${vol}%`;
    });
    compatibilityContext.voiceManager.on('inputVolumeChange', ({ volume }) => {
      micVolumeSlider.value = volume;
      if (micVolumeVal) micVolumeVal.textContent = `${volume}%`;
    });
  }

  if (speakerVolumeSlider && compatibilityContext.voiceManager) {
    speakerVolumeSlider.addEventListener('input', () => {
      const vol = compatibilityContext.voiceManager.setOutputVolume(speakerVolumeSlider.value);
      if (speakerVolumeVal) speakerVolumeVal.textContent = `${vol}%`;
    });
    compatibilityContext.voiceManager.on('outputVolumeChange', ({ volume }) => {
      speakerVolumeSlider.value = volume;
      if (speakerVolumeVal) speakerVolumeVal.textContent = `${volume}%`;
    });
  }

  function destroy() {
    if (typeof unwatch === 'function') {
      try { unwatch(); } catch (_) {}
    }
  }

  return { refreshDevices, syncVolumeUI, destroy };
}

export function initDiscordFeatures(compatibilityContext) {
  if (typeof document === 'undefined') return;

  compatibilityContext.discordUI = new compatibilityContext.DiscordUIController({
    onSendMessage: (text) => {
      const isHost = !window.location.pathname.endsWith('viewer.html');
      const coopState = compatibilityContext.getCoopState();
      const role = compatibilityContext.isRoomMode() && compatibilityContext.roomManager
        ? (compatibilityContext.roomManager.isMaster ? 'host' : 'member')
        : (isHost ? 'host' : (coopState.isPlayer2 ? 'player2' : 'viewer'));
      const senderName = compatibilityContext.getLocalUserDisplayName();

      const msg = compatibilityContext.chatManager.createMessage({
        senderId: compatibilityContext.myId,
        senderName,
        role,
        text,
        channel: compatibilityContext.chatManager.getActiveChannel(),
      });

      if (!msg) return;
      compatibilityContext.chatManager.addMessage(msg);
      compatibilityContext.broadcastDataMessage({ type: 'CHAT_MESSAGE', message: msg });
    },
    onPlaySound: (soundId) => {
      if (!compatibilityContext.soundboardManager.canPlay()) {
        compatibilityContext.showToast('Aguarde um instante antes de disparar outro som.', 'info');
        return;
      }
      if (typeof soundId === 'string' && soundId.startsWith('custom_')) {
        const sound = compatibilityContext.soundboardManager.getCustomSounds().find(s => s.id === soundId);
        if (sound) {
          compatibilityContext.soundboardManager.playCustomSound(sound);
          const senderName = compatibilityContext.getLocalUserDisplayName();
          compatibilityContext.broadcastDataMessage({
            type: 'SOUNDBOARD_PLAY_CUSTOM',
            soundId: sound.id,
            effectName: sound.name,
            audioBase64: sound.audioBase64,
            senderName
          });
          return;
        }
      }
      compatibilityContext.soundboardManager.playSound(soundId);
      const senderName = compatibilityContext.getLocalUserDisplayName();
      compatibilityContext.broadcastDataMessage({
        type: 'SOUNDBOARD_PLAY',
        soundId,
        senderName
      });
    },
    onPlayCustomSound: (sound) => {
      if (!compatibilityContext.soundboardManager.canPlay()) {
        compatibilityContext.showToast('Aguarde um instante antes de disparar outro som.', 'info');
        return;
      }
      compatibilityContext.soundboardManager.playCustomSound(sound);
      const senderName = compatibilityContext.getLocalUserDisplayName();
      compatibilityContext.broadcastDataMessage({
        type: 'SOUNDBOARD_PLAY_CUSTOM',
        soundId: sound.id,
        effectName: sound.name,
        audioBase64: sound.audioBase64,
        senderName
      });
      compatibilityContext.showToast(`🎙️ Você tocou o meme "${sound.name}"!`, 'info', 2000);
    },
    onSendReaction: (emoji) => {
      if (!compatibilityContext.floatingReactionsManager.canSend()) return;
      const senderName = compatibilityContext.getLocalUserDisplayName();
      const xPercent = Math.random() * 70 + 15;

      compatibilityContext.floatingReactionsManager.spawnReaction({ emoji, xPercent, senderName });
      compatibilityContext.broadcastDataMessage({
        type: 'EMOJI_REACTION',
        emoji,
        xPercent,
        senderName
      });
    },
    onJoinVoice: async () => {
      try {
        const isHost = !window.location.pathname.endsWith('viewer.html');
        const coopState = compatibilityContext.getCoopState();
        const role = compatibilityContext.isRoomMode() && compatibilityContext.roomManager
          ? (compatibilityContext.roomManager.isMaster ? 'host' : 'member')
          : (isHost ? 'host' : (coopState.isPlayer2 ? 'player2' : 'viewer'));
        const name = compatibilityContext.isRoomMode() && compatibilityContext.roomManager
          ? compatibilityContext.roomManager.userName
          : (isHost ? 'Streamer' : (coopState.isPlayer2 ? 'Player 2' : `Amigo ${compatibilityContext.myId ? compatibilityContext.myId.slice(0, 4) : ''}`));

        const stream = await compatibilityContext.voiceManager.joinVoice({
          peerId: compatibilityContext.myId,
          name,
          role,
        });

        compatibilityContext.showToast('Conectado à sala de voz!', 'success');

        if (compatibilityContext.isRoomMode() && compatibilityContext.roomManager) {
          compatibilityContext.roomManager.setLocalVoiceState({
            isMuted: compatibilityContext.voiceManager.isMuted,
            isDeafened: compatibilityContext.voiceManager.isDeafened,
            isSpeaking: false
          });

          compatibilityContext.broadcastDataMessage({
            type: 'VOICE_SIGNAL',
            action: 'VOICE_JOINED',
            peerId: compatibilityContext.myId,
            name,
            role
          });

          compatibilityContext.roomManager.members.forEach((m) => {
            if (m.peerId && m.peerId !== compatibilityContext.myId && !compatibilityContext.activeVoiceCalls.has(m.peerId) && compatibilityContext.peer && !compatibilityContext.peer.destroyed) {
              const call = compatibilityContext.peer.call(m.peerId, stream, {
                metadata: { type: 'VOICE_CHAT', name, role }
              });
              compatibilityContext.setupVoiceMediaCall(call, m.peerId);
            }
          });

          compatibilityContext.activeVoiceCalls.forEach((call) => {
            try {
              if (call?.peerConnection) {
                const sender = call.peerConnection.getSenders()?.find(s => s.track?.kind === 'audio' || !s.track);
                const newAudioTrack = stream.getAudioTracks()[0];
                if (sender && newAudioTrack) {
                  sender.replaceTrack(newAudioTrack).catch(() => {});
                }
              }
            } catch (_) {}
          });
        } else {
          if (!isHost) {
            compatibilityContext.watchingHosts.forEach((hostData, hostId) => {
              if (hostData.state === 'CONNECTED' && compatibilityContext.peer && !compatibilityContext.activeVoiceCalls.has(hostId)) {
                const call = compatibilityContext.peer.call(hostId, stream, {
                  metadata: { type: 'VOICE_CHAT', name, role },
                });
                compatibilityContext.setupVoiceMediaCall(call, hostId);
              }
            });
          } else {
            compatibilityContext.broadcastDataMessage({ type: 'VOICE_SIGNAL', action: 'HOST_VOICE_ACTIVE', peerId: compatibilityContext.myId, name, role });
          }
        }
      } catch (err) {
        console.warn('[Voice] Falha ao acessar microfone:', err);
        compatibilityContext.showToast('Não foi possível acessar o microfone.', 'error');
      }
    },
    onLeaveVoice: () => {
      compatibilityContext.activeVoiceCalls.forEach((call) => {
        try { call.close(); } catch (e) {}
      });
      compatibilityContext.activeVoiceCalls.clear();

      compatibilityContext.voiceManager.leaveVoice();
      compatibilityContext.broadcastDataMessage({ type: 'VOICE_SIGNAL', action: 'LEAVE', peerId: compatibilityContext.myId });
      compatibilityContext.showToast('Você saiu da sala de voz.', 'info');
    },
    onToggleMic: (isMuted) => {
      if (compatibilityContext.roomManager) {
        compatibilityContext.roomManager.setLocalVoiceState({ isMuted });
      }
    },
    onToggleDeaf: (isDeafened) => {
      if (compatibilityContext.roomManager) {
        compatibilityContext.roomManager.setLocalVoiceState({ isDeafened });
      }
    },
    onToggleStream: () => {
      compatibilityContext.handleStreamBtnClick();
    },
    onOpenTuning: async () => {
      const modal = document.getElementById('tuning-modal');
      if (modal) modal.style.display = 'flex';
      compatibilityContext.syncMediaControlsEnvironment();
      if (compatibilityContext.tuningAudioControls) {
        if (typeof compatibilityContext.tuningAudioControls.syncVolumeUI === 'function') {
          compatibilityContext.tuningAudioControls.syncVolumeUI();
        }
        await compatibilityContext.tuningAudioControls.refreshDevices(true).catch(() => {});
      }
    },
    onOpenWhiteboard: () => {
      if (typeof compatibilityContext.toggleWhiteboardModal === 'function') {
        compatibilityContext.toggleWhiteboardModal();
      } else {
        const toggleBtn = document.getElementById('toggle-whiteboard-btn');
        if (toggleBtn && typeof toggleBtn.onclick === 'function') {
          toggleBtn.onclick();
        } else {
          const wbModal = document.getElementById('whiteboard-modal');
          if (wbModal) wbModal.style.display = wbModal.style.display === 'flex' ? 'none' : 'flex';
        }
      }
    },
    onLeaveRoom: () => {
      if (compatibilityContext.roomManager) compatibilityContext.roomManager.leave();
      window.location.href = 'index.html';
    }
  });


  const closeTuningBtn = document.getElementById('close-tuning-modal-btn');
  const saveTuningBtn = document.getElementById('save-tuning-btn');
  const tuningModal = document.getElementById('tuning-modal');

  if (closeTuningBtn && tuningModal) {
    closeTuningBtn.addEventListener('click', () => { tuningModal.style.display = 'none'; });
  }
  if (saveTuningBtn && tuningModal) {
    saveTuningBtn.addEventListener('click', async () => {
      const micSelect = document.getElementById('tuning-mic-select');
      const speakerSelect = document.getElementById('tuning-speaker-select');
      if (micSelect) {
        compatibilityContext.saveAudioPreference('input', micSelect.value);
        if (compatibilityContext.voiceManager) await compatibilityContext.voiceManager.setAudioInputDevice(micSelect.value).catch(() => {});
      }
      if (speakerSelect && compatibilityContext.isAudioOutputSupported()) {
        compatibilityContext.saveAudioPreference('output', speakerSelect.value);
        if (compatibilityContext.voiceManager) await compatibilityContext.voiceManager.setAudioOutputDevice(speakerSelect.value).catch(() => {});
      }
      if (compatibilityContext.videoCodecSelect) {
        try { localStorage.setItem('seemygame_video_codec', compatibilityContext.videoCodecSelect.value); } catch (e) {}
      }
      if (compatibilityContext.h264EncoderSelect) {
        try { localStorage.setItem('seemygame_h264_encoder', compatibilityContext.h264EncoderSelect.value); } catch (e) {}
      }
      if (compatibilityContext.captureCursorToggle) {
        try { localStorage.setItem('seemygame_capture_cursor', String(compatibilityContext.captureCursorToggle.checked)); } catch (e) {}
      }
      if (compatibilityContext.coopModeSelect) {
        compatibilityContext.applyCoopModeChange(compatibilityContext.coopModeSelect.value);
      }

      // Reconfigura a transmissão ativa consolidando todas as opções do modal
      if (compatibilityContext.localStream || (compatibilityContext.isDesktopApp() && compatibilityContext.activeNativeCaptureProvider)) {
        compatibilityContext.applyLiveBitrateChange();
      }

      tuningModal.style.display = 'none';
      compatibilityContext.showToast('Configurações atualizadas com sucesso!', 'success');
    });
  }

  compatibilityContext.initTuningAudioDeviceControls().then((controls) => {
    compatibilityContext.tuningAudioControls = controls;
  }).catch(() => {});

  compatibilityContext.discordUI.init();

  compatibilityContext.voiceManager.on('speakingChange', ({ peerId, isSpeaking }) => {
    if (peerId === compatibilityContext.myId) {
      compatibilityContext.broadcastDataMessage({ type: 'VOICE_STATE_UPDATE', peerId: compatibilityContext.myId, isSpeaking });
    }
  });

  compatibilityContext.voiceManager.on('voiceStateChange', (state) => {
    compatibilityContext.broadcastDataMessage({
      type: 'VOICE_STATE_UPDATE',
      peerId: compatibilityContext.myId,
      isMuted: state.isMuted,
      isDeafened: state.isDeafened,
    });
  });
}
