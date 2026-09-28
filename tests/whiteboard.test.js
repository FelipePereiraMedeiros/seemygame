import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WhiteboardManager,
  WHITEBOARD_TOOLS,
  WHITEBOARD_COLORS,
  CURSOR_PALETTE,
  getPeerCursorColor,
  isTooBrightOrWhite,
  getContrastTextColor,
  drawRoundedRect,
  getFillAlpha,
  isSafeWhiteboardElement
} from '../js/whiteboard.js';

describe('Módulo: whiteboard.js (Lousa Interativa Estilo Excalidraw)', () => {
  let manager;
  let mockCanvas;
  let mockCtx;

  beforeEach(() => {
    const stateStack = [];
    mockCtx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      drawImage: vi.fn(),
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
      save: vi.fn(() => {
        stateStack.push({
          fillStyle: mockCtx.fillStyle,
          strokeStyle: mockCtx.strokeStyle,
          lineWidth: mockCtx.lineWidth,
          globalAlpha: mockCtx.globalAlpha ?? 1.0,
        });
      }),
      restore: vi.fn(() => {
        const prev = stateStack.pop();
        if (prev) {
          mockCtx.fillStyle = prev.fillStyle;
          mockCtx.strokeStyle = prev.strokeStyle;
          mockCtx.lineWidth = prev.lineWidth;
          mockCtx.globalAlpha = prev.globalAlpha;
        }
      }),
      scale: vi.fn(),
      fillStyle: '#000000',
      strokeStyle: '#ffffff',
      lineWidth: 1,
      globalAlpha: 1.0,
    };

    mockCanvas = {
      width: 1920,
      height: 1080,
      style: { cursor: 'default' },
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
      expect(WHITEBOARD_TOOLS.length).toBeGreaterThanOrEqual(10);
      const ids = WHITEBOARD_TOOLS.map(t => t.id);
      expect(ids).toContain('select');
      expect(ids).toContain('pencil');
      expect(ids).toContain('rectangle');
      expect(ids).toContain('diamond');
      expect(ids).toContain('circle');
      expect(ids).toContain('arrow');
      expect(ids).toContain('line');
      expect(ids).toContain('text');
      expect(ids).toContain('image');
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

    it('getFillAlpha deve retornar 1.0 para solid/true e 0.25 para semi', () => {
      expect(getFillAlpha('solid')).toBe(1.0);
      expect(getFillAlpha(true)).toBe(1.0);
      expect(getFillAlpha('semi')).toBe(0.25);
      expect(getFillAlpha(0.6)).toBe(0.6);
      expect(getFillAlpha('none')).toBe(1.0);
    });

    it('renderRectangle e renderCircle com fill solid devem aplicar opacidade 100% (globalAlpha = 1.0)', () => {
      let alphaDuringFill = null;
      mockCtx.fillRect.mockImplementation(() => {
        alphaDuringFill = mockCtx.globalAlpha;
      });

      const rectEl = { id: 'rect_solid', type: 'rectangle', startX: 10, startY: 10, endX: 100, endY: 100, color: '#ef4444', fill: 'solid' };
      manager.addElement(rectEl);
      manager.render();

      expect(mockCtx.fillRect).toHaveBeenCalledWith(10, 10, 90, 90);
      expect(alphaDuringFill).toBe(1.0);
      expect(mockCtx.globalAlpha).toBe(1.0);
    });

    it('renderRectangle com fill semi deve aplicar opacidade 0.25 (globalAlpha = 0.25)', () => {
      let alphaDuringFill = null;
      mockCtx.fillRect.mockImplementation(() => {
        alphaDuringFill = mockCtx.globalAlpha;
      });

      const rectEl = { id: 'rect_semi', type: 'rectangle', startX: 10, startY: 10, endX: 100, endY: 100, color: '#ef4444', fill: 'semi' };
      manager.addElement(rectEl);
      manager.render();

      expect(alphaDuringFill).toBe(0.25);
      expect(mockCtx.globalAlpha).toBe(1.0);
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

    it('isTooBrightOrWhite deve identificar branco puro e cores quase-brancas', () => {
      expect(isTooBrightOrWhite('#ffffff')).toBe(true);
      expect(isTooBrightOrWhite('#fff')).toBe(true);
      expect(isTooBrightOrWhite('#f8fafc')).toBe(true);
      expect(isTooBrightOrWhite('#06b6d4')).toBe(false);
      expect(isTooBrightOrWhite('#10b981')).toBe(false);
    });

    it('getContrastTextColor deve garantir contraste entre fundo da badge e texto', () => {
      expect(getContrastTextColor('#ffffff')).toBe('#0f172a'); // Escuro no branco
      expect(getContrastTextColor('#f59e0b')).toBe('#0f172a'); // Âmbar claro -> escuro
      expect(getContrastTextColor('#8b5cf6')).toBe('#ffffff'); // Roxo -> claro
      expect(getContrastTextColor('#ef4444')).toBe('#ffffff'); // Vermelho -> claro
    });

    it('updateRemoteCursor não deve permitir cor #ffffff (retângulo branco sem texto)', () => {
      manager.updateRemoteCursor('peer-white', { x: 0.3, y: 0.3, userName: 'Diogo', color: '#ffffff' });
      const cursor = manager.remoteCursors.get('peer-white');
      expect(cursor.color).not.toBe('#ffffff');
      expect(CURSOR_PALETTE).toContain(cursor.color);
      expect(cursor.userName).toBe('Diogo');

      manager.render();
      expect(mockCtx.fillText).toHaveBeenCalledWith('Diogo', expect.any(Number), expect.any(Number));
    });

    it('getPeerCursorColor deve retornar cor determinística e vibrante por peerId', () => {
      const c1 = getPeerCursorColor('peer-alpha');
      const c2 = getPeerCursorColor('peer-alpha');
      expect(c1).toBe(c2);
      expect(CURSOR_PALETTE).toContain(c1);
    });

    it('drawRoundedRect deve funcionar tanto com ctx.roundRect nativo quanto com fallback', () => {
      const ctxFallback = {
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
      };
      drawRoundedRect(ctxFallback, 10, 10, 100, 20, 4);
      expect(ctxFallback.moveTo).toHaveBeenCalled();
      expect(ctxFallback.quadraticCurveTo).toHaveBeenCalled();

      const ctxNative = {
        roundRect: vi.fn(),
      };
      drawRoundedRect(ctxNative, 10, 10, 100, 20, 4);
      expect(ctxNative.roundRect).toHaveBeenCalledWith(10, 10, 100, 20, 4);
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

  describe('Seleção, Movimentação e Arrastar de Objetos (Select & Drag)', () => {
    it('findElementAt deve identificar o elemento correto sob as coordenadas', () => {
      const rect = { id: 'rect1', type: 'rectangle', startX: 100, startY: 100, endX: 200, endY: 200 };
      const circle = { id: 'circle1', type: 'circle', startX: 400, startY: 400, endX: 500, endY: 500 };
      manager.addElement(rect);
      manager.addElement(circle);

      expect(manager.findElementAt(150, 150)?.id).toBe('rect1');
      expect(manager.findElementAt(450, 450)?.id).toBe('circle1');
      expect(manager.findElementAt(50, 50)).toBeNull();
    });

    it('translateElement deve deslocar coordenadas de retângulos, círculos e setas', () => {
      const rect = { id: 'r', type: 'rectangle', startX: 10, startY: 20, endX: 110, endY: 120 };
      const initial = { ...rect };
      manager.translateElement(rect, initial, 30, 40);

      expect(rect.startX).toBe(40);
      expect(rect.startY).toBe(60);
      expect(rect.endX).toBe(140);
      expect(rect.endY).toBe(160);
    });

    it('translateElement deve deslocar traços livres (pencil) preservando a forma', () => {
      const pencil = {
        id: 'p',
        type: 'pencil',
        points: [{ x: 10, y: 10 }, { x: 20, y: 30 }, { x: 30, y: 50 }]
      };
      const initial = JSON.parse(JSON.stringify(pencil));
      manager.translateElement(pencil, initial, 15, -5);

      expect(pencil.points[0]).toEqual({ x: 25, y: 5 });
      expect(pencil.points[1]).toEqual({ x: 35, y: 25 });
      expect(pencil.points[2]).toEqual({ x: 45, y: 45 });
    });

    it('translateElement deve deslocar elementos de texto e imagem', () => {
      const text = { id: 't', type: 'text', x: 100, y: 150, text: 'Olá' };
      manager.translateElement(text, { ...text }, 25, 35);
      expect(text.x).toBe(125);
      expect(text.y).toBe(185);

      const img = {
        id: 'img1',
        type: 'image',
        x: 50,
        y: 60,
        startX: 50,
        startY: 60,
        endX: 250,
        endY: 260,
        dataUrl: 'data:image/png;base64,abc'
      };
      manager.translateElement(img, { ...img }, 50, 50);
      expect(img.x).toBe(100);
      expect(img.y).toBe(110);
      expect(img.startX).toBe(100);
      expect(img.startY).toBe(110);
      expect(img.endX).toBe(300);
      expect(img.endY).toBe(310);
    });

    it('updateElement deve atualizar o elemento no array e disparar onElementUpdated', () => {
      const updatedCb = vi.fn();
      manager.onElementUpdated = updatedCb;

      const rect = { id: 'rect-up', type: 'rectangle', startX: 10, startY: 10, endX: 100, endY: 100, color: '#ffffff' };
      manager.addElement(rect);

      const modified = { ...rect, color: '#ef4444', endX: 200 };
      manager.updateElement(modified, true);

      expect(manager.elements[0].color).toBe('#ef4444');
      expect(manager.elements[0].endX).toBe(200);
      expect(updatedCb).toHaveBeenCalledWith(modified);
    });

    it('deleteSelected deve remover elemento selecionado e limpar selectedElementId', () => {
      const deletedCb = vi.fn();
      manager.onElementDeleted = deletedCb;

      const rect = { id: 'rect-del', type: 'rectangle', startX: 10, startY: 10, endX: 50, endY: 50 };
      manager.addElement(rect);
      manager.selectedElementId = 'rect-del';

      const result = manager.deleteSelected();
      expect(result).toBe(true);
      expect(manager.elements.length).toBe(0);
      expect(manager.selectedElementId).toBeNull();
      expect(deletedCb).toHaveBeenCalledWith(expect.objectContaining({ id: 'rect-del' }));
    });

    it('render com elemento selecionado deve desenhar a caixa de seleção', () => {
      const rect = { id: 'box-sel', type: 'rectangle', startX: 100, startY: 100, endX: 200, endY: 200 };
      manager.addElement(rect);
      manager.selectedElementId = 'box-sel';

      manager.render();
      expect(mockCtx.strokeRect).toHaveBeenCalled();
      expect(mockCtx.setLineDash).toHaveBeenCalled();
    });
  });

  describe('Manipulação e Colagem de Imagens (Images & Paste)', () => {
    it('isSafeWhiteboardElement deve validar elementos de imagem válidos', () => {
      const safeImg = {
        id: 'wb_img_1',
        type: 'image',
        startX: 100,
        startY: 100,
        endX: 300,
        endY: 250,
        x: 100,
        y: 100,
        width: 200,
        height: 150,
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      };
      expect(isSafeWhiteboardElement(safeImg)).toBe(true);
    });

    it('isSafeWhiteboardElement deve rejeitar imagem sem dataUrl válido ou com dados perigosos', () => {
      expect(isSafeWhiteboardElement({
        id: 'bad1',
        type: 'image',
        startX: 0,
        startY: 0,
        endX: 10,
        endY: 10,
        dataUrl: 'javascript:alert(1)'
      })).toBe(false);

      expect(isSafeWhiteboardElement({
        id: 'bad2',
        type: 'image',
        startX: 0,
        startY: 0,
        endX: 10,
        endY: 10,
        dataUrl: 'http://malicious.site/img.png'
      })).toBe(false);

      // Rejeita payload maior que 2.5MB
      expect(isSafeWhiteboardElement({
        id: 'bad3',
        type: 'image',
        startX: 0,
        startY: 0,
        endX: 10,
        endY: 10,
        dataUrl: 'data:image/png;base64,' + 'a'.repeat(2_600_000)
      })).toBe(false);
    });

    it('renderImage deve desenhar imagem no canvas sem lançar erro', () => {
      const imgEl = {
        id: 'img-render',
        type: 'image',
        startX: 100,
        startY: 100,
        endX: 300,
        endY: 300,
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      };

      // Mock image element in cache
      const mockHtmlImage = { complete: true, naturalWidth: 200, naturalHeight: 200 };
      manager.imageCache.set(imgEl.dataUrl, mockHtmlImage);

      manager.renderImage(mockCtx, imgEl);
      expect(mockCtx.drawImage).toHaveBeenCalledWith(mockHtmlImage, 100, 100, 200, 200);
    });
  });
});
