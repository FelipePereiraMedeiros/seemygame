// ==========================================
// MONITOR DE ESTATÍSTICAS REAL (FPS / RTT / BITRATE)
// ==========================================

const statsIntervals = new Map();   // PeerId -> intervalId
const lastBytes = {};
const lastTimestamp = {};
const lastMetrics = {};

/**
 * Inicia o monitoramento periódico de telemetria WebRTC via getStats()
 * @param {string} peerId
 * @param {RTCPeerConnection} pc
 * @param {boolean} isLocal
 * @param {Function} [onTelemetry=null]
 */
export function startStatsMonitor(peerId, pc, isLocal = false, onTelemetry = null) {
  stopStatsMonitor(peerId);

  lastBytes[peerId] = 0;
  lastTimestamp[peerId] = performance.now();
  lastMetrics[peerId] = {};

  const intervalId = setInterval(async () => {
    if (!pc || pc.connectionState === 'closed') {
      stopStatsMonitor(peerId);
      return;
    }

    try {
      const stats = await pc.getStats();
      let rtt = null;
      let fps = null;
      let bytes = 0;
      let width = null;
      let height = null;
      let packetsLost = null;
      let packetLossRate = null;
      let qualityReason = null;
      let encodeTimeMs = undefined;
      let packetSendDelayMs = undefined;
      let decodeTimeMs = undefined;
      let jitterBufferDelayMs = undefined;
      let currentOutbound = null;
      let currentInbound = null;

      // Primeiro busca pelo candidate-pair ativo (nominated ou selected)
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          const isNominated = report.nominated === true || report.selected === true;
          if (isNominated || rtt === null) {
            if (report.currentRoundTripTime !== undefined) {
              rtt = Math.round(report.currentRoundTripTime * 1000);
            }
          }
        }

        // Telemetria remota recebida pelo emissor via RTCP
        if (isLocal && report.type === 'remote-inbound-rtp' && report.kind === 'video') {
          if (report.roundTripTime !== undefined) {
            rtt = Math.round(report.roundTripTime * 1000);
          }
          if (report.fractionLost !== undefined) {
            packetLossRate = report.fractionLost;
          } else if (report.packetsLost !== undefined) {
            packetsLost = report.packetsLost;
          }
        }
      });

      // Separação estrita: Inbound (espectador) vs Outbound (streamer local)
      stats.forEach((report) => {
        if (!isLocal && report.type === 'inbound-rtp' && report.kind === 'video') {
          if (report.framesPerSecond !== undefined) fps = Math.round(report.framesPerSecond);
          if (report.bytesReceived !== undefined) bytes = report.bytesReceived;
          if (report.frameWidth !== undefined) width = report.frameWidth;
          if (report.frameHeight !== undefined) height = report.frameHeight;
          if (report.packetsLost !== undefined) packetsLost = report.packetsLost;
          if (report.packetsLost !== undefined && report.packetsReceived) {
            const total = report.packetsLost + report.packetsReceived;
            if (total > 0) packetLossRate = report.packetsLost / total;
          }

          const prev = lastMetrics[peerId]?.inbound;
          if (prev && report.framesDecoded !== undefined && report.totalDecodeTime !== undefined) {
            const dFrames = report.framesDecoded - prev.framesDecoded;
            const dDecodeTime = report.totalDecodeTime - prev.totalDecodeTime;
            if (dFrames > 0 && dDecodeTime >= 0) {
              decodeTimeMs = (dDecodeTime / dFrames) * 1000;
            }
          }
          if (prev && report.jitterBufferEmittedCount !== undefined && report.jitterBufferDelay !== undefined) {
            const dEmitted = report.jitterBufferEmittedCount - prev.jitterBufferEmittedCount;
            const dJitterDelay = report.jitterBufferDelay - prev.jitterBufferDelay;
            if (dEmitted > 0 && dJitterDelay >= 0) {
              jitterBufferDelayMs = (dJitterDelay / dEmitted) * 1000;
            }
          }
          currentInbound = {
            framesDecoded: report.framesDecoded,
            totalDecodeTime: report.totalDecodeTime,
            jitterBufferDelay: report.jitterBufferDelay,
            jitterBufferEmittedCount: report.jitterBufferEmittedCount
          };
        }

        if (isLocal && report.type === 'outbound-rtp' && report.kind === 'video') {
          if (report.framesPerSecond !== undefined) fps = Math.round(report.framesPerSecond);
          if (report.bytesSent !== undefined) bytes = report.bytesSent;
          if (report.frameWidth !== undefined) width = report.frameWidth;
          if (report.frameHeight !== undefined) height = report.frameHeight;
          if (report.qualityLimitationReason !== undefined) qualityReason = report.qualityLimitationReason;

          const prev = lastMetrics[peerId]?.outbound;
          if (prev && report.framesEncoded !== undefined && report.totalEncodeTime !== undefined) {
            const dFrames = report.framesEncoded - prev.framesEncoded;
            const dEncodeTime = report.totalEncodeTime - prev.totalEncodeTime;
            if (dFrames > 0 && dEncodeTime >= 0) {
              encodeTimeMs = (dEncodeTime / dFrames) * 1000;
            }
          }
          if (prev && report.packetsSent !== undefined && report.totalPacketSendDelay !== undefined) {
            const dPackets = report.packetsSent - prev.packetsSent;
            const dDelay = report.totalPacketSendDelay - prev.totalPacketSendDelay;
            if (dPackets > 0 && dDelay >= 0) {
              packetSendDelayMs = (dDelay / dPackets) * 1000;
            }
          }
          currentOutbound = {
            framesEncoded: report.framesEncoded,
            totalEncodeTime: report.totalEncodeTime,
            packetsSent: report.packetsSent,
            totalPacketSendDelay: report.totalPacketSendDelay
          };
        }

        // Informações adicionais da trilha
        if (report.type === 'track' && report.kind === 'video') {
          if (report.frameWidth && !width) width = report.frameWidth;
          if (report.frameHeight && !height) height = report.frameHeight;
        }
      });

      if (!lastMetrics[peerId]) lastMetrics[peerId] = {};
      if (currentOutbound) lastMetrics[peerId].outbound = currentOutbound;
      if (currentInbound) lastMetrics[peerId].inbound = currentInbound;

      const now = performance.now();
      const timeDiff = (now - (lastTimestamp[peerId] || now)) / 1000;
      let bitrateMbps = '0.0';
      if (timeDiff > 0 && lastBytes[peerId] && bytes > lastBytes[peerId]) {
        const bitDiff = (bytes - lastBytes[peerId]) * 8;
        bitrateMbps = (bitDiff / timeDiff / 1000000).toFixed(2);
      }
      lastBytes[peerId] = bytes;
      lastTimestamp[peerId] = now;

      const rttElem = document.getElementById(`stat-rtt-${peerId}`);
      const fpsElem = document.getElementById(`stat-fps-${peerId}`);
      const bitElem = document.getElementById(`stat-bitrate-${peerId}`);
      const resElem = document.getElementById(`stat-res-${peerId}`);
      const lossElem = document.getElementById(`stat-loss-${peerId}`);
      const qualityElem = document.getElementById(`stat-quality-${peerId}`);

      if (rttElem) {
        if (rtt !== null) {
          rttElem.innerText = `${rtt} ms`;
        } else if (isLocal) {
          rttElem.innerText = '0 ms (local)';
        }
      }

      if (fpsElem && fps !== null) {
        fpsElem.innerText = `${fps} FPS`;
      }

      if (bitElem) {
        bitElem.innerText = isLocal ? `${bitrateMbps} Mbps (Envio)` : `${bitrateMbps} Mbps`;
      }

      if (resElem && width && height) {
        resElem.innerText = `${width}x${height}`;
      }

      if (lossElem && packetsLost !== null) {
        lossElem.innerText = `${packetsLost} perdidos`;
      }

      if (qualityElem && qualityReason) {
        qualityElem.innerText = qualityReason === 'none' ? 'Normal' : qualityReason.toUpperCase();
      }

      if (typeof onTelemetry === 'function') {
        onTelemetry({
          peerId,
          rtt,
          fps,
          bitrateMbps: parseFloat(bitrateMbps) || 0,
          packetsLost,
          packetLossRate,
          qualityReason,
          encodeTimeMs,
          packetSendDelayMs,
          decodeTimeMs,
          jitterBufferDelayMs
        });
      }

    } catch (err) {}
  }, 1000);

  statsIntervals.set(peerId, intervalId);
}

/**
 * Interrompe a coleta de estatísticas de um peer específico
 * @param {string} peerId
 */
export function stopStatsMonitor(peerId) {
  if (statsIntervals.has(peerId)) {
    clearInterval(statsIntervals.get(peerId));
    statsIntervals.delete(peerId);
  }
  delete lastBytes[peerId];
  delete lastTimestamp[peerId];
  delete lastMetrics[peerId];
}
