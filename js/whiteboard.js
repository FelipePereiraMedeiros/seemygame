/**
 * SeeMyGame - Módulo de Lousa Branca Interativa Colaborativa (Estilo Excalidraw)
 * Suporta desenho livre e formas geométricas com estilo rascunho (hand-drawn),
 * desfazer/refazer, dot grid, modo overlay sobre o jogo e sincronização P2P via WebRTC.
 */

export const WHITEBOARD_TOOLS = [
  { id: 'pencil', name: 'Caneta Livre', icon: '✏️', shortcut: 'P' },
  { id: 'rectangle', name: 'Retângulo', icon: '⬜', shortcut: 'R' },
  { id: 'diamond', name: 'Losango', icon: '💎', shortcut: 'D' },
  { id: 'circle', name: 'Círculo', icon: '⭕', shortcut: 'C' },
  { id: 'arrow', name: 'Flecha', icon: '➡️', shortcut: 'A' },
  { id: 'line', name: 'Linha Reta', icon: '📏', shortcut: 'L' },
  { id: 'text', name: 'Texto', icon: '🔤', shortcut: 'T' },
  { id: 'eraser', name: 'Borracha', icon: '🧼', shortcut: 'E' },
];

export const WHITEBOARD_COLORS = [
  '#ffffff', // Branco
  '#ef4444', // Vermelho
  '#10b981', // Verde
  '#06b6d4', // Ciano
  '#a855f7', // Roxo
  '#f59e0b', // Amarelo
  '#ec4899', // Rosa
  '#1e1e2e', // Grafite
];

export class WhiteboardManager {
  constructor(options = {}) {
    this.canvas = options.canvas || null;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.elements = []; // Array de elementos desenhados
    this.undoStack = [];
    this.redoStack = [];

    this.selectedTool = 'pencil';
    this.currentColor = '#ffffff';
    this.currentWidth = 4;
    this.currentFill = 'none'; // 'none' | 'semi' | 'solid'
    this.isRough = true; // Estilo rascunho hand-drawn
    this.backgroundMode = 'dark'; // 'dark' | 'light' | 'transparent'

    this.isDrawing = false;
    this.currentElement = null;
    this.remoteCursors = new Map(); // peerId -> { x, y, userName, color, time }

    // Callbacks de eventos para mensageria P2P
    this.onElementCreated = options.onElementCreated || null;
    this.onElementDeleted = options.onElementDeleted || null;
    this.onBoardCleared = options.onBoardCleared || null;
    this.onCursorMoved = options.onCursorMoved || null;

    if (this.canvas) {
      this.attachEvents();
      this.render();
    }
  }

  setCanvas(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    if (this.canvas) {
      this.attachEvents();
      this.render();
    }
  }

  setTool(toolId) {
    this.selectedTool = toolId;
  }

  setColor(hexColor) {
    this.currentColor = hexColor;
  }

  setStrokeWidth(width) {
    this.currentWidth = Number(width) || 4;
  }

  setFill(fillMode) {
    this.currentFill = fillMode;
  }

  setRough(isRough) {
    this.isRough = !!isRough;
  }

  setBackgroundMode(mode) {
    this.backgroundMode = mode;
    this.render();
  }

  /**
   * Adiciona um elemento à lousa e atualiza o histórico de Undo
   * @param {Object} element 
   * @param {boolean} [broadcast=true] 
   */
  addElement(element, broadcast = true) {
    if (!element) return;
    this.undoStack.push([...this.elements]);
    this.redoStack = [];
    this.elements.push(element);
    this.render();

    if (broadcast && typeof this.onElementCreated === 'function') {
      this.onElementCreated(element);
    }
  }

  /**
   * Remove um elemento por ID
   * @param {string} elementId 
   * @param {boolean} [broadcast=true] 
   */
  removeElement(elementId, broadcast = true) {
    const idx = this.elements.findIndex(el => el.id === elementId);
    if (idx !== -1) {
      this.undoStack.push([...this.elements]);
      this.redoStack = [];
      const removed = this.elements.splice(idx, 1)[0];
      this.render();

      if (broadcast && typeof this.onElementDeleted === 'function') {
        this.onElementDeleted(removed);
      }
    }
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push([...this.elements]);
    this.elements = this.undoStack.pop();
    this.render();
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push([...this.elements]);
    this.elements = this.redoStack.pop();
    this.render();
    return true;
  }

  clear(broadcast = true) {
    if (this.elements.length === 0) return;
    this.undoStack.push([...this.elements]);
    this.redoStack = [];
    this.elements = [];
    this.render();

    if (broadcast && typeof this.onBoardCleared === 'function') {
      this.onBoardCleared();
    }
  }

  setElements(elements) {
    this.elements = Array.isArray(elements) ? [...elements] : [];
    this.render();
  }

  /**
   * Atualiza a posição de um cursor remoto na lousa
   */
  updateRemoteCursor(peerId, { x, y, userName = 'Amigo', color = '#06b6d4' }) {
    this.remoteCursors.set(peerId, {
      x: Number(x) || 0,
      y: Number(y) || 0,
      userName,
      color,
      time: Date.now()
    });
    this.render();
  }

  removeRemoteCursor(peerId) {
    if (this.remoteCursors.has(peerId)) {
      this.remoteCursors.delete(peerId);
      this.render();
    }
  }

  /**
   * Vincula os ouvintes de eventos do mouse/touch ao canvas
   */
  attachEvents() {
    if (!this.canvas || typeof window === 'undefined') return;

    const getCanvasPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const scaleX = this.canvas.width / (rect.width || 1);
      const scaleY = this.canvas.height / (rect.height || 1);
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
        normX: (clientX - rect.left) / (rect.width || 1),
        normY: (clientY - rect.top) / (rect.height || 1)
      };
    };

    const handlePointerDown = (e) => {
      e.preventDefault();
      const pos = getCanvasPos(e);

      if (this.selectedTool === 'eraser') {
        this.eraseAt(pos.x, pos.y);
        return;
      }

      if (this.selectedTool === 'text') {
        const text = prompt('Digite o texto para a lousa:', 'Nota Tática');
        if (text && text.trim()) {
          const el = {
            id: 'wb_' + Math.random().toString(36).substring(2, 9),
            type: 'text',
            x: pos.x,
            y: pos.y,
            text: text.trim(),
            color: this.currentColor,
            strokeWidth: this.currentWidth
          };
          this.addElement(el, true);
        }
        return;
      }

      this.isDrawing = true;
      const id = 'wb_' + Math.random().toString(36).substring(2, 9);

      if (this.selectedTool === 'pencil') {
        this.currentElement = {
          id,
          type: 'pencil',
          points: [{ x: pos.x, y: pos.y }],
          color: this.currentColor,
          strokeWidth: this.currentWidth,
          rough: this.isRough
        };
      } else {
        this.currentElement = {
          id,
          type: this.selectedTool,
          startX: pos.x,
          startY: pos.y,
          endX: pos.x,
          endY: pos.y,
          color: this.currentColor,
          strokeWidth: this.currentWidth,
          fill: this.currentFill,
          rough: this.isRough
        };
      }
      this.render();
    };

    const handlePointerMove = (e) => {
      const pos = getCanvasPos(e);

      // Notifica movimento do cursor para multiplayer
      if (typeof this.onCursorMoved === 'function') {
        this.onCursorMoved({ x: pos.normX, y: pos.normY });
      }

      if (!this.isDrawing) return;

      if (this.selectedTool === 'eraser') {
        this.eraseAt(pos.x, pos.y);
        return;
      }

      if (this.currentElement) {
        if (this.currentElement.type === 'pencil') {
          this.currentElement.points.push({ x: pos.x, y: pos.y });
        } else {
          this.currentElement.endX = pos.x;
          this.currentElement.endY = pos.y;
        }
        this.render();
      }
    };

    const handlePointerUp = (e) => {
      if (!this.isDrawing) return;
      this.isDrawing = false;

      if (this.currentElement) {
        // Valida se o elemento tem tamanho significativo
        let isValid = true;
        if (this.currentElement.type === 'pencil') {
          isValid = this.currentElement.points.length > 1;
        } else {
          const dx = Math.abs(this.currentElement.endX - this.currentElement.startX);
          const dy = Math.abs(this.currentElement.endY - this.currentElement.startY);
          isValid = dx > 4 || dy > 4;
        }

        if (isValid) {
          this.addElement(this.currentElement, true);
        }
        this.currentElement = null;
        this.render();
      }
    };

    this.canvas.onmousedown = handlePointerDown;
    this.canvas.onmousemove = handlePointerMove;
    window.addEventListener('mouseup', handlePointerUp);

    this.canvas.ontouchstart = handlePointerDown;
    this.canvas.ontouchmove = handlePointerMove;
    window.addEventListener('touchend', handlePointerUp);
  }

  eraseAt(x, y) {
    const threshold = 18;
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (this.hitTest(el, x, y, threshold)) {
        this.removeElement(el.id, true);
        break;
      }
    }
  }

  hitTest(el, x, y, threshold = 15) {
    if (el.type === 'pencil') {
      return el.points.some(p => Math.hypot(p.x - x, p.y - y) <= threshold);
    }
    if (el.type === 'text') {
      return Math.hypot(el.x - x, el.y - y) <= threshold * 2;
    }
    const minX = Math.min(el.startX, el.endX) - threshold;
    const maxX = Math.max(el.startX, el.endX) + threshold;
    const minY = Math.min(el.startY, el.endY) - threshold;
    const maxY = Math.max(el.startY, el.endY) + threshold;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  /**
   * Renderizador com estética Excalidraw (Hand-drawn / Sketch)
   */
  render() {
    if (!this.ctx || !this.canvas) return;

    const width = this.canvas.width;
    const height = this.canvas.height;

    this.ctx.clearRect(0, 0, width, height);

    // 1. Fundo e Dot Grid
    if (this.backgroundMode === 'dark') {
      this.ctx.fillStyle = '#12131c';
      this.ctx.fillRect(0, 0, width, height);
      this.drawDotGrid('#252839', 24);
    } else if (this.backgroundMode === 'light') {
      this.ctx.fillStyle = '#f8fafc';
      this.ctx.fillRect(0, 0, width, height);
      this.drawDotGrid('#cbd5e1', 24);
    }
    // transparent não preenche nada, fica vazado sobre o vídeo

    // 2. Renderiza todos os elementos consolidados
    for (const el of this.elements) {
      this.drawElement(this.ctx, el);
    }

    // 3. Renderiza o elemento atualmente sendo traçado pelo usuário
    if (this.currentElement) {
      this.drawElement(this.ctx, this.currentElement);
    }

    // 4. Renderiza os cursores multiplayer remotos
    this.drawRemoteCursors(this.ctx, width, height);
  }

  drawDotGrid(dotColor, spacing = 24) {
    this.ctx.save();
    this.ctx.fillStyle = dotColor;
    const w = this.canvas.width;
    const h = this.canvas.height;
    for (let x = spacing; x < w; x += spacing) {
      for (let y = spacing; y < h; y += spacing) {
        this.ctx.beginPath();
        this.ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
    this.ctx.restore();
  }

  drawElement(ctx, el) {
    ctx.save();
    ctx.strokeStyle = el.color || '#ffffff';
    ctx.lineWidth = el.strokeWidth || 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (el.type) {
      case 'pencil':
        this.renderPencil(ctx, el);
        break;
      case 'rectangle':
        this.renderRectangle(ctx, el);
        break;
      case 'diamond':
        this.renderDiamond(ctx, el);
        break;
      case 'circle':
        this.renderCircle(ctx, el);
        break;
      case 'arrow':
        this.renderArrow(ctx, el);
        break;
      case 'line':
        this.renderLine(ctx, el);
        break;
      case 'text':
        this.renderText(ctx, el);
        break;
    }
    ctx.restore();
  }

  // --- Funções de Traçado Estilo Hand-Drawn / Excalidraw ---

  drawSketchLine(ctx, x1, y1, x2, y2, rough = true) {
    if (!rough) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      return;
    }

    // Passada 1 com leve desvio central
    const midX = (x1 + x2) / 2 + (Math.sin(x1 * 0.05 + y2) * 1.5);
    const midY = (y1 + y2) / 2 + (Math.cos(y1 * 0.05 + x2) * 1.5);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(midX, midY, x2, y2);
    ctx.stroke();

    // Passada 2 de imperfeição manual sutil
    ctx.save();
    ctx.globalAlpha = (ctx.globalAlpha || 1) * 0.6;
    ctx.beginPath();
    ctx.moveTo(x1 + 0.8, y1 - 0.8);
    ctx.quadraticCurveTo(midX - 1.2, midY + 1.2, x2 - 0.8, y2 + 0.8);
    ctx.stroke();
    ctx.restore();
  }

  renderPencil(ctx, el) {
    if (!el.points || el.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(el.points[0].x, el.points[0].y);

    for (let i = 1; i < el.points.length - 1; i++) {
      const xc = (el.points[i].x + el.points[i + 1].x) / 2;
      const yc = (el.points[i].y + el.points[i + 1].y) / 2;
      ctx.quadraticCurveTo(el.points[i].x, el.points[i].y, xc, yc);
    }
    ctx.lineTo(el.points[el.points.length - 1].x, el.points[el.points.length - 1].y);
    ctx.stroke();
  }

  renderRectangle(ctx, el) {
    const x = Math.min(el.startX, el.endX);
    const y = Math.min(el.startY, el.endY);
    const w = Math.abs(el.endX - el.startX);
    const h = Math.abs(el.endY - el.startY);

    if (el.fill && el.fill !== 'none') {
      ctx.save();
      ctx.fillStyle = el.color;
      ctx.globalAlpha = el.fill === 'semi' ? 0.25 : 0.85;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }

    this.drawSketchLine(ctx, x, y, x + w, y, el.rough);
    this.drawSketchLine(ctx, x + w, y, x + w, y + h, el.rough);
    this.drawSketchLine(ctx, x + w, y + h, x, y + h, el.rough);
    this.drawSketchLine(ctx, x, y + h, x, y, el.rough);
  }

  renderDiamond(ctx, el) {
    const cx = (el.startX + el.endX) / 2;
    const cy = (el.startY + el.endY) / 2;
    const top = { x: cx, y: Math.min(el.startY, el.endY) };
    const right = { x: Math.max(el.startX, el.endX), y: cy };
    const bottom = { x: cx, y: Math.max(el.startY, el.endY) };
    const left = { x: Math.min(el.startX, el.endX), y: cy };

    if (el.fill && el.fill !== 'none') {
      ctx.save();
      ctx.fillStyle = el.color;
      ctx.globalAlpha = el.fill === 'semi' ? 0.25 : 0.85;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(right.x, right.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.lineTo(left.x, left.y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    this.drawSketchLine(ctx, top.x, top.y, right.x, right.y, el.rough);
    this.drawSketchLine(ctx, right.x, right.y, bottom.x, bottom.y, el.rough);
    this.drawSketchLine(ctx, bottom.x, bottom.y, left.x, left.y, el.rough);
    this.drawSketchLine(ctx, left.x, left.y, top.x, top.y, el.rough);
  }

  renderCircle(ctx, el) {
    const rx = Math.abs(el.endX - el.startX) / 2;
    const ry = Math.abs(el.endY - el.startY) / 2;
    const cx = (el.startX + el.endX) / 2;
    const cy = (el.startY + el.endY) / 2;

    if (el.fill && el.fill !== 'none') {
      ctx.save();
      ctx.fillStyle = el.color;
      ctx.globalAlpha = el.fill === 'semi' ? 0.25 : 0.85;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (el.rough) {
      ctx.save();
      ctx.globalAlpha = (ctx.globalAlpha || 1) * 0.55;
      ctx.beginPath();
      ctx.ellipse(cx + 0.5, cy - 0.5, Math.max(1, rx - 0.8), Math.max(1, ry + 0.8), 0.05, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  renderLine(ctx, el) {
    this.drawSketchLine(ctx, el.startX, el.startY, el.endX, el.endY, el.rough);
  }

  renderArrow(ctx, el) {
    const x1 = el.startX;
    const y1 = el.startY;
    const x2 = el.endX;
    const y2 = el.endY;

    this.drawSketchLine(ctx, x1, y1, x2, y2, el.rough);

    // Ponta da flecha
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLength = 16 + (el.strokeWidth || 4);
    const arrowAngle = Math.PI / 6; // 30 graus

    const px1 = x2 - headLength * Math.cos(angle - arrowAngle);
    const py1 = y2 - headLength * Math.sin(angle - arrowAngle);
    const px2 = x2 - headLength * Math.cos(angle + arrowAngle);
    const py2 = y2 - headLength * Math.sin(angle + arrowAngle);

    this.drawSketchLine(ctx, x2, y2, px1, py1, el.rough);
    this.drawSketchLine(ctx, x2, y2, px2, py2, el.rough);
  }

  renderText(ctx, el) {
    ctx.save();
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = el.color || '#ffffff';
    ctx.textBaseline = 'top';

    // Fundo em pílula estilizada
    const metrics = ctx.measureText(el.text);
    const pad = 6;
    ctx.fillStyle = 'rgba(20, 21, 32, 0.8)';
    ctx.fillRect(el.x - pad, el.y - pad, metrics.width + pad * 2, 24);

    ctx.fillStyle = el.color || '#ffffff';
    ctx.fillText(el.text, el.x, el.y);
    ctx.restore();
  }

  drawRemoteCursors(ctx, width, height) {
    const now = Date.now();
    for (const [peerId, cursor] of this.remoteCursors.entries()) {
      if (now - cursor.time > 15000) {
        this.remoteCursors.delete(peerId);
        continue;
      }

      const px = cursor.x * width;
      const py = cursor.y * height;

      ctx.save();
      // Ponteiro de seta do cursor
      ctx.fillStyle = cursor.color || '#06b6d4';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + 12, py + 12);
      ctx.lineTo(px + 4, py + 12);
      ctx.lineTo(px, py + 18);
      ctx.closePath();
      ctx.fill();

      // Etiqueta com nome do jogador
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = cursor.color || '#06b6d4';
      ctx.fillRect(px + 12, py + 8, ctx.measureText(cursor.userName).width + 8, 18);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(cursor.userName, px + 16, py + 21);
      ctx.restore();
    }
  }

  /**
   * Exporta o conteúdo da lousa como Blob de imagem PNG para download ou envio
   * @returns {Promise<Blob>}
   */
  exportToBlob() {
    return new Promise((resolve) => {
      if (!this.canvas) {
        resolve(new Blob([], { type: 'image/png' }));
        return;
      }
      if (typeof this.canvas.toBlob === 'function') {
        this.canvas.toBlob((blob) => resolve(blob), 'image/png');
      } else if (typeof this.canvas.toDataURL === 'function') {
        const dataUrl = this.canvas.toDataURL('image/png');
        const binary = atob(dataUrl.split(',')[1] || '');
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        resolve(new Blob([bytes], { type: 'image/png' }));
      } else {
        resolve(new Blob([], { type: 'image/png' }));
      }
    });
  }

  exportToDataUrl() {
    if (!this.canvas || typeof this.canvas.toDataURL !== 'function') return '';
    return this.canvas.toDataURL('image/png');
  }
}

export const whiteboardManager = new WhiteboardManager();
