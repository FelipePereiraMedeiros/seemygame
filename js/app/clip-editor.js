/** clip-editor: commands receive explicit compatibility ports; no page initialization. */
export function closeClipPostModal(compatibilityContext) {
  if (compatibilityContext.currentPreviewController) {
    try { compatibilityContext.currentPreviewController.stop(); } catch {}
    compatibilityContext.currentPreviewController = null;
  }
  const modal = document.getElementById('clip-post-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  const previewVideo = document.getElementById('clip-preview-video');
  if (previewVideo) {
    try { previewVideo.pause(); } catch {}
    if (previewVideo._blobUrl) {
      try { URL.revokeObjectURL(previewVideo._blobUrl); } catch {}
      previewVideo._blobUrl = null;
    }
    previewVideo.src = '';
  }
}

export async function openClipPostModal(compatibilityContext, clipBlob) {
  const modal = document.getElementById('clip-post-modal');
  if (!modal) return;

  compatibilityContext.activeClipBlob = clipBlob;
  compatibilityContext.activeAudioBuffer = null;
  compatibilityContext.activeEffectId = 'none';
  modal.style.display = 'flex';

  const previewVideo = document.getElementById('clip-preview-video');
  if (previewVideo && clipBlob) {
    try {
      if (previewVideo._blobUrl) {
        try { URL.revokeObjectURL(previewVideo._blobUrl); } catch (_) {}
      }
      const url = URL.createObjectURL(clipBlob);
      previewVideo.src = url;
      previewVideo._blobUrl = url;
      previewVideo.load();
    } catch (e) {
      console.warn('Falha ao definir preview de vídeo do clip:', e);
    }
  }

  const closeBtn = document.getElementById('clip-post-close-btn');
  const downloadVideoBtn = document.getElementById('clip-download-video-btn');
  const statusPill = document.getElementById('clip-audio-status');
  const titleEl = document.getElementById('clip-post-title');
  const metaSubEl = document.getElementById('clip-meta-sub');
  const clipModalDurSelect = document.getElementById('clip-modal-duration-select');
  const startSlider = document.getElementById('clip-trim-start-slider');
  const endSlider = document.getElementById('clip-trim-end-slider');
  const startVal = document.getElementById('clip-trim-start-val');
  const endVal = document.getElementById('clip-trim-end-val');
  const durationVal = document.getElementById('clip-trim-duration-val');
  const effectsGrid = document.getElementById('clip-effects-grid');
  const previewBtn = document.getElementById('clip-preview-audio-btn');
  const downloadWavBtn = document.getElementById('clip-download-wav-btn');
  const saveSoundboardBtn = document.getElementById('clip-save-soundboard-btn');
  const broadcastVoiceBtn = document.getElementById('clip-broadcast-voice-btn');

  if (closeBtn) {
    closeBtn.onclick = () => compatibilityContext.closeClipPostModal();
  }

  // Sincroniza seletor de duração do buffer no cabeçalho do modal
  if (clipModalDurSelect) {
    clipModalDurSelect.value = String(compatibilityContext.clipRecorder.getMaxDurationSeconds());
    clipModalDurSelect.onchange = () => {
      const newSec = Number(clipModalDurSelect.value);
      compatibilityContext.clipRecorder.setMaxDurationSeconds(newSec);
      compatibilityContext.syncClipDurationUI(newSec);
      const label = newSec === 0 ? 'Full (Toda a Sessão)' : `${newSec}s`;
      compatibilityContext.showToast(`⏱️ Buffer de gravação alterado para ${label}`, 'info');
    };
  }

  // Seção 1: Download do Vídeo Original
  if (downloadVideoBtn) {
    downloadVideoBtn.onclick = () => {
      if (!compatibilityContext.activeClipBlob) return;
      try {
        const url = URL.createObjectURL(compatibilityContext.activeClipBlob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = compatibilityContext.activeClipBlob.fileName || `SeeMyGame-Clip-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1500);
      } catch (err) {
        console.warn('Falha no download manual do vídeo:', err);
      }
    };
  }

  // Renderiza a grade de efeitos sonoros engraçados
  if (effectsGrid) {
    effectsGrid.innerHTML = '';
    compatibilityContext.AUDIO_MEME_EFFECTS.forEach(eff => {
      const chip = document.createElement('div');
      chip.className = `clip-effect-chip ${eff.id === compatibilityContext.activeEffectId ? 'active' : ''}`;
      chip.dataset.effectId = eff.id;
      chip.title = eff.desc;
      chip.innerHTML = `
        <span class="icon">${eff.icon}</span>
        <span class="name">${eff.name}</span>
        <span class="desc">${eff.desc}</span>
      `;
      chip.onclick = () => {
        compatibilityContext.activeEffectId = eff.id;
        effectsGrid.querySelectorAll('.clip-effect-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        if (compatibilityContext.currentPreviewController && previewBtn) {
          compatibilityContext.currentPreviewController.stop();
          compatibilityContext.currentPreviewController = null;
          previewBtn.innerHTML = '<span>🎧</span> Ouvir Prévia';
        }
      };
      effectsGrid.appendChild(chip);
    });
  }

  // Atualização dos sliders de trimming
  const updateTrimLabels = () => {
    let start = parseFloat(startSlider?.value) || 0;
    let end = parseFloat(endSlider?.value) || 3;
    if (start >= end) {
      start = Math.max(0, end - 0.2);
      if (startSlider) startSlider.value = start.toFixed(1);
    }
    const dur = Math.max(0.1, end - start);
    if (startVal) startVal.textContent = `${start.toFixed(1)}s`;
    if (endVal) endVal.textContent = `${end.toFixed(1)}s`;
    if (durationVal) durationVal.textContent = `${dur.toFixed(1)}s`;
  };

  if (startSlider) startSlider.oninput = updateTrimLabels;
  if (endSlider) endSlider.oninput = updateTrimLabels;

  // Botões de atalho rápido (presets de range dinâmicos)
  const presetBtns = modal.querySelectorAll('.btn-preset-quick');
  presetBtns.forEach(btn => {
    btn.onclick = () => {
      const maxDur = compatibilityContext.activeAudioBuffer?.duration || 30;
      const type = btn.dataset.presetRange;
      if (type === 'first3') {
        if (startSlider) startSlider.value = 0;
        if (endSlider) endSlider.value = Math.min(3, maxDur).toFixed(1);
      } else if (type === 'last3') {
        if (startSlider) startSlider.value = Math.max(0, maxDur - 3).toFixed(1);
        if (endSlider) endSlider.value = maxDur.toFixed(1);
      } else if (type === 'last5') {
        if (startSlider) startSlider.value = Math.max(0, maxDur - 5).toFixed(1);
        if (endSlider) endSlider.value = maxDur.toFixed(1);
      } else if (type === 'last10') {
        if (startSlider) startSlider.value = Math.max(0, maxDur - 10).toFixed(1);
        if (endSlider) endSlider.value = maxDur.toFixed(1);
      } else if (type === 'all') {
        if (startSlider) startSlider.value = 0;
        if (endSlider) endSlider.value = maxDur.toFixed(1);
      }
      updateTrimLabels();
    };
  });

  // Decodifica a trilha de áudio do Blob
  if (statusPill) {
    statusPill.textContent = '⏳ Decodificando áudio...';
    statusPill.classList.remove('ready');
  }

  const audioCtx = compatibilityContext.getAudioContext();
  try {
    compatibilityContext.activeAudioBuffer = await compatibilityContext.decodeAudioFromBlob(clipBlob, audioCtx);
  } catch (err) {
    console.warn('[AudioMeme] Erro ao decodificar áudio:', err);
    compatibilityContext.activeAudioBuffer = null;
  }

  if (compatibilityContext.activeAudioBuffer) {
    const totalDuration = compatibilityContext.activeAudioBuffer.duration || (compatibilityContext.activeAudioBuffer.length / compatibilityContext.activeAudioBuffer.sampleRate);
    const formatDur = (sec) => {
      if (!sec || isNaN(sec)) return '30s';
      if (sec >= 60) {
        const m = Math.floor(sec / 60);
        const s = Math.round(sec % 60);
        return s > 0 ? `${m}m ${s}s` : `${m}m`;
      }
      return `${Math.round(sec)}s`;
    };
    const durLabel = formatDur(totalDuration);
    if (titleEl) titleEl.textContent = `Clip Gravado! (${durLabel})`;
    if (metaSubEl) metaSubEl.textContent = `Últimos ${durLabel} da transmissão capturados em alta fluidez`;

    if (statusPill) {
      statusPill.textContent = '✓ Pronto para recortar';
      statusPill.classList.add('ready');
    }
    if (startSlider) {
      startSlider.min = '0';
      startSlider.max = totalDuration.toFixed(1);
      startSlider.step = totalDuration > 60 ? '0.5' : '0.1';
      startSlider.value = Math.max(0, totalDuration - Math.min(5.0, totalDuration)).toFixed(1);
    }
    if (endSlider) {
      endSlider.min = '0';
      endSlider.max = totalDuration.toFixed(1);
      endSlider.step = totalDuration > 60 ? '0.5' : '0.1';
      endSlider.value = totalDuration.toFixed(1);
    }
    updateTrimLabels();
  } else {
    if (statusPill) {
      statusPill.textContent = 'Trilha de áudio silenciosa ou ausente';
      statusPill.classList.remove('ready');
    }
  }

  // Ouvir Prévia
  if (previewBtn) {
    previewBtn.onclick = async () => {
      if (compatibilityContext.currentPreviewController) {
        compatibilityContext.currentPreviewController.stop();
        compatibilityContext.currentPreviewController = null;
        previewBtn.innerHTML = '<span>🎧</span> Ouvir Prévia';
        return;
      }

      if (!compatibilityContext.activeAudioBuffer) {
        compatibilityContext.showToast('Nenhuma trilha de áudio disponível no clipe.', 'warning');
        return;
      }

      const prevText = previewBtn.innerHTML;
      previewBtn.innerHTML = '<span>⏳</span> Processando...';
      try {
        const startSec = parseFloat(startSlider?.value) || 0;
        const endSec = parseFloat(endSlider?.value) || compatibilityContext.activeAudioBuffer.duration;
        const trimmed = compatibilityContext.trimAudioBuffer(compatibilityContext.activeAudioBuffer, startSec, endSec, audioCtx);
        const processed = await compatibilityContext.applyMemeEffect(trimmed, compatibilityContext.activeEffectId, audioCtx);
        compatibilityContext.currentPreviewController = compatibilityContext.playAudioBuffer(processed, audioCtx);
        previewBtn.innerHTML = '<span>⏹️</span> Parar Prévia';

        const playDurationMs = (processed.duration || (processed.length / processed.sampleRate)) * 1000;
        setTimeout(() => {
          if (compatibilityContext.currentPreviewController) {
            compatibilityContext.currentPreviewController = null;
            previewBtn.innerHTML = '<span>🎧</span> Ouvir Prévia';
          }
        }, playDurationMs + 200);
      } catch (err) {
        console.error('Erro ao tocar prévia:', err);
        compatibilityContext.showToast('Erro ao reproduzir prévia do áudio meme.', 'error');
        previewBtn.innerHTML = prevText;
      }
    };
  }

  // Baixar Áudio (.wav)
  if (downloadWavBtn) {
    downloadWavBtn.onclick = async () => {
      if (!compatibilityContext.activeAudioBuffer) {
        compatibilityContext.showToast('Nenhuma trilha de áudio disponível para exportar.', 'warning');
        return;
      }

      const prevText = downloadWavBtn.innerHTML;
      downloadWavBtn.disabled = true;
      downloadWavBtn.innerHTML = '<span>⏳</span> Exportando WAV...';
      try {
        const startSec = parseFloat(startSlider?.value) || 0;
        const endSec = parseFloat(endSlider?.value) || compatibilityContext.activeAudioBuffer.duration;
        const trimmed = compatibilityContext.trimAudioBuffer(compatibilityContext.activeAudioBuffer, startSec, endSec, audioCtx);
        const processed = await compatibilityContext.applyMemeEffect(trimmed, compatibilityContext.activeEffectId, audioCtx);
        const wavBlob = compatibilityContext.audioBufferToWavBlob(processed);

        const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `SeeMyGame-Meme-${compatibilityContext.activeEffectId}-${dateStr}.wav`;

        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1500);

        compatibilityContext.showToast(`Áudio meme salvo: ${fileName}!`, 'success');
      } catch (err) {
        console.error('Erro ao baixar WAV:', err);
        compatibilityContext.showToast('Erro ao converter áudio em WAV.', 'error');
      } finally {
        downloadWavBtn.disabled = false;
        downloadWavBtn.innerHTML = prevText;
      }
    };
  }

  // Salvar no Soundboard do SeeMyGame
  if (saveSoundboardBtn) {
    saveSoundboardBtn.onclick = async () => {
      if (!compatibilityContext.activeAudioBuffer) {
        compatibilityContext.showToast('Nenhuma trilha de áudio disponível para salvar no soundboard.', 'warning');
        return;
      }

      const prevText = saveSoundboardBtn.innerHTML;
      saveSoundboardBtn.disabled = true;
      saveSoundboardBtn.innerHTML = '<span>⏳</span> Salvando...';
      try {
        const startSec = parseFloat(startSlider?.value) || 0;
        const endSec = parseFloat(endSlider?.value) || compatibilityContext.activeAudioBuffer.duration;
        const trimmed = compatibilityContext.trimAudioBuffer(compatibilityContext.activeAudioBuffer, startSec, endSec, audioCtx);
        const processed = await compatibilityContext.applyMemeEffect(trimmed, compatibilityContext.activeEffectId, audioCtx);
        const wavBlob = compatibilityContext.audioBufferToWavBlob(processed);
        const base64 = await compatibilityContext.wavBlobToBase64(wavBlob);

        const effectObj = compatibilityContext.AUDIO_MEME_EFFECTS.find(e => e.id === compatibilityContext.activeEffectId);
        const defaultName = effectObj && effectObj.id !== 'none' ? `Meme ${effectObj.name}` : 'Meme Clip';
        const promptName = typeof prompt === 'function' ? prompt('Dê um nome para este meme no Soundboard do SeeMyGame:', defaultName) : defaultName;
        const finalName = (promptName && promptName.trim()) || defaultName;

        const savedSound = compatibilityContext.soundboardManager.addCustomSound({
          name: finalName,
          audioBase64: base64,
          icon: effectObj?.icon || '🎙️',
          duration: processed.duration
        });

        compatibilityContext.showToast(`⭐ Som "${savedSound.name}" salvo no Soundboard do SeeMyGame!`, 'success', 3500);
      } catch (err) {
        console.error('Erro ao salvar no soundboard:', err);
        compatibilityContext.showToast('Erro ao salvar áudio no Soundboard.', 'error');
      } finally {
        saveSoundboardBtn.disabled = false;
        saveSoundboardBtn.innerHTML = prevText;
      }
    };
  }

  // Tocar na Sala de Voz
  if (broadcastVoiceBtn) {
    broadcastVoiceBtn.onclick = async () => {
      if (!compatibilityContext.activeAudioBuffer) {
        compatibilityContext.showToast('Nenhum áudio disponível para transmitir.', 'warning');
        return;
      }

      const prevText = broadcastVoiceBtn.innerHTML;
      broadcastVoiceBtn.disabled = true;
      broadcastVoiceBtn.innerHTML = '<span>⏳</span> Transmitindo...';
      try {
        const startSec = parseFloat(startSlider?.value) || 0;
        const endSec = parseFloat(endSlider?.value) || compatibilityContext.activeAudioBuffer.duration;
        const trimmed = compatibilityContext.trimAudioBuffer(compatibilityContext.activeAudioBuffer, startSec, endSec, audioCtx);
        const processed = await compatibilityContext.applyMemeEffect(trimmed, compatibilityContext.activeEffectId, audioCtx);
        const wavBlob = compatibilityContext.audioBufferToWavBlob(processed);
        const base64 = await compatibilityContext.wavBlobToBase64(wavBlob);

        const isHost = !window.location.pathname.endsWith('viewer.html');
        const coopState = compatibilityContext.getCoopState();
        const senderName = isHost ? 'Streamer' : (coopState.isPlayer2 ? 'Player 2' : `Amigo ${compatibilityContext.myId ? compatibilityContext.myId.slice(0, 4) : ''}`);
        const effectObj = compatibilityContext.AUDIO_MEME_EFFECTS.find(e => e.id === compatibilityContext.activeEffectId);
        const effectName = effectObj ? `${effectObj.icon} ${effectObj.name}` : 'Meme';

        compatibilityContext.broadcastDataMessage({
          type: 'SOUNDBOARD_PLAY_CUSTOM',
          audioBase64: base64,
          effectName,
          senderName
        });

        // Reproduz localmente para o próprio usuário escutar também
        compatibilityContext.playAudioBuffer(processed, audioCtx);

        compatibilityContext.showToast(`Áudio meme (${effectName}) transmitido para a sala de voz!`, 'success');
      } catch (err) {
        console.error('Erro ao transmitir áudio meme:', err);
        compatibilityContext.showToast('Erro ao transmitir áudio para a sala de voz.', 'error');
      } finally {
        broadcastVoiceBtn.disabled = false;
        broadcastVoiceBtn.innerHTML = prevText;
      }
    };
  }
}
