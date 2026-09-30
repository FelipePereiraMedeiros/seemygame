
import { WHITEBOARD_TOOLS, WHITEBOARD_COLORS, CURSOR_PALETTE, getPeerCursorColor, isTooBrightOrWhite, getContrastTextColor, drawRoundedRect, getFillAlpha, MAX_WHITEBOARD_ELEMENTS, MAX_WHITEBOARD_POINTS, MAX_WHITEBOARD_TEXT_LENGTH, WHITEBOARD_REF_WIDTH, WHITEBOARD_REF_HEIGHT, WHITEBOARD_ELEMENT_TYPES, isFiniteNumber, isSafeWhiteboardElement, processImageFile } from './shared.js';
/** WhiteboardManager: geometry. State and lifetime remain owned by the composed engine. */
export const withWhiteboardManagerGeometry = Base => class extends Base {
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

findElementAt(x, y) {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      if (this.hitTest(this.elements[i], x, y, 16)) {
        return this.elements[i];
      }
    }
    return null;
  }
};
