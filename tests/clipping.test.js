import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClipRecorder } from '../js/clipping.js';

class MockMediaRecorder {
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.state = 'inactive';
    this.ondataavailable = null;
    MockMediaRecorder.lastInstance = this;
  }

  start(timeslice) {
    this.state = 'recording';
    this.timeslice = timeslice;
  }

  stop() {
    this.state = 'inactive';
  }

  emitData(blob) {
    if (this.ondataavailable) {
      this.ondataavailable({ data: blob });
    }
  }
}

MockMediaRecorder.isTypeSupported = vi.fn((type) => type.includes('webm'));
MockMediaRecorder.lastInstance = null;

describe('Módulo: clipping.js (ClipRecorder)', () => {
  beforeEach(() => {
    globalThis.MediaRecorder = MockMediaRecorder;
    MockMediaRecorder.lastInstance = null;
    vi.clearAllMocks();
  });

  it('deve inicializar com opções padrão de 30 segundos', () => {
    const recorder = new ClipRecorder();
    expect(recorder.maxDurationSeconds).toBe(30);
    expect(recorder.isRecording).toBe(false);
    expect(recorder.chunks).toEqual([]);
  });

  it('deve iniciar gravação e capturar chunks no buffer', () => {
    const recorder = new ClipRecorder({ maxDurationSeconds: 5 });
    const mockStream = { id: 'test-stream', getTracks: () => [] };

    const started = recorder.start(mockStream);
    expect(started).toBe(true);
    expect(recorder.isRecording).toBe(true);

    const instance = MockMediaRecorder.lastInstance;
    expect(instance).not.toBeNull();

    // Simula emissão de dados
    const blob1 = new Blob(['chunk1'], { type: 'video/webm' });
    instance.emitData(blob1);

    expect(recorder.chunks.length).toBe(1);
    expect(recorder.chunks[0].blob).toBe(blob1);
  });

  it('deve descartar chunks mais antigos que maxDurationSeconds', () => {
    const recorder = new ClipRecorder({ maxDurationSeconds: 3 });
    const mockStream = { id: 'test-stream', getTracks: () => [] };
    recorder.start(mockStream);

    const instance = MockMediaRecorder.lastInstance;
    const now = Date.now();

    // Injeta chunks simulando passagens de tempo
    recorder.chunks.push({ blob: new Blob(['old']), timestamp: now - 5000 }); // 5s atrás
    recorder.chunks.push({ blob: new Blob(['mid']), timestamp: now - 2000 }); // 2s atrás

    // Novo chunk chega agora
    instance.emitData(new Blob(['new']));

    // O chunk de 5s atrás deve ter sido descartado
    expect(recorder.chunks.length).toBe(2);
    expect(recorder.chunks[0].timestamp).toBeGreaterThanOrEqual(now - 3000);
  });

  it('deve exportar clipe gerando um Blob consolidado', () => {
    const recorder = new ClipRecorder();
    recorder.chunks.push({ blob: new Blob(['hello ']), timestamp: Date.now() });
    recorder.chunks.push({ blob: new Blob(['world']), timestamp: Date.now() });

    const blob = recorder.exportClip('teste.webm');
    expect(blob).not.toBeNull();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('deve retornar null se tentar exportar sem nenhum chunk gravado', () => {
    const recorder = new ClipRecorder();
    expect(recorder.exportClip()).toBeNull();
  });

  it('deve armazenar e recuperar o clipe recente com getRecentClipBlob e hasRecentClip', () => {
    const recorder = new ClipRecorder();
    expect(recorder.hasRecentClip()).toBe(false);
    expect(recorder.getRecentClipBlob()).toBeNull();

    recorder.chunks.push({ blob: new Blob(['clip data']), timestamp: Date.now() });
    const exported = recorder.exportClip('meu-clip.webm');

    expect(recorder.hasRecentClip()).toBe(true);
    expect(recorder.getRecentClipBlob()).toBe(exported);
    expect(exported.fileName).toBe('meu-clip.webm');

    recorder.clear();
    expect(recorder.hasRecentClip()).toBe(false);
    expect(recorder.getRecentClipBlob()).toBeNull();
  });

  it('stop() deve parar o MediaRecorder e resetar o estado', () => {
    const recorder = new ClipRecorder();
    recorder.start({ id: 'test' });
    expect(recorder.isRecording).toBe(true);

    recorder.stop();
    expect(recorder.isRecording).toBe(false);
    expect(recorder.stream).toBeNull();
  });
});
