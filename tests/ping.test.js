import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TacticalPingManager } from '../js/ping.js';

describe('Módulo: ping.js (TacticalPingManager)', () => {
  let manager;
  let mockCanvas;
  let mockCtx;

  beforeEach(() => {
    mockCtx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
    };

    mockCanvas = {
      width: 1280,
      height: 720,
      getContext: vi.fn(() => mockCtx),
    };

    manager = new TacticalPingManager();
    manager.setCanvas(mockCanvas);
  });

  it('deve adicionar um ping tático com coordenadas clampadas entre 0 e 1', () => {
    const ping = manager.addPing({ x: 0.5, y: 0.75, senderName: 'Player1' });

    expect(ping).toBeDefined();
    expect(ping.x).toBe(0.5);
    expect(ping.y).toBe(0.75);
    expect(ping.senderName).toBe('Player1');
    expect(manager.pings.length).toBe(1);

    // Teste com valor fora dos limites
    const outOfBounds = manager.addPing({ x: -0.2, y: 1.5 });
    expect(outOfBounds.x).toBe(0);
    expect(outOfBounds.y).toBe(1);
  });

  it('deve suportar tipo danger com cor vermelha padrão', () => {
    const danger = manager.addPing({ x: 0.2, y: 0.2, type: 'danger' });
    expect(danger.color).toBe('#ef4444');
  });

  it('deve iniciar e adicionar pontos ao traço de laser', () => {
    manager.startLaserTrail({ color: '#ff00ff' });
    expect(manager.isDrawingLaser).toBe(true);

    manager.addLaserPoint({ x: 0.1, y: 0.2 });
    manager.addLaserPoint({ x: 0.3, y: 0.4 });

    expect(manager.laserTrails.length).toBe(1);
    expect(manager.laserTrails[0].points.length).toBe(2);
    expect(manager.laserTrails[0].color).toBe('#ff00ff');

    manager.stopLaserTrail();
    expect(manager.isDrawingLaser).toBe(false);
  });

  it('render() deve desenhar pings e lasers chamando métodos do contexto 2D', () => {
    manager.addPing({ x: 0.5, y: 0.5, senderName: 'Tester' });
    manager.startLaserTrail();
    manager.addLaserPoint({ x: 0.1, y: 0.1 });
    manager.addLaserPoint({ x: 0.2, y: 0.2 });

    manager.render();

    expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 1280, 720);
    expect(mockCtx.arc).toHaveBeenCalled();
    expect(mockCtx.stroke).toHaveBeenCalled();
  });

  it('render() deve expirar pings após a duração configurada', () => {
    const ping = manager.addPing({ x: 0.5, y: 0.5, duration: 100 });
    expect(manager.pings.length).toBe(1);

    // Força o startTime para o passado
    ping.startTime = Date.now() - 500;

    manager.render();
    expect(manager.pings.length).toBe(0);
  });

  it('clear() deve limpar pings e lasers', () => {
    manager.addPing({ x: 0.1, y: 0.1 });
    manager.startLaserTrail();
    manager.addLaserPoint({ x: 0.2, y: 0.2 });

    manager.clear();
    expect(manager.pings.length).toBe(0);
    expect(manager.laserTrails.length).toBe(0);
    expect(mockCtx.clearRect).toHaveBeenCalled();
  });
});
