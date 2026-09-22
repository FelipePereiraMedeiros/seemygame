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

/**
 * Cria e aplica uma cadeia de processamento de áudio (High-Pass + Noise Gate)
 * em uma stream de microfone para eliminar ruídos mecânicos de teclado/ventoinha.
 *
 * @param {MediaStream} inputStream
 * @param {Object} [options={}]
 * @param {number} [options.thresholdDb=-45] - Limiar de abertura do portão em dB
 * @param {number} [options.highPassFreq=80] - Frequência de corte do filtro passa-altas em Hz
 * @param {number} [options.attackMs=5] - Tempo de ataque em ms para abrir o gate
 * @param {number} [options.releaseMs=120] - Tempo de liberação em ms para fechar o gate
 * @param {boolean} [options.enabled=true] - Se o processamento está ativo
 * @returns {{ processedStream: MediaStream, setEnabled: Function, setThreshold: Function, destroy: Function }}
 */
export function applyMicrophoneProcessing(inputStream, options = {}) {
  if (!inputStream || typeof inputStream.getAudioTracks !== 'function') {
    return {
      processedStream: inputStream,
      setEnabled: () => {},
      setThreshold: () => {},
      destroy: () => {}
    };
  }

  const audioTracks = inputStream.getAudioTracks();
  if (audioTracks.length === 0) {
    return {
      processedStream: inputStream,
      setEnabled: () => {},
      setThreshold: () => {},
      destroy: () => {}
    };
  }

  try {
    const ctx = getAudioContext();
    const source = ctx.createMediaStreamSource(inputStream);

    // 1. Filtro High-Pass (80 Hz) para cortar sub-graves mecânicos (vibração de mesa, AC hum, ventoinhas)
    const highPassFreq = Number(options.highPassFreq) || 80;
    const highPass = ctx.createBiquadFilter();
    highPass.type = 'highpass';
    if (highPass.frequency) {
      highPass.frequency.value = highPassFreq;
    }
    if (highPass.Q) {
      highPass.Q.value = 0.707; // Butterworth
    }

    // 2. Nó de Ganho para o Noise Gate
    const gateGain = ctx.createGain();
    if (gateGain.gain) {
      gateGain.gain.value = 1.0;
    }

    // 3. Analisador para detecção de amplitude RMS
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    // 4. Destino processado
    const destination = ctx.createMediaStreamDestination();

    // Conexões:
    // source -> highPass -> analyser
    // highPass -> gateGain -> destination
    source.connect(highPass);
    highPass.connect(analyser);
    highPass.connect(gateGain);
    gateGain.connect(destination);

    let isEnabled = options.enabled !== false;
    let thresholdDb = Number(options.thresholdDb) || -45;
    const attackTime = (Number(options.attackMs) || 5) / 1000;
    const releaseTime = (Number(options.releaseMs) || 120) / 1000;

    const timeDomainData = new Float32Array(analyser.fftSize || 256);
    let timerId = null;
    let isDestroyed = false;

    // Algoritmo de verificação de nível e envelope
    const checkGate = () => {
      if (isDestroyed) return;

      if (!isEnabled) {
        if (gateGain.gain?.setTargetAtTime) {
          gateGain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.01);
        } else if (gateGain.gain) {
          gateGain.gain.value = 1.0;
        }
        return;
      }

      if (typeof analyser.getFloatTimeDomainData === 'function') {
        analyser.getFloatTimeDomainData(timeDomainData);
      } else if (typeof analyser.getByteTimeDomainData === 'function') {
        const byteData = new Uint8Array(analyser.fftSize || 256);
        analyser.getByteTimeDomainData(byteData);
        for (let i = 0; i < byteData.length; i++) {
          timeDomainData[i] = (byteData[i] - 128) / 128;
        }
      }

      // Calcula RMS
      let sumSquares = 0;
      for (let i = 0; i < timeDomainData.length; i++) {
        sumSquares += timeDomainData[i] * timeDomainData[i];
      }
      const rms = Math.sqrt(sumSquares / timeDomainData.length);
      const currentDb = rms > 0.00001 ? 20 * Math.log10(rms) : -100;

      if (currentDb >= thresholdDb) {
        // Voz detectada -> Abre o gate rapidamente (attack)
        if (gateGain.gain?.setTargetAtTime) {
          gateGain.gain.setTargetAtTime(1.0, ctx.currentTime, attackTime);
        } else if (gateGain.gain) {
          gateGain.gain.value = 1.0;
        }
      } else {
        // Silêncio ou ruído mecânico abaixo do limiar -> Fecha suavemente (release)
        if (gateGain.gain?.setTargetAtTime) {
          gateGain.gain.setTargetAtTime(0.0, ctx.currentTime, releaseTime);
        } else if (gateGain.gain) {
          gateGain.gain.value = 0.0;
        }
      }
    };

    timerId = setInterval(checkGate, 20);

    const destroy = () => {
      if (isDestroyed) return;
      isDestroyed = true;
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
      try { source.disconnect(); } catch (_) {}
      try { highPass.disconnect(); } catch (_) {}
      try { gateGain.disconnect(); } catch (_) {}
      try { analyser.disconnect(); } catch (_) {}
      try { destination.disconnect(); } catch (_) {}
    };

    return {
      processedStream: destination.stream,
      setEnabled: (flag) => {
        isEnabled = Boolean(flag);
        if (!isEnabled && gateGain.gain?.setTargetAtTime) {
          gateGain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.01);
        }
      },
      setThreshold: (db) => {
        thresholdDb = Number(db);
      },
      destroy
    };
  } catch (err) {
    console.warn('[AudioProcessing] Falha ao configurar Noise Gate:', err);
    return {
      processedStream: inputStream,
      setEnabled: () => {},
      setThreshold: () => {},
      destroy: () => {}
    };
  }
}

