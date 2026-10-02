import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClipRecorder, ClipRecorderRegistry } from '../js/clipping.js';
import { bindClipEditor } from '../js/clipping/editor-controller.js';
import { createSessionContext } from '../js/core/session-context.js';

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

  it('deve selecionar MIME type sem áudio se o stream não tiver trilhas de áudio', () => {
    const recorder = new ClipRecorder();
    const mimeWithAudio = recorder._resolveSupportedMimeType(true);
    const mimeVideoOnly = recorder._resolveSupportedMimeType(false);

    expect(mimeWithAudio).toContain('opus');
    expect(mimeVideoOnly).not.toContain('opus');
  });

  it('flushPendingData deve chamar requestData no MediaRecorder ativo', async () => {
    const recorder = new ClipRecorder();
    const mockStream = { id: 'test', getTracks: () => [], getAudioTracks: () => [] };
    recorder.start(mockStream);

    const instance = MockMediaRecorder.lastInstance;
    instance.requestData = vi.fn(() => {
      instance.emitData(new Blob(['flushed-data']));
    });

    await recorder.flushPendingData();
    expect(instance.requestData).toHaveBeenCalled();
    expect(recorder.chunks.length).toBe(1);
  });

  it('deve alinhar chunks recentes ao primeiro marcador de cluster WebM ao exportar após rotação circular', async () => {
    const recorder = new ClipRecorder({ maxDurationSeconds: 3 });
    const clusterMarker = [0x1f, 0x43, 0xb6, 0x75];

    // Chunk de inicialização: cabeçalho EBML + primeiro cluster
    const header = [0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0xff];
    const cluster = [...clusterMarker, 0xff, 0xe7, 0x82, 0x0f, 0xa0, 0xa3, 0x85, 0x81, 0, 0, 0x80, 0];
    const initPayload = new Uint8Array([...header, ...cluster]);
    // Chunk recente com 10 bytes de resíduos parciais antes do marcador de cluster
    const garbageBytes = [0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55];
    const recentPayload = new Uint8Array([...garbageBytes, ...cluster]);

    const now = Date.now();
    recorder.initializationChunk = { blob: new Blob([initPayload], { type: 'video/webm' }), timestamp: now - 10000 };
    recorder.chunks = [
      recorder.initializationChunk,
      { blob: new Blob([recentPayload], { type: 'video/webm' }), timestamp: now - 1000 }
    ];

    const clip = await recorder.exportClip('aligned-test.webm');
    expect(clip).toBeTruthy();
    const clipBytes = new Uint8Array(await clip.arrayBuffer());

    expect(clipBytes.slice(0, header.length)).toEqual(new Uint8Array(header));
    expect(clipBytes.slice(header.length, header.length + 4)).toEqual(new Uint8Array(clusterMarker));
    expect(clipBytes.slice(header.length + 7, header.length + 9)).toEqual(new Uint8Array([0, 0]));
  });

  it('deve manter todos os chunks quando maxDurationSeconds for 0 (Full / Toda a Sessão)', () => {
    const recorder = new ClipRecorder({ maxDurationSeconds: 0 });
    const mockStream = { id: 'test-full-stream', getTracks: () => [] };
    recorder.start(mockStream);

    const instance = MockMediaRecorder.lastInstance;
    const now = Date.now();

    // Injeta chunks antigos (de 10 minutos atrás)
    recorder.chunks.push({ blob: new Blob(['chunk-10min']), timestamp: now - 600000 });
    recorder.chunks.push({ blob: new Blob(['chunk-5min']), timestamp: now - 300000 });

    instance.emitData(new Blob(['new-chunk']));

    // Nenhum chunk deve ser descartado pois maxDurationSeconds é 0 (Full)
    expect(recorder.chunks.length).toBe(3);
  });

  it('ClipRecorderRegistry deve permitir alterar maxDurationSeconds dinamicamente', () => {
    const registry = new ClipRecorderRegistry({ maxDurationSeconds: 30 });
    expect(registry.getMaxDurationSeconds()).toBe(30);

    const mockStream = { id: 'stream-1', getTracks: () => [] };
    registry.start(mockStream, 'cam1');

    const rec = registry.getRecorder('cam1');
    expect(rec.maxDurationSeconds).toBe(30);

    // Altera para 60 segundos
    registry.setMaxDurationSeconds(60);
    expect(registry.getMaxDurationSeconds()).toBe(60);
    expect(rec.maxDurationSeconds).toBe(60);

    // Altera para 0 (Full)
    registry.setMaxDurationSeconds(0);
    expect(registry.getMaxDurationSeconds()).toBe(0);
    expect(rec.maxDurationSeconds).toBe(0);
  });
});

describe('R5: Atalhos "Clip This" no ÁudioMaker / Clipping (bindClipEditor)', () => {
  let session;
  let mockRecorder;
  let showToastSpy;
  let container;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    container.innerHTML = `
      <button id="clip-btn">Clip</button>
      <select id="clip-buffer-duration-select">
        <option value="30">30s</option>
      </select>
      <div id="clip-post-modal" style="display:none;"></div>
    `;
    document.body.appendChild(container);

    mockRecorder = {
      exportClip: vi.fn().mockResolvedValue(new Blob(['video-clip'], { type: 'video/webm' })),
      setMaxDurationSeconds: vi.fn((s) => s)
    };
    showToastSpy = vi.fn();
    session = createSessionContext({ role: 'streamer' });
  });

  afterEach(() => {
    session.dispose();
    container.remove();
    vi.useRealTimers();
  });

  it('deve disparar exportClip e emitir toast com atalho Alt+C', async () => {
    bindClipEditor(session, {
      recorder: mockRecorder,
      showToast: showToastSpy,
      getPeerId: () => 'my-peer'
    });

    const event = new KeyboardEvent('keydown', { key: 'c', altKey: true, bubbles: true });
    window.dispatchEvent(event);

    expect(showToastSpy).toHaveBeenCalledWith(expect.stringContaining('Gravando'), 'info');
    expect(mockRecorder.exportClip).toHaveBeenCalled();
  });

  it('deve disparar exportClip com atalho Ctrl+Shift+C', async () => {
    bindClipEditor(session, {
      recorder: mockRecorder,
      showToast: showToastSpy,
      getPeerId: () => 'my-peer'
    });

    const event = new KeyboardEvent('keydown', { key: 'C', ctrlKey: true, shiftKey: true, bubbles: true });
    window.dispatchEvent(event);

    expect(mockRecorder.exportClip).toHaveBeenCalled();
  });

  it('deve ignorar atalho simples C quando digitado dentro de input ou textarea', async () => {
    bindClipEditor(session, {
      recorder: mockRecorder,
      showToast: showToastSpy,
      getPeerId: () => 'my-peer'
    });

    const input = document.createElement('input');
    container.appendChild(input);

    const event = new KeyboardEvent('keydown', { key: 'c', bubbles: true });
    Object.defineProperty(event, 'target', { value: input, configurable: true });
    window.dispatchEvent(event);

    expect(mockRecorder.exportClip).not.toHaveBeenCalled();
  });

  it('deve aplicar debounce e ignorar múltiplos disparos em menos de 1500ms', async () => {
    bindClipEditor(session, {
      recorder: mockRecorder,
      showToast: showToastSpy,
      getPeerId: () => 'my-peer'
    });

    // Primeiro disparo
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', altKey: true, bubbles: true }));
    expect(mockRecorder.exportClip).toHaveBeenCalledTimes(1);

    // Segundo disparo imediato (500ms depois)
    vi.advanceTimersByTime(500);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', altKey: true, bubbles: true }));
    expect(mockRecorder.exportClip).toHaveBeenCalledTimes(1); // Bloqueado pelo debounce

    // Terceiro disparo após debounce (1600ms depois)
    vi.advanceTimersByTime(1100);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', altKey: true, bubbles: true }));
    expect(mockRecorder.exportClip).toHaveBeenCalledTimes(2);
  });

  it('deve detectar combo no Gamepad (Select/Back + R1) e acionar clip', async () => {
    const mockGamepad = {
      connected: true,
      buttons: Array(17).fill({ pressed: false, value: 0 })
    };
    globalThis.navigator.getGamepads = () => [mockGamepad];

    let animCallback = null;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      animCallback = cb;
      return 999;
    });

    bindClipEditor(session, {
      recorder: mockRecorder,
      showToast: showToastSpy,
      getPeerId: () => 'my-peer'
    });

    // Pressiona Select (botão 8) e R1 (botão 5)
    mockGamepad.buttons[8] = { pressed: true, value: 1.0 };
    mockGamepad.buttons[5] = { pressed: true, value: 1.0 };

    if (animCallback) animCallback();

    expect(mockRecorder.exportClip).toHaveBeenCalled();
  });
});
