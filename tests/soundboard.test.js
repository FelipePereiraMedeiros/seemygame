import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoundboardManager, SOUNDBOARD_PRESETS } from '../js/soundboard.js';

class MockOscillator {
  constructor() {
    this.type = 'sine';
    this.frequency = {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    };
    this.connect = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
  }
}

class MockGain {
  constructor() {
    this.gain = {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    };
    this.connect = vi.fn();
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
    this.state = 'running';
  }
  createOscillator() { return new MockOscillator(); }
  createGain() { return new MockGain(); }
  resume() { return Promise.resolve(); }
}

describe('Módulo: soundboard.js (SoundboardManager)', () => {
  let manager;

  beforeEach(() => {
    globalThis.AudioContext = MockAudioContext;
    globalThis.window = globalThis;
    manager = new SoundboardManager({ cooldownMs: 300 });
  });

  it('deve exportar lista de presets válidos com ícones e nomes', () => {
    expect(SOUNDBOARD_PRESETS.length).toBeGreaterThanOrEqual(6);
    const ids = SOUNDBOARD_PRESETS.map(p => p.id);
    expect(ids).toContain('victory');
    expect(ids).toContain('hitmark');
    expect(ids).toContain('airhorn');
    expect(ids).toContain('boom');
  });

  it('canPlay() deve controlar o intervalo mínimo entre acionamentos', () => {
    expect(manager.canPlay()).toBe(true);
    expect(manager.canPlay()).toBe(false);
  });

  it('playSound() deve sintetizar corretamente todos os presets suportados', () => {
    expect(manager.playSound('victory')).toBe(true);
    expect(manager.playSound('hitmark')).toBe(true);
    expect(manager.playSound('airhorn')).toBe(true);
    expect(manager.playSound('laser')).toBe(true);
    expect(manager.playSound('boom')).toBe(true);
    expect(manager.playSound('gg')).toBe(true);
  });

  it('playSound() deve retornar false se id de som for desconhecido', () => {
    expect(manager.playSound('non-existent')).toBe(false);
  });
});
