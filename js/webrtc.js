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

      // Ajusta parâmetros fmtp de vídeo H.264
      const modifiedLines = filtered.map((line) => {
        if (line.startsWith('a=fmtp:') && (line.includes('42e01f') || line.includes('packetization-mode=1') || line.includes('H264'))) {
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
              paramMap.set(trimmed.substring(0, eqIdx).trim(), trimmed.substring(eqIdx + 1).trim());
            } else {
              paramMap.set(trimmed, '');
            }
          });

          const minK = 1000;
          const startK = Math.max(2500, Math.round(kbps * 0.7));
          const maxK = Math.round(kbps * 1.3);

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
export function applyTransceiverOptimizations(pc, latencyMode = 'ultra-low') {
  if (!pc || !pc.getTransceivers) return;

  try {
    const transceivers = pc.getTransceivers();
    transceivers.forEach((t) => {
      // Ajuste de Jitter Buffer do receptor
      if (t.receiver) {
        const target = latencyMode === 'stable' ? 0.05 : 0;
        if ('jitterBufferTarget' in t.receiver) t.receiver.jitterBufferTarget = target;
        if ('playoutDelayHint' in t.receiver) t.receiver.playoutDelayHint = target;
      }

      // IMPORTANTE: Só aplica preferências de codecs de VÍDEO se o transceiver NÃO for explicitamente de áudio
      const isAudio = (t.sender && t.sender.track && t.sender.track.kind === 'audio') ||
                      (t.receiver && t.receiver.track && t.receiver.track.kind === 'audio') ||
                      (t.mid && t.mid.toLowerCase().includes('audio'));

      if (!isAudio && t.sender && RTCRtpSender.getCapabilities) {
        const capabilities = RTCRtpSender.getCapabilities('video');
        if (capabilities && capabilities.codecs) {
          const h264Codecs = capabilities.codecs.filter(c => c.mimeType.toLowerCase() === 'video/h264');
          const otherCodecs = capabilities.codecs.filter(c => c.mimeType.toLowerCase() !== 'video/h264');
          if (h264Codecs.length > 0 && 'setCodecPreferences' in t) {
            try {
              t.setCodecPreferences([...h264Codecs, ...otherCodecs]);
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
 * Configurações de prioridade de framerate no Sender (Alvo de 60 FPS)
 * @param {RTCPeerConnection} pc
 * @param {number} bitrateBps
 * @param {number} fps
 */
export async function applySenderOptimizations(pc, bitrateBps, fps = 60) {
  if (!pc) return;

  try {
    const senders = pc.getSenders ? pc.getSenders() : [];
    for (const sender of senders) {
      if (sender.track && sender.track.kind === 'video') {
        sender.track.contentHint = 'motion';

        const params = sender.getParameters ? sender.getParameters() : {};
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }

        // Prioriza taxa de quadros (maintain-framerate)
        params.degradationPreference = 'maintain-framerate';
        params.encodings[0].maxFramerate = fps;
        params.encodings[0].maxBitrate = bitrateBps;
        params.encodings[0].priority = 'high';
        params.encodings[0].networkPriority = 'high';

        if (sender.setParameters) {
          await sender.setParameters(params);
        }
        console.log(`[FPS Target] Alvo: ${fps} FPS | Bitrate: ${(bitrateBps / 1000000).toFixed(1)} Mbps`);
      }
    }
  } catch (err) {
    console.warn('Erro ao aplicar parâmetros no sender:', err);
  }
}
