import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initWhiteboard,
  handleIncomingP2PMessage,
  setupIncomingDataConnection,
  broadcastDataMessage,
  openWhiteboardModal,
  closeWhiteboardModal,
  toggleWhiteboardModal
} from '../js/app.js';
import { whiteboardManager } from '../js/whiteboard.js';

class MockDataConnection {
  constructor(peer) {
    this.peer = peer;
    this.open = true;
    this.events = {};
    this.send = vi.fn();
    this.close = vi.fn(() => {
      if (this.events['close']) this.events['close']();
    });
  }

  on(event, cb) {
    this.events[event] = cb;
  }

  emit(event, ...args) {
    if (this.events[event]) {
      this.events[event](...args);
    }
  }
}

describe('Suíte de Testes: Lousa Interativa durante Transmissão (Streaming & Room Mode)', () => {
  let mockCtx;
  let mockCanvas;

  beforeEach(() => {
    vi.clearAllMocks();
    whiteboardManager.clear(false);

    document.body.innerHTML = `
      <div id="toast-container"></div>
      
      <!-- Stage de Transmissão / Vídeo -->
      <section class="room-stage" id="room-stage">
        <video id="remote-video"></video>
        <video id="local-video-preview"></video>
        <div id="reactions-dock" style="display: none;"></div>
      </section>

      <!-- Botão da Header -->
      <button id="toggle-whiteboard-btn" class="discord-toggle-btn"><span>🎨</span> Lousa</button>

      <!-- Botão do Dock Inferior (usado pelo streamer durante a transmissão) -->
      <div id="bottom-control-dock">
        <button id="dock-stream-btn" class="dock-btn dock-btn-stream">
          <span>🚀</span> <span class="dock-label">Transmitir Jogo</span>
        </button>
        <button id="dock-whiteboard-btn" class="dock-btn">
          <span>🎨</span> <span class="dock-label">Lousa</span>
        </button>
      </div>

      <!-- Modal da Lousa Interativa -->
      <div id="whiteboard-modal" class="whiteboard-overlay" style="display: none;">
        <div class="whiteboard-topbar">
          <button class="wb-tool-btn active" data-tool="pencil">✏️</button>
          <button class="wb-tool-btn" data-tool="rectangle">⬜</button>
          <button class="wb-tool-btn" data-tool="circle">⭕</button>
          <button id="wb-close-btn" class="wb-close-btn">✕</button>
        </div>

        <div class="whiteboard-stylebar">
          <div id="wb-color-group">
            <button class="wb-color-dot active" data-color="#ffffff"></button>
            <button class="wb-color-dot" data-color="#ef4444"></button>
          </div>
          <div id="wb-width-group">
            <button class="wb-opt-btn active" data-width="4">4px</button>
          </div>
          <div id="wb-fill-group">
            <button class="wb-opt-btn active" data-fill="none">Vazio</button>
          </div>
          <div id="wb-rough-group">
            <button class="wb-opt-btn active" data-rough="false">Preciso</button>
          </div>
          <div id="wb-bg-group">
            <button class="wb-opt-btn active" data-bg="dark">Escuro</button>
            <button class="wb-opt-btn" data-bg="transparent">Sobre o Jogo</button>
          </div>
        </div>

        <canvas id="whiteboard-canvas" class="whiteboard-canvas" width="1280" height="720"></canvas>
      </div>
    `;

    mockCtx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      measureText: vi.fn(() => ({ width: 40 })),
      fillText: vi.fn(),
      quadraticCurveTo: vi.fn(),
      fillStyle: '#000000',
      strokeStyle: '#ffffff',
      lineWidth: 1
    };

    mockCanvas = document.getElementById('whiteboard-canvas');
    if (mockCanvas) {
      mockCanvas.getContext = vi.fn(() => mockCtx);
      mockCanvas.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        width: 1280,
        height: 720
      }));
    }
  });

  afterEach(() => {
    whiteboardManager.clear(false);
  });

  it('1. initWhiteboard deve vincular o canvas e o botão dock-whiteboard-btn para abertura e fechamento', () => {
    initWhiteboard();

    const dockBtn = document.getElementById('dock-whiteboard-btn');
    const modal = document.getElementById('whiteboard-modal');
    expect(modal.style.display).toBe('none');

    // Clica no dock para abrir a lousa enquanto transmite
    dockBtn.click();
    expect(modal.style.display).toBe('flex');
    expect(whiteboardManager.canvas).toBe(mockCanvas);
    expect(typeof mockCanvas.onmousedown).toBe('function');
    expect(dockBtn.classList.contains('is-active') || dockBtn.classList.contains('active')).toBe(true);

    // Clica novamente no dock para fechar
    dockBtn.click();
    expect(modal.style.display).toBe('none');
    expect(dockBtn.classList.contains('is-active')).toBe(false);
  });

  it('2. desenhar na lousa aberta via dock deve registrar elementos e disparar onElementCreated', () => {
    initWhiteboard();

    const dockBtn = document.getElementById('dock-whiteboard-btn');
    dockBtn.click(); // Abre a lousa

    const elementCreatedSpy = vi.fn();
    whiteboardManager.onElementCreated = elementCreatedSpy;

    // Simula traço com a caneta (pencil)
    mockCanvas.onmousedown({
      preventDefault: vi.fn(),
      clientX: 100,
      clientY: 100
    });

    mockCanvas.onmousemove({
      preventDefault: vi.fn(),
      clientX: 150,
      clientY: 150
    });

    // Dispara mouseup para finalizar o traço
    window.dispatchEvent(new MouseEvent('mouseup'));

    expect(whiteboardManager.elements.length).toBe(1);
    expect(whiteboardManager.elements[0].type).toBe('pencil');
    expect(whiteboardManager.elements[0].points.length).toBeGreaterThan(1);
    expect(elementCreatedSpy).toHaveBeenCalled();
  });

  it('3. tecla Escape deve fechar a lousa interativa', () => {
    initWhiteboard();

    const dockBtn = document.getElementById('dock-whiteboard-btn');
    const modal = document.getElementById('whiteboard-modal');

    dockBtn.click();
    expect(modal.style.display).toBe('flex');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.style.display).toBe('none');
  });

  it('4. modo de fundo "Sobre o Jogo" (transparent) deve configurar transparência para sobreposição ao vídeo', () => {
    initWhiteboard();

    const dockBtn = document.getElementById('dock-whiteboard-btn');
    dockBtn.click();

    const transparentBtn = document.querySelector('#wb-bg-group [data-bg="transparent"]');
    transparentBtn.click();

    const modal = document.getElementById('whiteboard-modal');
    expect(modal.style.background).toBe('transparent');
    expect(whiteboardManager.backgroundMode).toBe('transparent');
  });

  it('5. mensagens P2P de WHITEBOARD_ não podem ser descartadas pelo listener de dados da conexão de streaming', () => {
    localStorage.clear();
    const conn = new MockDataConnection('viewer-1');
    setupIncomingDataConnection(conn);
    conn.emit('open');

    const addElementSpy = vi.spyOn(whiteboardManager, 'addElement');
    const clearSpy = vi.spyOn(whiteboardManager, 'clear');
    const cursorSpy = vi.spyOn(whiteboardManager, 'updateRemoteCursor');

    // Emite WHITEBOARD_ELEMENT_ADD como se viesse do WebRTC durante streaming
    conn.emit('data', {
      type: 'WHITEBOARD_ELEMENT_ADD',
      element: {
        id: 'wb-test-remote',
        type: 'rectangle',
        startX: 50,
        startY: 50,
        endX: 200,
        endY: 150,
        color: '#ef4444',
        strokeWidth: 4
      }
    });

    expect(addElementSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'wb-test-remote' }), false);

    // Emite WHITEBOARD_CURSOR
    conn.emit('data', {
      type: 'WHITEBOARD_CURSOR',
      x: 0.25,
      y: 0.75,
      userName: 'AmigoViewer',
      color: '#10b981'
    });

    expect(cursorSpy).toHaveBeenCalledWith('viewer-1', expect.objectContaining({ userName: 'AmigoViewer' }));

    // Emite WHITEBOARD_CLEAR
    conn.emit('data', { type: 'WHITEBOARD_CLEAR' });
    expect(clearSpy).toHaveBeenCalledWith(false);
  });

  it('6. solicitação WHITEBOARD_REQUEST_SYNC deve responder com WHITEBOARD_SYNC e os elementos da lousa', () => {
    localStorage.clear();
    const conn = new MockDataConnection('viewer-2');
    setupIncomingDataConnection(conn);
    conn.emit('open');

    whiteboardManager.elements = [
      { id: 'el-1', type: 'circle', startX: 10, startY: 10, endX: 30, endY: 30 }
    ];

    conn.emit('data', { type: 'WHITEBOARD_REQUEST_SYNC' });

    expect(conn.send).toHaveBeenCalledWith({
      type: 'WHITEBOARD_SYNC',
      elements: expect.arrayContaining([expect.objectContaining({ id: 'el-1' })])
    });
  });
});
