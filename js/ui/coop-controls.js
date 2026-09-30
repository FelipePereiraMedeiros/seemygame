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

export function renderCoopLobbyDock(compatibilityContext, slots = [], isHost = false, options = {}) {
  // Safe stub/renderer para slots coop no lobby
}
