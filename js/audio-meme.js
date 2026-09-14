/**
 * SeeMyGame - Módulo de Áudio Meme Pós-Clipping
 * Permite extrair trechos de áudio do clipe gravado de 30s, aplicar efeitos
 * e modulações cômicas de voz, exportar em formato WAV e transmitir via P2P.
 */

export const AUDIO_MEME_EFFECTS = [
  { id: 'none', name: 'Original', icon: '🎵', desc: 'Áudio original limpo sem efeitos' },
  { id: 'chipmunk', name: 'Esquilo', icon: '🐿️', desc: 'Voz fina e acelerada (efeito gás hélio)' },
  { id: 'monster', name: 'Monstro', icon: '👹', desc: 'Voz grossa, cavernosa e pesada' },
  { id: 'robot', name: 'Robô', icon: '🤖', desc: 'Modulação metálica estilo ciborgue' },
  { id: 'radio', name: 'Rádio Policial', icon: '📻', desc: 'Filtro passa-faixa com timbre de rádio' },
  { id: 'bassboost', name: 'Bass Boost', icon: '📢', desc: 'Graves estourados com saturação gamer' },
  { id: 'reverse', name: 'Reverso', icon: '🔄', desc: 'Áudio invertido de trás para frente' },
  { id: 'fast', name: '2x Rápido', icon: '⚡', desc: 'Velocidade acelerada em 200%' },
  { id: 'slow', name: '0.5x Lento', icon: '🦥', desc: 'Câmera lenta em 50%' },
];

/**
 * Cria ou recupera uma instância de AudioContext
 * @returns {AudioContext|null}
 */
export function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  return new AudioCtx();
}

/**
 * Decodifica o áudio de um Blob (WebM ou MP4) em um AudioBuffer
 * @param {Blob} blob 
 * @param {AudioContext} [audioCtx] 
 * @returns {Promise<AudioBuffer|null>}
 */
export async function decodeAudioFromBlob(blob, audioCtx = null) {
  if (!blob) return null;
  const ctx = audioCtx || getAudioContext();
  if (!ctx || typeof ctx.decodeAudioData !== 'function') return null;

  try {
    const arrayBuffer = await blob.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  } catch (err) {
    console.warn('[AudioMeme] Falha ao decodificar áudio do clipe:', err);
    return null;
  }
}

/**
 * Recorta uma fatia temporal (entre startSec e endSec) de um AudioBuffer
 * @param {AudioBuffer} audioBuffer 
 * @param {number} startSec 
 * @param {number} endSec 
 * @param {AudioContext} [audioCtx] 
 * @returns {AudioBuffer|null}
 */
export function trimAudioBuffer(audioBuffer, startSec = 0, endSec = 0, audioCtx = null) {
  if (!audioBuffer) return null;

  const duration = audioBuffer.duration || (audioBuffer.length / audioBuffer.sampleRate);
  const safeStart = Math.max(0, Math.min(startSec, duration));
  const safeEnd = Math.max(safeStart + 0.05, Math.min(endSec || duration, duration));
  const sampleRate = audioBuffer.sampleRate || 44100;

  const startSample = Math.floor(safeStart * sampleRate);
  const endSample = Math.floor(safeEnd * sampleRate);
  const frameCount = Math.max(1, endSample - startSample);
  const numChannels = audioBuffer.numberOfChannels || 1;

  let newBuffer = null;
  if (audioCtx && typeof audioCtx.createBuffer === 'function') {
    newBuffer = audioCtx.createBuffer(numChannels, frameCount, sampleRate);
  } else if (typeof AudioBuffer !== 'undefined') {
    try {
      newBuffer = new AudioBuffer({ length: frameCount, numberOfChannels: numChannels, sampleRate });
    } catch {
      newBuffer = {
        numberOfChannels: numChannels,
        length: frameCount,
        sampleRate,
        duration: frameCount / sampleRate,
        _channels: [],
        getChannelData(c) {
          if (!this._channels[c]) this._channels[c] = new Float32Array(frameCount);
          return this._channels[c];
        }
      };
    }
  } else {
    newBuffer = {
      numberOfChannels: numChannels,
      length: frameCount,
      sampleRate,
      duration: frameCount / sampleRate,
      _channels: [],
      getChannelData(c) {
        if (!this._channels[c]) this._channels[c] = new Float32Array(frameCount);
        return this._channels[c];
      }
    };
  }

  if (!newBuffer) return null;

  for (let c = 0; c < numChannels; c++) {
    const srcData = audioBuffer.getChannelData(c);
    const dstData = newBuffer.getChannelData(c);
    for (let i = 0; i < frameCount; i++) {
      dstData[i] = srcData[startSample + i] || 0;
    }
  }

  return newBuffer;
}

/**
 * Cria uma curva de distorção sigmoidal para efeitos de saturação e rádio
 * @param {number} amount 
 * @returns {Float32Array}
 */
function makeDistortionCurve(amount = 20) {
  const k = typeof amount === 'number' ? amount : 20;
  const nSamples = 44100;
  const curve = new Float32Array(nSamples);
  const deg = Math.PI / 180;
  for (let i = 0; i < nSamples; ++i) {
    const x = (i * 2) / nSamples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

/**
 * Inverte os canais de um AudioBuffer (Efeito Reverso)
 * @param {AudioBuffer} audioBuffer 
 * @param {AudioContext} [audioCtx] 
 * @returns {AudioBuffer}
 */
export function reverseAudioBuffer(audioBuffer, audioCtx = null) {
  if (!audioBuffer) return null;
  const numChannels = audioBuffer.numberOfChannels || 1;
  const length = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate || 44100;

  let newBuffer = null;
  if (audioCtx && typeof audioCtx.createBuffer === 'function') {
    newBuffer = audioCtx.createBuffer(numChannels, length, sampleRate);
  } else {
    newBuffer = {
      numberOfChannels: numChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      _channels: [],
      getChannelData(c) {
        if (!this._channels[c]) this._channels[c] = new Float32Array(length);
        return this._channels[c];
      }
    };
  }

  for (let c = 0; c < numChannels; c++) {
    const src = audioBuffer.getChannelData(c);
    const dst = newBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      dst[i] = src[length - 1 - i];
    }
  }

  return newBuffer;
}

/**
 * Aplica o efeito sonoro meme selecionado e retorna um novo AudioBuffer sintetizado
 * @param {AudioBuffer} sourceBuffer 
 * @param {string} effectId 
 * @param {AudioContext} [audioCtx] 
 * @returns {Promise<AudioBuffer>}
 */
export async function applyMemeEffect(sourceBuffer, effectId = 'none', audioCtx = null) {
  if (!sourceBuffer) return null;
  if (effectId === 'none') return sourceBuffer;
  if (effectId === 'reverse') {
    return reverseAudioBuffer(sourceBuffer, audioCtx);
  }

  const sampleRate = sourceBuffer.sampleRate || 44100;
  const numChannels = sourceBuffer.numberOfChannels || 1;

  let playbackRate = 1.0;
  if (effectId === 'chipmunk') playbackRate = 1.6;
  else if (effectId === 'monster') playbackRate = 0.72;
  else if (effectId === 'fast') playbackRate = 2.0;
  else if (effectId === 'slow') playbackRate = 0.5;

  const outDuration = (sourceBuffer.duration || (sourceBuffer.length / sampleRate)) / playbackRate;
  const outLength = Math.max(1, Math.ceil(outDuration * sampleRate));

  const OfflineCtxClass = (typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext)) || null;

  if (!OfflineCtxClass) {
    // Fallback gracioso para ambientes sem OfflineAudioContext
    return sourceBuffer;
  }

  try {
    const offlineCtx = new OfflineCtxClass(numChannels, outLength, sampleRate);

    const sourceNode = offlineCtx.createBufferSource();
    sourceNode.buffer = sourceBuffer;
    sourceNode.playbackRate.value = playbackRate;

    let lastNode = sourceNode;

    if (effectId === 'robot') {
      const carrierOsc = offlineCtx.createOscillator();
      const carrierGain = offlineCtx.createGain();
      carrierOsc.type = 'sine';
      carrierOsc.frequency.value = 50;

      carrierGain.gain.value = 0.0;
      sourceNode.connect(carrierGain.gain);

      carrierOsc.connect(carrierGain);
      carrierOsc.start();
      lastNode = carrierGain;
    } else if (effectId === 'radio') {
      const filter = offlineCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1400;
      filter.Q.value = 1.8;

      const shaper = offlineCtx.createWaveShaper();
      shaper.curve = makeDistortionCurve(30);

      lastNode.connect(filter);
      filter.connect(shaper);
      lastNode = shaper;
    } else if (effectId === 'bassboost') {
      const bassFilter = offlineCtx.createBiquadFilter();
      bassFilter.type = 'lowshelf';
      bassFilter.frequency.value = 160;
      bassFilter.gain.value = 18;

      const shaper = offlineCtx.createWaveShaper();
      shaper.curve = makeDistortionCurve(15);

      lastNode.connect(bassFilter);
      bassFilter.connect(shaper);
      lastNode = shaper;
    }

    lastNode.connect(offlineCtx.destination);
    sourceNode.start(0);

    const rendered = await offlineCtx.startRendering();
    return rendered || sourceBuffer;
  } catch (err) {
    console.warn('[AudioMeme] Falha ao renderizar efeito offline:', err);
    return sourceBuffer;
  }
}

/**
 * Converte um AudioBuffer em um arquivo Blob de áudio WAV (16-bit PCM RIFF)
 * @param {AudioBuffer} audioBuffer 
 * @returns {Blob}
 */
export function audioBufferToWavBlob(audioBuffer) {
  if (!audioBuffer) return null;

  const numChannels = audioBuffer.numberOfChannels || 1;
  const sampleRate = audioBuffer.sampleRate || 44100;
  const length = audioBuffer.length || 0;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const bufferSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF chunk descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i] || 0;
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Converte um Blob WAV em string Base64 para transmissão via WebRTC DataChannel
 * @param {Blob} blob 
 * @returns {Promise<string>}
 */
export function wavBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const base64 = result.split(',')[1] || '';
        resolve(base64);
      } else {
        resolve('');
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Converte uma string Base64 de volta para um Blob de áudio WAV
 * @param {string} base64 
 * @returns {Blob}
 */
export function base64ToWavBlob(base64) {
  if (!base64) return new Blob([], { type: 'audio/wav' });
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes.buffer], { type: 'audio/wav' });
}

/**
 * Reproduz um AudioBuffer localmente como prévia
 * @param {AudioBuffer} audioBuffer 
 * @param {AudioContext} [audioCtx] 
 * @returns {{ stop: () => void }|null}
 */
export function playAudioBuffer(audioBuffer, audioCtx = null) {
  if (!audioBuffer) return null;
  const ctx = audioCtx || getAudioContext();
  if (!ctx) return null;

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  source.start(0);

  return {
    stop: () => {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
  };
}
