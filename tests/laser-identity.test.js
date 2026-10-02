import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TacticalPingPlugin } from '../js/plugins/ping-plugin.js';
import { MessageDispatcher } from '../js/core/message-dispatcher.js';

describe('Identidade de laser direto e retransmitido', () => {
  let manager, dispatcher, plugin, broadcast;
  beforeEach(() => {
    manager = { addLaserPoint: vi.fn(), stopLaserTrail: vi.fn() };
    dispatcher = new MessageDispatcher();
    broadcast = vi.fn();
    plugin = new TacticalPingPlugin({ manager });
    plugin.init({ dispatcher, isRoomMode: () => false, getViewersCount: () => 2,
      broadcastDataMessage: broadcast, isTrustedLaserRelayPeer: peer => peer === 'host' });
  });
  afterEach(() => plugin.destroy());
  it('ignora identidades forjadas no ponto e no envelope sem mutar a mensagem', () => {
    const data = { type: 'TACTICAL_LASER', senderId: 'victim', laserOriginPeerId: 'victim', point: { x: .2, y: .3, senderId: 'victim' } };
    dispatcher.dispatch(data, { peer: 'alice' });
    expect(manager.addLaserPoint).toHaveBeenCalledWith({ x: .2, y: .3, senderId: 'alice' });
    expect(data.point.senderId).toBe('victim');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ senderId: 'alice', laserOriginPeerId: 'alice' }), 'alice');
  });
  it('um peer só pode parar o próprio laser', () => {
    dispatcher.dispatch({ type: 'TACTICAL_LASER', action: 'stop', senderId: 'bob', laserOriginPeerId: 'bob' }, { peer: 'alice' });
    expect(manager.stopLaserTrail).toHaveBeenCalledWith('alice');
  });
  it('preserva dois remetentes diferentes retransmitidos pelo host autorizado', () => {
    for (const peer of ['alice', 'bob']) dispatcher.dispatch({ type: 'TACTICAL_LASER', laserOriginPeerId: peer, point: { x: .2, y: .3 } }, { peer: 'host' });
    expect(manager.addLaserPoint.mock.calls.map(([point]) => point.senderId)).toEqual(['alice', 'bob']);
    dispatcher.dispatch({ type: 'TACTICAL_LASER', action: 'stop', laserOriginPeerId: 'alice' }, { peer: 'host' });
    expect(manager.stopLaserTrail).toHaveBeenCalledWith('alice');
  });
  it('sem uma política de confiança explícita não aceita origem retransmitida', () => {
    plugin.destroy();
    plugin = new TacticalPingPlugin({ manager });
    plugin.init({ dispatcher });
    dispatcher.dispatch({ type: 'TACTICAL_LASER', laserOriginPeerId: 'bob', point: { x: .2, y: .3 } }, { peer: 'host' });
    expect(manager.addLaserPoint).toHaveBeenCalledWith({ x: .2, y: .3, senderId: 'host' });
  });
});
