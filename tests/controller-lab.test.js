import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionContext } from '../js/core/session-context.js';
import { ControllerLab } from '../js/controller-lab/controller.js';
import { normalizeControllerState, createLabPlayer, applyLabSample, controllerChecksComplete } from '../js/controller-lab/state.js';

const fullPad = (id = 'Xbox', index = 0) => ({ connected: true, id, index, mapping: 'standard', buttons: Array.from({ length: 17 }, (_, i) => ({ value: i < 4 || i === 6 || i === 7 ? 1 : 0 })), axes: [.6, 0, -.7, 0] });
let nodes = [];
afterEach(() => { nodes.forEach(node => { node.lab.dispose(); node.session.dispose(); }); nodes = []; });

function network(guests = 3) {
  let time = 1000;
  const make = (id, canInvite) => {
    const session = createSessionContext(); session.getPeerId = () => id;
    const node = { id, session, connections: [], messages: [], invites: vi.fn(), opened: vi.fn(), closed: vi.fn() };
    node.lab = new ControllerLab({ session, getPeerId: () => id, getDisplayName: () => id,
      getConnections: () => node.connections, isAuthorizedPeer: peer => node.connections.some(conn => conn.peer === peer),
      canInvite, now: () => time, onInvite: node.invites, onOpen: node.opened, onClose: node.closed });
    nodes.push(node); return node;
  };
  const host = make('host', true), viewers = Array.from({ length: guests }, (_, i) => make(`viewer-${i}`, false));
  for (const viewer of viewers) {
    const incoming = { peer: host.id, open: true, dataChannel: { bufferedAmount: 0 } };
    const outgoing = { peer: viewer.id, open: true, dataChannel: { bufferedAmount: 0 } };
    outgoing.send = data => { host.messages.push(structuredClone(data)); viewer.session.dispatcher.dispatch(structuredClone(data), incoming); };
    incoming.send = data => { viewer.messages.push(structuredClone(data)); host.session.dispatcher.dispatch(structuredClone(data), outgoing); };
    host.connections.push(outgoing); viewer.connections.push(incoming);
  }
  return { host, viewers, advance: (ms = 50) => { time += ms; }, join: () => { host.lab.open(); viewers.forEach(viewer => viewer.lab.acceptInvite()); } };
}

describe('Sala de controles: estado físico', () => {
  it('preserva valores analógicos, limita payload e neutraliza desconectados', () => {
    const raw = fullPad('x'.repeat(150)); raw.buttons[6] = { pressed: true, value: .37 }; raw.axes = [3, -4, NaN, Infinity];
    const state = normalizeControllerState(raw);
    expect(state.buttons[6]).toBe(.37); expect(state.buttons).toHaveLength(17);
    expect(state.axes).toEqual([1, -1, 0, 0]); expect(state.device).toHaveLength(100);
    expect(normalizeControllerState({ ...raw, connected: false }).buttons.every(value => value === 0)).toBe(true);
    expect(normalizeControllerState(null)).toBeNull();
  });
  it('acumula grupos de inputs e exige repetir o teste ao trocar dispositivo ou desconectar', () => {
    const player = createLabPlayer('me', 'Me', 0);
    applyLabSample(player, normalizeControllerState(fullPad()), 1000);
    expect(controllerChecksComplete(player.checks)).toBe(true); player.ready = true;
    const idle = fullPad('Xbox', 1); idle.buttons = []; idle.axes = [];
    applyLabSample(player, normalizeControllerState(idle), 1050);
    expect(controllerChecksComplete(player.checks)).toBe(false); expect(player.ready).toBe(false);
    applyLabSample(player, normalizeControllerState(fullPad('Xbox', 1)), 1100); player.ready = true;
    applyLabSample(player, normalizeControllerState({ connected: false }), 1150);
    expect(player.checks).toEqual({ face: 0, sticks: 0, triggers: 0 }); expect(player.ready).toBe(false);
  });
});

describe('Sala de controles: protocolo e participantes', () => {
  it('requer aceite e distribui quatro pessoas sem encaminhar comandos ao jogo', () => {
    const { host, viewers } = network(); host.lab.open();
    expect(host.lab.list()).toHaveLength(1);
    viewers.forEach(viewer => { expect(viewer.lab.active).toBe(false); expect(viewer.lab.pending.peerId).toBe('host'); expect(viewer.lab.acceptInvite()).toBe(true); });
    expect(host.lab.list().map(player => player.slot)).toEqual([0, 1, 2, 3]);
    for (const node of [host, ...viewers]) {
      node.lab.sample(fullPad(node.id)); node.lab.setReady(true);
    }
    host.lab.publish(); viewers.forEach(viewer => viewer.lab.setReady(true));
    for (const node of [host, ...viewers]) {
      expect(node.lab.list()).toHaveLength(4); expect(node.lab.list().every(player => player.ready)).toBe(true);
      expect(node.messages.some(data => data.type.startsWith('INPUT_'))).toBe(false);
    }
  });
  it('impede entrada além do quarto lugar e mantém a sala existente', () => {
    const { host, viewers, join } = network(4); join();
    expect(host.lab.list()).toHaveLength(4); expect(viewers[3].lab.active).toBe(false);
    expect(viewers[0].lab.active).toBe(true);
  });
  it('atribui input ao transporte real e ignora slot/peer forjados', () => {
    const { host, viewers, join } = network(2); join();
    const data = { type: 'GAMEPAD_TEST_INPUT', labId: host.lab.labId, ownerPeerId: 'host', peerId: viewers[1].id, slot: 2, state: fullPad('attacker') };
    host.lab.receive(data, host.connections[0]);
    expect(host.lab.players.get(viewers[0].id).state.device).toBe('attacker');
    expect(host.lab.players.get(viewers[1].id).state.connected).toBe(false);
    host.lab.receive({ ...data, state: fullPad('spoof') }, { peer: viewers[1].id, open: true });
    expect(host.lab.players.get(viewers[1].id).state.connected).toBe(false);
  });
  it('limita frequência e backpressure; não confirma pronto antes de testar', () => {
    const { host, viewers, join, advance } = network(1); join(); const guest = viewers[0];
    guest.lab.setReady(true); expect(host.lab.players.get(guest.id).ready).toBe(false);
    guest.lab.sample(fullPad('first')); guest.lab.sample(fullPad('second'));
    expect(host.lab.players.get(guest.id).state.device).toBe('first');
    advance(); guest.connections[0].dataChannel.bufferedAmount = 65537; guest.lab.sample(fullPad('third'));
    expect(host.lab.players.get(guest.id).state.device).toBe('first');
    advance(); guest.connections[0].dataChannel.bufferedAmount = 0; guest.lab.sample(fullPad('third'));
    expect(host.lab.players.get(guest.id).state.device).toBe('third');
    host.lab.publish(); guest.lab.setReady(true); expect(host.lab.players.get(guest.id).ready).toBe(true);
  });
  it('não aceita snapshots antigos, de outro peer ou com slots duplicados', () => {
    const { host, viewers, join } = network(1); join(); const guest = viewers[0];
    const data = { type: 'GAMEPAD_TEST_STATE', labId: host.lab.labId, ownerPeerId: 'host', revision: 100, players: structuredClone(host.lab.list()) };
    guest.lab.receive(data, guest.connections[0]); expect(guest.lab.lastRevision).toBe(100);
    guest.lab.receive({ ...data, revision: 99, players: [] }, guest.connections[0]); expect(guest.lab.list()).toHaveLength(2);
    guest.lab.receive({ ...data, revision: 101, players: data.players.map(player => ({ ...player, slot: 0 })) }, guest.connections[0]);
    expect(guest.lab.lastRevision).toBe(100);
    guest.lab.receive({ ...data, revision: 102 }, { peer: 'host', open: true }); expect(guest.lab.lastRevision).toBe(100);
  });
  it('reseta pronto por amostra antiga e remove participante desconectado', () => {
    const { host, viewers, join, advance } = network(1); join(); const guest = viewers[0];
    guest.lab.sample(fullPad()); host.lab.publish(); guest.lab.setReady(true);
    advance(1600); host.lab.tick(); expect(host.lab.players.get(guest.id).state.connected).toBe(false);
    expect(host.lab.players.get(guest.id).ready).toBe(false);
    host.connections[0].open = false; host.lab.tick(); expect(host.lab.list()).toHaveLength(1);
    guest.connections[0].open = false; guest.lab.tick(); expect(guest.lab.active).toBe(false);
  });
  it('sair remove só o participante; fechar organizador encerra todos sem fechar a conexão', () => {
    const { host, viewers, join } = network(2); join(); viewers[0].lab.close();
    expect(host.lab.list()).toHaveLength(2); expect(viewers[1].lab.active).toBe(true);
    host.lab.close(); expect(viewers[1].lab.active).toBe(false);
    expect(host.connections.every(conn => conn.open)).toBe(true);
  });
  it('cancela convites pendentes e rejeita sessão antiga após reabrir', () => {
    const { host, viewers } = network(1); host.lab.open(); const oldId = host.lab.labId;
    host.lab.close(); expect(viewers[0].lab.pending).toBeNull(); host.lab.open();
    host.lab.receive({ type: 'GAMEPAD_TEST_JOIN', labId: oldId, ownerPeerId: 'host', name: 'old' }, host.connections[0]);
    expect(host.lab.list()).toHaveLength(1);
  });
  it('não deixa a tela ativa quando JOIN não consegue ser enviado e remove handlers no dispose', () => {
    const { host, viewers } = network(1); host.lab.open(); const guest = viewers[0];
    guest.connections[0].dataChannel.bufferedAmount = 100000;
    expect(guest.lab.acceptInvite()).toBe(false); expect(guest.lab.active).toBe(false);
    guest.lab.dispose();
    expect(guest.session.dispatcher.dispatch({ type: 'GAMEPAD_TEST_INVITE', labId: 'new', ownerPeerId: 'host' }, guest.connections[0]).handled).toBe(false);
  });
});
