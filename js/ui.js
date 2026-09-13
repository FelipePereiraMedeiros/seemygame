import { initAudioAnalyser, stopAudioAnalyser } from './audio.js';
import { stopStatsMonitor } from './stats.js';
import { TERMS_VERSION } from './config.js';

/**
 * Valida o formato e tamanho seguro de um Peer ID
 * @param {string} id
 * @returns {boolean}
 */
export function isValidPeerId(id) {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  return /^[a-zA-Z0-9_-]{1,64}$/.test(trimmed);
}

/**
 * Exibe notificações toast flutuantes na tela (Seguro contra XSS)
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 * @param {number} [duration=4000]
 */
export function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '✓',
    info: 'ℹ',
    error: '⚠'
  };

  const iconStrong = document.createElement('strong');
  iconStrong.textContent = icons[type] || '•';

  const msgSpan = document.createElement('span');
  msgSpan.textContent = String(message);

  toast.appendChild(iconStrong);
  toast.appendChild(document.createTextNode(' '));
  toast.appendChild(msgSpan);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}

/**
 * Inicializa o modal de termos de uso e verificação de maioridade
 * @param {Function} [onAcceptCallback]
 */
export function initTermsModal(onAcceptCallback) {
  const modal = document.getElementById('terms-modal');
  const checkAge = document.getElementById('check-age');
  const checkTerms = document.getElementById('check-terms');
  const acceptBtn = document.getElementById('accept-btn');
  const openTermsLink = document.getElementById('open-terms-link');

  if (!modal || !checkAge || !checkTerms || !acceptBtn) return;

  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  function updateAcceptButton() {
    acceptBtn.disabled = !(checkAge.checked && checkTerms.checked);
  }

  checkAge.addEventListener('change', updateAcceptButton);
  checkTerms.addEventListener('change', updateAcceptButton);

  const acceptedVersion = localStorage.getItem('seemygame_terms_version');
  const legacyAccepted = localStorage.getItem('seemygame_terms_accepted') === 'true';

  if (acceptedVersion === TERMS_VERSION || (legacyAccepted && !acceptedVersion)) {
    modal.style.display = 'none';
  } else {
    modal.style.display = 'flex';
  }

  acceptBtn.addEventListener('click', () => {
    localStorage.setItem('seemygame_terms_version', TERMS_VERSION);
    localStorage.setItem('seemygame_terms_accepted', 'true');
    modal.style.display = 'none';
    showToast('Termos aceitos com sucesso!', 'success');

    if (typeof onAcceptCallback === 'function') {
      onAcceptCallback();
    }
  });

  if (openTermsLink) {
    openTermsLink.addEventListener('click', () => {
      checkAge.checked = true;
      checkTerms.checked = true;
      updateAcceptButton();
      modal.style.display = 'flex';
    });
  }
}

/**
 * Atualiza a visibilidade do estado vazio da grade de vídeos
 */
export function updateGridEmptyState() {
  const grid = document.getElementById('video-grid');
  const emptyState = document.getElementById('empty-state');
  if (!grid || !emptyState) return;

  const cards = grid.querySelectorAll('.video-card');
  if (cards.length === 0) {
    emptyState.style.display = 'flex';
  } else {
    emptyState.style.display = 'none';
  }
}

/**
 * Cria um cartão temporário com animação de carregamento enquanto conecta (Seguro contra XSS)
 * @param {string} peerId
 * @param {string} initialText
 * @param {Function} onDisconnect
 */
export function createPlaceholderCard(peerId, initialText, onDisconnect) {
  const grid = document.getElementById('video-grid');
  if (!grid) return;

  // Validação de segurança de ID
  if (!isValidPeerId(peerId)) {
    showToast('ID inválido para criação de cartão.', 'error');
    return;
  }

  if (document.getElementById(`card-${peerId}`)) return;

  const card = document.createElement('div');
  card.className = 'video-card';
  card.id = `card-${peerId}`;

  // Header seguro
  const header = document.createElement('div');
  header.className = 'video-card-header';

  const titleDiv = document.createElement('div');
  titleDiv.className = 'streamer-title';

  const iconSpan = document.createElement('span');
  iconSpan.textContent = '📡 ';

  const nameSpan = document.createElement('span');
  nameSpan.textContent = `Tela de ${peerId.slice(0, 6)}`;

  titleDiv.appendChild(iconSpan);
  titleDiv.appendChild(nameSpan);

  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'card-controls';

  const disconnectBtn = document.createElement('button');
  disconnectBtn.className = 'card-btn card-btn-danger';
  disconnectBtn.id = `disconnect-btn-${peerId}`;
  disconnectBtn.textContent = 'Desconectar';

  controlsDiv.appendChild(disconnectBtn);
  header.appendChild(titleDiv);
  header.appendChild(controlsDiv);

  // Wrapper do vídeo com spinner
  const wrapper = document.createElement('div');
  wrapper.className = 'video-wrapper';

  const statusOverlay = document.createElement('div');
  statusOverlay.className = 'stream-status-overlay';
  statusOverlay.id = `status-${peerId}`;

  const spinner = document.createElement('div');
  spinner.className = 'spinner';

  const pText = document.createElement('p');
  pText.style.cssText = 'font-size: 13px; color: var(--text-muted);';
  pText.textContent = initialText;

  statusOverlay.appendChild(spinner);
  statusOverlay.appendChild(pText);
  wrapper.appendChild(statusOverlay);

  card.appendChild(header);
  card.appendChild(wrapper);
  grid.appendChild(card);

  if (onDisconnect) {
    disconnectBtn.onclick = () => onDisconnect(peerId);
  }

  updateGridEmptyState();
}

/**
 * Atualiza o texto do overlay de status de um cartão
 * @param {string} peerId
 * @param {string} message
 */
export function updateCardStatus(peerId, message) {
  const statusOverlay = document.getElementById(`status-${peerId}`);
  if (statusOverlay) {
    const textElem = statusOverlay.querySelector('p');
    if (textElem) textElem.innerText = message;
  }
}

/**
 * Oculta o overlay de carregamento quando o stream é recebido
 * @param {string} peerId
 */
export function hideCardLoading(peerId) {
  const statusOverlay = document.getElementById(`status-${peerId}`);
  if (statusOverlay) {
    statusOverlay.style.display = 'none';
  }
}

/**
 * Altera visualmente o overlay de status de pausa da transmissão
 * @param {string} peerId
 * @param {boolean} isPaused
 * @param {string} [message='Transmissão pausada pelo streamer.']
 */
export function setCardStreamPaused(peerId, isPaused, message = 'Transmissão pausada pelo streamer.') {
  const pausedOverlay = document.getElementById(`paused-overlay-${peerId}`);
  if (pausedOverlay) {
    pausedOverlay.style.display = isPaused ? 'flex' : 'none';
    const p = pausedOverlay.querySelector('p');
    if (p) p.textContent = message;
    return;
  }

  const statusOverlay = document.getElementById(`status-${peerId}`);
  if (statusOverlay) {
    statusOverlay.style.display = isPaused ? 'flex' : 'none';
    const p = statusOverlay.querySelector('p');
    if (p) p.textContent = message;
  }
}

/**
 * Remove o cartão de vídeo e interrompe monitorias associadas
 * @param {string} peerId
 */
export function removeVideoCard(peerId) {
  const card = document.getElementById(`card-${peerId}`);
  if (card) card.remove();
  stopStatsMonitor(peerId);
  stopAudioAnalyser(peerId);
  updateGridEmptyState();
}

/**
 * Adiciona ou atualiza o player de vídeo na grade com controles de stats, som, PiP e tela cheia
 * @param {Object} options
 * @param {MediaStream} options.stream
 * @param {string} options.peerId
 * @param {string} options.label
 * @param {boolean} [options.isLocal=false]
 * @param {Function} [options.onDisconnect]
 */
export function addOrUpdateVideoCard({ stream, peerId, label, isLocal = false, onDisconnect, onCoopClick, onPanicClick }) {
  const grid = document.getElementById('video-grid');
  if (!grid) return null;

  if (!isValidPeerId(peerId) && peerId !== 'local-me') {
    showToast('ID inválido para adicionar cartão de vídeo.', 'error');
    return null;
  }

  let card = document.getElementById(`card-${peerId}`);
  if (!card) {
    card = document.createElement('div');
    card.className = 'video-card';
    card.id = `card-${peerId}`;
    grid.appendChild(card);
  }

  card.innerHTML = '';

  // Header do Card
  const header = document.createElement('div');
  header.className = 'video-card-header';

  const title = document.createElement('div');
  title.className = 'streamer-title';

  const liveDot = document.createElement('div');
  liveDot.className = 'live-dot';

  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;

  title.appendChild(liveDot);
  title.appendChild(labelSpan);

  // VU Meter Estéreo no Header
  const vuMeter = document.createElement('div');
  vuMeter.className = 'vu-meter-container';
  vuMeter.title = 'Medidor Estéreo L / R (Áudio do Jogo)';
  vuMeter.innerHTML = `
    <span class="vu-label">L</span>
    <div class="vu-track"><div class="vu-bar" id="vu-l-${peerId}"></div></div>
    <span class="vu-label">R</span>
    <div class="vu-track"><div class="vu-bar" id="vu-r-${peerId}"></div></div>
  `;
  title.appendChild(vuMeter);

  const controls = document.createElement('div');
  controls.className = 'card-controls';

  // Botão de HUD Stats
  const statsBtn = document.createElement('button');
  statsBtn.className = 'card-btn';
  statsBtn.innerText = '📊 Stats';
  statsBtn.title = 'Alternar HUD de FPS, Ping e Bitrate';
  statsBtn.onclick = () => {
    const hud = card.querySelector('.stats-hud');
    if (hud) {
      const isVisible = hud.style.display === 'flex';
      hud.style.display = isVisible ? 'none' : 'flex';
      statsBtn.classList.toggle('card-btn-active', !isVisible);
    }
  };
  controls.appendChild(statsBtn);

  // Botão Mute / Áudio
  if (!isLocal) {
    const muteBtn = document.createElement('button');
    muteBtn.className = 'card-btn';
    muteBtn.innerHTML = '🔊 Som';
    muteBtn.onclick = () => {
      video.muted = !video.muted;
      muteBtn.innerHTML = video.muted ? '🔇 Mudo' : '🔊 Som';
    };
    controls.appendChild(muteBtn);
  }

  // Botão PiP
  const pipBtn = document.createElement('button');
  pipBtn.className = 'card-btn';
  pipBtn.innerText = '⧉ PiP';
  pipBtn.onclick = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      showToast('Picture-in-Picture não suportado.', 'error');
    }
  };
  controls.appendChild(pipBtn);

  // Botão Fullscreen
  const fsBtn = document.createElement('button');
  fsBtn.className = 'card-btn';
  fsBtn.innerText = '⛶ Tela Cheia';
  fsBtn.onclick = () => {
    if (video.requestFullscreen) {
      video.requestFullscreen().catch((err) => {
        console.warn('Falha ao abrir tela cheia:', err);
      });
    }
  };
  controls.appendChild(fsBtn);

  // Botão Co-op / Player 2 para espectadores
  if (!isLocal) {
    const coopBtn = document.createElement('button');
    coopBtn.className = 'card-btn card-btn-coop';
    coopBtn.id = `btn-coop-${peerId}`;
    coopBtn.innerHTML = '🎮 Pedir Controle';
    coopBtn.title = 'Solicitar ao streamer para jogar como Player 2';
    if (onCoopClick) {
      coopBtn.onclick = () => onCoopClick(peerId);
    }
    controls.appendChild(coopBtn);
  }

  // Badges e Botão de Pânico no Host (Streamer)
  if (isLocal) {
    const hostP2Badge = document.createElement('div');
    hostP2Badge.id = 'host-p2-badge';
    hostP2Badge.style.display = 'none';
    hostP2Badge.className = 'card-badge-p2';
    hostP2Badge.innerHTML = `<span>🎮 P2: <strong id="host-p2-name">--</strong></span>`;
    title.appendChild(hostP2Badge);

    const panicBtn = document.createElement('button');
    panicBtn.id = 'host-panic-btn';
    panicBtn.style.display = 'none';
    panicBtn.className = 'card-btn card-btn-panic';
    panicBtn.innerHTML = '🛑 Revogar P2';
    panicBtn.title = 'Cortar imediatamente o controle do Player 2 (Escape)';
    if (onPanicClick) {
      panicBtn.onclick = () => onPanicClick();
    }
    controls.appendChild(panicBtn);
  }

  // Botão Sair / Encerrar
  const closeBtn = document.createElement('button');
  closeBtn.className = 'card-btn card-btn-danger';
  closeBtn.innerText = isLocal ? 'Encerrar' : 'Sair';
  closeBtn.onclick = () => {
    if (onDisconnect) {
      onDisconnect(peerId);
    }
  };
  controls.appendChild(closeBtn);

  header.appendChild(title);
  header.appendChild(controls);
  card.appendChild(header);

  // Wrapper do Vídeo
  const videoWrapper = document.createElement('div');
  videoWrapper.className = 'video-wrapper';

  // HUD de Estatísticas em Tempo Real (Inicia com -- em vez de valor fictício)
  const statsHud = document.createElement('div');
  statsHud.className = 'stats-hud';
  statsHud.innerHTML = `
    <div class="stats-row"><span class="stats-label">Taxa de Quadros:</span> <span class="stats-val stats-val-green" id="stat-fps-${peerId}">-- FPS</span></div>
    <div class="stats-row"><span class="stats-label">Latência (RTT):</span> <span class="stats-val stats-val-green" id="stat-rtt-${peerId}">-- ms</span></div>
    <div class="stats-row"><span class="stats-label">Bitrate:</span> <span class="stats-val" id="stat-bitrate-${peerId}">-- Mbps</span></div>
    <div class="stats-row"><span class="stats-label">Resolução:</span> <span class="stats-val" id="stat-res-${peerId}">--</span></div>
    <div class="stats-row"><span class="stats-label">Prioridade:</span> <span class="stats-val stats-val-purple">Máxima Fluidez</span></div>
  `;

  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.controls = false;
  video.muted = isLocal;

  // Overlay de transmissão pausada
  const pausedOverlay = document.createElement('div');
  pausedOverlay.className = 'stream-paused-overlay';
  pausedOverlay.id = `paused-overlay-${peerId}`;
  pausedOverlay.style.display = 'none';
  pausedOverlay.innerHTML = `
    <div class="pause-icon">⏸️</div>
    <p style="font-size: 13px; color: var(--text-main);">Transmissão pausada pelo streamer.</p>
  `;

  // Overlay de Unmute caso autoplay seja barrado
  const unmuteOverlay = document.createElement('div');
  unmuteOverlay.className = 'audio-unmute-overlay';
  unmuteOverlay.innerHTML = `
    <p style="font-size: 13px; color: #fff;">O navegador pausou o áudio automático do jogo.</p>
    <button>🔊 Clique para Ativar Áudio Estéreo</button>
  `;

  unmuteOverlay.onclick = () => {
    video.muted = false;
    video.play().catch(e => console.warn(e));
    unmuteOverlay.style.display = 'none';
    initAudioAnalyser(stream, peerId);
  };

  videoWrapper.appendChild(statsHud);
  videoWrapper.appendChild(video);
  videoWrapper.appendChild(pausedOverlay);
  videoWrapper.appendChild(unmuteOverlay);
  card.appendChild(videoWrapper);

  // Inicia o analisador de VU Meter estéreo
  initAudioAnalyser(stream, peerId);

  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch((err) => {
      console.warn("Autoplay bloqueado:", err);
      video.muted = true;
      video.play().catch(e => console.warn(e));
      if (!isLocal) {
        unmuteOverlay.style.display = 'flex';
      }
    });
  }

  updateGridEmptyState();
  return { card, video };
}

/**
 * Exibe o modal de solicitação de controle do Player 2 para o streamer
 * @param {string} requesterId
 * @param {Function} onApprove
 * @param {Function} onDeny
 */
export function showCoopPromptModal(requesterId, onApprove, onDeny) {
  const modal = document.getElementById('coop-modal');
  const reqIdSpan = document.getElementById('coop-requester-id');
  const approveBtn = document.getElementById('coop-approve-btn');
  const denyBtn = document.getElementById('coop-deny-btn');
  if (!modal) return;

  if (reqIdSpan) reqIdSpan.textContent = requesterId.slice(0, 8);
  modal.style.display = 'flex';

  if (approveBtn) {
    approveBtn.onclick = () => {
      modal.style.display = 'none';
      if (onApprove) onApprove();
    };
  }

  if (denyBtn) {
    denyBtn.onclick = () => {
      modal.style.display = 'none';
      if (onDeny) onDeny();
    };
  }
}

/**
 * Atualiza visualmente o estado de Co-op nos cards (Host e Espectador)
 * @param {Object} state
 */
export function updateCoopUI(state) {
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

