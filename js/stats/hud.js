export function renderStatsHud(peerId, isLocal, { rtt, fps, bitrateText, width, height, packetsLost, qualityReason }) {
if (typeof document === 'undefined') return;
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
        bitElem.innerText = isLocal ? `${bitrateText} Mbps (Envio)` : `${bitrateText} Mbps`;
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


}
