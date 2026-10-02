import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createControllerLabView } from '../js/controller-lab/view.js';
import { createLabPlayer, normalizeControllerState } from '../js/controller-lab/state.js';

const mocks = vi.hoisted(() => ({ instances: [], fail: false }));
vi.mock('../js/gamepad-3d-viewer.js', () => ({ Gamepad3DViewer: class {
  constructor(options) { this.options = options; this.init = vi.fn(() => !mocks.fail); this.start = vi.fn(); this.stop = vi.fn(); this.destroy = vi.fn(); this.updateInputs = vi.fn(); mocks.instances.push(this); }
} }));
let view;
beforeEach(() => { document.body.innerHTML = '<button id="launcher">Controles</button><main>Room</main>'; mocks.instances = []; mocks.fail = false; });
afterEach(() => { view?.destroy(); view = null; document.body.innerHTML = ''; });

describe('Sala de controles: visualização e ciclo de vida', () => {
  it('atualiza quatro modelos independentes e usa texto seguro para nomes', async () => {
    view = createControllerLabView({ onClose: vi.fn(), onInvite: vi.fn() });
    const players = Array.from({ length: 4 }, (_, slot) => {
      const player = createLabPlayer(`p${slot}`, slot === 1 ? '<img src=x onerror=alert(1)>' : `Player ${slot}`, slot);
      player.state = normalizeControllerState({ connected: true, id: 'DualSense', mapping: 'standard', axes: [slot / 4, 0, 0, 0], buttons: [slot === 1 ? 1 : 0] }); return player;
    });
    view.render(players, 'p0'); await view.open(true);
    expect(mocks.instances).toHaveLength(4);
    mocks.instances.forEach((instance, slot) => expect(instance.updateInputs).toHaveBeenLastCalledWith(players[slot].state));
    expect(view.screen.querySelector('img')).toBeNull();
    expect(view.screen.querySelector('[data-lab-slot="1"] h3').textContent).toContain('<img');
    expect(view.screen.querySelector('[data-lab-slot="1"] [data-lab-button="0"]').dataset.pressed).toBe('true');
    expect(view.screen.querySelectorAll('.controller-lab-ready:not([hidden])')).toHaveLength(1);
    expect(view.screen.querySelector('.controller-lab-invite').disabled).toBe(true);
  });
  it('trava o foco, restaura inert e destrói renderizadores ao voltar', async () => {
    const launcher = document.getElementById('launcher'); launcher.focus();
    view = createControllerLabView({ onClose: () => view.close(), onInvite: vi.fn() }); await view.open(true);
    expect(launcher.inert).toBe(true); expect(document.activeElement.className).toBe('controller-lab-close');
    view.screen.querySelector('.controller-lab-invite').focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    expect(document.activeElement.className).toBe('controller-lab-close');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(view.screen.hidden).toBe(true); expect(launcher.inert).toBeFalsy(); expect(document.activeElement).toBe(launcher);
    mocks.instances.forEach(instance => expect(instance.destroy).toHaveBeenCalledOnce());
  });
  it('mantém os inputs disponíveis quando WebGL falha e não deixa modelos após fechar durante import', async () => {
    mocks.fail = true; view = createControllerLabView({ onClose: vi.fn(), onInvite: vi.fn() }); await view.open(false);
    expect(view.screen.querySelectorAll('.controller-lab-fallback:not([hidden])')).toHaveLength(4);
    mocks.instances.forEach(instance => expect(instance.destroy).toHaveBeenCalledOnce());
    view.close(); mocks.instances = []; const opening = view.open(false); view.close(); await opening;
    expect(mocks.instances).toHaveLength(0);
  });
  it('convite exige clique, seletor identifica índice físico e pronto depende do checklist', () => {
    const accept = vi.fn(), select = vi.fn(), ready = vi.fn();
    view = createControllerLabView({ onAccept: accept, onDevice: select, onReady: ready });
    view.invitation({ name: 'Amigo' }); expect(accept).not.toHaveBeenCalled();
    document.querySelector('[data-accept]').click(); expect(accept).toHaveBeenCalledOnce();
    const player = createLabPlayer('me', 'Eu', 2); view.render([player], 'me');
    const card = view.screen.querySelector('[data-lab-slot="2"]'); expect(card.querySelector('.controller-lab-ready').disabled).toBe(true);
    view.updateDevices([{ index: 0, id: 'Xbox' }, { index: 3, id: 'DualSense' }], 0);
    const selector = card.querySelector('select'); selector.value = '3'; selector.dispatchEvent(new Event('change'));
    expect(select).toHaveBeenCalledWith(3);
    player.state = normalizeControllerState({ connected: true }); player.checks = { face: 15, sticks: 3, triggers: 3 }; view.render([player], 'me');
    card.querySelector('.controller-lab-ready').click(); expect(ready).toHaveBeenCalledWith(true);
  });
});
