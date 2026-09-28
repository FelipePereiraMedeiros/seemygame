/**
 * SeeMyGame - Módulo de Lousa Branca Interativa Colaborativa (Estilo Excalidraw)
 * Suporta desenho livre e formas geométricas com estilo rascunho (hand-drawn),
 * arrastar/mover objetos desenhados, colar imagens (clipboard / drag & drop),
 * desfazer/refazer, dot grid, modo overlay sobre o jogo e sincronização P2P via WebRTC.
 */

export const WHITEBOARD_TOOLS = [
  { id: 'select', name: 'Mover / Selecionar', icon: '👆', shortcut: 'V' },
  { id: 'pencil', name: 'Caneta Livre', icon: '✏️', shortcut: 'P' },
  { id: 'rectangle', name: 'Retângulo', icon: '⬜', shortcut: 'R' },
  { id: 'diamond', name: 'Losango', icon: '💎', shortcut: 'D' },
  { id: 'circle', name: 'Círculo', icon: '⭕', shortcut: 'C' },
  { id: 'arrow', name: 'Flecha', icon: '➡️', shortcut: 'A' },
  { id: 'line', name: 'Linha Reta', icon: '📏', shortcut: 'L' },
  { id: 'text', name: 'Texto', icon: '🔤', shortcut: 'T' },
  { id: 'image', name: 'Inserir Imagem', icon: '🖼️', shortcut: 'I' },
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

// Paleta dedicada e determinística de cursores multiplayer (estilo Figma/Discord)
export const CURSOR_PALETTE = [
  '#06b6d4', // Ciano
  '#8b5cf6', // Roxo
  '#10b981', // Esmeralda
  '#f59e0b', // Âmbar
  '#ec4899', // Rosa
  '#3b82f6', // Azul
  '#f97316', // Laranja
  '#14b8a6', // Teal
  '#e11d48', // Rubi
  '#6366f1', // Índigo
];

export function getPeerCursorColor(id) {
  if (!id || typeof id !== 'string') return CURSOR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return CURSOR_PALETTE[hash % CURSOR_PALETTE.length];
}

export function isTooBrightOrWhite(hexColor) {
  if (!hexColor || typeof hexColor !== 'string') return true;
  let hex = hexColor.replace('#', '').trim();
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16) || 0;
  const g = parseInt(hex.slice(2, 4), 16) || 0;
  const b = parseInt(hex.slice(4, 6), 16) || 0;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.90; // Evita branco puro e quase-branco
}

export function getContrastTextColor(hexColor) {
  if (!hexColor || typeof hexColor !== 'string') return '#ffffff';
  let hex = hexColor.replace('#', '').trim();
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (hex.length !== 6) return '#ffffff';
  const r = parseInt(hex.slice(0, 2), 16) || 0;
  const g = parseInt(hex.slice(2, 4), 16) || 0;
  const b = parseInt(hex.slice(4, 6), 16) || 0;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.60 ? '#0f172a' : '#ffffff';
}

export function drawRoundedRect(ctx, x, y, width, height, radius = 4) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius);
  } else {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }
}

export function getFillAlpha(fill) {
  if (fill === 'semi') return 0.25;
  if (fill === 'solid' || fill === true) return 1.0;
  if (typeof fill === 'number') return Math.max(0, Math.min(1, fill));
  return 1.0;
}

export const MAX_WHITEBOARD_ELEMENTS = 1000;
export const MAX_WHITEBOARD_POINTS = 2000;
export const MAX_WHITEBOARD_TEXT_LENGTH = 500;
export const WHITEBOARD_REF_WIDTH = 1920;
export const WHITEBOARD_REF_HEIGHT = 1080;

export const WHITEBOARD_ELEMENT_TYPES = new Set([
  'pencil', 'rectangle', 'diamond', 'circle', 'arrow', 'line', 'text', 'image'
]);

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isSafeWhiteboardElement(element) {
  if (!element || typeof element !== 'object' || typeof element.id !== 'string' || element.id.length > 64) return false;
  if (!WHITEBOARD_ELEMENT_TYPES.has(element.type)) return false;
  if (element.type === 'pencil') {
    return Array.isArray(element.points) && element.points.length > 0 && element.points.length <= MAX_WHITEBOARD_POINTS &&
      element.points.every((point) => isFiniteNumber(point?.x) && isFiniteNumber(point?.y));
  }
  if (element.type === 'text') {
    return isFiniteNumber(element.x) && isFiniteNumber(element.y) &&
      typeof element.text === 'string' && element.text.length <= MAX_WHITEBOARD_TEXT_LENGTH;
  }
  if (element.type === 'image') {
    return isFiniteNumber(element.startX) && isFiniteNumber(element.startY) &&
      isFiniteNumber(element.endX) && isFiniteNumber(element.endY) &&
      typeof element.dataUrl === 'string' &&
      element.dataUrl.startsWith('data:image/') &&
      element.dataUrl.length <= 2_500_000;
  }
  if (isFiniteNumber(element.x) && isFiniteNumber(element.y)) {
    if (isFiniteNumber(element.width) && isFiniteNumber(element.height)) {
      if (!isFiniteNumber(element.startX)) element.startX = element.x;
      if (!isFiniteNumber(element.startY)) element.startY = element.y;
      if (!isFiniteNumber(element.endX)) element.endX = element.x + element.width;
      if (!isFiniteNumber(element.endY)) element.endY = element.y + element.height;
    } else if (isFiniteNumber(element.radius)) {
      if (!isFiniteNumber(element.startX)) element.startX = element.x - element.radius;
      if (!isFiniteNumber(element.startY)) element.startY = element.y - element.radius;
      if (!isFiniteNumber(element.endX)) element.endX = element.x + element.radius;
      if (!isFiniteNumber(element.endY)) element.endY = element.y + element.radius;
    }
  }
  return ['startX', 'startY', 'endX', 'endY'].every((key) => isFiniteNumber(element[key]));
}

/**
 * Processa e redimensiona um arquivo de imagem para inserção na lousa
 * Mantém resolução ideal e gera dataURL compacta para transmissão P2P eficiente
 */
export async function processImageFile(file, maxWidth = 1024, maxHeight = 768) {
  if (!file) throw new Error('Nenhum arquivo fornecido');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || 400;
        let h = img.naturalHeight || 300;
        if (w > maxWidth || h > maxHeight) {
          const ratio = Math.min(maxWidth / w, maxHeight / h);
          w = Math.max(1, Math.round(w * ratio));
          h = Math.max(1, Math.round(h * ratio));
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target.result);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        try {
          const dataUrl = canvas.toDataURL(mimeType, 0.85);
          resolve(dataUrl);
        } catch (_) {
          resolve(e.target.result);
        }
      };
      img.onerror = () => reject(new Error('Erro ao decodificar imagem'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

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

    // Seleção e Arrastar
    this.selectedElementId = null;
    this.isDraggingElement = false;
    this.dragStartPos = null;
    this.dragInitialState = null;
    this._dragUndoSnapshot = null;

    // Cache de imagens decodificadas
    this.imageCache = new Map();

    // Callbacks de eventos para mensageria P2P
    this.onElementCreated = options.onElementCreated || null;
    this.onElementUpdated = options.onElementUpdated || null;
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
    if (toolId !== 'select') {
      this.selectedElementId = null;
      this.isDraggingElement = false;
      if (this.canvas && this.canvas.style) this.canvas.style.cursor = toolId === 'eraser' ? 'cell' : 'crosshair';
    } else {
      if (this.canvas && this.canvas.style) this.canvas.style.cursor = 'default';
    }
    this.render();
    if (typeof this.onToolChanged === 'function') {
      this.onToolChanged(toolId);
    }
  }

  setColor(hexColor) {
    this.currentColor = hexColor;
    if (this.selectedElementId) {
      const el = this.elements.find(e => e.id === this.selectedElementId);
      if (el) {
        el.color = hexColor;
        this.render();
        if (typeof this.onElementUpdated === 'function') {
          this.onElementUpdated(el);
        }
      }
    }
  }

  setStrokeWidth(width) {
    this.currentWidth = Number(width) || 4;
    if (this.selectedElementId) {
      const el = this.elements.find(e => e.id === this.selectedElementId);
      if (el) {
        el.strokeWidth = this.currentWidth;
        this.render();
        if (typeof this.onElementUpdated === 'function') {
          this.onElementUpdated(el);
        }
      }
    }
  }

  setFill(fillMode) {
    this.currentFill = fillMode;
    if (this.selectedElementId) {
      const el = this.elements.find(e => e.id === this.selectedElementId);
      if (el && el.type !== 'pencil' && el.type !== 'line' && el.type !== 'text' && el.type !== 'image') {
        el.fill = fillMode;
        this.render();
        if (typeof this.onElementUpdated === 'function') {
          this.onElementUpdated(el);
        }
      }
    }
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
    if (!isSafeWhiteboardElement(element) || this.elements.length >= MAX_WHITEBOARD_ELEMENTS) return;
    if (this.elements.some(el => el.id === element.id)) return;
    this.undoStack.push([...this.elements]);
    this.redoStack = [];
    this.elements.push(element);
    this.render();

    if (broadcast && typeof this.onElementCreated === 'function') {
      this.onElementCreated(element);
    }
  }

  /**
   * Atualiza um elemento existente (ex: após arrasto)
   */
  updateElement(element, broadcast = true) {
    if (!element || !element.id) return;
    const idx = this.elements.findIndex(el => el.id === element.id);
    if (idx !== -1) {
      this.undoStack.push([...this.elements.map(e => ({ ...e }))]);
      this.redoStack = [];
      this.elements[idx] = element;
      this.render();

      if (broadcast && typeof this.onElementUpdated === 'function') {
        this.onElementUpdated(element);
      }
    } else {
      this.addElement(element, broadcast);
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
      if (this.selectedElementId === elementId) {
        this.selectedElementId = null;
      }
      this.render();

      if (broadcast && typeof this.onElementDeleted === 'function') {
        this.onElementDeleted(removed);
      }
    }
  }

  deleteSelected() {
    if (!this.selectedElementId) return false;
    const id = this.selectedElementId;
    this.selectedElementId = null;
    this.removeElement(id, true);
    return true;
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push([...this.elements]);
    this.elements = this.undoStack.pop();
    this.selectedElementId = null;
    this.render();
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push([...this.elements]);
    this.elements = this.redoStack.pop();
    this.selectedElementId = null;
    this.render();
    return true;
  }

  clear(broadcast = true) {
    if (this.elements.length === 0) return;
    this.undoStack.push([...this.elements]);
    this.redoStack = [];
    this.elements = [];
    this.selectedElementId = null;
    this.render();

    if (broadcast && typeof this.onBoardCleared === 'function') {
      this.onBoardCleared();
    }
  }

  setElements(elements) {
    this.elements = Array.isArray(elements)
      ? elements.filter(isSafeWhiteboardElement).slice(0, MAX_WHITEBOARD_ELEMENTS)
      : [];
    this.selectedElementId = null;
    this.render();
  }

  /**
   * Insere imagem a partir de uma DataURL na lousa
   */
  async addImageFromDataUrl(dataUrl, targetX = null, targetY = null, broadcast = true) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || 400;
        let h = img.naturalHeight || 300;
        const MAX_W = 640;
        const MAX_H = 480;
        if (w > MAX_W || h > MAX_H) {
          const ratio = Math.min(MAX_W / w, MAX_H / h);
          w = Math.max(1, Math.round(w * ratio));
          h = Math.max(1, Math.round(h * ratio));
        }

        const posX = isFiniteNumber(targetX) ? targetX : Math.round(WHITEBOARD_REF_WIDTH / 2 - w / 2);
        const posY = isFiniteNumber(targetY) ? targetY : Math.round(WHITEBOARD_REF_HEIGHT / 2 - h / 2);

        const el = {
          id: 'wb_' + Math.random().toString(36).substring(2, 9),
          type: 'image',
          x: posX,
          y: posY,
          width: w,
          height: h,
          startX: posX,
          startY: posY,
          endX: posX + w,
          endY: posY + h,
          dataUrl,
          color: '#ffffff',
          strokeWidth: 2
        };

        this.addElement(el, broadcast);
        this.setTool('select');
        this.selectedElementId = el.id;
        this.render();
        resolve(el);
      };
      img.onerror = () => {
        console.warn('[Whiteboard] Falha ao carregar imagem para renderização');
        resolve(null);
      };
      img.src = dataUrl;
    });
  }

  /**
   * Atualiza a posição de um cursor remoto na lousa
   */
  updateRemoteCursor(peerId, { x, y, userName = 'Amigo', color = '#06b6d4' }) {
    if (typeof peerId !== 'string' || peerId.length > 64) return;
    if (!this.remoteCursors.has(peerId) && this.remoteCursors.size >= 64) return;
    let safeColor = typeof color === 'string' && /^#[0-9a-f]{3,8}$/i.test(color) ? color : null;
    if (!safeColor || isTooBrightOrWhite(safeColor)) {
      safeColor = getPeerCursorColor(peerId);
    }
    this.remoteCursors.set(peerId, {
      x: Math.max(0, Math.min(1, Number(x) || 0)),
      y: Math.max(0, Math.min(1, Number(y) || 0)),
      userName: typeof userName === 'string' && userName.trim() ? userName.trim().slice(0, 64) : 'Amigo',
      color: safeColor,
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
   * Retorna os limites (bounding box) de um elemento
   */
  getElementBounds(el) {
    if (!el) return null;
    if (el.type === 'pencil' && Array.isArray(el.points) && el.points.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of el.points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
      return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
    }
    if (el.type === 'text') {
      const w = el.text ? el.text.length * 10 + 16 : 80;
      return {
        minX: el.x - 6,
        minY: el.y - 6,
        maxX: el.x + w,
        maxY: el.y + 26,
        width: w + 6,
        height: 32
      };
    }
    const minX = Math.min(el.startX, el.endX);
    const maxX = Math.max(el.startX, el.endX);
    const minY = Math.min(el.startY, el.endY);
    const maxY = Math.max(el.startY, el.endY);
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY)
    };
  }

  /**
   * Desloca as coordenadas de um elemento em relação ao estado inicial
   */
  translateElement(el, initial, dx, dy) {
    if (!el || !initial) return;
    if (el.type === 'pencil' && Array.isArray(initial.points)) {
      el.points = initial.points.map(p => ({
        x: Math.round((p.x + dx) * 10) / 10,
        y: Math.round((p.y + dy) * 10) / 10
      }));
    } else if (el.type === 'text') {
      el.x = Math.round((initial.x + dx) * 10) / 10;
      el.y = Math.round((initial.y + dy) * 10) / 10;
    } else {
      el.startX = Math.round((initial.startX + dx) * 10) / 10;
      el.startY = Math.round((initial.startY + dy) * 10) / 10;
      el.endX = Math.round((initial.endX + dx) * 10) / 10;
      el.endY = Math.round((initial.endY + dy) * 10) / 10;
      if (el.x !== undefined && initial.x !== undefined) {
        el.x = Math.round((initial.x + dx) * 10) / 10;
      }
      if (el.y !== undefined && initial.y !== undefined) {
        el.y = Math.round((initial.y + dy) * 10) / 10;
      }
    }
  }

  /**
   * Encontra o elemento superior que intersecta o ponto (x, y)
   */
  findElementAt(x, y) {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      if (this.hitTest(this.elements[i], x, y, 16)) {
        return this.elements[i];
      }
    }
    return null;
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
      const normX = Math.max(0, Math.min(1, (clientX - rect.left) / (rect.width || 1)));
      const normY = Math.max(0, Math.min(1, (clientY - rect.top) / (rect.height || 1)));
      return {
        x: Math.round(normX * WHITEBOARD_REF_WIDTH * 10) / 10,
        y: Math.round(normY * WHITEBOARD_REF_HEIGHT * 10) / 10,
        normX,
        normY
      };
    };

    const handlePointerDown = (e) => {
      e.preventDefault();
      const pos = getCanvasPos(e);

      // Ferramenta Selecionar / Mover
      if (this.selectedTool === 'select') {
        const target = this.findElementAt(pos.x, pos.y);
        if (target) {
          this.selectedElementId = target.id;
          this.isDraggingElement = true;
          this.dragStartPos = { x: pos.x, y: pos.y };
          this.dragInitialState = JSON.parse(JSON.stringify(target));
          this._dragUndoSnapshot = this.elements.map(el => JSON.parse(JSON.stringify(el)));
          if (this.canvas && this.canvas.style) this.canvas.style.cursor = 'grabbing';
        } else {
          this.selectedElementId = null;
          this.isDraggingElement = false;
          this.dragStartPos = null;
          this.dragInitialState = null;
          this._dragUndoSnapshot = null;
          if (this.canvas && this.canvas.style) this.canvas.style.cursor = 'default';
        }
        this.render();
        return;
      }

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

      // Ferramenta Selecionar / Mover
      if (this.selectedTool === 'select') {
        if (this.isDraggingElement && this.selectedElementId && this.dragInitialState) {
          const dx = pos.x - this.dragStartPos.x;
          const dy = pos.y - this.dragStartPos.y;
          const el = this.elements.find(e => e.id === this.selectedElementId);
          if (el) {
            this.translateElement(el, this.dragInitialState, dx, dy);
            this.render();
          }
          return;
        } else if (this.canvas && this.canvas.style) {
          const hoverEl = this.findElementAt(pos.x, pos.y);
          this.canvas.style.cursor = hoverEl ? 'grab' : 'default';
        }
        return;
      }

      if (!this.isDrawing) return;

      if (this.selectedTool === 'eraser') {
        this.eraseAt(pos.x, pos.y);
        return;
      }

      if (this.currentElement) {
        if (this.currentElement.type === 'pencil') {
          const pts = this.currentElement.points;
          const last = pts[pts.length - 1];
          const distSq = (pos.x - last.x) ** 2 + (pos.y - last.y) ** 2;
          if (distSq >= 9) {
            pts.push({ x: pos.x, y: pos.y });
            this.render();
          }
        } else {
          this.currentElement.endX = pos.x;
          this.currentElement.endY = pos.y;
          this.render();
        }
      }
    };

    const handlePointerUp = (e) => {
      // Ferramenta Selecionar / Mover
      if (this.selectedTool === 'select' && this.isDraggingElement) {
        this.isDraggingElement = false;
        if (this.canvas && this.canvas.style) this.canvas.style.cursor = 'default';
        const el = this.elements.find(e => e.id === this.selectedElementId);
        if (el && this.dragInitialState && this._dragUndoSnapshot) {
          const initial = this.dragInitialState;
          const hasMoved = (el.startX !== undefined && initial.startX !== undefined && (Math.abs(el.startX - initial.startX) > 1 || Math.abs(el.startY - initial.startY) > 1)) ||
            (el.points && initial.points && Math.abs(el.points[0]?.x - initial.points[0]?.x) > 1) ||
            (el.x !== undefined && initial.x !== undefined && (Math.abs(el.x - initial.x) > 1 || Math.abs(el.y - initial.y) > 1));

          if (hasMoved) {
            this.undoStack.push(this._dragUndoSnapshot);
            this.redoStack = [];
            if (typeof this.onElementUpdated === 'function') {
              this.onElementUpdated(el);
            }
          }
        }
        this.dragStartPos = null;
        this.dragInitialState = null;
        this._dragUndoSnapshot = null;
        this.render();
        return;
      }

      if (!this.isDrawing) return;
      this.isDrawing = false;

      if (this.currentElement) {
        // Valida se o elemento tem tamanho significativo
        let isValid = true;
        if (this.currentElement.type === 'pencil') {
          if (e && (e.clientX !== undefined || e.touches)) {
            const pos = getCanvasPos(e);
            const pts = this.currentElement.points;
            const last = pts[pts.length - 1];
            if (last && (last.x !== pos.x || last.y !== pos.y)) {
              pts.push({ x: pos.x, y: pos.y });
            }
          }
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

    if (this._pointerUpHandler) {
      window.removeEventListener('mouseup', this._pointerUpHandler);
      window.removeEventListener('touchend', this._pointerUpHandler);
    }
    this._pointerUpHandler = handlePointerUp;

    this.canvas.onmousedown = handlePointerDown;
    this.canvas.onmousemove = handlePointerMove;
    window.addEventListener('mouseup', handlePointerUp);

    this.canvas.ontouchstart = handlePointerDown;
    this.canvas.ontouchmove = handlePointerMove;
    window.addEventListener('touchend', handlePointerUp);
  }

  eraseAt(x, y) {
    const threshold = 28;
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (this.hitTest(el, x, y, threshold)) {
        this.removeElement(el.id, true);
        break;
      }
    }
  }

  hitTest(el, x, y, threshold = 24) {
    if (!el) return false;
    if (el.type === 'pencil') {
      return el.points?.some(p => Math.hypot(p.x - x, p.y - y) <= threshold);
    }
    if (el.type === 'text') {
      const bounds = this.getElementBounds(el);
      return x >= bounds.minX - threshold && x <= bounds.maxX + threshold &&
             y >= bounds.minY - threshold && y <= bounds.maxY + threshold;
    }
    const bounds = this.getElementBounds(el);
    if (!bounds) return false;
    return x >= bounds.minX - threshold && x <= bounds.maxX + threshold &&
           y >= bounds.minY - threshold && y <= bounds.maxY + threshold;
  }

  /**
   * Renderizador com estética Excalidraw (Hand-drawn / Sketch)
   */
  render() {
    if (!this.ctx || !this.canvas) return;

    const width = this.canvas.width || WHITEBOARD_REF_WIDTH;
    const height = this.canvas.height || WHITEBOARD_REF_HEIGHT;

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

    const scaleX = width / WHITEBOARD_REF_WIDTH;
    const scaleY = height / WHITEBOARD_REF_HEIGHT;

    this.ctx.save();
    if (typeof this.ctx.scale === 'function') {
      this.ctx.scale(scaleX, scaleY);
    }

    // 2. Renderiza todos os elementos consolidados no plano de referência virtual
    for (const el of this.elements) {
      this.drawElement(this.ctx, el);
    }

    // 3. Renderiza o elemento atualmente sendo traçado pelo usuário
    if (this.currentElement) {
      this.drawElement(this.ctx, this.currentElement);
    }

    // 4. Renderiza caixa de seleção (bounding box) do elemento selecionado
    if (this.selectedElementId) {
      const selectedEl = this.elements.find(e => e.id === this.selectedElementId);
      if (selectedEl) {
        this.drawSelectionBox(this.ctx, selectedEl);
      }
    }

    this.ctx.restore();

    // 5. Renderiza os cursores multiplayer remotos
    this.drawRemoteCursors(this.ctx, width, height);
  }

  drawSelectionBox(ctx, el) {
    const bounds = this.getElementBounds(el);
    if (!bounds) return;
    const pad = 6;
    const x = bounds.minX - pad;
    const y = bounds.minY - pad;
    const w = bounds.width + pad * 2;
    const h = bounds.height + pad * 2;

    ctx.save();
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 1.5;
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([6, 4]);
    if (typeof ctx.strokeRect === 'function') {
      ctx.strokeRect(x, y, w, h);
    } else {
      ctx.stroke();
    }
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);

    const handleSize = 7;
    const handles = [
      { x: x, y: y },
      { x: x + w, y: y },
      { x: x + w, y: y + h },
      { x: x, y: y + h }
    ];

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1.5;
    for (const hPos of handles) {
      ctx.beginPath();
      if (typeof ctx.rect === 'function') {
        ctx.rect(hPos.x - handleSize / 2, hPos.y - handleSize / 2, handleSize, handleSize);
      }
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
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
      case 'image':
        this.renderImage(ctx, el);
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
      ctx.globalAlpha = getFillAlpha(el.fill);
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
      ctx.globalAlpha = getFillAlpha(el.fill);
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
      ctx.globalAlpha = getFillAlpha(el.fill);
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

  renderImage(ctx, el) {
    let img = this.imageCache.get(el.dataUrl);
    if (!img) {
      img = new Image();
      img.src = el.dataUrl;
      img.onload = () => {
        this.render();
      };
      this.imageCache.set(el.dataUrl, img);
    }

    const x = Math.min(el.startX, el.endX);
    const y = Math.min(el.startY, el.endY);
    const w = Math.abs(el.endX - el.startX);
    const h = Math.abs(el.endY - el.startY);

    if (img.complete && (img.naturalWidth > 0 || img.width > 0)) {
      ctx.save();
      ctx.beginPath();
      drawRoundedRect(ctx, x, y, w, h, 6);
      if (typeof ctx.clip === 'function') ctx.clip();
      try {
        ctx.drawImage(img, x, y, w, h);
      } catch (err) {
        console.warn('[Whiteboard] Erro ao desenhar imagem:', err);
      }
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = el.color || 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      drawRoundedRect(ctx, x, y, w, h, 6);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = 'rgba(30, 41, 59, 0.6)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      drawRoundedRect(ctx, x, y, w, h, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🖼️ Carregando imagem...', x + w / 2, y + h / 2);
      ctx.restore();
    }
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
      const userName = (typeof cursor.userName === 'string' && cursor.userName.trim())
        ? cursor.userName.trim()
        : 'Amigo';

      let cursorColor = cursor.color;
      if (!cursorColor || isTooBrightOrWhite(cursorColor)) {
        cursorColor = getPeerCursorColor(peerId);
      }
      const textColor = getContrastTextColor(cursorColor);

      ctx.save();

      // Sombra suave para destacar cursor e badge sobre qualquer fundo (escuro, claro ou sobreposição)
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 2;

      // 1. Ponteiro de seta estilo Figma/Excalidraw
      ctx.fillStyle = cursorColor;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + 13, py + 13);
      ctx.lineTo(px + 5, py + 13);
      ctx.lineTo(px, py + 19);
      ctx.closePath();
      ctx.fill();

      // Contorno sutil no ponteiro
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Remove sombra para renderizar badge e texto ultra nítidos
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // 2. Badge arredondada moderna (pill) com nome legível e contraste garantido
      ctx.font = 'bold 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const textMetrics = ctx.measureText(userName);
      const textWidth = (textMetrics && typeof textMetrics.width === 'number') ? textMetrics.width : 50;
      const paddingX = 8;
      const badgeHeight = 20;
      const badgeWidth = textWidth + paddingX * 2;
      const badgeX = px + 10;
      const badgeY = py + 10;

      ctx.beginPath();
      drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 5);
      ctx.fillStyle = cursorColor;
      ctx.fill();

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Texto de alto contraste garantido
      ctx.fillStyle = textColor;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(userName, badgeX + paddingX, badgeY + badgeHeight / 2);

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
