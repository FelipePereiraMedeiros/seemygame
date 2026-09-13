import { initAudioAnalyser, stopAudioAnalyser } from './audio.js';
import { stopStatsMonitor } from './stats.js';

/**
 * Exibe notificações toast flutuantes na tela
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 */
export function showToast(message, type = 'info', duration = 4500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = {
    success: '✓',
    info: 'ℹ',
    error: '⚠'
  };
  
  toast.innerHTML = `<strong>${icons[type] || '•'}</strong> <span>${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Inicializa o modal de termos de uso e verificação de maioridade
 */
export function initTermsModal() {
  const modal = document.getElementById('terms-modal');
  const checkAge = document.getElementById('check-age');
  const checkTerms = document.getElementById('check-terms');
  const acceptBtn = document.getElementById('accept-btn');
  const openTermsLink = document.getElementById('open-terms-link');

  if (!modal || !checkAge || !checkTerms || !acceptBtn) return;

  function updateAcceptButton() {
    acceptBtn.disabled = !(checkAge.checked && checkTerms.checked);
  }

  checkAge.addEventListener('change', updateAcceptButton);
  checkTerms.addEventListener('change', updateAcceptButton);

  if (localStorage.getItem('seemygame_terms_accepted') === 'true') {
    modal.style.display = 'none';
  }

  acceptBtn.addEventListener('click', () => {
    localStorage.setItem('seemygame_terms_accepted', 'true');
    modal.style.display = 'none';
    showToast('Termos aceitos com sucesso!', 'success');
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
 * Cria um cartão temporário com animação de carregamento enquanto conecta
 * @param {string} peerId
 * @param {string} initialText
 * @param {Function} onDisconnect
 */
export function createPlaceholderCard(peerId, initialText, onDisconnect) {
  const grid = document.getElementById('video-grid');
  if (!grid || document.getElementById(`card-${peerId}`)) return;

  const card = document.createElement('div');
  card.className = 'video-card';
  card.id = `card-${peerId}`;

  card.innerHTML = `
    <div class="video-card-header">
      <div class="streamer-title">
        <span>📡</span>
        <span>Tela de ${peerId.slice(0, 6)}</span>
      </div>
      <div class="card-controls">
        <button class="card-btn card-btn-danger" id="disconnect-btn-${peerId}">Desconectar</button>
      </div>
    </div>
    <div class="video-wrapper">
      <div class="stream-status-overlay" id="status-${peerId}">
        <div class="spinner"></div>
        <p style="font-size: 13px; color: var(--text-muted);">${initialText}</p>
      </div>
    </div>
  `;

  grid.appendChild(card);

  const btn = card.querySelector(`#disconnect-btn-${peerId}`);
  if (btn && onDisconnect) {
    btn.onclick = () => onDisconnect(peerId);
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
export function addOrUpdateVideoCard({ stream, peerId, label, isLocal = false, onDisconnect }) {
  const grid = document.getElementById('video-grid');
  if (!grid) return null;

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
  title.innerHTML = `
    <div class="live-dot"></div>
    <span>${label}</span>
  `;

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
      video.requestFullscreen();
    }
  };
  controls.appendChild(fsBtn);

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

  // HUD de Estatísticas em Tempo Real
  const statsHud = document.createElement('div');
  statsHud.className = 'stats-hud';
  statsHud.innerHTML = `
    <div class="stats-row"><span class="stats-label">Taxa de Quadros:</span> <span class="stats-val stats-val-green" id="stat-fps-${peerId}">60 FPS</span></div>
    <div class="stats-row"><span class="stats-label">Latência (RTT):</span> <span class="stats-val stats-val-green" id="stat-rtt-${peerId}">-- ms</span></div>
    <div class="stats-row"><span class="stats-label">Bitrate:</span> <span class="stats-val" id="stat-bitrate-${peerId}">-- Mbps</span></div>
    <div class="stats-row"><span class="stats-label">Resolução:</span> <span class="stats-val" id="stat-res-${peerId}">--</span></div>
    <div class="stats-row"><span class="stats-label">Prioridade:</span> <span class="stats-val stats-val-purple">Maintain-Framerate</span></div>
  `;

  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.controls = false;
  video.muted = isLocal;

  // Overlay de Unmute caso autoplay seja barrado
  const unmuteOverlay = document.createElement('div');
  unmuteOverlay.className = 'audio-unmute-overlay';
  unmuteOverlay.innerHTML = `
    <p style="font-size: 13px; color: #fff;">O navegador pausou o áudio automático do jogo.</p>
    <button>🔊 Clique para Ativar Áudio Estéreo</button>
  `;

  unmuteOverlay.onclick = () => {
    video.muted = false;
    video.play();
    unmuteOverlay.style.display = 'none';
    initAudioAnalyser(stream, peerId);
  };

  videoWrapper.appendChild(statsHud);
  videoWrapper.appendChild(video);
  videoWrapper.appendChild(unmuteOverlay);
  card.appendChild(videoWrapper);

  // Inicia o analisador de VU Meter estéreo
  initAudioAnalyser(stream, peerId);

  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch((err) => {
      console.warn("Autoplay bloqueado:", err);
      video.muted = true;
      video.play();
      if (!isLocal) {
        unmuteOverlay.style.display = 'flex';
      }
    });
  }

  updateGridEmptyState();
  return { card, video };
}
