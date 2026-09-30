import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { Gamepad3DViewer } from '../js/gamepad-3d-viewer.js';

// Polyfill básico para canvas 2d no JSDOM para silenciar avisos
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function (type) {
    if (type === '2d') {
      return {
        createRadialGradient: () => ({ addColorStop: vi.fn() }),
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: [] }))
      };
    }
    return null;
  };
}

function createMockRenderer(canvas) {
  const c = canvas || document.createElement('canvas');
  return {
    domElement: c,
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1.0
  };
}

describe('Adversarial Stress Testing: Gamepad3DViewer', () => {
  let container;
  let canvas;
  let mockRenderer;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
    document.body.appendChild(container);
    mockRenderer = createMockRenderer(canvas);
  });

  afterEach(() => {
    if (container && container.parentElement) {
      container.parentElement.removeChild(container);
    }
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('1. Zero and Malformed Dimensions & Aspect Ratio Calculation', () => {
    it('adota fallback 420x250 e aspecto 1.68 quando container e canvas têm dimensões 0x0', () => {
      Object.defineProperty(canvas, 'clientWidth', { value: 0, configurable: true });
      Object.defineProperty(canvas, 'clientHeight', { value: 0, configurable: true });
      Object.defineProperty(container, 'clientWidth', { value: 0, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 0, configurable: true });
      canvas.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 });
      container.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 });

      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      const dims = viewer._getEffectiveDimensions();

      expect(dims.width).toBe(420);
      expect(dims.height).toBe(250);
      expect(dims.isVisible).toBe(false);

      viewer.init();
      expect(viewer.camera.aspect).toBeCloseTo(420 / 250, 4);
      expect(Number.isFinite(viewer.camera.aspect)).toBe(true);
      expect(mockRenderer.setSize).toHaveBeenCalledWith(420, 250, false);
      viewer.destroy();
    });

    it('rejeita dimensões parciais zero (ex: 500x0 ou 0x300) e adota fallback seguro sem dividir por zero', () => {
      // Caso 1: width > 0, height = 0
      Object.defineProperty(canvas, 'clientWidth', { value: 500, configurable: true });
      Object.defineProperty(canvas, 'clientHeight', { value: 0, configurable: true });
      canvas.getBoundingClientRect = () => ({ width: 500, height: 0, top: 0, left: 0, bottom: 0, right: 0 });

      const viewer1 = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      const dims1 = viewer1._getEffectiveDimensions();
      expect(dims1.width).toBe(420);
      expect(dims1.height).toBe(250);

      viewer1.init();
      expect(viewer1.camera.aspect).toBeCloseTo(1.68, 2);
      expect(Number.isFinite(viewer1.camera.aspect)).toBe(true);
      viewer1.destroy();

      // Caso 2: width = 0, height = 300
      const mockRenderer2 = createMockRenderer(canvas);
      Object.defineProperty(canvas, 'clientWidth', { value: 0, configurable: true });
      Object.defineProperty(canvas, 'clientHeight', { value: 300, configurable: true });
      canvas.getBoundingClientRect = () => ({ width: 0, height: 300, top: 0, left: 0, bottom: 0, right: 0 });

      const viewer2 = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer2 });
      const dims2 = viewer2._getEffectiveDimensions();
      expect(dims2.width).toBe(420);
      expect(dims2.height).toBe(250);

      viewer2.init();
      expect(viewer2.camera.aspect).toBeCloseTo(1.68, 2);
      expect(Number.isFinite(viewer2.camera.aspect)).toBe(true);
      viewer2.destroy();
    });

    it('adota fallback quando getBoundingClientRect retorna NaN ou dimensões negativas', () => {
      canvas.getBoundingClientRect = () => ({ width: NaN, height: -100, top: 0, left: 0, bottom: 0, right: 0 });
      Object.defineProperty(canvas, 'clientWidth', { value: -50, configurable: true });
      Object.defineProperty(canvas, 'clientHeight', { value: -50, configurable: true });

      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      const dims = viewer._getEffectiveDimensions();
      expect(dims.width).toBe(420);
      expect(dims.height).toBe(250);

      viewer.init();
      expect(viewer.camera.aspect).toBeCloseTo(1.68, 2);
      expect(Number.isFinite(viewer.camera.aspect)).toBe(true);
      viewer.destroy();
    });

    it('prioriza atributos HTML width/height do canvas se dimensões computadas forem 0', () => {
      canvas.setAttribute('width', '520');
      canvas.setAttribute('height', '310');
      Object.defineProperty(canvas, 'clientWidth', { value: 0, configurable: true });
      Object.defineProperty(canvas, 'clientHeight', { value: 0, configurable: true });
      canvas.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 });

      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      const dims = viewer._getEffectiveDimensions();
      expect(dims.width).toBe(520);
      expect(dims.height).toBe(310);

      viewer.init();
      expect(viewer.camera.aspect).toBeCloseTo(520 / 310, 4);
      viewer.destroy();
    });

    it('adota fallback 420x250 e aspecto 1.68 quando container está desacoplado (detached) do DOM', () => {
      // Remove container do DOM
      document.body.removeChild(container);

      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      const dims = viewer._getEffectiveDimensions();
      expect(dims.width).toBe(420);
      expect(dims.height).toBe(250);

      viewer.init();
      expect(viewer.camera.aspect).toBeCloseTo(420 / 250, 4);
      viewer.destroy();
    });
  });

  describe('2. Subpixel & Fractional Pixels Layout Resizing', () => {
    it('arredonda pixels fracionários para inteiros evitando borramento e distorções', () => {
      // Simula layout fracionário (ex: zoom do navegador a 125% ou flexbox com porcentagem)
      canvas.getBoundingClientRect = () => ({
        width: 421.37,
        height: 249.81,
        top: 10.45,
        left: 20.33,
        bottom: 260.26,
        right: 441.7
      });
      Object.defineProperty(canvas, 'clientWidth', { value: 0, configurable: true });
      Object.defineProperty(canvas, 'clientHeight', { value: 0, configurable: true });

      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      viewer.init();

      const dims = viewer._getEffectiveDimensions();
      expect(dims.width).toBe(421);
      expect(dims.height).toBe(250);
      expect(Number.isInteger(dims.width)).toBe(true);
      expect(Number.isInteger(dims.height)).toBe(true);
      expect(viewer.camera.aspect).toBeCloseTo(421 / 250, 4);
      expect(mockRenderer.setSize).toHaveBeenCalledWith(421, 250, false);
      viewer.destroy();
    });

    it('lida com dimensões fracionárias minúsculas (< 0.5px) ativando fallback seguro', () => {
      canvas.getBoundingClientRect = () => ({
        width: 0.35,
        height: 0.42,
        top: 0,
        left: 0,
        bottom: 0.42,
        right: 0.35
      });
      Object.defineProperty(canvas, 'clientWidth', { value: 0, configurable: true });
      Object.defineProperty(canvas, 'clientHeight', { value: 0, configurable: true });

      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      const dims = viewer._getEffectiveDimensions();
      expect(dims.width).toBe(420);
      expect(dims.height).toBe(250);

      viewer.init();
      expect(viewer.camera.aspect).toBeCloseTo(420 / 250, 4);
      viewer.destroy();
    });
  });

  describe('3. ResizeObserver while Hidden and Unhide Lifecycle', () => {
    it('ignora callbacks de ResizeObserver com contentRect 0x0 e não dispara re-render desnecessário', () => {
      let observerCb = null;
      class MockResizeObserver {
        constructor(cb) {
          observerCb = cb;
        }
        observe() {}
        disconnect() {}
      }
      const origRO = globalThis.ResizeObserver;
      globalThis.ResizeObserver = MockResizeObserver;

      try {
        const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
        viewer.init();

        const onResizeSpy = vi.spyOn(viewer, '_onResize');

        // Dispara ResizeObserver com rect 0x0
        observerCb([{ contentRect: { width: 0, height: 0 } }]);
        expect(onResizeSpy).not.toHaveBeenCalled();

        // Dispara com rect positivo
        observerCb([{ contentRect: { width: 500, height: 300 } }]);
        expect(onResizeSpy).toHaveBeenCalledWith(false);

        viewer.destroy();
      } finally {
        globalThis.ResizeObserver = origRO;
      }
    });

    it('mantém fallback enquanto oculto (display: none) mesmo se ResizeObserver disparar', () => {
      container.style.display = 'none';

      let observerCb = null;
      class MockResizeObserver {
        constructor(cb) {
          observerCb = cb;
        }
        observe() {}
        disconnect() {}
      }
      const origRO = globalThis.ResizeObserver;
      globalThis.ResizeObserver = MockResizeObserver;

      try {
        const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
        viewer.init();

        expect(viewer.camera.aspect).toBeCloseTo(420 / 250, 4);

        // Força disparo do ResizeObserver fingindo dimensões residuais enquanto display: none
        Object.defineProperty(canvas, 'clientWidth', { value: 600, configurable: true });
        Object.defineProperty(canvas, 'clientHeight', { value: 350, configurable: true });
        observerCb([{ contentRect: { width: 600, height: 350 } }]);

        // Como está no DOM como display: none, _isDomHidden() é true e mantém 420x250
        const dims = viewer._getEffectiveDimensions();
        expect(dims.width).toBe(420);
        expect(dims.height).toBe(250);
        expect(dims.isVisible).toBe(false);

        // Agora simula o modal sendo exibido e start() sendo chamado
        container.style.display = 'flex';
        viewer.start();

        const dimsUnhidden = viewer._getEffectiveDimensions();
        expect(dimsUnhidden.width).toBe(600);
        expect(dimsUnhidden.height).toBe(350);
        expect(dimsUnhidden.isVisible).toBe(true);
        expect(viewer.camera.aspect).toBeCloseTo(600 / 350, 4);

        viewer.destroy();
      } finally {
        globalThis.ResizeObserver = origRO;
      }
    });

    it('não quebra se ResizeObserver disparar com entry sem contentRect', () => {
      let observerCb = null;
      class MockResizeObserver {
        constructor(cb) {
          observerCb = cb;
        }
        observe() {}
        disconnect() {}
      }
      const origRO = globalThis.ResizeObserver;
      globalThis.ResizeObserver = MockResizeObserver;

      try {
        const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
        viewer.init();

        const onResizeSpy = vi.spyOn(viewer, '_onResize');

        // Entry malformada (contentRect indefinido)
        expect(() => {
          observerCb([{ contentRect: null }]);
        }).not.toThrow();

        expect(onResizeSpy).toHaveBeenCalledWith(false);

        viewer.destroy();
      } finally {
        globalThis.ResizeObserver = origRO;
      }
    });
  });

  describe('4. Rapid Open/Close (Start/Stop) Cycling Stress', () => {
    it('suporta 1000 ciclos consecutivos de start() e stop() sem dessincronização de animId ou render leak', () => {
      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      viewer.init();

      for (let i = 0; i < 1000; i++) {
        viewer.start();
        expect(viewer.isPaused).toBe(false);
        expect(viewer.isRendering).toBe(true);
        expect(viewer.animId).not.toBeNull();

        viewer.stop();
        expect(viewer.isPaused).toBe(true);
        expect(viewer.isRendering).toBe(false);
        expect(viewer.animId).toBeNull();
      }

      // Nenhuma animação ou render pendente após stop()
      expect(viewer.animId).toBeNull();
      expect(viewer.isRendering).toBe(false);
      expect(viewer.isPaused).toBe(true);

      viewer.destroy();
    });

    it('ignora callbacks pendentes de requestAnimationFrame se start() for seguido de destroy()', () => {
      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      viewer.init();

      viewer.start();
      viewer.destroy();

      expect(viewer.isDestroyed).toBe(true);
      expect(viewer.isPaused).toBe(true);

      // Avança timers / rAF pendentes
      expect(() => {
        vi.runAllTimers();
      }).not.toThrow();

      // Camera e cena devem continuar nulos após rAF
      expect(viewer.camera).toBeNull();
      expect(viewer.scene).toBeNull();
    });
  });

  describe('5. High-Frequency L3/R3 Stick Clicks & Emissive Lighting Stress', () => {
    it('executa 10000 cliques rápidos de L3 e R3 com verificação de zero alocação de novos materiais', () => {
      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      viewer.init();

      const stickL = viewer.parts.stickL;
      const stickR = viewer.parts.stickR;
      expect(stickL).toBeTruthy();
      expect(stickR).toBeTruthy();

      const recordsL = viewer.partMaterials.get(stickL);
      const recordsR = viewer.partMaterials.get(stickR);
      expect(recordsL.length).toBeGreaterThan(0);
      expect(recordsR.length).toBeGreaterThan(0);

      // Salva instâncias originais dos materiais
      const originalMaterialsL = recordsL.map((r) => r.material);
      const originalMaterialsR = recordsR.map((r) => r.material);

      const initL = viewer.initialTransforms.get(stickL);
      const initR = viewer.initialTransforms.get(stickR);

      // 10000 iterações alternando L3 e R3 e cliques simultâneos
      for (let i = 0; i < 10000; i++) {
        const l3Active = (i % 2) === 0;
        const r3Active = (i % 3) === 0;

        viewer.updateInputs({
          axes: [0, 0, 0, 0],
          buttons: [
            ...Array(10).fill({ pressed: false, value: 0 }),
            { pressed: l3Active, value: l3Active ? 1.0 : 0.0 }, // 10: L3
            { pressed: r3Active, value: r3Active ? 1.0 : 0.0 }  // 11: R3
          ],
          connected: true
        });

        // Verificação anatômica de depressão do analógico
        const expectedLY = initL.pos.y - (l3Active ? 0.04 : 0);
        const expectedRY = initR.pos.y - (r3Active ? 0.04 : 0);
        expect(stickL.position.y).toBeCloseTo(expectedLY, 4);
        expect(stickR.position.y).toBeCloseTo(expectedRY, 4);

        // Verificação de emissivo ciano
        if (l3Active) {
          for (const { material } of recordsL) {
            expect(material.emissive.getHex()).toBe(0x06b6d4);
          }
        }
        if (r3Active) {
          for (const { material } of recordsR) {
            expect(material.emissive.getHex()).toBe(0x06b6d4);
          }
        }
      }

      // Release total final
      viewer.updateInputs({
        axes: [0, 0, 0, 0],
        buttons: Array(12).fill({ pressed: false, value: 0 }),
        connected: true
      });

      expect(stickL.position.y).toBeCloseTo(initL.pos.y, 4);
      expect(stickR.position.y).toBeCloseTo(initR.pos.y, 4);

      for (const { material, baseEmissive, baseIntensity } of recordsL) {
        expect(material.emissive.getHex()).toBe(baseEmissive.getHex());
        expect(material.emissiveIntensity).toBeCloseTo(baseIntensity, 4);
      }
      for (const { material, baseEmissive, baseIntensity } of recordsR) {
        expect(material.emissive.getHex()).toBe(baseEmissive.getHex());
        expect(material.emissiveIntensity).toBeCloseTo(baseIntensity, 4);
      }

      // Verificação crítica: zero alocação de novos materiais (instâncias idênticas às originais)
      recordsL.forEach((r, idx) => {
        expect(r.material).toBe(originalMaterialsL[idx]);
      });
      recordsR.forEach((r, idx) => {
        expect(r.material).toBe(originalMaterialsR[idx]);
      });
      expect(recordsL.length).toBe(originalMaterialsL.length);
      expect(recordsR.length).toBe(originalMaterialsR.length);

      viewer.destroy();
    });

    it('mantém isolamento total entre L3 e R3 (clicar L3 não ilumina stickR e vice-versa)', () => {
      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      viewer.init();

      const stickL = viewer.parts.stickL;
      const stickR = viewer.parts.stickR;
      const recordsL = viewer.partMaterials.get(stickL);
      const recordsR = viewer.partMaterials.get(stickR);

      // Pressiona apenas L3
      viewer.updateInputs({
        axes: [0, 0, 0, 0],
        buttons: [
          ...Array(10).fill({ pressed: false, value: 0 }),
          { pressed: true, value: 1.0 }, // 10: L3
          { pressed: false, value: 0.0 }  // 11: R3
        ],
        connected: true
      });

      for (const { material } of recordsL) {
        expect(material.emissive.getHex()).toBe(0x06b6d4);
      }
      for (const { material, baseEmissive } of recordsR) {
        expect(material.emissive.getHex()).toBe(baseEmissive.getHex());
      }

      // Pressiona apenas R3
      viewer.updateInputs({
        axes: [0, 0, 0, 0],
        buttons: [
          ...Array(10).fill({ pressed: false, value: 0 }),
          { pressed: false, value: 0.0 }, // 10: L3
          { pressed: true, value: 1.0 }   // 11: R3
        ],
        connected: true
      });

      for (const { material, baseEmissive } of recordsL) {
        expect(material.emissive.getHex()).toBe(baseEmissive.getHex());
      }
      for (const { material } of recordsR) {
        expect(material.emissive.getHex()).toBe(0x06b6d4);
      }

      viewer.destroy();
    });

    it('processa rotação angular máxima combinada com clique L3/R3 sem NaN nem descontinuidade', () => {
      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      viewer.init();

      const stickL = viewer.parts.stickL;
      const initL = viewer.initialTransforms.get(stickL);

      // Analógico esquerdo totalmente para cima e direita com L3 pressionado
      viewer.updateInputs({
        axes: [1.0, -1.0, -1.0, 1.0],
        buttons: [
          ...Array(10).fill({ pressed: false, value: 0 }),
          { pressed: true, value: 1.0 },
          { pressed: true, value: 1.0 }
        ],
        connected: true
      });

      expect(Number.isFinite(stickL.rotation.x)).toBe(true);
      expect(Number.isFinite(stickL.rotation.z)).toBe(true);
      expect(stickL.position.y).toBeCloseTo(initL.pos.y - 0.04, 4);

      viewer.destroy();
    });

    it('lida robustamente com dados de entrada malformados ou corrompidos sem estourar exceções', () => {
      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      viewer.init();

      // Entradas com null, undefined, strings e NaNs
      expect(() => {
        viewer.updateInputs(null);
        viewer.updateInputs({});
        viewer.updateInputs({ axes: null, buttons: null });
        viewer.updateInputs({ axes: [NaN, Infinity, 'invalid', -999], buttons: [null, undefined, { pressed: 'yes' }] });
        viewer.updateInputs({ buttons: Array(20).fill(undefined) });
      }).not.toThrow();

      viewer.destroy();
    });

    it('suprime updateInputs() e requestRender() quando pausado sem consumir recursos', () => {
      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      viewer.init();
      viewer.stop(); // Pausa

      expect(viewer.isPaused).toBe(true);
      expect(viewer._isElementHidden()).toBe(true);

      const renderSpy = vi.spyOn(viewer, 'requestRender');
      viewer.updateInputs({
        axes: [1, 1, 1, 1],
        buttons: Array(16).fill({ pressed: true, value: 1.0 }),
        connected: true
      });

      // updateInputs deve sair imediatamente sem nem chamar requestRender
      expect(renderSpy).not.toHaveBeenCalled();

      // Chamada direta a requestRender quando pausado deve ignorar
      viewer.requestRender();
      expect(viewer.isRendering).toBe(false);
      expect(viewer.animId).toBeNull();

      viewer.destroy();
    });

    it('resiste a valores extremos e inválidos de rumble (NaN, Infinity, negativos, gigantes)', () => {
      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer });
      viewer.init();

      // Inválidos devem ser ignorados
      viewer.triggerRumble(NaN);
      expect(viewer.rumbleIntensity).toBe(0);

      viewer.triggerRumble(-5);
      expect(viewer.rumbleIntensity).toBe(0);

      viewer.triggerRumble(0);
      expect(viewer.rumbleIntensity).toBe(0);

      viewer.triggerRumble('invalid');
      expect(viewer.rumbleIntensity).toBe(0);

      // Válidos devem ser limitados a 1.0
      viewer.triggerRumble(100);
      expect(viewer.rumbleIntensity).toBe(1.0);

      viewer.destroy();
    });
  });

  describe('6. Lifecycle & Memory Leak Stress (100 sequential instances)', () => {
    it('instancia, inicializa, atualiza entradas e destrói 100 visualizadores sem vazamentos de listeners ou referências', () => {
      const addWindowSpy = vi.spyOn(window, 'addEventListener');
      const removeWindowSpy = vi.spyOn(window, 'removeEventListener');

      let disconnectCount = 0;
      class MockResizeObserver {
        observe() {}
        disconnect() {
          disconnectCount++;
        }
      }
      const origRO = globalThis.ResizeObserver;
      globalThis.ResizeObserver = MockResizeObserver;

      try {
        for (let i = 0; i < 100; i++) {
          const c = document.createElement('canvas');
          container.appendChild(c);
          const r = createMockRenderer(c);

          const instance = new Gamepad3DViewer({ container, canvas: c, renderer: r });
          instance.init();
          instance.start();

          instance.updateInputs({
            axes: [0.5, -0.5, 0, 0],
            buttons: [
              ...Array(10).fill({ pressed: false, value: 0 }),
              { pressed: true, value: 1.0 }
            ],
            connected: true
          });

          instance.stop();
          instance.destroy();

          expect(instance.isDestroyed).toBe(true);
          expect(instance.scene).toBeNull();
          expect(instance.camera).toBeNull();
          expect(instance.renderer).toBeNull();
          expect(instance.initialTransforms.size).toBe(0);
          expect(instance.partMaterials.size).toBe(0);
          expect(r.dispose).toHaveBeenCalled();
          expect(r.forceContextLoss).toHaveBeenCalled();

          container.removeChild(c);
        }

        // Verifica que todos os 100 ResizeObservers foram desconectados
        expect(disconnectCount).toBe(100);

        // Verifica que todos os window resize listeners foram removidos
        const resizeAdds = addWindowSpy.mock.calls.filter(([event]) => event === 'resize').length;
        const resizeRemoves = removeWindowSpy.mock.calls.filter(([event]) => event === 'resize').length;
        expect(resizeAdds).toBe(100);
        expect(resizeRemoves).toBe(100);

      } finally {
        globalThis.ResizeObserver = origRO;
        addWindowSpy.mockRestore();
        removeWindowSpy.mockRestore();
      }
    });

    it('interações de mouse no container após destroy() não provocam erros', () => {
      const viewer = new Gamepad3DViewer({ container, canvas, renderer: mockRenderer, enableMouseTracking: true });
      viewer.init();
      viewer.destroy();

      expect(() => {
        container.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 50 }));
        container.dispatchEvent(new MouseEvent('mouseenter'));
        container.dispatchEvent(new MouseEvent('mouseleave'));
      }).not.toThrow();
    });
  });
});
