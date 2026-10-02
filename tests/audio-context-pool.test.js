import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { audioContextPool, getSharedAudioContext } from '../js/core/audio-context-pool.js';

describe('Kernel Core: AudioContextPool', () => {
  beforeEach(() => {
    audioContextPool.close();
  });

  afterEach(() => {
    audioContextPool.close();
  });

  it('deve retornar a mesma instância singleton ativa de AudioContext', () => {
    const ctx1 = getSharedAudioContext();
    const ctx2 = getSharedAudioContext();

    expect(ctx1).not.toBeNull();
    expect(ctx1).toBe(ctx2);
  });

  it('deve recriar uma nova instância caso a anterior seja fechada', () => {
    const ctx1 = getSharedAudioContext();
    expect(ctx1).not.toBeNull();

    audioContextPool.close();

    const ctx2 = getSharedAudioContext();
    expect(ctx2).not.toBeNull();
    expect(ctx2).not.toBe(ctx1);
  });
});
