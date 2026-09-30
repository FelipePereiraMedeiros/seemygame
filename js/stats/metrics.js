/** Collect WebRTC metrics without DOM, timers, or module state. Units: ms, Mbps, pixels. */
export function collectPeerMetrics(stats, { peerId, isLocal = false, previous = {}, lastBytes = 0, lastTimestamp = 0, now = performance.now() }) {
previous = { ...previous };
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

          const prev = previous?.inbound;
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

          const prev = previous?.outbound;
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

      if (!previous) previous = {};
      if (currentOutbound) previous.outbound = currentOutbound;
      if (currentInbound) previous.inbound = currentInbound;


      const timeDiff = (now - (lastTimestamp || now)) / 1000;
      let bitrateMbps = '0.0';
      if (timeDiff > 0 && lastBytes && bytes > lastBytes) {
        const bitDiff = (bytes - lastBytes) * 8;
        bitrateMbps = (bitDiff / timeDiff / 1000000).toFixed(2);
      }




      return {
        ...previous,
        peerId,
        rtt,
        fps,
        bitrateMbps: parseFloat(bitrateMbps) || 0,
        bitrateText: bitrateMbps,
        bytes,
        width,
        height,
        packetsLost,
        packetLossRate,
        qualityReason,
        encodeTimeMs,
        packetSendDelayMs,
        decodeTimeMs,
        jitterBufferDelayMs
      };
}
