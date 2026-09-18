// ==========================================
// MOTOR DE PRIORIDADE DE FPS & BAIXA LATÊNCIA
// ==========================================

/**
 * Injeta parâmetros no SDP de forma segura e conforme com a RFC 8866
 * (b=AS e b=TIAS posicionados após c= e sem duplicação de atributos)
 * @param {string} sdp
 * @param {number} bitrateBps
 * @returns {string}
 */
export function tuneSdpForGaming(sdp, bitrateBps) {
  if (!sdp) return sdp;

  const lines = sdp.split(/\r?\n/);
  const kbps = Math.round(bitrateBps / 1000);

  // Divide o SDP em blocos: sessão global e seções m=
  const sections = [];
  let currentSection = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('m=')) {
      if (currentSection.length > 0) {
        sections.push(currentSection);
      }
      currentSection = [line];
    } else {
      currentSection.push(line);
    }
  }
  if (currentSection.length > 0) {
    sections.push(currentSection);
  }

  // Processa cada bloco independentemente
  const processedSections = sections.map((section) => {
    const header = section[0];
    if (!header) return section;

    // 1. Bloco de Áudio (Opus)
    if (header.startsWith('m=audio')) {
      let opusPt = null;
      for (const line of section) {
        if (line.startsWith('a=rtpmap:') && line.toLowerCase().includes('opus')) {
          const match = line.match(/^a=rtpmap:(\d+)\s+opus/i);
          if (match) opusPt = match[1];
        }
      }

      return section.map((line) => {
        if (line.startsWith('a=fmtp:') && (line.includes('opus') || (opusPt && line.startsWith(`a=fmtp:${opusPt}`)))) {
          // Parse de parâmetros chave-valor do fmtp para evitar duplicações
          const prefixMatch = line.match(/^(a=fmtp:\d+\s+)(.*)$/);
          if (!prefixMatch) return line;

          const prefix = prefixMatch[1];
          const rawParams = prefixMatch[2];
          const paramMap = new Map();

          rawParams.split(';').forEach((pair) => {
            const trimmed = pair.trim();
            if (!trimmed) return;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx !== -1) {
              const k = trimmed.substring(0, eqIdx).trim();
              const v = trimmed.substring(eqIdx + 1).trim();
              paramMap.set(k, v);
            } else {
              paramMap.set(trimmed, '');
            }
          });

          // Define parâmetros Opus Gamer estéreo 128 kbps CBR
          paramMap.set('stereo', '1');
          paramMap.set('sprop-stereo', '1');
          paramMap.set('maxaveragebitrate', '128000');
          paramMap.set('cbr', '1');
          paramMap.set('usedtx', '0');
          paramMap.set('maxplaybackrate', '48000');

          const formattedParams = Array.from(paramMap.entries())
            .map(([k, v]) => (v ? `${k}=${v}` : k))
            .join(';');

          return `${prefix}${formattedParams}`;
        }
        return line;
      });
    }

    // 2. Bloco de Vídeo (H.264 & Limites de Banda RFC 8866)
    if (header.startsWith('m=video')) {
      // Remove quaisquer b=AS ou b=TIAS existentes neste bloco de vídeo
      const filtered = section.filter((l) => !l.startsWith('b=AS:') && !l.startsWith('b=TIAS:'));

      const minK = 1000;
      const startK = Math.max(2500, Math.round(kbps * 0.7));
      const maxK = Math.round(kbps * 1.3);

      // Identifica payload types de H.264 presentes no SDP
      const h264Pts = new Set();
      for (const line of filtered) {
        if (line.startsWith('a=rtpmap:') && line.toLowerCase().includes('h264')) {
          const match = line.match(/^a=rtpmap:(\d+)\s+h264/i);
          if (match) h264Pts.add(match[1]);
        }
      }

      // Ajusta parâmetros fmtp de todos os codecs de vídeo no bloco
      const modifiedLines = filtered.map((line) => {
        if (line.startsWith('a=fmtp:')) {
          const prefixMatch = line.match(/^(a=fmtp:(\d+)\s+)(.*)$/);
          if (!prefixMatch) return line;

          const prefix = prefixMatch[1];
          const pt = prefixMatch[2];
          const rawParams = prefixMatch[3];
          const paramMap = new Map();

          rawParams.split(';').forEach((pair) => {
            const trimmed = pair.trim();
            if (!trimmed) return;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx !== -1) {
              paramMap.set(trimmed.substring(0, eqIdx).trim(), trimmed.substring(eqIdx + 1).trim());
            } else {
              paramMap.set(trimmed, '');
            }
          });

          // Se for H.264 ou contiver parâmetros H.264 conhecidos
          if (h264Pts.has(pt) || line.includes('42e01f') || line.includes('packetization-mode=1') || line.includes('profile-level-id')) {
            paramMap.set('level-asymmetry-allowed', '1');
            paramMap.set('packetization-mode', '1');
          }

          paramMap.set('x-google-min-bitrate', String(minK));
          paramMap.set('x-google-start-bitrate', String(startK));
          paramMap.set('x-google-max-bitrate', String(maxK));

          const formattedParams = Array.from(paramMap.entries())
            .map(([k, v]) => (v ? `${k}=${v}` : k))
            .join(';');

          return `${prefix}${formattedParams}`;
        }
        return line;
      });

      // Posição RFC 8866: linhas b= devem vir logo após c= (ou após m= se c= não existir)
      let insertIdx = -1;
      for (let j = 0; j < modifiedLines.length; j++) {
        if (modifiedLines[j].startsWith('c=')) {
          insertIdx = j + 1;
          break;
        }
      }
      if (insertIdx === -1) {
        insertIdx = 1; // Logo após m=
      }

      const bandwidthLines = [`b=AS:${kbps}`, `b=TIAS:${bitrateBps}`];
      modifiedLines.splice(insertIdx, 0, ...bandwidthLines);
      return modifiedLines;
    }

    return section;
  });

  return processedSections.flat().join('\r\n');
}

/**
 * Intercepta setLocalDescription para injetar o SDP customizado
 * @param {RTCPeerConnection} pc
 * @param {Function|number} getBitrateBps
 */
export function hookPeerConnectionSdp(pc, getBitrateBps) {
  if (!pc || pc._sdpHooked) return;
  pc._sdpHooked = true;

  const originalSetLocal = pc.setLocalDescription.bind(pc);
  pc.setLocalDescription = async function(desc) {
    if (desc && desc.sdp) {
      const bitrate = typeof getBitrateBps === 'function' ? getBitrateBps() : (getBitrateBps || 7500000);
      desc.sdp = tuneSdpForGaming(desc.sdp, bitrate);
    }
    return originalSetLocal(desc);
  };
}

/**
 * Otimiza Transceivers, prioriza H.264 no vídeo e ajusta Jitter Buffer por modo
 * @param {RTCPeerConnection} pc
 * @param {'ultra-low'|'stable'} [latencyMode='ultra-low']
 */
export function applyTransceiverOptimizations(pc, latencyMode = 'ultra-low', preferredCodec = 'h264') {
  if (!pc || !pc.getTransceivers) return;

  try {
    const transceivers = pc.getTransceivers();
    transceivers.forEach((t) => {
      // IMPORTANTE: Só aplica preferências de codecs de VÍDEO se o transceiver NÃO for explicitamente de áudio
      const isAudio = (t.sender && t.sender.track && t.sender.track.kind === 'audio') ||
                      (t.receiver && t.receiver.track && t.receiver.track.kind === 'audio') ||
                      (t.mid && t.mid.toLowerCase().includes('audio'));

      // Ajuste de Jitter Buffer do receptor (vídeo pode operar em 0ms; áudio exige margem mínima de 25ms para evitar estalidos/underrun)
      if (t.receiver) {
        const targetMs = isAudio ? (latencyMode === 'stable' ? 50 : 25) : (latencyMode === 'stable' ? 50 : 0);
        const targetSec = isAudio ? (latencyMode === 'stable' ? 0.05 : 0.025) : (latencyMode === 'stable' ? 0.05 : 0);
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

/**
 * Configurações de prioridade de framerate no Sender (Alvo de 60 FPS) e escala de resolução
 * @param {RTCPeerConnection} pc
 * @param {number} bitrateBps
 * @param {number} [fps=60]
 * @param {number} [scaleResolutionDownBy=1]
 * @returns {Promise<boolean>} Retorna true se os parâmetros foram aplicados com sucesso
 */
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

/**
 * Aplica parâmetros de alta fluidez no RTCRtpSender assim que a conexão WebRTC estiver negociada e estável
 * @param {RTCPeerConnection} pc
 * @param {Function|number} getBitrateBps
 * @param {Function|number} [getFps=60]
 * @param {Function|number} [getScaleFactor=1]
 * @returns {Function} Função de cancelamento / cleanup
 */
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

/**
 * Atualiza o bitrate máximo do sender de vídeo dinamicamente sem interromper a transmissão
 * @param {RTCPeerConnection} pc
 * @param {number} bitrateBps
 * @returns {Promise<boolean>}
 */
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

/**
 * Substitui ou remove a trilha de áudio em tempo real sem renegociação SDP
 * @param {RTCPeerConnection} pc
 * @param {MediaStreamTrack|null} newTrack
 * @returns {Promise<boolean>}
 */
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
