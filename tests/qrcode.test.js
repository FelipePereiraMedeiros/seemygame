import { describe, it, expect, vi } from 'vitest';
import { renderQRCodeToCanvas } from '../js/qrcode-light.js';

describe('Módulo: qrcode-light.js', () => {
  it('deve desenhar no contexto 2D do canvas', () => {
    const fakeContext = {
      fillStyle: '',
      fillRect: vi.fn()
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => fakeContext)
    };

    const success = renderQRCodeToCanvas(fakeCanvas, 'https://seemygame.app/room.html#room=resenha', { size: 180 });
    expect(success).toBe(true);
    expect(fakeCanvas.width).toBe(180);
    expect(fakeCanvas.height).toBe(180);
    expect(fakeContext.fillRect).toHaveBeenCalled();
  });

  it('deve retornar false se canvas ou texto não forem fornecidos', () => {
    expect(renderQRCodeToCanvas(null, 'teste')).toBe(false);
    expect(renderQRCodeToCanvas({}, '')).toBe(false);
  });
});
