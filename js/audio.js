// ==========================================
// VU METER ESTÉREO (ANALISADOR DE ÁUDIO L/R)
// ==========================================

let audioCtx = null;
const vuIntervals = new Map(); // PeerId -> animationFrameId

/**
 * Obtém ou inicializa o contexto de áudio
 * @returns {AudioContext}
 */
export function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Inicializa a análise estéreo de áudio para renderizar o VU meter L/R
 * @param {MediaStream} stream
 * @param {string} peerId
 */
export function initAudioAnalyser(stream, peerId) {
  if (!stream || stream.getAudioTracks().length === 0) return;

  try {
    const ctx = getAudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const splitter = ctx.createChannelSplitter(2);
    
    const analyserL = ctx.createAnalyser();
    const analyserR = ctx.createAnalyser();
    analyserL.fftSize = 64;
    analyserR.fftSize = 64;

    source.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    const dataL = new Uint8Array(analyserL.frequencyBinCount);
    const dataR = new Uint8Array(analyserR.frequencyBinCount);

    const barL = document.getElementById(`vu-l-${peerId}`);
    const barR = document.getElementById(`vu-r-${peerId}`);

    // Garante que qualquer loop anterior desse peer seja encerrado
    stopAudioAnalyser(peerId);

    function renderVU() {
      if (!document.getElementById(`card-${peerId}`)) {
        stopAudioAnalyser(peerId);
        return;
      }

      analyserL.getByteFrequencyData(dataL);
      analyserR.getByteFrequencyData(dataR);

      let sumL = 0;
      let sumR = 0;
      for (let i = 0; i < dataL.length; i++) sumL += dataL[i];
      for (let i = 0; i < dataR.length; i++) sumR += dataR[i];

      const avgL = Math.min(100, Math.round((sumL / dataL.length / 255) * 120));
      const avgR = Math.min(100, Math.round((sumR / dataR.length / 255) * 120));

      if (barL) barL.style.width = `${avgL}%`;
      if (barR) barR.style.width = `${avgR}%`;

      vuIntervals.set(peerId, requestAnimationFrame(renderVU));
    }

    renderVU();
  } catch (err) {
    console.warn('Erro ao inicializar VU meter de áudio:', err);
  }
}

/**
 * Encerra a animação e análise de áudio de um peer específico
 * @param {string} peerId
 */
export function stopAudioAnalyser(peerId) {
  if (vuIntervals.has(peerId)) {
    cancelAnimationFrame(vuIntervals.get(peerId));
    vuIntervals.delete(peerId);
  }
}
