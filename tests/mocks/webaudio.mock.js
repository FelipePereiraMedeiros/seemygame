import { vi } from 'vitest';

export class MockAudioContext {
  constructor() {
    this.state = 'suspended';
  }

  async resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  async close() {
    this.state = 'closed';
    return Promise.resolve();
  }

  createMediaStreamSource(stream) {
    return {
      stream,
      connect: vi.fn(),
      disconnect: vi.fn()
    };
  }

  createChannelSplitter(numberOfOutputs = 2) {
    return {
      numberOfOutputs,
      connect: vi.fn(),
      disconnect: vi.fn()
    };
  }

  createAnalyser() {
    return {
      fftSize: 2048,
      get frequencyBinCount() {
        return this.fftSize / 2;
      },
      getByteFrequencyData: vi.fn((array) => {
        array.fill(120);
      }),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
  }
}
