import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoopController } from '../js/coop/controller.js';
import { dispatchHostInputReset } from '../js/coop/transport.js';
import { handleHostCoopMessage } from '../js/coop/host.js';

afterEach(() => vi.restoreAllMocks());
describe('Sala de controles: pausa do Co-op', () => {
  it('pausa envio do viewer, manda reset uma vez e retoma sem solicitar nova aprovação', () => {
    vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(73);
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    const connection = { open: true, send: vi.fn() }; const controller = createCoopController();
    const card = document.createElement('div'); document.body.appendChild(card);
    const key = () => card.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
    try {
      controller.requestCoopControl('host', connection);
      controller.handleViewerCoopMessage({ type: 'COOP_RESPONSE', approved: true, slot: 1 }, 'host', card);
      connection.send.mockClear(); key();
      expect(connection.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'INPUT_KEY' }));
      connection.send.mockClear(); controller.setInputTestMode(true); controller.setInputTestMode(true);
      expect(connection.send).toHaveBeenCalledOnce();
      expect(connection.send).toHaveBeenCalledWith({ type: 'INPUT_RESET', slot: 1, preserveGamepads: true });
      connection.send.mockClear(); key(); expect(connection.send).not.toHaveBeenCalled();
      controller.setInputTestMode(false); key();
      expect(connection.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'INPUT_KEY' }));
      expect(controller.getCoopState().myAssignedSlot).toBe(1);
    } finally { controller.dispose(); card.remove(); }
  });
  it('solta teclas, preserva slot e bloqueia inputs até voltar à sala', () => {
    const controller = createCoopController();
    const events = []; const listener = event => events.push(event.type);
    window.addEventListener('keydown', listener); window.addEventListener('keyup', listener);
    try {
      controller.coopSlots.set(1, { peerId: 'player', slot: 1 });
      const input = { type: 'INPUT_KEY', slot: 1, code: 'KeyW', action: 'down' };
      controller.handleHostCoopMessage('player', input); expect(events).toEqual(['keydown']);
      controller.setInputTestMode(true); expect(events).toEqual(['keydown', 'keyup']);
      controller.handleHostCoopMessage('player', input); expect(events).toHaveLength(2);
      expect(controller.coopSlots.get(1).peerId).toBe('player');
      controller.setInputTestMode(false); controller.handleHostCoopMessage('player', input);
      expect(events).toEqual(['keydown', 'keyup', 'keydown']);
    } finally { controller.dispose(); window.removeEventListener('keydown', listener); window.removeEventListener('keyup', listener); }
  });
  it('neutraliza todos os slots nativos sem desconectar gamepads virtuais', () => {
    const ports = { isTauriEnvironment: () => true, coopSlots: new Map([[0, {}], [3, {}]]),
      updateVirtualGamepad: vi.fn().mockResolvedValue(), unplugAllVirtualGamepads: vi.fn().mockResolvedValue(),
      pressedBrowserKeys: new Set(), slotPressedKeys: new Map() };
    dispatchHostInputReset(ports, { unplugVirtualGamepads: false });
    expect(ports.unplugAllVirtualGamepads).not.toHaveBeenCalled();
    expect(ports.updateVirtualGamepad).toHaveBeenCalledWith(0, expect.objectContaining({ axes: [0, 0, 0, 0], triggers: [0, 0] }));
    expect(ports.updateVirtualGamepad).toHaveBeenCalledWith(3, expect.any(Object));
  });
  it('reset remoto preserva dispositivos apenas de jogador autorizado', () => {
    const ports = { coopSlots: new Map([[1, { peerId: 'player' }]]), maxCoopPlayers: 1, dispatchHostInputReset: vi.fn() };
    handleHostCoopMessage(ports, 'other', { type: 'INPUT_RESET', preserveGamepads: true, slot: 1 });
    expect(ports.dispatchHostInputReset).not.toHaveBeenCalled();
    handleHostCoopMessage(ports, 'player', { type: 'INPUT_RESET', preserveGamepads: true, slot: 1 });
    expect(ports.dispatchHostInputReset).toHaveBeenCalledWith({ unplugVirtualGamepads: false, slot: 1 });
  });
  it('entrada individual não neutraliza controles ou teclas de outros jogadores', () => {
    const ports = { isTauriEnvironment: () => true, coopSlots: new Map([[1, {}], [3, {}]]),
      updateVirtualGamepad: vi.fn().mockResolvedValue(), unplugAllVirtualGamepads: vi.fn().mockResolvedValue(),
      pressedBrowserKeys: new Set(['KeyW', 'KeyA']), slotPressedKeys: new Map([[1, new Set(['KeyW', 'KeyA'])], [3, new Set(['KeyW'])]]) };
    const keyup = vi.fn(); window.addEventListener('keyup', keyup);
    try {
      dispatchHostInputReset(ports, { unplugVirtualGamepads: false, slot: 1 });
      expect(ports.updateVirtualGamepad).toHaveBeenCalledOnce(); expect(ports.updateVirtualGamepad).toHaveBeenCalledWith(1, expect.any(Object));
      expect(ports.slotPressedKeys.get(3)).toEqual(new Set(['KeyW'])); expect(ports.pressedBrowserKeys.has('KeyW')).toBe(true);
      expect(keyup).toHaveBeenCalledOnce(); expect(keyup.mock.calls[0][0].code).toBe('KeyA');
    } finally { window.removeEventListener('keyup', keyup); }
  });
});
