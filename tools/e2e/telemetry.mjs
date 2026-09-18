// Injected only into isolated E2E browser contexts. Never ships with dist.
export function installTelemetry({ expectedSessionMagic = null } = {}) {
  const Base = window.RTCPeerConnection;
  const peers = [];
  window.RTCPeerConnection = class extends Base {
    constructor(...args) {
      super(...args);
      peers.push(this);
    }
  };

  const fields = [
    'type', 'id', 'kind', 'codecId', 'mimeType', 'ssrc', 'trackIdentifier',
    'encoderImplementation', 'decoderImplementation', 'powerEfficientEncoder',
    'powerEfficientDecoder', 'timestamp', 'bytesSent', 'bytesReceived',
    'framesEncoded', 'framesDecoded', 'framesReceived', 'framesDropped',
    'framesPerSecond', 'frameWidth', 'frameHeight', 'totalEncodeTime',
    'totalDecodeTime', 'totalPacketSendDelay', 'packetsSent', 'packetsReceived',
    'packetsLost', 'jitter', 'jitterBufferDelay', 'jitterBufferEmittedCount',
    'freezeCount', 'totalFreezesDuration', 'nackCount', 'pliCount',
    'qualityLimitationReason', 'qualityLimitationDurations',
    'selectedCandidatePairId', 'currentRoundTripTime', 'availableOutgoingBitrate',
    'localCandidateId', 'remoteCandidateId', 'candidateType', 'protocol', 'state', 'nominated'
  ];

  function crc16(bytes) {
    let crc = 0xFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= (bytes[i] << 8);
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
          crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
        } else {
          crc = (crc << 1) & 0xFFFF;
        }
      }
    }
    return crc;
  }

  function decodeMarkerAt(rgba, width, height, startX, y, blockW, expectedMagicNum) {
    const totalBits = 96;
    if (startX + totalBits * blockW > width || y >= height || startX < 0 || y < 0) return null;

    const lum = idx => {
      const off = (y * width + idx) * 4;
      return 0.299 * rgba[off] + 0.587 * rgba[off + 1] + 0.114 * rgba[off + 2];
    };

    const p0 = lum(Math.floor(startX + 0.5 * blockW));
    const p1 = lum(Math.floor(startX + 1.5 * blockW));
    const p2 = lum(Math.floor(startX + 2.5 * blockW));
    const p3 = lum(Math.floor(startX + 3.5 * blockW));
    const p4 = lum(Math.floor(startX + 4.5 * blockW));
    const p5 = lum(Math.floor(startX + 5.5 * blockW));
    const p6 = lum(Math.floor(startX + 6.5 * blockW));
    const p7 = lum(Math.floor(startX + 7.5 * blockW));

    const whiteAvg = (p0 + p2 + p4 + p5) / 4;
    const blackAvg = (p1 + p3 + p6 + p7) / 4;
    if (whiteAvg - blackAvg < 50) return null;
    if (whiteAvg < 110 || blackAvg > 110) return null;

    const threshold = (whiteAvg + blackAvg) / 2;
    const bits = [];
    for (let i = 0; i < totalBits; i++) {
      const sx = Math.floor(startX + (i + 0.5) * blockW);
      if (sx >= width) return null;
      bits.push(lum(sx) >= threshold ? 1 : 0);
    }
    if (bits.length < totalBits) return null;

    // Valida preâmbulo [1, 0, 1, 0, 1, 1, 0, 0]
    if (
      bits[0] !== 1 || bits[1] !== 0 || bits[2] !== 1 || bits[3] !== 0 ||
      bits[4] !== 1 || bits[5] !== 1 || bits[6] !== 0 || bits[7] !== 0
    ) {
      return null;
    }

    let magic = 0; for (let i = 8; i < 24; i++) magic = (magic << 1) | bits[i];
    if (expectedMagicNum != null && magic !== expectedMagicNum) return null;

    let seq = 0; for (let i = 24; i < 48; i++) seq = (seq << 1) | bits[i];
    let time = 0; for (let i = 48; i < 80; i++) time = ((time << 1) | bits[i]) >>> 0;
    let checksum = 0; for (let i = 80; i < 96; i++) checksum = (checksum << 1) | bits[i];

    const payload = [
      (magic >> 8) & 0xFF,
      magic & 0xFF,
      (seq >> 16) & 0xFF,
      (seq >> 8) & 0xFF,
      seq & 0xFF,
      (time >>> 24) & 0xFF,
      (time >>> 16) & 0xFF,
      (time >>> 8) & 0xFF,
      time & 0xFF
    ];
    if (checksum === crc16(payload)) {
      return {
        frameSeq: seq,
        sourceTimeMs: time,
        sessionMagic: magic,
        detectedBlockWidth: blockW,
        startX,
        y
      };
    }
    return null;
  }

  function decodeOptical(rgba, width, height, candidateBlockWidths = [8, 10, 12, 16], expectedMagic = null) {
    const totalBits = 96; // 8 preamble + 16 magic + 24 seq + 32 time + 16 crc
    const expectedMagicNum = expectedMagic != null ? expectedMagic & 0xFFFF : null;

    for (const blockW of candidateBlockWidths) {
      const totalW = totalBits * blockW;
      if (totalW + 4 > width) continue;

      const maxX = Math.min(width - totalW, 120);
      const maxY = Math.min(height - 16, 160);

      for (let y = Math.max(2, Math.floor(16 * 0.4)); y <= maxY; y += 3) {
        for (let startX = 0; startX <= maxX; startX += 2) {
          const res = decodeMarkerAt(rgba, width, height, startX, y, blockW, expectedMagicNum);
          if (res) return res;
        }
      }
    }
    return null;
  }

  function hookVideo(video) {
    if (video.__smgHooked) return;
    video.__smgHooked = true;

    // Canvas full para detecção inicial / fallback (1920x200)
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = 1920;
    fullCanvas.height = 200;
    const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });

    // Canvas dedicado para ROI restrita de ultra-baixo overhead (<1ms)
    const roiCanvas = document.createElement('canvas');
    roiCanvas.width = 1200;
    roiCanvas.height = 64;
    const roiCtx = roiCanvas.getContext('2d', { willReadFrequently: true });

    let lastRoi = null; // { startX, y, blockW }
    let lastSeq = -1;
    let lastSuccessfulWidth = null;
    let lastCallbackTime = performance.now();
    let lastOpticalAnalysisTime = 0;
    const opticalIntervalMs = 125; // ~8 amostras ópticas por segundo para evitar sobrecarga da thread principal
    const latencies = [];
    const gaps = [];
    const recentSeqs = [];
    let presentedFramesCount = 0;
    let duplicateFrames = 0;
    let intervalMaxPauseMs = 0;
    let recentLatencies = [];
    let validSamplesCount = 0;
    let rejectedCandidatesCount = 0;
    let lastValidTimeMs = null;
    const analysisDurations = [];

    let currentPhase = 'warmup';
    const phaseLatencies = {
      warmup: [],
      steady: [],
      cooldown: []
    };
    const hookStartTime = performance.now();
    let firstValidFrameTime = null;
    let startupMaxPauseMs = 0;

    function onFrame(now, metadata) {
      const callbackEntryPerfNow = performance.now();

      // Semântica estrita: usa metadata.presentedFrames se fornecido pela W3C spec
      if (metadata && typeof metadata.presentedFrames === 'number') {
        presentedFramesCount = metadata.presentedFrames;
      } else {
        presentedFramesCount++;
      }

      // Timing do display: obtém o timestamp de apresentação no instante de chegada
      // Conforme W3C requestVideoFrameCallback, metadata.expectedDisplayTime ou metadata.presentationTime
      let framePresentationEpoch;
      if (metadata && typeof metadata.expectedDisplayTime === 'number' && metadata.expectedDisplayTime > 0) {
        framePresentationEpoch = performance.timeOrigin + metadata.expectedDisplayTime;
      } else if (metadata && typeof metadata.presentationTime === 'number' && metadata.presentationTime > 0) {
        framePresentationEpoch = performance.timeOrigin + metadata.presentationTime;
      } else {
        framePresentationEpoch = performance.timeOrigin + callbackEntryPerfNow;
      }
      const now32 = (Math.floor(framePresentationEpoch) >>> 0);

      const callbackNow = performance.now();
      const gap = callbackNow - lastCallbackTime;
      lastCallbackTime = callbackNow;
      if (gap > 100) {
        gaps.push({ at: Date.now(), gapMs: Math.round(gap), phase: currentPhase });
        if (gap > intervalMaxPauseMs) intervalMaxPauseMs = Math.round(gap);
        if (currentPhase === 'warmup' && gap > startupMaxPauseMs) {
          startupMaxPauseMs = Math.round(gap);
        }
      }

      // Amostragem óptica com cadência controlada (8 Hz):
      // Garante que o receptor não dispute CPU/GPU em cada frame, preservando a fluidez da reprodução
      const shouldAnalyzeOptical = (callbackNow - lastOpticalAnalysisTime >= opticalIntervalMs);

      try {
        if (shouldAnalyzeOptical && video.videoWidth > 0 && video.readyState >= 2) {
          lastOpticalAnalysisTime = callbackNow;
          let decoded = null;
          const expectedMagicNum = expectedSessionMagic != null ? expectedSessionMagic & 0xFFFF : null;

          // 1. FAST PATH: Se já conhecemos a posição (lastRoi), amostra apenas uma ROI mínima (<1ms)
          if (lastRoi) {
            const cropX = Math.max(0, Math.floor(lastRoi.startX - 6));
            const cropY = Math.max(0, Math.floor(lastRoi.y - 6));
            const cropW = Math.min(video.videoWidth - cropX, Math.ceil(96 * (lastRoi.blockW + 0.5)) + 24);
            const cropH = Math.min(video.videoHeight - cropY, 60);

            if (cropW > 0 && cropH > 0 && cropW <= 1200 && cropH <= 64) {
              roiCtx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
              const roiImg = roiCtx.getImageData(0, 0, cropW, cropH);
              const localStartX = lastRoi.startX - cropX;
              const localY = lastRoi.y - cropY;

              for (const dy of [0, -1, 1, -2, 2, -3, 3]) {
                const y = localY + dy;
                if (y < 0 || y >= cropH) continue;
                for (const dx of [0, -2, 2, -4, 4, -6, 6]) {
                  const sx = localStartX + dx;
                  if (sx < 0 || sx + 96 * lastRoi.blockW > cropW) continue;
                  for (const dw of [0, -0.05, 0.05, -0.1, 0.1, -0.2, 0.2]) {
                    const bw = Number((lastRoi.blockW + dw).toFixed(2));
                    const res = decodeMarkerAt(roiImg.data, cropW, cropH, sx, y, bw, expectedMagicNum);
                    if (res) {
                      decoded = {
                        frameSeq: res.frameSeq,
                        sourceTimeMs: res.sourceTimeMs,
                        sessionMagic: res.sessionMagic,
                        detectedBlockWidth: res.detectedBlockWidth
                      };
                      lastRoi = {
                        startX: cropX + res.startX,
                        y: cropY + res.y,
                        blockW: res.detectedBlockWidth
                      };
                      break;
                    }
                  }
                  if (decoded) break;
                }
                if (decoded) break;
              }
            }
          }

          // 2. FALLBACK PATH: Primeira detecção ou caso a ROI tenha falhado (redimensionamento / movimento)
          if (!decoded) {
            const sampleW = Math.min(video.videoWidth, 1920);
            const sampleH = Math.min(video.videoHeight, 200);
            fullCtx.drawImage(video, 0, 0, sampleW, sampleH, 0, 0, sampleW, sampleH);
            const img = fullCtx.getImageData(0, 0, sampleW, sampleH);
            const nomScale = video.videoWidth > 0 ? (video.videoWidth / 1280) : 1;
            const nomW = Number((8 * nomScale).toFixed(2));
            const candidateWidths = [];
            if (lastSuccessfulWidth != null) candidateWidths.push(lastSuccessfulWidth);
            for (let dw = -0.4; dw <= 0.4; dw += 0.05) {
              const w = Number((nomW + dw).toFixed(2));
              if (w >= 6 && !candidateWidths.includes(w)) candidateWidths.push(w);
            }
            for (const w of [8, 10, 12, 16]) {
              if (!candidateWidths.includes(w)) candidateWidths.push(w);
            }
            decoded = decodeOptical(img.data, sampleW, sampleH, candidateWidths, expectedSessionMagic);
            if (decoded) {
              lastRoi = {
                startX: decoded.startX,
                y: decoded.y,
                blockW: decoded.detectedBlockWidth
              };
            }
          }

          if (decoded) {
            if (firstValidFrameTime === null) {
              firstValidFrameTime = performance.now();
            }
            lastSuccessfulWidth = decoded.detectedBlockWidth;
            validSamplesCount++;
            if (decoded.frameSeq === lastSeq) {
              duplicateFrames++;
            } else {
              lastSeq = decoded.frameSeq;
              recentSeqs.push(decoded.frameSeq);
              if (recentSeqs.length > 50) recentSeqs.shift();
            }
            lastValidTimeMs = decoded.sourceTimeMs;

            // Modular uint32 difference: imune a wrap de época de 32 bits
            const diff = ((now32 - (decoded.sourceTimeMs >>> 0)) | 0);
            if (diff >= -50 && diff < 60000) {
              latencies.push(diff);
              recentLatencies.push(diff);
              if (recentLatencies.length > 60) recentLatencies.shift();
              if (phaseLatencies[currentPhase]) {
                phaseLatencies[currentPhase].push(diff);
              }
            }
          } else {
            rejectedCandidatesCount++;
          }
        }
      } catch {}

      if (shouldAnalyzeOptical) {
        const durationMs = performance.now() - callbackEntryPerfNow;
        analysisDurations.push(durationMs);
        if (analysisDurations.length > 100) analysisDurations.shift();
      }

      if ('requestVideoFrameCallback' in video) {
        video.requestVideoFrameCallback(onFrame);
      }
    }

    if ('requestVideoFrameCallback' in video) {
      video.requestVideoFrameCallback(onFrame);
    }

    video.__smgPresentation = {
      setPhase(phase) {
        if (phase && phaseLatencies[phase] !== undefined) {
          currentPhase = phase;
        }
      },
      getStats({ reset = false } = {}) {
        const computePercentiles = arr => {
          if (!arr || !arr.length) return null;
          const s = [...arr].sort((a, b) => a - b);
          return {
            p50: s[Math.floor(s.length * 0.5)],
            p90: s[Math.floor(s.length * 0.9)],
            p99: s[Math.floor(s.length * 0.99)],
            min: s[0],
            max: s[s.length - 1],
            samplesCount: s.length
          };
        };

        const sorted = [...latencies].sort((a, b) => a - b);
        const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : null;
        const p90 = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : null;
        const p99 = sorted.length ? sorted[Math.floor(sorted.length * 0.99)] : null;
        const recentSorted = [...recentLatencies].sort((a, b) => a - b);
        const recentP50 = recentSorted.length ? recentSorted[Math.floor(recentSorted.length * 0.5)] : null;

        const durSorted = [...analysisDurations].sort((a, b) => a - b);
        const overheadP50 = durSorted.length ? Number(durSorted[Math.floor(durSorted.length * 0.5)].toFixed(2)) : null;
        const overheadP95 = durSorted.length ? Number(durSorted[Math.floor(durSorted.length * 0.95)].toFixed(2)) : null;

        const steadyLatency = computePercentiles(phaseLatencies.steady);
        const warmupLatency = computePercentiles(phaseLatencies.warmup);
        const cooldownLatency = computePercentiles(phaseLatencies.cooldown);

        // Leitura da pausa do intervalo e reset SOMENTE se explicitamente requisitado (ex: ao consumir intervalo na timeline)
        const maxPause = intervalMaxPauseMs;
        if (reset) {
          intervalMaxPauseMs = 0;
        }

        return {
          presentedFrames: presentedFramesCount,
          duplicateFrames,
          intervalMaxPauseMs: maxPause,
          gapsCount: gaps.length,
          lastSeq,
          recentSeqs: [...recentSeqs],
          lastValidTimeMs,
          validSamplesCount,
          rejectedCandidatesCount,
          instrumentationOverheadMs: {
            p50: overheadP50,
            p95: overheadP95
          },
          currentPhase,
          steadyLatency,
          warmupLatency,
          cooldownLatency,
          startupDynamics: {
            timeToFirstFrameMs: firstValidFrameTime !== null ? Math.round(firstValidFrameTime - hookStartTime) : null,
            startupMaxPauseMs,
            warmupSamplesCount: phaseLatencies.warmup.length,
            warmupLatency
          },
          latency: {
            p50, p90, p99,
            min: sorted.length ? sorted[0] : null,
            max: sorted.length ? sorted[sorted.length - 1] : null,
            recentP50
          }
        };
      }
    };
  }

  window.__smgE2E = {
    async sample() {
      const rows = [];
      for (let pcId = 0; pcId < peers.length; pcId++) {
        const pc = peers[pcId];
        // Ignora conexões fechadas
        if (pc.signalingState === 'closed') continue;

        const stats = await Promise.race([
          pc.getStats(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('stats timeout')), 1500))
        ]).catch(() => null);
        if (!stats) continue;

        for (const report of stats.values()) {
          const row = {
            pcId,
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState
          };
          for (const key of fields) if (report[key] !== undefined) row[key] = report[key];
          rows.push(row);
        }
      }

      return {
        at: Date.now(),
        rows,
        videos: [...document.querySelectorAll('video')].map(v => {
          hookVideo(v);
          return {
            width: v.videoWidth,
            height: v.videoHeight,
            currentTime: v.currentTime,
            readyState: v.readyState,
            paused: v.paused,
            presentation: v.__smgPresentation?.getStats({ reset: false })
          };
        })
      };
    }
  };
}

export function deltaMetrics(previous, current) {
  const dt = (current.timestamp - previous.timestamp) / 1000;
  const delta = key => Number.isFinite(current[key]) && Number.isFinite(previous[key]) && current[key] >= previous[key] ? current[key] - previous[key] : null;
  const ratio = (a, b, scale = 1000) => { const x = delta(a), y = delta(b); return x !== null && y > 0 ? scale * x / y : null; };

  const decodeTimeMs = ratio('totalDecodeTime', 'framesDecoded');
  const jitterBufferMs = ratio('jitterBufferDelay', 'jitterBufferEmittedCount');
  const bridgeObservableMs = (decodeTimeMs !== null || jitterBufferMs !== null)
    ? ((decodeTimeMs ?? 0) + (jitterBufferMs ?? 0))
    : null;

  return {
    encodeTimeMs: ratio('totalEncodeTime', 'framesEncoded'),
    decodeTimeMs,
    jitterBufferMs,
    bridgeObservableMs,
    packetSendDelayMs: ratio('totalPacketSendDelay', 'packetsSent'),
    decodedFps: dt > 0 && delta('framesDecoded') !== null ? delta('framesDecoded') / dt : null,
    sentMbps: dt > 0 && delta('bytesSent') !== null ? delta('bytesSent') * 8 / dt / 1e6 : null
  };
}

