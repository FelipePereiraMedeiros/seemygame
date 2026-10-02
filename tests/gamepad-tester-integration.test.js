import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupGamepadTesterModal } from '../js/coop/tester-controller.js';
import { detectGamepadType, getButtonDisplayLabel } from '../js/coop/input.js';

const viewer = vi.hoisted(() => ({ init: vi.fn(), start: vi.fn(), stop: vi.fn(), destroy: vi.fn(), updateInputs: vi.fn() }));
vi.mock('../js/gamepad-3d-viewer.js', () => ({ Gamepad3DViewer: class {
  constructor() { Object.assign(this, viewer); }
} }));

describe('Integração do tester com o visualizador 3D e o hardware', () => {
  let dispose;
  let ports;
  let renderHud;
  beforeEach(() => {
    vi.clearAllMocks();
    viewer.init.mockReturnValue(true);
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { renderHud = callback; return 0; });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, writable: true, value: () => [] });
    document.body.innerHTML = `<button id="open-gamepad-tester-btn"></button>
      <div id="gamepad-tester-modal" style="display:none">
        <div id="gamepad-visual-stage"><canvas id="gamepad-3d-canvas"></canvas></div>
        <select id="gamepad-select"></select><span id="gamepad-buttons-label"></span>
      </div>`;
    ports = {
      currentMappingPreset: 'xbox', currentGamepadMapping: Array.from({ length: 17 }, (_, i) => i),
      detectGamepadType, getButtonDisplayLabel, applyButtonMapping: raw => raw,
      isTauriEnvironment: () => false, checkGamepadDriverStatus: vi.fn(), showToast: vi.fn()
    };
  });
  afterEach(() => {
    dispose?.(); dispose = null;
    vi.restoreAllMocks();
    delete navigator.getGamepads;
    document.body.innerHTML = '';
  });
  it('aceita init boolean e inicia o viewer se o modal abrir durante o import', async () => {
    dispose = setupGamepadTesterModal(ports);
    document.getElementById('open-gamepad-tester-btn').click();
    await vi.dynamicImportSettled();
    expect(viewer.init).toHaveBeenCalledOnce();
    expect(viewer.start).toHaveBeenCalledOnce();
    expect(console.warn).not.toHaveBeenCalled();
  });
  it('destrói o viewer quando WebGL não inicializa e mantém o modal funcional', async () => {
    viewer.init.mockReturnValue(false);
    dispose = setupGamepadTesterModal(ports);
    await vi.dynamicImportSettled();
    document.getElementById('open-gamepad-tester-btn').click();
    expect(viewer.destroy).toHaveBeenCalledOnce();
    expect(viewer.start).not.toHaveBeenCalled();
    expect(document.getElementById('gamepad-tester-modal').style.display).toBe('flex');
  });
  it('não cria recursos 3D depois do descarte durante o import', async () => {
    dispose = setupGamepadTesterModal(ports);
    dispose();
    await vi.dynamicImportSettled();
    expect(viewer.init).not.toHaveBeenCalled();
  });
  it('mostra glifos Sony no layout padrão sem modificar o mapeamento', async () => {
    navigator.getGamepads = () => [{ index: 0, id: 'DualSense (Vendor: 054c)', connected: true,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0, value: i === 0 ? 1 : 0 })) }];
    dispose = setupGamepadTesterModal(ports);
    await vi.dynamicImportSettled();
    document.getElementById('open-gamepad-tester-btn').click();
    renderHud();
    expect(document.getElementById('gamepad-buttons-label').textContent).toBe('✕ (Cross)');
    expect(ports.currentMappingPreset).toBe('xbox');
  });
  it.each(['8BitDo Switch Pro Controller', '8BitDo Wireless Controller', 'Pro Controller (Vendor: 2dc8)'])('prioriza o fabricante 8BitDo: %s', id => {
    expect(detectGamepadType(id)).toBe('8bitdo');
  });
  it.each(['Wireless Controller', 'Generic Pro Controller'])('não presume fabricante em nome ambíguo: %s', id => {
    expect(detectGamepadType(id)).toBe('generic');
  });
  it('mantém a escolha do slot ao conectar, desconectar e reconectar o controle', async () => {
    const makePad = index => ({ index, id: `Xbox ${index}`, connected: true, axes: [0, 0, 0, 0], buttons: [] });
    let pads = [makePad(0)];
    navigator.getGamepads = () => pads;
    dispose = setupGamepadTesterModal(ports);
    await vi.dynamicImportSettled();
    document.getElementById('open-gamepad-tester-btn').click(); renderHud();
    const select = document.getElementById('gamepad-select');
    expect([...select.options].map(o => o.value)).toEqual(['web:0', 'vacant:1', 'vacant:2', 'vacant:3']);
    select.value = 'vacant:3'; pads.push(makePad(3)); renderHud();
    expect(select.value).toBe('web:3');
    pads = [pads[0]]; renderHud(); expect(select.value).toBe('vacant:3');
    pads.push(makePad(3)); renderHud(); expect(select.value).toBe('web:3');
  });
});
