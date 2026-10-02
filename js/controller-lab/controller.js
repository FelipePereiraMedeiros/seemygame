import { sendSessionMessage } from '../protocol/transport.js';
import { normalizeControllerState, createLabPlayer, applyLabSample, controllerChecksComplete, createControllerChecks } from './state.js';

export const LAB_TYPES = ['GAMEPAD_TEST_INVITE', 'GAMEPAD_TEST_JOIN', 'GAMEPAD_TEST_STATE', 'GAMEPAD_TEST_INPUT', 'GAMEPAD_TEST_READY', 'GAMEPAD_TEST_LEAVE', 'GAMEPAD_TEST_STOP'];

/** Read-only controller diagnostics: this transport never calls a game input adapter. */
export class ControllerLab {
  constructor({ session, getConnections = () => [], getPeerId = () => null, getDisplayName = () => 'Jogador',
    isAuthorizedPeer = () => false, canInvite = true, now = () => Date.now(), onChange = () => {},
    onInvite = () => {}, onOpen = () => {}, onClose = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { session, getConnections, getPeerId, getDisplayName, isAuthorizedPeer, canInvite, now, onChange, onInvite, onOpen, onClose, onError });
    this.players = new Map(); this.invitedAt = new Map(); this.pending = null;
    this.active = false; this.owner = false; this.labId = null; this.ownerPeerId = null;
    this.lastPublishAt = -Infinity; this.lastInputAt = -Infinity; this.revision = 0; this.lastRevision = -1;
    this.unsubs = LAB_TYPES.map(type => session.dispatcher.register(type, (data, connection) => this.receive(data, connection)));
  }
  connections() {
    return Array.from(this.getConnections() || []).filter(conn => conn?.open && this.isAuthorizedPeer(conn.peer));
  }
  send(conn, data) {
    if (this.session.isDisposed || !conn?.open || (conn.dataChannel?.bufferedAmount || 0) > 65536) return false;
    try { return sendSessionMessage(this.session, conn, { ...data, labId: this.labId, ownerPeerId: this.ownerPeerId }); }
    catch (_) { return false; }
  }
  ownerConnection() { return this.connections().find(conn => conn.peer === this.ownerPeerId); }
  ownPlayer() { return this.players.get(this.getPeerId() || 'local'); }
  list() { return [...this.players.values()].sort((a, b) => a.slot - b.slot); }
  changed() { this.onChange(this.list()); }
  open() {
    if (this.active) return;
    this.owner = true; this.active = true;
    this.ownerPeerId = this.getPeerId() || 'local';
    this.labId = globalThis.crypto?.randomUUID?.() || `lab_${this.now()}_${Math.random().toString(36).slice(2)}`;
    this.lastPublishAt = -Infinity; this.revision = 0;
    this.players.clear(); this.players.set(this.ownerPeerId, createLabPlayer(this.ownerPeerId, this.getDisplayName(), 0));
    this.onOpen(); this.changed(); this.invite();
  }
  invite() {
    if (!this.active || !this.owner || !this.canInvite) return 0;
    let count = 0;
    for (const conn of this.connections()) {
      if (this.players.has(conn.peer)) continue;
      if (this.send(conn, { type: 'GAMEPAD_TEST_INVITE', name: this.getDisplayName() })) { this.invitedAt.set(conn.peer, this.now()); count++; }
    }
    return count;
  }
  acceptInvite() {
    const pending = this.pending;
    if (!pending || this.now() - pending.receivedAt > 30000) return false;
    const conn = this.connections().find(item => item.peer === pending.peerId);
    if (!conn) return false;
    this.close();
    this.pending = null; this.owner = false; this.active = true;
    this.ownerPeerId = pending.peerId; this.labId = pending.labId; this.lastRevision = -1;
    this.lastInputAt = -Infinity;
    this.players.clear();
    this.players.set(this.getPeerId(), createLabPlayer(this.getPeerId(), this.getDisplayName(), 1));
    this.onOpen(); this.changed();
    if (!this.send(conn, { type: 'GAMEPAD_TEST_JOIN', name: this.getDisplayName() })) {
      this.close(false); return false;
    }
    return true;
  }
  dismissInvite() { this.pending = null; this.onInvite(null); }
  receive(data, conn) {
    if (this.session.isDisposed || !conn || !this.connections().includes(conn)
      || typeof data.labId !== 'string' || data.labId.length > 128) return;
    if (data.type === 'GAMEPAD_TEST_INVITE') {
      if (data.ownerPeerId !== conn.peer || (this.active && this.ownerPeerId !== (this.getPeerId() || 'local'))) return;
      this.pending = { labId: data.labId, peerId: conn.peer, name: String(data.name || 'Seu amigo').slice(0, 40), receivedAt: this.now() };
      this.onInvite(this.pending); return;
    }
    if (data.type === 'GAMEPAD_TEST_STOP' && this.pending?.peerId === conn.peer
      && this.pending.labId === data.labId && data.ownerPeerId === conn.peer) this.dismissInvite();
    if (!this.active || data.labId !== this.labId || data.ownerPeerId !== this.ownerPeerId) return;
    if (this.owner) {
      if (data.type === 'GAMEPAD_TEST_JOIN') {
        if (!this.invitedAt.has(conn.peer)) return;
        if (!this.players.has(conn.peer)) {
          const used = new Set(this.list().map(player => player.slot));
          const slot = [1, 2, 3].find(index => !used.has(index));
          if (slot === undefined) { this.send(conn, { type: 'GAMEPAD_TEST_STOP', reason: 'Os quatro lugares do teste já estão ocupados.' }); return; }
          this.players.set(conn.peer, createLabPlayer(conn.peer, data.name, slot));
        }
        this.publish(); return;
      }
      const player = this.players.get(conn.peer);
      if (!player || conn.peer === this.ownerPeerId) return;
      if (data.type === 'GAMEPAD_TEST_INPUT') {
        // Cap one peer at 25 updates/s and ignore any peer/slot claimed in the payload.
        if (this.now() - player.lastSeen < 40 && player.lastSeen !== 0) return;
        applyLabSample(player, normalizeControllerState(data.state), this.now());
      } else if (data.type === 'GAMEPAD_TEST_READY') {
        player.ready = data.ready === true && player.state.connected && controllerChecksComplete(player.checks);
        this.publish();
      } else if (data.type === 'GAMEPAD_TEST_LEAVE') {
        this.players.delete(conn.peer); this.publish();
      }
    } else if (conn.peer === this.ownerPeerId) {
      if (data.type === 'GAMEPAD_TEST_STATE') {
        if (!Number.isSafeInteger(data.revision) || data.revision <= this.lastRevision || !Array.isArray(data.players) || data.players.length > 4) return;
        const players = new Map(); const slots = new Set();
        for (const item of data.players) {
          if (!item || typeof item.peerId !== 'string' || item.peerId.length > 64 || !Number.isInteger(item.slot)
            || item.slot < 0 || item.slot > 3 || slots.has(item.slot) || players.has(item.peerId)) return;
          slots.add(item.slot);
          const player = createLabPlayer(item.peerId, item.name, item.slot);
          player.state = normalizeControllerState(item.state) || player.state;
          player.checks = {
            face: Number.isInteger(item.checks?.face) ? item.checks.face & 15 : 0,
            sticks: Number.isInteger(item.checks?.sticks) ? item.checks.sticks & 3 : 0,
            triggers: Number.isInteger(item.checks?.triggers) ? item.checks.triggers & 3 : 0
          };
          player.ready = item.ready === true && player.state.connected && controllerChecksComplete(player.checks);
          players.set(player.peerId, player);
        }
        if (players.get(this.ownerPeerId)?.slot !== 0 || !players.has(this.getPeerId())) return;
        this.players = players; this.lastRevision = data.revision; this.changed();
      } else if (data.type === 'GAMEPAD_TEST_STOP') {
        this.close(false); if (data.reason) this.onError(String(data.reason).slice(0, 160));
      }
    }
  }
  sample(raw) {
    if (!this.active) return;
    const player = this.ownPlayer();
    if (!player) { this.close(); this.onError('Sua conexão mudou. Abra novamente a sala de controles.'); return; }
    const state = normalizeControllerState(raw || { connected: false });
    if (this.owner) {
      applyLabSample(player, state, this.now());
    } else if (this.now() - this.lastInputAt >= 50) {
      this.lastInputAt = this.now();
      this.send(this.ownerConnection(), { type: 'GAMEPAD_TEST_INPUT', state });
    }
  }
  setReady(ready) {
    const player = this.ownPlayer();
    if (!player || (ready && (!player.state.connected || !controllerChecksComplete(player.checks)))) return;
    if (this.owner) { player.ready = ready; this.publish(); }
    else this.send(this.ownerConnection(), { type: 'GAMEPAD_TEST_READY', ready });
  }
  tick() {
    if (this.pending && this.now() - this.pending.receivedAt > 30000) this.dismissInvite();
    if (!this.active) return;
    if (!this.owner) {
      if (!this.ownerConnection()) { this.close(false); this.onError('O organizador saiu do teste.'); }
      return;
    }
    const peers = new Set(this.connections().map(conn => conn.peer));
    for (const player of this.players.values()) {
      if (player.peerId !== this.ownerPeerId && !peers.has(player.peerId)) this.players.delete(player.peerId);
      else if (player.state.connected && this.now() - player.lastSeen > 1500) {
        player.state = normalizeControllerState({ ...player.state, connected: false });
        player.ready = false; player.checks = createControllerChecks();
      }
    }
    if (this.canInvite && this.players.size < 4 && this.connections().some(conn => !this.players.has(conn.peer) && !this.invitedAt.has(conn.peer))) this.invite();
    if (this.now() - this.lastPublishAt >= 50) this.publish();
  }
  publish() {
    this.lastPublishAt = this.now(); this.revision++;
    const players = this.list(); this.changed();
    for (const conn of this.connections()) if (this.players.has(conn.peer)) this.send(conn, { type: 'GAMEPAD_TEST_STATE', players, revision: this.revision });
  }
  close(notify = true) {
    if (!this.active) return;
    if (notify) {
      if (this.owner) for (const conn of this.connections()) {
        if (this.players.has(conn.peer) || this.invitedAt.has(conn.peer)) this.send(conn, { type: 'GAMEPAD_TEST_STOP' });
      }
      else this.send(this.ownerConnection(), { type: 'GAMEPAD_TEST_LEAVE' });
    }
    this.active = false; this.players.clear(); this.invitedAt.clear(); this.pending = null;
    this.onClose(); this.onInvite(null);
  }
  dispose() { this.close(); this.unsubs.forEach(unsubscribe => unsubscribe()); this.unsubs = []; this.dismissInvite(); }
}
