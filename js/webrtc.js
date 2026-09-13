// ==========================================
// MOTOR DE PRIORIDADE DE FPS & ZERO LAG
// ==========================================

/**
 * Injeta parâmetros no SDP de forma segura (Sem estourar buffers)
 * @param {string} sdp
 * @param {number} bitrateBps
 * @returns {string}
 */
export function tuneSdpForGaming(sdp, bitrateBps) {
  if (!sdp) return sdp;

  let lines = sdp.split('\r\n');
  let newLines = [];
  let inAudio = false;
  let inVideo = false;
  const kbps = Math.round(bitrateBps / 1000);

  let opusPayload = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (line.startsWith('m=audio')) {
      inAudio = true;
      inVideo = false;
    } else if (line.startsWith('m=video')) {
      inVideo = true;
      inAudio = false;
    }

    // Detecta o payload type do Opus
    if (inAudio && line.startsWith('a=rtpmap:') && line.toLowerCase().includes('opus')) {
      const match = line.match(/^a=rtpmap:(\d+)\s+opus/i);
      if (match) opusPayload = match[1];
    }

    // 1. ÁUDIO OPUS GAMER: Estéreo Real 128 kbps CBR
    if (inAudio && line.startsWith('a=fmtp:') && (line.includes('opus') || (opusPayload && line.startsWith(`a=fmtp:${opusPayload}`)))) {
      if (!line.includes('stereo=1')) {
        line += ';stereo=1;sprop-stereo=1;maxaveragebitrate=128000;cbr=1;usedtx=0;maxplaybackrate=48000';
      }
    }

    // 2. VÍDEO COM PISO DE BITRATE SEGURO: Evita descarte de quadros na fila do encoder
    if (inVideo && line.startsWith('a=fmtp:') && (line.includes('42e01f') || line.includes('packetization-mode=1') || line.includes('H264'))) {
      if (!line.includes('x-google-min-bitrate')) {
        const minK = 1000; // Piso seguro para nunca travar frames em oscilações
        const startK = Math.max(2500, Math.round(kbps * 0.7));
        const maxK = Math.round(kbps * 1.3);
        line += `;x-google-min-bitrate=${minK};x-google-start-bitrate=${startK};x-google-max-bitrate=${maxK}`;
      }
    }

    newLines.push(line);

    // Insere limites b=AS / b=TIAS na seção de vídeo
    if (line.startsWith('m=video') && !sdp.includes('b=AS:')) {
      newLines.push(`b=AS:${kbps}`);
      newLines.push(`b=TIAS:${bitrateBps}`);
    }
  }

  return newLines.join('\r\n');
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
 * Otimiza Transceivers, prioriza H.264 acelerado por GPU e zera Jitter Buffer
 * @param {RTCPeerConnection} pc
 */
export function applyTransceiverOptimizations(pc) {
  if (!pc || !pc.getTransceivers) return;

  try {
    const transceivers = pc.getTransceivers();
    transceivers.forEach((t) => {
      if (t.receiver) {
        if ('jitterBufferTarget' in t.receiver) t.receiver.jitterBufferTarget = 0;
        if ('playoutDelayHint' in t.receiver) t.receiver.playoutDelayHint = 0;
      }

      if (t.sender && RTCRtpSender.getCapabilities) {
        const capabilities = RTCRtpSender.getCapabilities('video');
        if (capabilities && capabilities.codecs) {
          const h264Codecs = capabilities.codecs.filter(c => c.mimeType.toLowerCase() === 'video/h264');
          const otherCodecs = capabilities.codecs.filter(c => c.mimeType.toLowerCase() !== 'video/h264');
          if (h264Codecs.length > 0 && 'setCodecPreferences' in t) {
            try {
              t.setCodecPreferences([...h264Codecs, ...otherCodecs]);
            } catch (e) {}
          }
        }
      }
    });
  } catch (err) {
    console.warn('Erro em applyTransceiverOptimizations:', err);
  }
}

/**
 * CRUCIAL: Trava de 60 FPS com degradationPreference = 'maintain-framerate'
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

        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }

        // NUNCA descarta FPS para manter resolução!
        params.degradationPreference = 'maintain-framerate';
        params.encodings[0].maxFramerate = fps;
        params.encodings[0].maxBitrate = bitrateBps;
        params.encodings[0].priority = 'high';
        params.encodings[0].networkPriority = 'high';

        await sender.setParameters(params);
        console.log(`[FPS Lock] 60 FPS travado | Bitrate: ${(bitrateBps / 1000000).toFixed(1)} Mbps`);
      }
    }
  } catch (err) {
    console.warn('Erro ao aplicar parâmetros no sender:', err);
  }
}
