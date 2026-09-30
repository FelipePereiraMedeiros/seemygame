/** slots: commands receive explicit compatibility ports; no page initialization. */
export function reconcileCoopSlots(compatibilityContext) {
  const allowedMaxSlots = compatibilityContext.maxCoopPlayers > 1 ? 4 : 2;
  for (const [slot, player] of Array.from(compatibilityContext.coopSlots.entries())) {
    // Se o modo party estiver desativado, o slot 0 não pode ser ocupado por jogador remoto (exclusivo do host)
    if (slot === 0 && !compatibilityContext.partyModeEnabled) {
      compatibilityContext.revokeCoopPlayer(0, true);
    } else if (slot >= allowedMaxSlots) {
      // Se maxCoopPlayers foi reduzido (ex: de 4 para 2), revoga slots além do limite
      compatibilityContext.revokeCoopPlayer(slot, true);
    }
  }
}

export function setMaxCoopPlayers(compatibilityContext, count) {
  compatibilityContext.maxCoopPlayers = Math.max(1, Math.min(4, Number(count) || 1));
  compatibilityContext.reconcileCoopSlots();
  compatibilityContext.notifyStateChange();
}

export function getMaxCoopPlayers(compatibilityContext) {
  return compatibilityContext.maxCoopPlayers;
}

export function setPartyModeEnabled(compatibilityContext, enabled) {
  compatibilityContext.partyModeEnabled = Boolean(enabled);
  compatibilityContext.reconcileCoopSlots();
  compatibilityContext.notifyStateChange();
}

export function isPartyModeEnabled(compatibilityContext) {
  return compatibilityContext.partyModeEnabled;
}

export function registerCoopBroadcastHandler(compatibilityContext, cb) {
  compatibilityContext.broadcastSlotsCallback = cb;
}

export function broadcastSlotsUpdate(compatibilityContext) {
  if (compatibilityContext.broadcastSlotsCallback) {
    try {
      compatibilityContext.broadcastSlotsCallback({
        type: 'COOP_SLOTS_UPDATE',
        slots: compatibilityContext.getCoopSlots()
      });
    } catch (e) {}
  }
}

export function getCoopSlots(compatibilityContext) {
  const slots = [];
  const maxSlots = compatibilityContext.maxCoopPlayers > 1 ? 4 : 2;

  // Slot 0 (Player 1)
  slots.push({
    slot: 0,
    label: 'Player 1',
    occupied: compatibilityContext.coopSlots.has(0),
    peerId: compatibilityContext.coopSlots.get(0)?.peerId || (compatibilityContext.partyModeEnabled ? null : 'host-local'),
    name: compatibilityContext.coopSlots.get(0)?.name || (compatibilityContext.partyModeEnabled ? 'Vago' : 'Streamer (Local)'),
    isHost: !compatibilityContext.coopSlots.has(0) && !compatibilityContext.partyModeEnabled,
    color: '#3b82f6'
  });

  // Slot 1 (Player 2)
  slots.push({
    slot: 1,
    label: 'Player 2',
    occupied: compatibilityContext.coopSlots.has(1),
    peerId: compatibilityContext.coopSlots.get(1)?.peerId || null,
    name: compatibilityContext.coopSlots.get(1)?.name || 'Vago',
    isHost: false,
    color: '#10b981'
  });

  if (compatibilityContext.maxCoopPlayers > 1) {
    // Slot 2 (Player 3)
    slots.push({
      slot: 2,
      label: 'Player 3',
      occupied: compatibilityContext.coopSlots.has(2),
      peerId: compatibilityContext.coopSlots.get(2)?.peerId || null,
      name: compatibilityContext.coopSlots.get(2)?.name || 'Vago',
      isHost: false,
      color: '#f59e0b'
    });

    // Slot 3 (Player 4)
    slots.push({
      slot: 3,
      label: 'Player 4',
      occupied: compatibilityContext.coopSlots.has(3),
      peerId: compatibilityContext.coopSlots.get(3)?.peerId || null,
      name: compatibilityContext.coopSlots.get(3)?.name || 'Vago',
      isHost: false,
      color: '#a855f7'
    });
  }

  return slots;
}

export function getNextAvailableSlot(compatibilityContext, preferredSlot = null) {
  const candidateSlots = [];
  if (compatibilityContext.maxCoopPlayers > 1 && compatibilityContext.partyModeEnabled && !compatibilityContext.coopSlots.has(0)) {
    candidateSlots.push(0);
  }
  if (!compatibilityContext.coopSlots.has(1)) {
    candidateSlots.push(1);
  }
  if (compatibilityContext.maxCoopPlayers > 1) {
    if (!compatibilityContext.coopSlots.has(2)) candidateSlots.push(2);
    if (!compatibilityContext.coopSlots.has(3)) candidateSlots.push(3);
  }

  if (preferredSlot !== null && preferredSlot !== undefined) {
    const p = Number(preferredSlot);
    if (candidateSlots.includes(p)) return p;
  }

  return candidateSlots.length > 0 ? candidateSlots[0] : null;
}

export function registerCoopPromptHandler(compatibilityContext, cb) {
  compatibilityContext.onPromptCallback = cb;
  return () => { if (compatibilityContext.onPromptCallback === cb) compatibilityContext.onPromptCallback = null; };
}

export function registerCoopStateChangeHandler(compatibilityContext, cb) {
  compatibilityContext.onStateChangeCallback = cb;
  return () => { if (compatibilityContext.onStateChangeCallback === cb) compatibilityContext.onStateChangeCallback = null; };
}

export function notifyStateChange(compatibilityContext) {
  if (compatibilityContext.onStateChangeCallback) {
    const p2PeerId = compatibilityContext.coopSlots.get(1)?.peerId || (compatibilityContext.coopSlots.size > 0 ? compatibilityContext.coopSlots.values().next().value?.peerId : null);
    compatibilityContext.onStateChangeCallback({
      isCoopEnabled: compatibilityContext.isCoopEnabled,
      activePlayer2PeerId: p2PeerId,
      isPlayer2: compatibilityContext.myAssignedSlot !== null || compatibilityContext.isPlayer2,
      myAssignedSlot: compatibilityContext.myAssignedSlot,
      maxCoopPlayers: compatibilityContext.maxCoopPlayers,
      partyModeEnabled: compatibilityContext.partyModeEnabled,
      activeSlotsCount: compatibilityContext.coopSlots.size,
      slots: compatibilityContext.getCoopSlots(),
      activeHostPeerId: compatibilityContext.activeHostPeerId,
      isCompanionConnected: compatibilityContext.isCompanionConnected,
      companionCapabilities: { ...compatibilityContext.companionCapabilities },
      targetRect: compatibilityContext.coopInputTargetRect ? { ...compatibilityContext.coopInputTargetRect } : null
    });
  }
}

export function setCoopEnabled(compatibilityContext, enabled) {
  compatibilityContext.isCoopEnabled = enabled;
  if (!enabled && compatibilityContext.coopSlots.size > 0) {
    compatibilityContext.revokeAllCoopPlayers();
  }
  compatibilityContext.notifyStateChange();
}

export function getCoopState(compatibilityContext) {
  const p2PeerId = compatibilityContext.coopSlots.get(1)?.peerId || (compatibilityContext.coopSlots.size > 0 ? compatibilityContext.coopSlots.values().next().value?.peerId : null);
  return {
    isCoopEnabled: compatibilityContext.isCoopEnabled,
    activePlayer2PeerId: p2PeerId,
    isPlayer2: compatibilityContext.myAssignedSlot !== null || compatibilityContext.isPlayer2,
    myAssignedSlot: compatibilityContext.myAssignedSlot,
    maxCoopPlayers: compatibilityContext.maxCoopPlayers,
    partyModeEnabled: compatibilityContext.partyModeEnabled,
    activeSlotsCount: compatibilityContext.coopSlots.size,
    slots: compatibilityContext.getCoopSlots(),
    activeHostPeerId: compatibilityContext.activeHostPeerId,
    isCompanionConnected: compatibilityContext.isCompanionConnected,
    companionCapabilities: { ...compatibilityContext.companionCapabilities },
    targetRect: compatibilityContext.coopInputTargetRect ? { ...compatibilityContext.coopInputTargetRect } : null
  };
}
