
import { WHITEBOARD_TOOLS, WHITEBOARD_COLORS, CURSOR_PALETTE, getPeerCursorColor, isTooBrightOrWhite, getContrastTextColor, drawRoundedRect, getFillAlpha, MAX_WHITEBOARD_ELEMENTS, MAX_WHITEBOARD_POINTS, MAX_WHITEBOARD_TEXT_LENGTH, WHITEBOARD_REF_WIDTH, WHITEBOARD_REF_HEIGHT, WHITEBOARD_ELEMENT_TYPES, isFiniteNumber, isSafeWhiteboardElement, processImageFile } from './shared.js';
/** WhiteboardManager: input. State and lifetime remain owned by the composed engine. */
export const withWhiteboardManagerInput = Base => class extends Base {
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

dispose() {
    if (this._pointerUpHandler && typeof window !== 'undefined') {
      window.removeEventListener('mouseup', this._pointerUpHandler);
      window.removeEventListener('touchend', this._pointerUpHandler);
    }
    if (this.canvas) {
      this.canvas.onmousedown = null;
      this.canvas.onmousemove = null;
      this.canvas.ontouchstart = null;
      this.canvas.ontouchmove = null;
    }
    this._pointerUpHandler = null;
    this.canvas = null;
    this.ctx = null;
    this.elements = [];
    this.imageCache.clear();
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
};
