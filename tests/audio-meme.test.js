import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AUDIO_MEME_EFFECTS,
  getAudioContext,
  decodeAudioFromBlob,
  trimAudioBuffer,
  reverseAudioBuffer,
  applyMemeEffect,
  audioBufferToWavBlob,
  wavBlobToBase64,
  base64ToWavBlob,
  playAudioBuffer
} from '../js/audio-meme.js';

class MockAudioBuffer {
  constructor({ length = 44100, numberOfChannels = 2, sampleRate = 44100 } = {}) {
    this.length = length;
    this.numberOfChannels = numberOfChannels;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._data = [];
    for (let c = 0; c < numberOfChannels; c++) {
      const ch = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        ch[i] = Math.sin((i / sampleRate) * 440 * 2 * Math.PI) * 0.5;
      }
      this._data.push(ch);
    }
  }

  getChannelData(c) {
    return this._data[c];
  }
}

class MockAudioSource {
  constructor() {
    this.buffer = null;
    this.playbackRate = { value: 1.0 };
    this.connect = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
    this.disconnect = vi.fn();
  }
}

class MockBiquadFilter {
  constructor() {
    this.type = 'lowpass';
    this.frequency = { value: 1000 };
    this.gain = { value: 0 };
    this.Q = { value: 1 };
    this.connect = vi.fn();
  }
}

class MockWaveShaper {
  constructor() {
    this.curve = null;
    this.connect = vi.fn();
  }
}

class MockGainNode {
  constructor() {
    this.gain = { value: 1.0 };
    this.connect = vi.fn();
  }
}

class MockOscillatorNode {
  constructor() {
    this.type = 'sine';
    this.frequency = { value: 440 };
    this.connect = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
  }
}

class MockOfflineAudioContext {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.destination = {};
  }

  createBufferSource() { return new MockAudioSource(); }
  createBiquadFilter() { return new MockBiquadFilter(); }
  createWaveShaper() { return new MockWaveShaper(); }
  createGain() { return new MockGainNode(); }
  createOscillator() { return new MockOscillatorNode(); }

  startRendering() {
    return Promise.resolve(new MockAudioBuffer({
      length: this.length,
      numberOfChannels: this.numberOfChannels,
      sampleRate: this.sampleRate
    }));
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.destination = {};
  }

  createBuffer(channels, length, sampleRate) {
    return new MockAudioBuffer({ numberOfChannels: channels, length, sampleRate });
  }

  createBufferSource() {
    return new MockAudioSource();
  }

  decodeAudioData(arrayBuffer) {
    return Promise.resolve(new MockAudioBuffer());
  }

  resume() {
    return Promise.resolve();
  }
}

describe('Módulo: audio-meme.js (Áudio Meme Pós-Clipping)', () => {
  beforeEach(() => {
    globalThis.AudioContext = MockAudioContext;
    globalThis.OfflineAudioContext = MockOfflineAudioContext;
    globalThis.window = globalThis;
    vi.clearAllMocks();
  });

  describe('Presets e Inicialização', () => {
    it('deve disponibilizar lista de efeitos sonoros válidos com nomes e ícones', () => {
      expect(AUDIO_MEME_EFFECTS.length).toBeGreaterThanOrEqual(8);
      const ids = AUDIO_MEME_EFFECTS.map(e => e.id);
      expect(ids).toContain('none');
      expect(ids).toContain('chipmunk');
      expect(ids).toContain('monster');
      expect(ids).toContain('robot');
      expect(ids).toContain('radio');
      expect(ids).toContain('bassboost');
      expect(ids).toContain('reverse');
      expect(ids).toContain('fast');
      expect(ids).toContain('slow');
    });

    it('getAudioContext deve retornar uma instância válida de AudioContext', () => {
      const ctx = getAudioContext();
      expect(ctx).not.toBeNull();
      expect(typeof ctx.createBufferSource).toBe('function');
    });
  });

  describe('decodeAudioFromBlob', () => {
    it('deve retornar null se blob for nulo ou indefinido', async () => {
      expect(await decodeAudioFromBlob(null)).toBeNull();
    });

    it('deve decodificar áudio com sucesso a partir de um Blob', async () => {
      const mockBlob = new Blob(['fake audio binary'], { type: 'video/webm' });
      // Mock arrayBuffer se não existir no ambiente
      mockBlob.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(128));

      const buffer = await decodeAudioFromBlob(mockBlob);
      expect(buffer).not.toBeNull();
      expect(buffer.numberOfChannels).toBe(2);
      expect(mockBlob.arrayBuffer).toHaveBeenCalled();
    });

    it('deve tratar erro na decodificação retornando null', async () => {
      const mockBlob = new Blob(['bad binary'], { type: 'video/webm' });
      mockBlob.arrayBuffer = vi.fn().mockRejectedValue(new Error('Decode failed'));

      const buffer = await decodeAudioFromBlob(mockBlob);
      expect(buffer).toBeNull();
    });
  });

  describe('trimAudioBuffer', () => {
    it('deve retornar null se audioBuffer for inválido', () => {
      expect(trimAudioBuffer(null, 0, 5)).toBeNull();
    });

    it('deve recortar o intervalo de tempo solicitado com o número exato de samples', () => {
      // 10 segundos a 44100Hz = 441000 samples
      const source = new MockAudioBuffer({ length: 441000, sampleRate: 44100, numberOfChannels: 2 });
      const ctx = new MockAudioContext();

      // Recortar dos 2.0s aos 5.0s (3.0 segundos = 132300 samples)
      const trimmed = trimAudioBuffer(source, 2.0, 5.0, ctx);
      expect(trimmed).not.toBeNull();
      expect(trimmed.sampleRate).toBe(44100);
      expect(trimmed.length).toBe(132300);
      expect(trimmed.numberOfChannels).toBe(2);
    });

    it('deve ajustar limites para bounds seguros quando tempos ultrapassam a duração', () => {
      const source = new MockAudioBuffer({ length: 44100, sampleRate: 44100, numberOfChannels: 1 }); // 1 segundo
      const ctx = new MockAudioContext();

      // Pedir de -5s a 10s -> deve ser clampado para 0s a 1s
      const trimmed = trimAudioBuffer(source, -5, 10, ctx);
      expect(trimmed).not.toBeNull();
      expect(trimmed.length).toBeLessThanOrEqual(44100);
    });
  });

  describe('reverseAudioBuffer', () => {
    it('deve retornar null se audioBuffer for inválido', () => {
      expect(reverseAudioBuffer(null)).toBeNull();
    });

    it('deve inverter a ordem dos samples do buffer original', () => {
      const source = new MockAudioBuffer({ length: 5, sampleRate: 1, numberOfChannels: 1 });
      const channel = source.getChannelData(0);
      channel[0] = 10;
      channel[1] = 20;
      channel[2] = 30;
      channel[3] = 40;
      channel[4] = 50;

      const ctx = new MockAudioContext();
      const reversed = reverseAudioBuffer(source, ctx);

      expect(reversed.length).toBe(5);
      const revData = reversed.getChannelData(0);
      expect(revData[0]).toBe(50);
      expect(revData[1]).toBe(40);
      expect(revData[2]).toBe(30);
      expect(revData[3]).toBe(20);
      expect(revData[4]).toBe(10);
    });
  });

  describe('applyMemeEffect', () => {
    it('efeito none deve retornar o próprio buffer inalterado', async () => {
      const source = new MockAudioBuffer();
      const result = await applyMemeEffect(source, 'none');
      expect(result).toBe(source);
    });

    it('efeito reverse deve inverter os samples', async () => {
      const source = new MockAudioBuffer({ length: 4, sampleRate: 1, numberOfChannels: 1 });
      source.getChannelData(0)[0] = 1;
      source.getChannelData(0)[3] = 9;

      const result = await applyMemeEffect(source, 'reverse');
      expect(result.getChannelData(0)[0]).toBe(9);
      expect(result.getChannelData(0)[3]).toBe(1);
    });

    it('efeitos que utilizam OfflineAudioContext devem ser renderizados com sucesso', async () => {
      const source = new MockAudioBuffer({ length: 44100, sampleRate: 44100 });
      const effects = ['chipmunk', 'monster', 'robot', 'radio', 'bassboost', 'fast', 'slow'];

      for (const effect of effects) {
        const result = await applyMemeEffect(source, effect);
        expect(result).not.toBeNull();
        expect(result.length).toBeGreaterThan(0);
      }
    });
  });

  describe('audioBufferToWavBlob', () => {
    it('deve retornar null se audioBuffer for inválido', () => {
      expect(audioBufferToWavBlob(null)).toBeNull();
    });

    it('deve gerar um Blob WAV válido com cabeçalho RIFF e 16-bit PCM', async () => {
      const length = 100;
      const channels = 1;
      const buffer = new MockAudioBuffer({ length, sampleRate: 44100, numberOfChannels: channels });

      const wavBlob = audioBufferToWavBlob(buffer);
      expect(wavBlob).not.toBeNull();
      expect(wavBlob.type).toBe('audio/wav');

      // 44 bytes de cabeçalho + (100 samples * 1 canal * 2 bytes por sample = 200 bytes) = 244 bytes
      expect(wavBlob.size).toBe(244);

      // Inspeciona os primeiros bytes do cabeçalho
      const arrayBuffer = await wavBlob.arrayBuffer();
      const view = new DataView(arrayBuffer);

      // "RIFF" (0x52, 0x49, 0x46, 0x46)
      const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      expect(riff).toBe('RIFF');

      // "WAVE" (0x57, 0x41, 0x56, 0x45)
      const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
      expect(wave).toBe('WAVE');

      // "fmt "
      const fmt = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
      expect(fmt).toBe('fmt ');

      // Formato PCM = 1
      expect(view.getUint16(20, true)).toBe(1);
      // Canais = 1
      expect(view.getUint16(22, true)).toBe(1);
      // SampleRate = 44100
      expect(view.getUint32(24, true)).toBe(44100);
      // Bits por sample = 16
      expect(view.getUint16(34, true)).toBe(16);

      // "data"
      const dataTag = String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39));
      expect(dataTag).toBe('data');
      // dataSize = 200
      expect(view.getUint32(40, true)).toBe(200);
    });
  });

  describe('Serialização Base64 (wavBlobToBase64 e base64ToWavBlob)', () => {
    it('deve converter Blob para Base64 e reconstruir Blob fielmente', async () => {
      const buffer = new MockAudioBuffer({ length: 50, sampleRate: 44100, numberOfChannels: 1 });
      const blob = audioBufferToWavBlob(buffer);

      const base64 = await wavBlobToBase64(blob);
      expect(typeof base64).toBe('string');
      expect(base64.length).toBeGreaterThan(0);

      const reconstructed = base64ToWavBlob(base64);
      expect(reconstructed).not.toBeNull();
      expect(reconstructed.size).toBe(blob.size);
      expect(reconstructed.type).toBe('audio/wav');
    });

    it('base64ToWavBlob com string vazia deve retornar Blob vazio', () => {
      const empty = base64ToWavBlob('');
      expect(empty.size).toBe(0);
    });
  });

  describe('playAudioBuffer', () => {
    it('deve instanciar AudioBufferSourceNode e conectar à destination', () => {
      const ctx = new MockAudioContext();
      const buffer = new MockAudioBuffer();

      const controller = playAudioBuffer(buffer, ctx);
      expect(controller).not.toBeNull();
      expect(typeof controller.stop).toBe('function');

      // Invocar stop não deve lançar exceção
      expect(() => controller.stop()).not.toThrow();
    });

    it('deve retornar null se buffer for nulo', () => {
      expect(playAudioBuffer(null)).toBeNull();
    });
  });
});
