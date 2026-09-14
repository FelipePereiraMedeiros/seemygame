import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdaptiveBitrateController } from '../js/abr.js';

describe('Módulo: abr.js (AdaptiveBitrateController)', () => {
  let controller;
  let bitrateChangeSpy;

  beforeEach(() => {
    bitrateChangeSpy = vi.fn();
    controller = new AdaptiveBitrateController({
      targetBitrateBps: 8000000,
      minBitrateBps: 2000000,
      onBitrateChange: bitrateChangeSpy,
    });
  });

  it('deve inicializar com o bitrate alvo configurado', () => {
    expect(controller.currentBitrateBps).toBe(8000000);
    expect(controller.targetBitrateBps).toBe(8000000);
    expect(controller.minBitrateBps).toBe(2000000);
    expect(controller.isEnabled).toBe(true);
  });

  it('deve reduzir bitrate em 25% quando perda de pacotes for maior que 4%', () => {
    controller.processSample({ packetLossRate: 0.06, rttMs: 50 });

    expect(controller.currentBitrateBps).toBe(6000000); // 8M * 0.75
    expect(bitrateChangeSpy).toHaveBeenCalledWith(6000000);
  });

  it('deve reduzir bitrate quando latência RTT for muito alta (> 220ms)', () => {
    controller.processSample({ packetLossRate: 0.0, rttMs: 300 });

    expect(controller.currentBitrateBps).toBe(6000000);
  });

  it('não deve reduzir abaixo do bitrate mínimo', () => {
    controller.currentBitrateBps = 2200000;
    controller.processSample({ packetLossRate: 0.1, rttMs: 500 });

    expect(controller.currentBitrateBps).toBe(2000000); // travou em minBitrateBps
  });

  it('deve recuperar bitrate gradualmente após 4 amostras consecutivas saudáveis', () => {
    controller.currentBitrateBps = 4000000;

    // 3 amostras boas
    controller.processSample({ packetLossRate: 0.002, rttMs: 40 });
    controller.processSample({ packetLossRate: 0.001, rttMs: 42 });
    controller.processSample({ packetLossRate: 0.0, rttMs: 38 });
    expect(controller.currentBitrateBps).toBe(4000000);

    // 4ª amostra boa -> aciona incremento de 15%
    controller.processSample({ packetLossRate: 0.0, rttMs: 35 });
    expect(controller.currentBitrateBps).toBe(4600000); // 4M * 1.15
  });

  it('ao desativar ABR, deve restaurar imediatamente o targetBitrate', () => {
    controller.currentBitrateBps = 3000000;
    controller.setEnabled(false);

    expect(controller.currentBitrateBps).toBe(8000000);
    expect(bitrateChangeSpy).toHaveBeenCalledWith(8000000);
  });
});
