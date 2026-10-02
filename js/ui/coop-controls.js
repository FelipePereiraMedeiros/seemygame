/** coop-controls: commands receive explicit compatibility ports; no page initialization. */
export function showCoopPromptModal(compatibilityContext, requesterIdOrOpts, onApprove, onDeny) {
  const modal = document.getElementById('coop-modal') || document.getElementById('coop-prompt-modal');
  const reqIdSpan = document.getElementById('coop-requester-id');
  const approveBtn = document.getElementById('coop-approve-btn');
  const denyBtn = document.getElementById('coop-deny-btn');
  if (!modal) return;

  let requesterId = '';
  let approveCb = onApprove;
  let denyCb = onDeny;

  if (requesterIdOrOpts && typeof requesterIdOrOpts === 'object') {
    requesterId = requesterIdOrOpts.peerId || requesterIdOrOpts.requesterId || '';
    approveCb = requesterIdOrOpts.approve || requesterIdOrOpts.onApprove || onApprove;
    denyCb = requesterIdOrOpts.deny || requesterIdOrOpts.onDeny || onDeny;
  } else {
    requesterId = String(requesterIdOrOpts || '');
  }

  if (reqIdSpan) reqIdSpan.textContent = requesterId.slice(0, 8);
  modal.style.display = 'flex';

  if (approveBtn) {
    approveBtn.onclick = () => {
      modal.style.display = 'none';
      if (approveCb) approveCb();
    };
  }

  if (denyBtn) {
    denyBtn.onclick = () => {
      modal.style.display = 'none';
      if (denyCb) denyCb();
    };
  }
}

export function updateCoopUI(compatibilityContext, state) {
  // 1. Host side: badges e botão de pânico
  const hostP2Badge = document.getElementById('host-p2-badge');
  const hostP2Name = document.getElementById('host-p2-name');
  const hostPanicBtn = document.getElementById('host-panic-btn');

  if (state.activePlayer2PeerId) {
    if (hostP2Badge) hostP2Badge.style.display = 'inline-flex';
    if (hostP2Name) hostP2Name.textContent = state.activePlayer2PeerId.slice(0, 6);
    if (hostPanicBtn) hostPanicBtn.style.display = 'inline-flex';
  } else {
    if (hostP2Badge) hostP2Badge.style.display = 'none';
    if (hostPanicBtn) hostPanicBtn.style.display = 'none';
  }

  // 2. Viewer side: botões de pedir/liberar controle
  if (state.activeHostPeerId) {
    const btn = document.getElementById(`btn-coop-${state.activeHostPeerId}`);
    if (btn) {
      if (state.isPlayer2) {
        btn.innerHTML = '🎮 Liberar P2';
        btn.classList.add('card-btn-p2-active');
        btn.title = 'Você está controlando. Clique para liberar o controle.';
      } else {
        btn.innerHTML = '🎮 Pedir Controle';
        btn.classList.remove('card-btn-p2-active');
        btn.title = 'Solicitar ao streamer para jogar como Player 2';
      }
    }
  }
}

/**
 * Renderiza o dock de slots de jogadores Co-op (4 slots)
 * @param {Object} compatibilityContext
 * @param {Array} slots
 * @param {boolean} isHost
 * @param {Object} options
 */
export function renderCoopLobbyDock(compatibilityContext, slots = [], isHost = false, options = {}) {
  if (typeof document === 'undefined') return;
  const dock = document.getElementById('coop-lobby-dock');
  const container = document.getElementById('coop-slots-container');
  const panicBtn = document.getElementById('coop-panic-all-btn');

  if (!container) return;

  const slotsList = Array.isArray(slots) && slots.length > 0
    ? slots
    : (compatibilityContext?.getCoopSlots ? compatibilityContext.getCoopSlots() : []);

  if (dock) {
    dock.style.display = 'flex';
  }

  container.replaceChildren();

  let hasGuestConnected = false;

  // Renderiza exatamente 4 slots (0 a 3)
  for (let i = 0; i < 4; i++) {
    const slotInfo = slotsList.find(s => s.slot === i) || null;
    const chip = document.createElement('div');
    chip.className = `coop-slot-chip slot-${i}`;
    chip.dataset.slotIndex = String(i);

    if (slotInfo && slotInfo.peerId && slotInfo.peerId !== 'vago') {
      const isGuest = slotInfo.peerId !== 'host-local' && !slotInfo.isHost;
      if (isGuest) hasGuestConnected = true;

      const title = document.createElement('span');
      title.className = 'slot-name';
      title.textContent = `P${i + 1}: ${slotInfo.name || slotInfo.peerId.slice(0, 6)}`;
      chip.appendChild(title);

      const statusBadge = document.createElement('span');
      statusBadge.className = 'slot-status is-connected';
      statusBadge.textContent = isGuest ? '🟢 Conectado' : '👑 Host';
      chip.appendChild(statusBadge);

      if (isHost && isGuest) {
        const ejectBtn = document.createElement('button');
        ejectBtn.className = 'btn-eject';
        ejectBtn.title = `Ejetar Player ${i + 1}`;
        ejectBtn.textContent = '✕';
        ejectBtn.onclick = (e) => {
          e.stopPropagation();
          if (options.onEject) {
            options.onEject(i);
          } else if (compatibilityContext?.revokeCoopPlayer) {
            compatibilityContext.revokeCoopPlayer(slotInfo.peerId);
          }
        };
        chip.appendChild(ejectBtn);
      }
    } else {
      chip.classList.add('slot-empty');
      const emptyLabel = document.createElement('span');
      emptyLabel.className = 'slot-empty-label';
      emptyLabel.textContent = `Slot ${i + 1}: Vago`;
      chip.appendChild(emptyLabel);
    }

    container.appendChild(chip);
  }

  if (panicBtn) {
    panicBtn.style.display = (isHost && hasGuestConnected) ? 'inline-block' : 'none';
    panicBtn.onclick = () => {
      if (options.onPanicAll) {
        options.onPanicAll();
      } else if (compatibilityContext?.revokeAllCoopPlayers) {
        compatibilityContext.revokeAllCoopPlayers();
      }
    };
  }
}
