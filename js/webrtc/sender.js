/** sender: commands receive explicit compatibility ports; no page initialization. */
export function applyTransceiverOptimizations(pc, latencyMode = 'ultra-low', preferredCodec = 'h264') {
  if (!pc || !pc.getTransceivers) return;

  try {
    const transceivers = pc.getTransceivers();
    const hasAudio = transceivers.some((t) => 
      (t.sender && t.sender.track && t.sender.track.kind === 'audio') ||
      (t.receiver && t.receiver.track && t.receiver.track.kind === 'audio') ||
      (t.mid && t.mid.toLowerCase().includes('audio'))
    );

    transceivers.forEach((t) => {
      // IMPORTANTE: Só aplica preferências de codecs de VÍDEO se o transceiver NÃO for explicitamente de áudio
      const isAudio = (t.sender && t.sender.track && t.sender.track.kind === 'audio') ||
                      (t.receiver && t.receiver.track && t.receiver.track.kind === 'audio') ||
                      (t.mid && t.mid.toLowerCase().includes('audio'));

      // Ajuste de Jitter Buffer do receptor:
      // Em modo ultra-low latency, áudio e vídeo operam com alvo 0 para minimizar tempo de residência e descarte por A/V sync.
      if (t.receiver) {
        const targetMs = latencyMode === 'stable' ? 50 : (latencyMode === 'smooth' ? 25 : 0);
        const targetSec = latencyMode === 'stable' ? 0.05 : 0;
        if ('jitterBufferTarget' in t.receiver) t.receiver.jitterBufferTarget = targetMs;
        if ('playoutDelayHint' in t.receiver) t.receiver.playoutDelayHint = targetSec;
      }

      if (!isAudio && t.sender && RTCRtpSender.getCapabilities) {
        const capabilities = RTCRtpSender.getCapabilities('video');
        if (capabilities && capabilities.codecs) {
          const codecMime = preferredCodec === 'av1' ? 'video/av1'
            : (preferredCodec === 'hevc' || preferredCodec === 'h265') ? 'video/h265'
            : 'video/h264';
          let prioritized = capabilities.codecs.filter(c => c.mimeType.toLowerCase() === codecMime);
          // Fallback para H264 se o codec desejado não estiver presente na engine
          if (prioritized.length === 0 && codecMime !== 'video/h264') {
            prioritized = capabilities.codecs.filter(c => c.mimeType.toLowerCase() === 'video/h264');
          }
          const others = capabilities.codecs.filter(c => !prioritized.includes(c));
          if (prioritized.length > 0 && 'setCodecPreferences' in t) {
            try {
              t.setCodecPreferences([...prioritized, ...others]);
            } catch (e) {
              // Silencia erros caso a engine rejeite lista específica
            }
          }
        }
      }
    });
  } catch (err) {
    console.warn('Erro em applyTransceiverOptimizations:', err);
  }
}

export async function applySenderOptimizations(pc, bitrateBps, fps = 60, scaleResolutionDownBy = 1) {
  if (!pc) return false;

  let applied = false;
  try {
    const senders = pc.getSenders ? pc.getSenders() : [];
    for (const sender of senders) {
      if (sender.track && sender.track.kind === 'video') {
        sender.track.contentHint = 'motion';

        const params = sender.getParameters ? sender.getParameters() : {};
        if (!params.encodings || params.encodings.length === 0) {
          // Os encodings ainda não foram negociados pelo navegador.
          continue;
        }

        // Prioriza taxa de quadros (maintain-framerate)
        params.degradationPreference = 'maintain-framerate';
        params.encodings[0].maxFramerate = fps;
        params.encodings[0].maxBitrate = bitrateBps;
        params.encodings[0].priority = 'high';
        params.encodings[0].networkPriority = 'high';

        // Escala de resolução dinâmica no encoder (essencial para getDisplayMedia onde applyConstraints falha)
        if (scaleResolutionDownBy && scaleResolutionDownBy > 1) {
          params.encodings[0].scaleResolutionDownBy = scaleResolutionDownBy;
        } else if ('scaleResolutionDownBy' in params.encodings[0]) {
          params.encodings[0].scaleResolutionDownBy = 1;
        }

        if (sender.setParameters) {
          await sender.setParameters(params);
          applied = true;
        }
        console.log(`[FPS Target] Alvo: ${fps} FPS | Bitrate: ${(bitrateBps / 1000000).toFixed(1)} Mbps | Escala: ${scaleResolutionDownBy || 1}x`);
      }
    }
    return applied;
  } catch (err) {
    console.warn('Erro ao aplicar parâmetros no sender:', err);
    return false;
  }
}

export function applySenderOptimizationsWhenReady(pc, getBitrateBps, getFps = 60, getScaleFactor = 1) {
  if (!pc) return () => {};

  let cancelled = false;
  let retryTimer = null;

  const tryApply = async () => {
    if (cancelled || !pc || pc.connectionState === 'closed') {
      cleanup();
      return;
    }
    const bitrate = typeof getBitrateBps === 'function' ? getBitrateBps() : getBitrateBps;
    const fps = typeof getFps === 'function' ? getFps() : getFps;
    const scale = typeof getScaleFactor === 'function' ? getScaleFactor() : getScaleFactor;

    try {
      const ok = await applySenderOptimizations(pc, bitrate, fps, scale);
      if (ok) {
        cleanup();
      }
    } catch (_) {}
  };

  const cleanup = () => {
    cancelled = true;
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
    if (typeof pc.removeEventListener === 'function') {
      pc.removeEventListener('signalingstatechange', onSignaling);
      pc.removeEventListener('connectionstatechange', onConnection);
    }
  };

  const onSignaling = () => {
    if (pc.signalingState === 'stable') {
      tryApply();
    }
  };

  const onConnection = () => {
    if (pc.connectionState === 'connected') {
      tryApply();
    } else if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
      cleanup();
    }
  };

  if (typeof pc.addEventListener === 'function') {
    pc.addEventListener('signalingstatechange', onSignaling);
    pc.addEventListener('connectionstatechange', onConnection);
  }

  let attempts = 0;
  retryTimer = setInterval(() => {
    attempts++;
    if (attempts > 30 || cancelled) {
      cleanup();
      return;
    }
    tryApply();
  }, 400);

  tryApply();

  return cleanup;
}

export async function updateSenderBitrate(pc, bitrateBps) {
  if (!pc || typeof pc.getSenders !== 'function') return false;
  try {
    const senders = pc.getSenders();
    for (const sender of senders) {
      if (sender.track && sender.track.kind === 'video' && sender.setParameters) {
        const params = sender.getParameters ? sender.getParameters() : {};
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = bitrateBps;
        await sender.setParameters(params);
        return true;
      }
    }
    return false;
  } catch (err) {
    console.warn('[ABR] Falha ao atualizar bitrate no sender:', err);
    return false;
  }
}

export async function swapStreamAudioTrack(pc, newTrack = null) {
  if (!pc) return false;

  try {
    const senders = pc.getSenders ? pc.getSenders() : [];
    let audioSender = senders.find(s => s.track && s.track.kind === 'audio');

    // Se não encontrou sender com track de áudio ativa, procura transceiver de áudio
    if (!audioSender && pc.getTransceivers) {
      const transceivers = pc.getTransceivers();
      const audioTransceiver = transceivers.find(t => 
        (t.sender && t.sender.track && t.sender.track.kind === 'audio') ||
        (t.receiver && t.receiver.track && t.receiver.track.kind === 'audio') ||
        (t.mid && t.mid.toLowerCase().includes('audio'))
      );
      if (audioTransceiver && audioTransceiver.sender) {
        audioSender = audioTransceiver.sender;
      }
    }

    // Se ainda não encontrou, tenta qualquer sender sem track ou cujo tipo seja áudio
    if (!audioSender) {
      audioSender = senders.find(s => !s.track);
    }

    if (audioSender && typeof audioSender.replaceTrack === 'function') {
      await audioSender.replaceTrack(newTrack);
      console.log(`[Audio Swap] Trilha de áudio substituída: ${newTrack ? (newTrack.label || newTrack.id) : 'Nenhuma (Mudo)'}`);
      return true;
    } else {
      console.warn('[Audio Swap] Nenhum RTCRtpSender de áudio disponível para substituição.');
      return false;
    }
  } catch (err) {
    console.error('[Audio Swap] Erro ao trocar trilha de áudio:', err);
    return false;
  }
}
