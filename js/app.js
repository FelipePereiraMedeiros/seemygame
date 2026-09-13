import { PEER_CONFIG, QUALITY_PROFILES, DEFAULT_PROFILE, DEFAULT_BITRATE_BPS } from './config.js';
import { 
  hookPeerConnectionSdp, 
  applyTransceiverOptimizations, 
  applySenderOptimizations 
} from './webrtc.js';
import { startStatsMonitor, stopStatsMonitor } from './stats.js';
import { 
  showToast, 
  initTermsModal, 
  createPlaceholderCard, 
  updateCardStatus, 
  hideCardLoading, 
  removeVideoCard, 
  addOrUpdateVideoCard 
} from './ui.js';

// Estado da Aplicação
let selectedProfile = DEFAULT_PROFILE;
let customBitrateBps = DEFAULT_BITRATE_BPS;

let peer = null;
let myId = null;
let localStream = null;

// Conexões ativas
const connectedViewers = new Map(); // PeerId -> DataConnection
const activeMediaCalls = new Map(); // PeerId -> MediaConnection
const watchingHosts = new Map();    // HostId -> { conn, call, stream }

// Elementos DOM
const copyBadge = document.getElementById('copy-badge');
const shareLinkBtn = document.getElementById('share-link-btn');
const streamBtn = document.getElementById('stream-btn');
const connectBtn = document.getElementById('connect-btn');
const targetInput = document.getElementById('target-id');
const qualityPresetSelect = document.getElementById('quality-preset');
const bitrateSlider = document.getElementById('bitrate-slider');
const bitrateDisplay = document.getElementById('bitrate-display');
const audioModeSelect = document.getElementById('audio-mode-select');
const audioTipBanner = document.getElementById('audio-tip-banner');
const closeBannerBtn = document.getElementById('close-banner-btn');

// ==========================================
// CONTROLES DE TUNING & PRESETS
// ==========================================

function applyLiveBitrateChange() {
  if (localStream) {
    activeMediaCalls.forEach((call) => {
      if (call && call.peerConnection) {
        applySenderOptimizations(call.peerConnection, customBitrateBps, selectedProfile.fps);
      }
    });
  }
}

if (qualityPresetSelect) {
  qualityPresetSelect.addEventListener('change', (e) => {
    selectedProfile = QUALITY_PROFILES[e.target.value] || QUALITY_PROFILES.balanced;
    customBitrateBps = selectedProfile.bitrate;
    if (bitrateSlider) bitrateSlider.value = Math.round(customBitrateBps / 1000);
    if (bitrateDisplay) bitrateDisplay.innerText = `${(customBitrateBps / 1000000).toFixed(1)} Mbps`;
    
    showToast(`Perfil selecionado: ${selectedProfile.label}`, 'info');
    applyLiveBitrateChange();
  });
}

if (bitrateSlider) {
  bitrateSlider.addEventListener('input', (e) => {
    const kbps = parseInt(e.target.value, 10);
    customBitrateBps = kbps * 1000;
    if (bitrateDisplay) bitrateDisplay.innerText = `${(kbps / 1000).toFixed(1)} Mbps`;
    applyLiveBitrateChange();
  });
}

if (closeBannerBtn && audioTipBanner) {
  closeBannerBtn.addEventListener('click', () => {
    audioTipBanner.style.display = 'none';
  });
}

// ==========================================
// INICIALIZAÇÃO DO PEERJS & SINALIZAÇÃO
// ==========================================

export function initPeer() {
  if (typeof Peer === 'undefined') {
    showToast('Erro: Biblioteca PeerJS não carregada.', 'error');
    return;
  }

  peer = new Peer(PEER_CONFIG);

  peer.on('open', (id) => {
    myId = id;
    if (copyBadge) copyBadge.innerHTML = `<span>📋</span> Seu ID: <strong>${id}</strong>`;
    if (shareLinkBtn) shareLinkBtn.style.display = 'inline-flex';
    if (streamBtn) streamBtn.disabled = false;
    showToast('Engine P2P conectada com Trava de 60 FPS!', 'success');

    // Copiar ID
    if (copyBadge) {
      copyBadge.onclick = () => {
        navigator.clipboard.writeText(id);
        const prev = copyBadge.innerHTML;
        copyBadge.innerHTML = `<span>✓</span> <strong>ID Copiado!</strong>`;
        showToast('Seu ID foi copiado!', 'success');
        setTimeout(() => { copyBadge.innerHTML = prev; }, 2500);
      };
    }

    // Copiar Link direto
    if (shareLinkBtn) {
      shareLinkBtn.onclick = () => {
        const shareUrl = `${window.location.origin}${window.location.pathname}#watch=${id}`;
        navigator.clipboard.writeText(shareUrl);
        showToast('Link de convite direto copiado! Envie para seus amigos.', 'success');
      };
    }

    checkAutoWatchUrl();
  });

  // 1. Recebe conexões de controle (DataConnection)
  peer.on('connection', (conn) => {
    setupIncomingDataConnection(conn);
  });

  // 2. Recebe chamadas de mídia (MediaConnection)
  peer.on('call', (call) => {
    handleIncomingMediaCall(call);
  });

  peer.on('error', (err) => {
    console.error('PeerJS Error:', err);
    if (err.type === 'peer-unavailable') {
      showToast('ID do amigo não encontrado ou offline.', 'error');
      if (targetInput) removeVideoCard(targetInput.value.trim());
    } else {
      showToast(`Erro P2P: ${err.type || err.message}`, 'error');
    }
  });
}

// Controle: Transmissor recebe pedido de espectador
function setupIncomingDataConnection(conn) {
  conn.on('open', () => {
    console.log(`Espectador conectado: ${conn.peer}`);
    connectedViewers.set(conn.peer, conn);

    if (localStream) {
      initiateMediaCallToViewer(conn.peer);
      conn.send({ type: 'STREAM_STATUS', isStreaming: true });
    } else {
      conn.send({ type: 'STREAM_STATUS', isStreaming: false });
    }
  });

  conn.on('data', (data) => {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'REQUEST_STREAM') {
      showToast(`Amigo (${conn.peer.slice(0, 6)}) conectou para assistir.`, 'info');
      if (localStream) {
        initiateMediaCallToViewer(conn.peer);
      }
    }
  });

  conn.on('close', () => {
    connectedViewers.delete(conn.peer);
    stopStatsMonitor(conn.peer);
  });

  conn.on('error', (err) => {
    console.error('Erro na DataConnection:', err);
    connectedViewers.delete(conn.peer);
    stopStatsMonitor(conn.peer);
  });
}

// Transmissor envia o vídeo com Trava de 60 FPS e GPU H.264
function initiateMediaCallToViewer(viewerPeerId) {
  if (!localStream) return;

  console.log(`Iniciando chamada com 60 FPS travado para: ${viewerPeerId}`);
  const call = peer.call(viewerPeerId, localStream);
  
  if (call) {
    activeMediaCalls.set(viewerPeerId, call);

    if (call.peerConnection) {
      hookPeerConnectionSdp(call.peerConnection, () => customBitrateBps);
      applyTransceiverOptimizations(call.peerConnection);

      setTimeout(() => {
        applySenderOptimizations(call.peerConnection, customBitrateBps, selectedProfile.fps);
      }, 300);
    }

    call.on('close', () => {
      activeMediaCalls.delete(viewerPeerId);
      stopStatsMonitor(viewerPeerId);
    });

    call.on('error', (err) => {
      console.error(`Erro na chamada com ${viewerPeerId}:`, err);
      activeMediaCalls.delete(viewerPeerId);
      stopStatsMonitor(viewerPeerId);
    });
  }
}

// Espectador recebe o stream do amigo
function handleIncomingMediaCall(call) {
  console.log(`Recebendo chamada de mídia de: ${call.peer}`);

  call.answer();

  if (call.peerConnection) {
    hookPeerConnectionSdp(call.peerConnection, () => customBitrateBps);
    applyTransceiverOptimizations(call.peerConnection);
  }

  call.on('stream', (remoteStream) => {
    console.log(`Stream remoto recebido de ${call.peer}`);
    
    hideCardLoading(call.peer);
    addOrUpdateVideoCard({
      stream: remoteStream,
      peerId: call.peer,
      label: `🎮 Tela de ${call.peer.slice(0, 6)}`,
      isLocal: false,
      onDisconnect: () => disconnectHost(call.peer)
    });
    
    if (call.peerConnection) {
      applyTransceiverOptimizations(call.peerConnection);
      startStatsMonitor(call.peer, call.peerConnection, false);
    }

    showToast(`Transmissão de ${call.peer.slice(0, 6)} a 60 FPS!`, 'success');
  });

  call.on('close', () => {
    showToast(`Transmissão de ${call.peer.slice(0, 6)} encerrada.`, 'info');
    removeVideoCard(call.peer);
    stopStatsMonitor(call.peer);
  });

  call.on('error', (err) => {
    console.error('Erro no stream recebido:', err);
    showToast(`Erro no stream: ${err.message}`, 'error');
    removeVideoCard(call.peer);
    stopStatsMonitor(call.peer);
  });

  activeMediaCalls.set(call.peer, call);
}

// ==========================================
// CONECTAR COMO ESPECTADOR
// ==========================================

export function watchFriend(rawTargetId) {
  let targetId = rawTargetId.trim();
  
  if (targetId.includes('#watch=')) {
    targetId = targetId.split('#watch=')[1].split('&')[0];
  } else if (targetId.includes('watch=')) {
    const urlParams = new URLSearchParams(targetId.split('?')[1] || targetId);
    targetId = urlParams.get('watch') || targetId;
  }

  if (!targetId) {
    return showToast('Por favor, insira um ID válido.', 'error');
  }

  if (targetId === myId) {
    return showToast('Você não pode assistir ao seu próprio ID.', 'error');
  }

  showToast(`Conectando a ${targetId.slice(0, 6)}...`, 'info');
  createPlaceholderCard(targetId, `Conectando a ${targetId.slice(0, 6)}...`, () => disconnectHost(targetId));

  const conn = peer.connect(targetId, { reliable: true });
  
  conn.on('open', () => {
    watchingHosts.set(targetId, { conn });
    conn.send({ type: 'REQUEST_STREAM' });
    showToast(`Conectado a ${targetId.slice(0, 6)}! Aguardando stream...`, 'info');
  });

  conn.on('data', (data) => {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'STREAM_STATUS') {
      if (!data.isStreaming) {
        updateCardStatus(targetId, 'Amigo conectado! Aguardando ele iniciar o jogo...');
        showToast('Amigo está online, aguardando início da transmissão.', 'info');
      } else {
        updateCardStatus(targetId, 'Sincronizando 60 FPS em tempo real...');
      }
    } else if (data.type === 'STREAM_STOPPED') {
      showToast('O amigo pausou a transmissão.', 'info');
      updateCardStatus(targetId, 'Transmissão pausada pelo streamer.');
    }
  });

  conn.on('close', () => {
    showToast(`Conexão com ${targetId.slice(0, 6)} encerrada.`, 'info');
    removeVideoCard(targetId);
    watchingHosts.delete(targetId);
    stopStatsMonitor(targetId);
  });

  conn.on('error', (err) => {
    console.error('Erro de conexão:', err);
    showToast(`Falha ao conectar: ${err.message || 'Amigo indisponível'}`, 'error');
    removeVideoCard(targetId);
    watchingHosts.delete(targetId);
    stopStatsMonitor(targetId);
  });
}

export function disconnectHost(peerId) {
  const hostData = watchingHosts.get(peerId);
  if (hostData && hostData.conn) {
    hostData.conn.close();
  }
  const mediaCall = activeMediaCalls.get(peerId);
  if (mediaCall) {
    mediaCall.close();
  }
  watchingHosts.delete(peerId);
  activeMediaCalls.delete(peerId);
  removeVideoCard(peerId);
  showToast(`Desconectado de ${peerId.slice(0, 6)}.`, 'info');
}

// Expõe globalmente para compatibilidade
window.disconnectHost = disconnectHost;

if (connectBtn && targetInput) {
  connectBtn.addEventListener('click', () => {
    const val = targetInput.value;
    if (val) {
      watchFriend(val);
      targetInput.value = '';
    } else {
      showToast('Insira o ID ou link de um amigo.', 'error');
    }
  });

  targetInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      connectBtn.click();
    }
  });
}

// ==========================================
// INICIAR E ENCERRAR TRANSMISSÃO LOCAL
// ==========================================

export async function startLocalStream() {
  if (localStream) {
    stopLocalStream();
    return;
  }

  const audioMode = audioModeSelect ? audioModeSelect.value : 'system';

  // Restrições de vídeo com foco absoluto em 60 FPS
  const videoConstraints = {
    width: { ideal: selectedProfile.width, max: 1920 },
    height: { ideal: selectedProfile.height, max: 1080 },
    frameRate: { ideal: 60, max: 60 },
    cursor: 'always'
  };

  try {
    let displayAudio = false;
    if (audioMode === 'system') {
      displayAudio = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      };
    }

    // Captura da tela (sem systemAudio: 'include' que forçava rejeição W3C com NotReadableError)
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints,
      audio: displayAudio
    });

    // Se selecionou Microfone, captura e anexa a trilha de voz
    if (audioMode === 'mic') {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        const micTrack = micStream.getAudioTracks()[0];
        if (micTrack) {
          localStream.addTrack(micTrack);
        }
      } catch (micErr) {
        console.warn('Microfone não concedido:', micErr);
        showToast('Aviso: Permissão do microfone não concedida.', 'info');
      }
    }

    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.contentHint = 'motion';
    }

    const hasAudio = localStream.getAudioTracks().length > 0;
    if (hasAudio) {
      const label = audioMode === 'mic' ? 'Microfone' : 'Áudio do jogo (sistema)';
      showToast(`${label} capturado com sucesso!`, 'success');
    } else if (audioMode === 'system') {
      showToast('Transmissão iniciada (apenas vídeo). Dica: no Windows, selecione "Tela inteira" e marque a caixinha de áudio.', 'info');
    } else {
      showToast('Transmissão iniciada (modo sem áudio).', 'info');
    }

    addOrUpdateVideoCard({
      stream: localStream,
      peerId: 'local-me',
      label: 'Minha Transmissão (Você)',
      isLocal: true,
      onDisconnect: () => stopLocalStream()
    });
    
    if (streamBtn) {
      streamBtn.innerHTML = '<span>🛑</span> Parar Transmissão';
      streamBtn.classList.add('btn-stop');
    }

    // Notifica e chama todos os espectadores conectados
    connectedViewers.forEach((conn, viewerId) => {
      conn.send({ type: 'STREAM_STATUS', isStreaming: true });
      initiateMediaCallToViewer(viewerId);
    });

    showToast(`Transmissão ativa com Trava de 60 FPS (${(customBitrateBps / 1000000).toFixed(1)} Mbps)!`, 'success');

    videoTrack.onended = () => {
      stopLocalStream();
    };

  } catch (err) {
    console.error('Erro ao capturar tela:', err);
    if (err.name === 'NotReadableError') {
      showToast('O Windows não permitiu capturar o som dessa janela. Selecione a aba "Tela inteira" e marque "Compartilhar áudio", ou selecione "Apenas Vídeo" no menu superior.', 'error');
    } else if (err.name !== 'NotAllowedError') {
      showToast(`Erro ao iniciar stream: ${err.message}`, 'error');
    }
  }
}

export function stopLocalStream() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  removeVideoCard('local-me');
  stopStatsMonitor('local-me');

  if (streamBtn) {
    streamBtn.innerHTML = '<span>🚀</span> Transmitir Jogo (60 FPS)';
    streamBtn.classList.remove('btn-stop');
  }

  connectedViewers.forEach((conn) => {
    conn.send({ type: 'STREAM_STOPPED' });
  });

  showToast('Transmissão encerrada.', 'info');
}

if (streamBtn) {
  streamBtn.addEventListener('click', startLocalStream);
}

// Auto-conexão por URL
function checkAutoWatchUrl() {
  const hash = window.location.hash;
  let targetId = null;

  if (hash.includes('watch=')) {
    targetId = hash.split('watch=')[1].split('&')[0];
  } else {
    const params = new URLSearchParams(window.location.search);
    targetId = params.get('watch');
  }

  if (targetId && targetId !== myId) {
    if (targetInput) targetInput.value = targetId;
    showToast(`ID detectado: ${targetId.slice(0, 6)}. Conectando com Trava de 60 FPS...`, 'info');
    watchFriend(targetId);
  }
}

// ==========================================
// INICIALIZAÇÃO GERAL
// ==========================================

window.addEventListener('DOMContentLoaded', () => {
  initTermsModal();
  initPeer();
});
