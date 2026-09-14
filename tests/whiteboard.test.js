import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhiteboardManager, WHITEBOARD_TOOLS, WHITEBOARD_COLORS } from '../js/whiteboard.js';

describe('Módulo: whiteboard.js (Lousa Interativa Estilo Excalidraw)', () => {
  let manager;
  let mockCanvas;
  let mockCtx;

  beforeEach(() => {
    mockCtx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 60 })),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillStyle: '#000000',
      strokeStyle: '#ffffff',
      lineWidth: 1,
    };

    mockCanvas = {
      width: 1920,
      height: 1080,
      getContext: vi.fn(() => mockCtx),
      getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: 960, height: 540 })),
      toDataURL: vi.fn(() => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
      toBlob: vi.fn((cb) => cb(new Blob(['png-data'], { type: 'image/png' }))),
    };

    manager = new WhiteboardManager();
    manager.setCanvas(mockCanvas);
  });

  describe('Presets e Configurações Iniciais', () => {
    it('deve exportar lista de ferramentas essenciais com ícones e atalhos', () => {
      expect(WHITEBOARD_TOOLS.length).toBeGreaterThanOrEqual(8);
      const ids = WHITEBOARD_TOOLS.map(t => t.id);
      expect(ids).toContain('pencil');
      expect(ids).toContain('rectangle');
      expect(ids).toContain('diamond');
      expect(ids).toContain('circle');
      expect(ids).toContain('arrow');
      expect(ids).toContain('line');
      expect(ids).toContain('text');
      expect(ids).toContain('eraser');
    });

    it('deve exportar paleta de cores moderna com 8 opções', () => {
      expect(WHITEBOARD_COLORS.length).toBe(8);
      expect(WHITEBOARD_COLORS).toContain('#ffffff');
      expect(WHITEBOARD_COLORS).toContain('#ef4444');
      expect(WHITEBOARD_COLORS).toContain('#10b981');
    });

    it('deve inicializar com parâmetros padrão adequados', () => {
      expect(manager.selectedTool).toBe('pencil');
      expect(manager.currentColor).toBe('#ffffff');
      expect(manager.currentWidth).toBe(4);
      expect(manager.currentFill).toBe('none');
      expect(manager.isRough).toBe(true);
      expect(manager.backgroundMode).toBe('dark');
      expect(manager.elements).toEqual([]);
    });

    it('setters devem atualizar os parâmetros e renderizar', () => {
      manager.setTool('rectangle');
      expect(manager.selectedTool).toBe('rectangle');

      manager.setColor('#10b981');
      expect(manager.currentColor).toBe('#10b981');

      manager.setStrokeWidth(8);
      expect(manager.currentWidth).toBe(8);

      manager.setFill('semi');
      expect(manager.currentFill).toBe('semi');

      manager.setRough(false);
      expect(manager.isRough).toBe(false);

      manager.setBackgroundMode('light');
      expect(manager.backgroundMode).toBe('light');
    });
  });

  describe('Adição, Remoção e Histórico (Undo / Redo)', () => {
    it('addElement deve adicionar elemento e acionar callback onElementCreated', () => {
      const onCreatedSpy = vi.fn();
      manager.onElementCreated = onCreatedSpy;

      const el = { id: 'el_1', type: 'rectangle', startX: 10, startY: 10, endX: 100, endY: 80 };
      manager.addElement(el);

      expect(manager.elements.length).toBe(1);
      expect(manager.elements[0]).toBe(el);
      expect(manager.undoStack.length).toBe(1);
      expect(onCreatedSpy).toHaveBeenCalledWith(el);
    });

    it('removeElement deve remover elemento por id e acionar onElementDeleted', () => {
      const onDeletedSpy = vi.fn();
      manager.onElementDeleted = onDeletedSpy;

      const el = { id: 'el_target', type: 'circle', startX: 50, startY: 50, endX: 120, endY: 120 };
      manager.addElement(el);
      expect(manager.elements.length).toBe(1);

      manager.removeElement('el_target');
      expect(manager.elements.length).toBe(0);
      expect(onDeletedSpy).toHaveBeenCalledWith(el);
    });

    it('undo e redo devem navegar fielmente pelo histórico de modificações', () => {
      expect(manager.undo()).toBe(false); // pilha vazia

      const el1 = { id: '1', type: 'line', startX: 0, startY: 0, endX: 50, endY: 50 };
      const el2 = { id: '2', type: 'arrow', startX: 50, startY: 50, endX: 150, endY: 100 };

      manager.addElement(el1);
      manager.addElement(el2);
      expect(manager.elements.length).toBe(2);

      // Desfazer adição do el2
      expect(manager.undo()).toBe(true);
      expect(manager.elements.length).toBe(1);
      expect(manager.elements[0].id).toBe('1');

      // Desfazer adição do el1
      expect(manager.undo()).toBe(true);
      expect(manager.elements.length).toBe(0);

      // Refazer adição do el1
      expect(manager.redo()).toBe(true);
      expect(manager.elements.length).toBe(1);
      expect(manager.elements[0].id).toBe('1');

      // Refazer adição do el2
      expect(manager.redo()).toBe(true);
      expect(manager.elements.length).toBe(2);

      expect(manager.redo()).toBe(false); // nada mais para refazer
    });

    it('clear deve limpar a lousa e disparar onBoardCleared', () => {
      const onClearedSpy = vi.fn();
      manager.onBoardCleared = onClearedSpy;

      manager.addElement({ id: '1', type: 'pencil', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] });
      manager.clear();

      expect(manager.elements.length).toBe(0);
      expect(onClearedSpy).toHaveBeenCalled();

      // Pode desfazer o clear
      expect(manager.undo()).toBe(true);
      expect(manager.elements.length).toBe(1);
    });
  });

  describe('Renderização e Formas Excalidraw (Hand-drawn)', () => {
    it('render() deve desenhar fundo dark com grade de pontos e elementos', () => {
      manager.setBackgroundMode('dark');
      manager.addElement({ id: 'rec', type: 'rectangle', startX: 20, startY: 20, endX: 80, endY: 60, rough: true });

      manager.render();

      expect(mockCtx.clearRect).toHaveBeenCalled();
      expect(mockCtx.fillRect).toHaveBeenCalled(); // fundo dark
      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.stroke).toHaveBeenCalled();
    });

    it('render() em modo transparent não deve preencher o fundo (overlay mode)', () => {
      manager.setBackgroundMode('transparent');
      mockCtx.fillRect.mockClear();

      manager.render();

      expect(mockCtx.clearRect).toHaveBeenCalled();
      expect(mockCtx.fillRect).not.toHaveBeenCalled();
    });

    it('deve renderizar todas as formas geométricas: pencil, diamond, circle, arrow, line, text', () => {
      manager.addElement({ id: 'p', type: 'pencil', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }] });
      manager.addElement({ id: 'd', type: 'diamond', startX: 100, startY: 100, endX: 150, endY: 150, fill: 'semi' });
      manager.addElement({ id: 'c', type: 'circle', startX: 200, startY: 200, endX: 250, endY: 250, rough: true });
      manager.addElement({ id: 'a', type: 'arrow', startX: 300, startY: 300, endX: 350, endY: 320 });
      manager.addElement({ id: 'l', type: 'line', startX: 400, startY: 400, endX: 450, endY: 450, rough: false });
      manager.addElement({ id: 't', type: 'text', x: 500, y: 500, text: 'Gamer Note' });

      expect(() => manager.render()).not.toThrow();
      expect(mockCtx.fillText).toHaveBeenCalledWith('Gamer Note', 500, 500);
      expect(mockCtx.ellipse).toHaveBeenCalled();
    });
  });

  describe('Cursores Colaborativos Remotos', () => {
    it('updateRemoteCursor deve salvar cursor e renderizar etiqueta na tela', () => {
      manager.updateRemoteCursor('peer-123', { x: 0.5, y: 0.5, userName: 'Felipe', color: '#10b981' });

      expect(manager.remoteCursors.has('peer-123')).toBe(true);
      const cursor = manager.remoteCursors.get('peer-123');
      expect(cursor.userName).toBe('Felipe');

      manager.render();
      expect(mockCtx.fillText).toHaveBeenCalledWith('Felipe', expect.any(Number), expect.any(Number));
    });

    it('removeRemoteCursor deve remover cursor do mapa', () => {
      manager.updateRemoteCursor('peer-leave', { x: 0.2, y: 0.2, userName: 'Saindo' });
      expect(manager.remoteCursors.has('peer-leave')).toBe(true);

      manager.removeRemoteCursor('peer-leave');
      expect(manager.remoteCursors.has('peer-leave')).toBe(false);
    });
  });

  describe('Borracha (Eraser) e Hit Testing', () => {
    it('eraseAt deve remover elemento que colide com as coordenadas do clique', () => {
      const rect = { id: 'box', type: 'rectangle', startX: 50, startY: 50, endX: 100, endY: 100 };
      manager.addElement(rect);
      expect(manager.elements.length).toBe(1);

      // Clica longe do retângulo -> não deve apagar
      manager.eraseAt(400, 400);
      expect(manager.elements.length).toBe(1);

      // Clica dentro do retângulo -> deve apagar
      manager.eraseAt(75, 75);
      expect(manager.elements.length).toBe(0);
    });
  });

  describe('Exportação de Imagem', () => {
    it('exportToBlob deve retornar Blob do canvas', async () => {
      const blob = await manager.exportToBlob();
      expect(blob).not.toBeNull();
      expect(blob.type).toBe('image/png');
    });

    it('exportToDataUrl deve retornar string dataURL válida', () => {
      const dataUrl = manager.exportToDataUrl();
      expect(dataUrl.startsWith('data:image/png')).toBe(true);
    });
  });
});
