import { detectGamepadType } from '../coop/input.js';

const bounded = (value, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;

export function normalizeControllerState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const connected = raw.connected === true;
  const buttons = Array.from({ length: 17 }, (_, index) => {
    if (!connected) return 0;
    const button = raw.buttons?.[index];
    return bounded(typeof button === 'object' && button ? (button.value ?? (button.pressed ? 1 : 0)) : Number(button), 0, 1);
  });
  return {
    connected,
    device: String(raw.device || raw.id || '').slice(0, 100),
    mapping: raw.mapping === 'standard' ? 'standard' : '',
    index: Number.isInteger(raw.index) && raw.index >= 0 && raw.index <= 255 ? raw.index : 0,
    buttons,
    axes: Array.from({ length: 4 }, (_, index) => connected ? bounded(raw.axes?.[index], -1, 1) : 0)
  };
}

export function createControllerChecks() {
  return { face: 0, sticks: 0, triggers: 0 };
}

export function advanceControllerChecks(checks, state) {
  if (!state?.connected) return createControllerChecks();
  const next = { ...checks };
  for (let i = 0; i < 4; i++) if (state.buttons[i] > .5) next.face |= 1 << i;
  if (Math.hypot(state.axes[0], state.axes[1]) > .35) next.sticks |= 1;
  if (Math.hypot(state.axes[2], state.axes[3]) > .35) next.sticks |= 2;
  if (state.buttons[6] > .25) next.triggers |= 1;
  if (state.buttons[7] > .25) next.triggers |= 2;
  return next;
}

export function controllerChecksComplete(checks) {
  return checks?.face === 15 && checks.sticks === 3 && checks.triggers === 3;
}

export function controllerDeviceType(state) {
  return detectGamepadType(state?.device);
}

export function createLabPlayer(peerId, name, slot) {
  return { peerId, name: String(name || 'Jogador').slice(0, 40), slot, ready: false,
    state: normalizeControllerState({ connected: false }), checks: createControllerChecks(), lastSeen: 0 };
}

export function applyLabSample(player, state, now) {
  if (!state) return;
  if (player.state.device !== state.device || player.state.index !== state.index || !state.connected) {
    player.checks = createControllerChecks(); player.ready = false;
  }
  player.state = state;
  player.checks = advanceControllerChecks(player.checks, state);
  player.lastSeen = now;
}
