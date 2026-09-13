// ==========================================
// VU METER ESTÉREO (ANALISADOR DE ÁUDIO L/R)
// ==========================================

let audioCtx = null;
const activeAudioPipelines = new Map(); // PeerId -> { source, splitter, analyserL, analyserR, rafId }

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

  // Garante que qualquer loop/pipeline anterior desse peer seja completamente encerrado e desconectado
  stopAudioAnalyser(peerId);

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

    const pipeline = {
      source,
      splitter,
      analyserL,
      analyserR,
      rafId: null
    };

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

      pipeline.rafId = requestAnimationFrame(renderVU);
    }

    activeAudioPipelines.set(peerId, pipeline);
    renderVU();
  } catch (err) {
    console.warn('Erro ao inicializar VU meter de áudio:', err);
  }
}

/**
 * Encerra a animação e desconecta explicitamente todos os nós de áudio do peer
 * @param {string} peerId
 */
export function stopAudioAnalyser(peerId) {
  const pipeline = activeAudioPipelines.get(peerId);
  if (pipeline) {
    if (pipeline.rafId) {
      cancelAnimationFrame(pipeline.rafId);
    }

    // Desconecta explicitamente cada nó da Web Audio API para prevenir memory leaks
    try {
      if (pipeline.source && typeof pipeline.source.disconnect === 'function') {
        pipeline.source.disconnect();
      }
    } catch (e) {}

    try {
      if (pipeline.splitter && typeof pipeline.splitter.disconnect === 'function') {
        pipeline.splitter.disconnect();
      }
    } catch (e) {}

    try {
      if (pipeline.analyserL && typeof pipeline.analyserL.disconnect === 'function') {
        pipeline.analyserL.disconnect();
      }
    } catch (e) {}

    try {
      if (pipeline.analyserR && typeof pipeline.analyserR.disconnect === 'function') {
        pipeline.analyserR.disconnect();
      }
    } catch (e) {}

    activeAudioPipelines.delete(peerId);
  }

  // Reseta visualmente as barras se ainda presentes
  const barL = document.getElementById(`vu-l-${peerId}`);
  const barR = document.getElementById(`vu-r-${peerId}`);
  if (barL) barL.style.width = '0%';
  if (barR) barR.style.width = '0%';
}

/**
 * Interrompe todos os analisadores ativos
 */
export function stopAllAudioAnalysers() {
  const peerIds = Array.from(activeAudioPipelines.keys());
  peerIds.forEach(id => stopAudioAnalyser(id));
}
