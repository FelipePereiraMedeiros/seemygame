// ==========================================
// MONITOR DE ESTATÍSTICAS (FPS / RTT / BITRATE)
// ==========================================

const statsIntervals = new Map();   // PeerId -> intervalId
const lastBytes = {};
const lastTimestamp = {};

/**
 * Inicia o monitoramento periódico de telemetria WebRTC via getStats()
 * @param {string} peerId
 * @param {RTCPeerConnection} pc
 * @param {boolean} isLocal
 */
export function startStatsMonitor(peerId, pc, isLocal = false) {
  stopStatsMonitor(peerId);

  lastBytes[peerId] = 0;
  lastTimestamp[peerId] = performance.now();

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

      stats.forEach((report) => {
        // RTT (Ping)
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (report.currentRoundTripTime !== undefined) {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          }
        }

        // Inbound (Espectador)
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          if (report.framesPerSecond !== undefined) fps = Math.round(report.framesPerSecond);
          if (report.bytesReceived !== undefined) bytes = report.bytesReceived;
          if (report.frameWidth !== undefined) width = report.frameWidth;
          if (report.frameHeight !== undefined) height = report.frameHeight;
        }

        // Outbound (Transmissor)
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          if (report.framesPerSecond !== undefined) fps = Math.round(report.framesPerSecond);
          if (report.bytesSent !== undefined) bytes = report.bytesSent;
          if (report.frameWidth !== undefined) width = report.frameWidth;
          if (report.frameHeight !== undefined) height = report.frameHeight;
        }

        // Track info
        if (report.type === 'track' && report.kind === 'video') {
          if (report.frameWidth) width = report.frameWidth;
          if (report.frameHeight) height = report.frameHeight;
        }
      });

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

      if (rttElem && rtt !== null) rttElem.innerText = `${rtt} ms`;
      if (fpsElem && fps !== null) fpsElem.innerText = `${fps} FPS`;
      if (bitElem) bitElem.innerText = `${bitrateMbps} Mbps`;
      if (resElem && width && height) resElem.innerText = `${width}x${height}`;

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
}
