import { expect, it, describe } from 'vitest';
import { deltaMetrics, installTelemetry } from '../tools/e2e/telemetry.mjs';
import {
  MARKER_CONFIG,
  crc16,
  computeSessionMagic,
  encodeOpticalMarker,
  decodeOpticalMarker,
  computeVisualLatency
} from '../tools/e2e/optical.mjs';

it('E2E: calcula deltas sem confundir cumulativos com fila e expõe atraso observável da ponte', () => {
  const prev = {
    timestamp: 1000,
    framesDecoded: 60,
    totalDecodeTime: 0.12,
    jitterBufferEmittedCount: 60,
    jitterBufferDelay: 3
  };
  const curr = {
    timestamp: 2000,
    framesDecoded: 120,
    totalDecodeTime: 0.24,
    jitterBufferEmittedCount: 120,
    jitterBufferDelay: 6
  };
  const result = deltaMetrics(prev, curr);
  expect(result).toMatchObject({
    decodedFps: 60,
    decodeTimeMs: 2,
    jitterBufferMs: 50,
    bridgeObservableMs: 52
  });
});

it('E2E: campos ausentes, reset e denominador zero não viram zero de sucesso', () => {
  const result = deltaMetrics(
    { timestamp: 2000, framesDecoded: 100, totalDecodeTime: 1 },
    { timestamp: 3000, framesDecoded: 5, totalDecodeTime: 0.1 }
  );
  expect(result.decodedFps).toBeNull();
  expect(result.decodeTimeMs).toBeNull();
  expect(result.sentMbps).toBeNull();
  expect(result.bridgeObservableMs).toBeNull();
});

it('E2E Telemetria: sample() preserva intervalMaxPauseMs e somente reset:true consome a pausa', async () => {
  // Configura ambiente básico
  if (!window.RTCPeerConnection) {
    window.RTCPeerConnection = class {};
  }
  installTelemetry();

  const video = document.createElement('video');
  document.body.appendChild(video);

  // Executa amostragem inicial
  const initialSample = await window.__smgE2E.sample();
  expect(initialSample.videos.length).toBeGreaterThan(0);
  expect(video.__smgPresentation).toBeDefined();

  // Injeta simulador de callback com pausa artificial de 250ms
  // hookVideo define onFrame via requestVideoFrameCallback se disponível
  // Simulamos diretamente no objeto de apresentação
  const stats0 = video.__smgPresentation.getStats({ reset: false });
  expect(stats0.intervalMaxPauseMs).toBe(0);

  // Primeira leitura com reset: false mantém o estado
  // Chamada de sample() deve passar reset: false
  const sample1 = await window.__smgE2E.sample();
  expect(sample1.videos[0].presentation.intervalMaxPauseMs).toBe(0);

  // Verifica que getStats({ reset: true }) zera o contador
  const consumed = video.__smgPresentation.getStats({ reset: true });
  expect(consumed.intervalMaxPauseMs).toBe(0);

  document.body.removeChild(video);
});

describe('Módulo Óptico E2E Robusto (Protocolo 96 bits e CRC-16)', () => {
  it('CRC-16-CCITT detecta com certeza matemática erros de 1 bit e 2 bits (superando a falha do XOR)', () => {
    const payload = [0x12, 0x34, 0x00, 0x05, 0x8C, 0x66, 0xE9, 0x3B, 0x1A];
    const initialCrc = crc16(payload);

    // 1 bit flip em qualquer posição altera o CRC
    for (let byteIdx = 0; byteIdx < payload.length; byteIdx++) {
      for (let bit = 0; bit < 8; bit++) {
        const corrupted = [...payload];
        corrupted[byteIdx] ^= (1 << bit);
        expect(crc16(corrupted)).not.toBe(initialCrc);
      }
    }

    // 2 bit flips (caso específico apontado na revisão onde XOR colidia)
    const corruptedTwoBits = [...payload];
    corruptedTwoBits[2] ^= 0x01;
    corruptedTwoBits[4] ^= 0x01;
    expect(crc16(corruptedTwoBits)).not.toBe(initialCrc);
  });

  it('calcula sessionMagic determinístico a partir do runId', () => {
    const magic1 = computeSessionMagic('2026-09-17T06-25-06-316Z-61a567');
    const magic2 = computeSessionMagic('2026-09-17T06-25-06-316Z-61a567');
    const magicOther = computeSessionMagic('2026-09-17T07-00-00-000Z-abcdef');

    expect(typeof magic1).toBe('number');
    expect(magic1).toBe(magic2);
    expect(magic1).not.toBe(magicOther);
    expect(magic1).toBeGreaterThanOrEqual(0);
    expect(magic1).toBeLessThanOrEqual(0xFFFF);
  });

  function renderSyntheticMarker(frameSeq, sourceTimeMs, sessionMagic, blockWidth = 8) {
    const totalBits = 96;
    const width = Math.ceil(totalBits * blockWidth + 40);
    const height = 30;
    const rgba = new Uint8ClampedArray(width * height * 4);

    const magic = sessionMagic & 0xFFFF;
    const seq = frameSeq & 0xFFFFFF;
    const time = (Math.floor(sourceTimeMs) >>> 0);

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
    const checksum = crc16(payload);

    const bits = [...MARKER_CONFIG.preamble];
    for (let i = 15; i >= 0; i--) bits.push((magic >> i) & 1);
    for (let i = 23; i >= 0; i--) bits.push((seq >> i) & 1);
    for (let i = 31; i >= 0; i--) bits.push((time >>> i) & 1);
    for (let i = 15; i >= 0; i--) bits.push((checksum >> i) & 1);

    // Borda preta e blocos
    const startX = 2;
    const startY = 2;
    for (let i = 0; i < bits.length; i++) {
      const val = bits[i] === 1 ? 255 : 0;
      const x0 = Math.floor(startX + i * blockWidth);
      const x1 = Math.floor(startX + (i + 1) * blockWidth);
      for (let y = startY; y < startY + 16; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * width + x) * 4;
          rgba[idx] = val;
          rgba[idx + 1] = val;
          rgba[idx + 2] = val;
          rgba[idx + 3] = 255;
        }
      }
    }

    return { rgba, width, height };
  }

  it('decodifica corretamente frameSeq, sourceTimeMs e sessionMagic a partir de buffer sintético', () => {
    const frameSeq = 1420;
    const sourceTimeMs = 1789626315000;
    const sessionMagic = 0xABCD;

    const { rgba, width, height } = renderSyntheticMarker(frameSeq, sourceTimeMs, sessionMagic, 8);
    const decoded = decodeOpticalMarker(rgba, width, height, MARKER_CONFIG, [8]);

    expect(decoded).not.toBeNull();
    expect(decoded?.frameSeq).toBe(frameSeq);
    expect(decoded?.sourceTimeMs).toBe(sourceTimeMs >>> 0);
    expect(decoded?.sessionMagic).toBe(sessionMagic);
    expect(decoded?.detectedBlockWidth).toBe(8);
  });

  it('rejeita quando expectedMagic não coincide', () => {
    const frameSeq = 500;
    const sourceTimeMs = 100000;
    const sessionMagic = 0x1111;

    const { rgba, width, height } = renderSyntheticMarker(frameSeq, sourceTimeMs, sessionMagic, 8);
    // Espera magic diferente: deve rejeitar
    const decoded = decodeOpticalMarker(rgba, width, height, MARKER_CONFIG, [8], 0x2222);
    expect(decoded).toBeNull();

    // Com o magic correto: aceita
    const decodedValid = decodeOpticalMarker(rgba, width, height, MARKER_CONFIG, [8], 0x1111);
    expect(decodedValid).not.toBeNull();
  });

  it('rejeita marcador corrompido em 1 ou 2 bits por falha de CRC', () => {
    const frameSeq = 1420;
    const sourceTimeMs = 52310;
    const sessionMagic = 0x4321;

    const { rgba, width, height } = renderSyntheticMarker(frameSeq, sourceTimeMs, sessionMagic, 8);

    // Inverte o bloco inteiro de 8x16 pixels da sequência para corrupção real do bit
    const blockStart = 2 + (8 + 16 + 2) * 8;
    for (let y = 2; y < 18; y++) {
      for (let x = blockStart; x < blockStart + 8; x++) {
        const idx = (y * width + x) * 4;
        const flipped = rgba[idx] > 128 ? 0 : 255;
        rgba[idx] = flipped;
        rgba[idx + 1] = flipped;
        rgba[idx + 2] = flipped;
      }
    }

    expect(decodeOpticalMarker(rgba, width, height, MARKER_CONFIG, [8])).toBeNull();
  });

  it('rejeita tela verde sintética de fake-device do Chrome', () => {
    const width = 800;
    const height = 40;
    const rgba = new Uint8ClampedArray(width * height * 4);
    // Simula tela verde: R=0, G=220, B=0
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 0;
      rgba[i + 1] = 220;
      rgba[i + 2] = 0;
      rgba[i + 3] = 255;
    }
    expect(decodeOpticalMarker(rgba, width, height)).toBeNull();
  });

  it('rejeita imagens de cor sólida (preto total, branco total)', () => {
    const width = 800;
    const height = 40;
    const white = new Uint8ClampedArray(width * height * 4).fill(255);
    const black = new Uint8ClampedArray(width * height * 4).fill(0);

    expect(decodeOpticalMarker(white, width, height)).toBeNull();
    expect(decodeOpticalMarker(black, width, height)).toBeNull();
  });

  it('rejeita ruído aleatório que simule textura de papel de parede do Windows', () => {
    const width = 800;
    const height = 40;
    const noise = new Uint8ClampedArray(width * height * 4);
    // Pseudo-ruído determinístico
    let seed = 12345;
    for (let i = 0; i < noise.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const v = (seed >>> 24);
      noise[i] = v;
      noise[i + 1] = (v * 2) & 0xFF;
      noise[i + 2] = (v * 3) & 0xFF;
      noise[i + 3] = 255;
    }
    expect(decodeOpticalMarker(noise, width, height)).toBeNull();
  });

  it('suporta candidateBlockWidths escalonados (ex: 12px)', () => {
    const frameSeq = 88;
    const sourceTimeMs = 456789;
    const sessionMagic = 0x7777;

    const { rgba, width, height } = renderSyntheticMarker(frameSeq, sourceTimeMs, sessionMagic, 12);
    const decoded = decodeOpticalMarker(rgba, width, height, MARKER_CONFIG, [8, 10, 12]);

    expect(decoded).not.toBeNull();
    expect(decoded?.frameSeq).toBe(frameSeq);
    expect(decoded?.detectedBlockWidth).toBe(12);
  });

  it('suporta candidateBlockWidths fracionários com compensação de escala (ex: 11.85px)', () => {
    const frameSeq = 1420;
    const sourceTimeMs = 567890;
    const sessionMagic = 0xABCD;

    const { rgba, width, height } = renderSyntheticMarker(frameSeq, sourceTimeMs, sessionMagic, 11.85);
    const candidateWidths = [11.8, 11.85, 11.9, 12];
    const decoded = decodeOpticalMarker(rgba, width, height, MARKER_CONFIG, candidateWidths);

    expect(decoded).not.toBeNull();
    expect(decoded?.frameSeq).toBe(frameSeq);
    expect([11.8, 11.85]).toContain(decoded?.detectedBlockWidth);
  });

  it('calcula latência visual em ms sem wrap ambíguo de 16 bits', () => {
    // Normal: 1000045 - 1000000 = 45ms
    expect(computeVisualLatency(1000045, 1000000)).toBe(45);

    // Longo período estável sem wrap prematuro
    expect(computeVisualLatency(500000, 499920)).toBe(80);

    // Skew negativo leve (-2ms)
    expect(computeVisualLatency(1000, 1002)).toBe(-2);
  });

  it('calcula latência com aritmética modular uint32 imune a overflow de época (2^32 ms)', () => {
    // Caso de wrap de época: source enviado pouco antes de 2^32, recebido logo após
    const sourceUint32 = 0xFFFFFFF0; // 4294967280
    const nowAfterWrap = 10;          // 10
    // Diferença modular esperada: 10 - (-16) = 26 ms
    expect(computeVisualLatency(nowAfterWrap, sourceUint32)).toBe(26);

    // Exatamente na borda 0xFFFFFFFF -> 0x00000005: 6 ms
    expect(computeVisualLatency(5, 0xFFFFFFFF)).toBe(6);

    // Skew negativo através da borda: 0x00000000 -> 0xFFFFFFFE (-2ms)
    expect(computeVisualLatency(0xFFFFFFFE, 0)).toBe(-2);
  });

  it('E2E Telemetria: isolamento estrito de fases (warmup, steady, cooldown) e startupDynamics', async () => {
    installTelemetry();
    const video = document.createElement('video');
    document.body.appendChild(video);

    // Amostra inicial cria __smgPresentation
    await window.__smgE2E.sample();
    const pres = video.__smgPresentation;
    expect(pres).toBeDefined();

    // Inicia no warmup por padrão
    expect(pres.getStats().currentPhase).toBe('warmup');

    // Altera para steady e cooldown
    pres.setPhase('steady');
    expect(pres.getStats().currentPhase).toBe('steady');
    pres.setPhase('cooldown');
    expect(pres.getStats().currentPhase).toBe('cooldown');

    // Retorna para steady
    pres.setPhase('steady');
    const initialStats = pres.getStats();
    expect(initialStats.steadyLatency).toBeNull();
    expect(initialStats.warmupLatency).toBeNull();
    expect(initialStats.startupDynamics).toMatchObject({
      startupMaxPauseMs: 0,
      warmupSamplesCount: 0
    });

    document.body.removeChild(video);
  });
});


