/** host: commands receive explicit compatibility ports; no page initialization. */
export function handleHostCoopMessage(compatibilityContext, senderPeerId, data, conn) {
  if (!data || typeof data !== 'object') return;

  // 1. Pedido de entrada no Co-op
  if (data.type === 'COOP_REQUEST') {
    if (!compatibilityContext.isCoopEnabled) {
      conn.send({ type: 'COOP_RESPONSE', approved: false, reason: 'O streamer desativou o modo Co-op.' });
      return;
    }

    // Se este peer já estiver alocado em um slot, reconfirma aprovação
    for (const [s, p] of compatibilityContext.coopSlots.entries()) {
      if (p.peerId === senderPeerId) {
        conn.send({ type: 'COOP_RESPONSE', approved: true, slot: s });
        return;
      }
    }

    // Verifica disponibilidade de slots
    const targetSlot = compatibilityContext.getNextAvailableSlot(data.preferredSlot);
    if (targetSlot === null) {
      const reason = compatibilityContext.maxCoopPlayers === 1
        ? 'Já existe um Player 2 conectado na sessão.'
        : 'Todos os 4 slots de Co-op estão ocupados no momento.';
      conn.send({ type: 'COOP_RESPONSE', approved: false, reason });
      return;
    }

    // Exibe modal de autorização para o streamer
    if (compatibilityContext.onPromptCallback) {
      compatibilityContext.onPromptCallback({
        peerId: senderPeerId,
        requestedSlot: targetSlot,
        approve: (approvedSlot = targetSlot) => {
          const finalSlot = approvedSlot !== undefined ? Number(approvedSlot) : targetSlot;
          const slotGeneration = ++compatibilityContext.nextCoopSlotGeneration;
          compatibilityContext.coopSlots.set(finalSlot, {
            slot: finalSlot,
            peerId: senderPeerId,
            conn,
            name: data.name || `Player ${finalSlot + 1}`,
            deviceType: 'gamepad',
            connectedAt: Date.now(),
            generation: slotGeneration
          });

          if (typeof localStorage !== 'undefined' && localStorage.getItem('seemygame_coop_token')) {
            compatibilityContext.initCompanionAgentConnection();
          }

          const isStillValid = () => {
            if (!compatibilityContext.isCoopEnabled) return false;
            const current = compatibilityContext.coopSlots.get(finalSlot);
            return current && current.peerId === senderPeerId && current.generation === slotGeneration;
          };

          const sendApproval = (nativeGamepadReady) => {
            if (!isStillValid()) return;
            conn.send({
              type: 'COOP_RESPONSE',
              approved: true
            });

            conn.send({
              type: 'COOP_CAPABILITIES',
              slot: finalSlot,
              keyboard: finalSlot === 1,
              mouse: Boolean(finalSlot === 1 && compatibilityContext.isCompanionConnected && compatibilityContext.companionCapabilities.mouse),
              gamepad: Boolean(nativeGamepadReady || (compatibilityContext.isCompanionConnected && compatibilityContext.companionCapabilities.gamepad)),
              browserKeyboardFallback: finalSlot === 1,
              mouseCoordinateSpace: compatibilityContext.companionCapabilities.mouseCoordinateSpace,
              targetRect: compatibilityContext.coopInputTargetRect
            });

            compatibilityContext.showToast(`🎮 Amigo (${senderPeerId.slice(0, 6)}) agora é o Player ${finalSlot + 1}!`, 'success');
            compatibilityContext.broadcastSlotsUpdate();
            compatibilityContext.notifyStateChange();
          };

          // A presença do global Tauri não prova que ViGEmBus está instalado.
          // A aprovação só é anunciada após o comando nativo resolver.
          if (compatibilityContext.isTauriEnvironment()) {
            compatibilityContext.plugVirtualGamepad(finalSlot)
              .then(() => {
                if (!isStillValid()) {
                  compatibilityContext.unplugVirtualGamepad(finalSlot).catch(() => {});
                  return;
                }
                sendApproval(true);
              })
              .catch((error) => {
                if (!isStillValid()) return;
                compatibilityContext.coopSlots.delete(finalSlot);
                conn.send({
                  type: 'COOP_RESPONSE',
                  approved: false,
                  reason: error?.message || 'Gamepad virtual indisponível neste desktop.'
                });
                compatibilityContext.showToast('Gamepad virtual indisponível: instale/ative o ViGEmBus.', 'error');
                compatibilityContext.broadcastSlotsUpdate();
                compatibilityContext.notifyStateChange();
              });
          } else {
            sendApproval(false);
          }
        },
        deny: (reason = 'Solicitação recusada pelo streamer.') => {
          conn.send({ type: 'COOP_RESPONSE', approved: false, reason });
          compatibilityContext.showToast(`Pedido de Co-op de (${senderPeerId.slice(0, 6)}) recusado.`, 'info');
        }
      });
    }
  }

  // 2. Convidado liberou o controle voluntariamente
  else if (data.type === 'COOP_RELEASE') {
    let slotToRelease = null;
    if (data.slot !== undefined && compatibilityContext.coopSlots.has(Number(data.slot)) && compatibilityContext.coopSlots.get(Number(data.slot)).peerId === senderPeerId) {
      slotToRelease = Number(data.slot);
    } else {
      for (const [s, p] of compatibilityContext.coopSlots.entries()) {
        if (p.peerId === senderPeerId) {
          slotToRelease = s;
          break;
        }
      }
    }
    if (slotToRelease !== null) {
      compatibilityContext.revokeCoopPlayer(slotToRelease, false);
      compatibilityContext.showToast(`🎮 Player ${slotToRelease + 1} (${senderPeerId.slice(0, 6)}) liberou os controles.`, 'info');
    }
  }

  // 3. Desconexão de peer
  else if (data.type === 'COOP_PEER_DISCONNECTED') {
    for (const [s, p] of Array.from(compatibilityContext.coopSlots.entries())) {
      if (p.peerId === senderPeerId) {
        compatibilityContext.revokeCoopPlayer(s, false);
      }
    }
  }

  // 4. Inputs dos Jogadores (Validação estrita de autorização por slot)
  else {
    const slot = Number(data.slot !== undefined ? data.slot : 1);
    const assignedPlayer = compatibilityContext.coopSlots.get(slot);

    const isSlotAllowed = (slot === 0 && compatibilityContext.partyModeEnabled) ||
      (slot === 1) ||
      (compatibilityContext.maxCoopPlayers > 1 && (slot === 2 || slot === 3));

    if (isSlotAllowed && assignedPlayer && assignedPlayer.peerId === senderPeerId) {
      if (data.type === 'INPUT_KEY') {
        compatibilityContext.dispatchHostKeyboardInput(data, slot);
      } else if (data.type === 'INPUT_MOUSE') {
        compatibilityContext.dispatchHostMouseInput(data);
      } else if (data.type === 'INPUT_GAMEPAD') {
        compatibilityContext.dispatchHostGamepadInput(data);
      } else if (data.type === 'INPUT_RESET') {
        compatibilityContext.dispatchHostInputReset();
      }
    }
  }
}

export function revokeCoopPlayer(compatibilityContext, slot, notify = true) {
  const targetSlot = Number(slot);
  const player = compatibilityContext.coopSlots.get(targetSlot);
  if (!player) return;

  if (compatibilityContext.isTauriEnvironment()) {
    compatibilityContext.unplugVirtualGamepad(targetSlot).catch(() => {});
  }

  // Libera teclas que estavam retidas no navegador por este slot específico
  const keysForSlot = compatibilityContext.slotPressedKeys.get(targetSlot);
  if (keysForSlot) {
    keysForSlot.forEach((code) => {
      // P3: Só emite keyup se nenhum outro slot ainda estiver segurando esta mesma tecla
      let heldByOtherSlot = false;
      for (const [otherSlot, sKeys] of compatibilityContext.slotPressedKeys.entries()) {
        if (otherSlot !== targetSlot && sKeys.has(code)) {
          heldByOtherSlot = true;
          break;
        }
      }
      if (!heldByOtherSlot) {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          try {
            window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
          } catch (e) {}
        }
        compatibilityContext.pressedBrowserKeys.delete(code);
      }
    });
    keysForSlot.clear();
  }
  compatibilityContext.slotPressedKeys.delete(targetSlot);

  // Se o companion nativo estiver conectado, envia reset para o slot correspondente
  if (compatibilityContext.isCompanionConnected && compatibilityContext.companionSocket && compatibilityContext.companionSocket.readyState === WebSocket.OPEN) {
    try {
      compatibilityContext.companionSocket.send(JSON.stringify({ type: 'INPUT_RESET', slot: targetSlot }));
    } catch (e) {}
  }

  if (notify && player.conn && player.conn.open !== false) {
    try {
      player.conn.send({ type: 'COOP_REVOKE' });
    } catch (e) {}
  }

  compatibilityContext.coopSlots.delete(targetSlot);

  if (compatibilityContext.coopSlots.size === 0) {
    compatibilityContext.closeCompanionAgentConnection();
  }

  if (notify) {
    compatibilityContext.showToast(`🛑 Controle do Player ${targetSlot + 1} (${player.peerId.slice(0, 6)}) foi revogado.`, 'info');
  }
  compatibilityContext.broadcastSlotsUpdate();
  compatibilityContext.notifyStateChange();
}

export function revokeAllCoopPlayers(compatibilityContext) {
  for (const slot of Array.from(compatibilityContext.coopSlots.keys())) {
    compatibilityContext.revokeCoopPlayer(slot, true);
  }
  if (compatibilityContext.isTauriEnvironment()) {
    compatibilityContext.unplugAllVirtualGamepads().catch(() => {});
  }
  compatibilityContext.dispatchHostInputReset();
  compatibilityContext.closeCompanionAgentConnection();
  compatibilityContext.showToast('🛑 Todos os controles de Co-op foram revogados.', 'warning');
}

export function revokePlayer2(compatibilityContext) {
  if (compatibilityContext.coopSlots.has(1)) {
    compatibilityContext.revokeCoopPlayer(1, true);
  } else {
    compatibilityContext.revokeAllCoopPlayers();
  }
}
