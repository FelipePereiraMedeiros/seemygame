import { 
  PEER_CONFIG, 
  getPeerConfig,
  fetchIceServersFromApi,
  QUALITY_PROFILES, 
  DEFAULT_PROFILE, 
  DEFAULT_BITRATE_BPS,
  MAX_VIEWERS_DEFAULT,
  ROOM_MODES,
  TERMS_VERSION
} from './config.js';
import { 
  hookPeerConnectionSdp, 
  applyTransceiverOptimizations, 
  applySenderOptimizations,
  swapStreamAudioTrack
} from './webrtc.js';
import { initAudioAnalyser, stopAudioAnalyser } from './audio.js';
import { startStatsMonitor, stopStatsMonitor } from './stats.js';
import { 
  showToast, 
  initTermsModal, 
  createPlaceholderCard, 
  updateCardStatus, 
  hideCardLoading, 
  setCardStreamPaused,
  removeVideoCard, 
  addOrUpdateVideoCard,
  showCoopPromptModal,
  updateCoopUI,
  isValidPeerId
} from './ui.js';
import {
  handleHostCoopMessage,
  handleViewerCoopMessage,
  requestCoopControl,
  releaseCoopControl,
  revokePlayer2,
  setCoopEnabled,
  getCoopState,
  registerCoopPromptHandler,
  registerCoopStateChangeHandler,
  initCompanionAgentConnection
} from './coop.js';
import {
  isDesktopApp,
  getCapturableWindows,
  setHighPriority
} from './desktop.js';
import { chatManager } from './chat.js';
import { voiceManager } from './voice.js';
import { DiscordUIController } from './discord-ui.js';

// Estado da Aplicação
let selectedProfile = DEFAULT_PROFILE;
let customBitrateBps = DEFAULT_BITRATE_BPS;
let maxViewers = MAX_VIEWERS_DEFAULT;
let currentRoomMode = ROOM_MODES.PUBLIC;

let peer = null;
let myId = null;
let localStream = null;
let isStartingStream = false;
let capturedSystemAudioTrack = null;
let capturedMicStream = null;

// Conexões ativas
const connectedViewers = new Map(); // PeerId -> DataConnection
const activeMediaCalls = new Map(); // PeerId -> MediaConnection
const activeVoiceCalls = new Map(); // PeerId -> MediaConnection (Voz)
const watchingHosts = new Map();    // HostId -> { state: 'CONNECTING'|'CONNECTED'|'CANCELLED'|'CLOSED', conn, call, timeoutTimer }
export let discordUI = null;

// Reconexão exponencial
let reconnectAttempts = 0;
let reconnectTimer = null;

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
const viewerCountBadge = document.getElementById('viewer-count');
const coopModeSelect = document.getElementById('coop-mode-select');

function updateViewerCountUI() {
  if (viewerCountBadge) {
    const count = connectedViewers.size;
    viewerCountBadge.innerHTML = `<span>👥</span> <strong>${count}</strong> ${count === 1 ? 'espectador' : 'espectadores'}`;
  }
}

// ==========================================
// CONFIGURAÇÕES E LISTENERS CO-OP (PLAYER 2)
// ==========================================

if (coopModeSelect) {
  coopModeSelect.addEventListener('change', (e) => {
    const isEnabled = e.target.value === 'enabled';
    setCoopEnabled(isEnabled);
    showToast(isEnabled ? '🎮 Modo Co-op ativado (espectadores podem solicitar Player 2).' : '🔒 Co-op desativado.', 'info');

    // Notifica todos os espectadores conectados imediatamente
    connectedViewers.forEach((conn) => {
      conn.send({ type: 'COOP_CONFIG', enabled: isEnabled });
    });
  });
}

// Configura callbacks de autorização e de atualização de interface do Co-op
registerCoopPromptHandler(({ peerId, approve, deny }) => {
  showCoopPromptModal(peerId, approve, deny);
});

registerCoopStateChangeHandler((state) => {
  updateCoopUI(state);
});

// Tecla Escape como killswitch / botão de pânico rápido no streamer para revogar Player 2
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const state = getCoopState();
    if (state.activePlayer2PeerId) {
      revokePlayer2();
      showToast('🛑 Controle do Player 2 revogado via tecla Escape!', 'info');
    }
  }
});

// ==========================================
// CONTROLES DE TUNING & PRESETS
// ==========================================

function applyLiveBitrateChange() {
  if (localStream) {
    let scaleFactor = 1;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack && typeof videoTrack.getSettings === 'function') {
      const settings = videoTrack.getSettings();
      const nativeHeight = settings.height || 1080;
      const targetHeight = selectedProfile.height || 1080;
      if (nativeHeight > targetHeight) {
        scaleFactor = Number((nativeHeight / targetHeight).toFixed(2));
      }
    } else if (selectedProfile.height && selectedProfile.height < 1080) {
      scaleFactor = Number((1080 / selectedProfile.height).toFixed(2));
    }

    activeMediaCalls.forEach((call) => {
      if (call && call.peerConnection) {
        applySenderOptimizations(call.peerConnection, customBitrateBps, selectedProfile.fps, scaleFactor);
      }
    });

    // Notifica espectadores sobre a nova taxa/perfil via DataConnection
    connectedViewers.forEach((conn) => {
      conn.send({
        type: 'STREAM_CONFIG_UPDATED',
        preset: qualityPresetSelect ? qualityPresetSelect.value : null,
        bitrate: customBitrateBps,
        fps: selectedProfile.fps,
        height: selectedProfile.height
      });
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

    // Aplica constraints dinamicamente na trilha de vídeo existente
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
        videoTrack.applyConstraints({
          width: { ideal: selectedProfile.width },
          height: { ideal: selectedProfile.height },
          frameRate: { ideal: selectedProfile.fps }
        }).catch((err) => {
          console.warn('Falha ao aplicar restrições dinâmicas na trilha de vídeo:', err);
        });
      }
    }

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

// Hot Swapping dinâmico de fonte de áudio ao vivo sem desconectar espectadores
if (audioModeSelect) {
  audioModeSelect.addEventListener('change', async (e) => {
    const newMode = e.target.value;

    if (localStream) {
      try {
        let newAudioTrack = null;

        if (newMode === 'mic') {
          if (!capturedMicStream || !capturedMicStream.getAudioTracks()[0] || capturedMicStream.getAudioTracks()[0].readyState !== 'live') {
            capturedMicStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              }
            });
          }
          newAudioTrack = capturedMicStream.getAudioTracks()[0] || null;

          // Remove faixas de áudio anteriores da stream local
          localStream.getAudioTracks().forEach(t => {
            if (t !== capturedSystemAudioTrack) {
              t.stop();
            }
            localStream.removeTrack(t);
          });

          if (newAudioTrack) {
            localStream.addTrack(newAudioTrack);
            showToast('🎙️ Microfone ativado na transmissão!', 'success');
          }
        } else if (newMode === 'none') {
          localStream.getAudioTracks().forEach(t => {
            if (t !== capturedSystemAudioTrack) {
              t.stop();
            }
            localStream.removeTrack(t);
          });
          newAudioTrack = null;
          showToast('🔇 Áudio desativado (apenas vídeo).', 'info');
        } else if (newMode === 'system') {
          if (capturedSystemAudioTrack && capturedSystemAudioTrack.readyState === 'live') {
            localStream.getAudioTracks().forEach(t => {
              if (t !== capturedSystemAudioTrack) {
                t.stop();
              }
              localStream.removeTrack(t);
            });
            localStream.addTrack(capturedSystemAudioTrack);
            newAudioTrack = capturedSystemAudioTrack;
            showToast('🔊 Áudio do jogo restaurado!', 'success');
          } else {
            showToast('ℹ️ O áudio do jogo precisa ser capturado via seletor do navegador ao iniciar a transmissão.', 'info', 6000);
          }
        }

        // Hot Swapping de áudio no WebRTC para cada chamada ativa
        activeMediaCalls.forEach((call) => {
          if (call && call.peerConnection) {
            swapStreamAudioTrack(call.peerConnection, newAudioTrack);
          }
        });

        // Atualiza VU Meter local
        if (newAudioTrack) {
          initAudioAnalyser(localStream, 'local-me');
        } else {
          stopAudioAnalyser('local-me');
        }

        // Notifica espectadores da nova fonte de áudio
        connectedViewers.forEach((conn) => {
          conn.send({
            type: 'STREAM_CONFIG_UPDATED',
            audioMode: newMode,
            hasAudio: !!newAudioTrack
          });
        });
      } catch (err) {
        console.error('Erro ao trocar modo de áudio:', err);
        showToast(`Erro ao mudar fonte de áudio: ${err.message}`, 'error');
      }
    } else {
      const label = e.target.options[e.target.selectedIndex] ? e.target.options[e.target.selectedIndex].text : newMode;
      showToast(`Fonte de áudio selecionada: ${label}`, 'info');
    }
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

  if (peer && !peer.destroyed && !peer.disconnected) {
    return;
  }

  const config = getPeerConfig();
  peer = new Peer(config);

  peer.on('open', (id) => {
    myId = id;
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (copyBadge) {
      copyBadge.innerHTML = `<span>📋</span> Seu ID: <strong>${id}</strong>`;
      copyBadge.setAttribute('role', 'button');
      copyBadge.setAttribute('tabindex', '0');
    }
    if (shareLinkBtn) shareLinkBtn.style.display = 'inline-flex';
    if (streamBtn) streamBtn.disabled = false;
    if (connectBtn) connectBtn.disabled = false;
    showToast('Engine P2P conectada em alta fluidez!', 'success');

    // Copiar ID com suporte a teclado e tratamento assíncrono
    const copyIdAction = async () => {
      try {
        await navigator.clipboard.writeText(id);
        const prev = copyBadge.innerHTML;
        copyBadge.innerHTML = `<span>✓</span> <strong>ID Copiado!</strong>`;
        showToast('Seu ID foi copiado!', 'success');
        setTimeout(() => { copyBadge.innerHTML = prev; }, 2500);
      } catch (err) {
        showToast(`ID: ${id}`, 'info');
      }
    };

    if (copyBadge) {
      copyBadge.onclick = copyIdAction;
      copyBadge.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          copyIdAction();
        }
      };
    }

    // Copiar Link direto para a página do espectador
    if (shareLinkBtn) {
      shareLinkBtn.onclick = async () => {
        let basePath = window.location.pathname;
        if (basePath.endsWith('.html')) {
          basePath = basePath.substring(0, basePath.lastIndexOf('/') + 1);
        } else if (!basePath.endsWith('/')) {
          basePath += '/';
        }
        const shareUrl = `${window.location.origin}${basePath}viewer.html#watch=${id}`;
        try {
          await navigator.clipboard.writeText(shareUrl);
          showToast('Link de convite copiado!', 'success');
        } catch (err) {
          showToast(`Link de convite: ${shareUrl}`, 'info');
        }
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

  // 3. Queda de sinalização e reconexão automática com backoff exponencial
  peer.on('disconnected', () => {
    console.warn('PeerJS desconectado do servidor de sinalização.');
    showToast('Conexão de sinalização perdida. Tentando reconectar...', 'info');

    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (reconnectAttempts < 5) {
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 16000);
      reconnectAttempts++;
      reconnectTimer = setTimeout(() => {
        if (peer && !peer.destroyed && peer.disconnected) {
          console.log(`Tentativa de reconexão PeerJS #${reconnectAttempts}...`);
          try {
            peer.reconnect();
          } catch (e) {
            console.warn('Erro ao chamar peer.reconnect():', e);
          }
        }
      }, delay);
    } else {
      showToast('Não foi possível reconectar à sinalização. Atualize a página.', 'error');
    }
  });

  peer.on('close', () => {
    console.warn('PeerJS destruído/encerrado.');
    showToast('Sessão P2P encerrada.', 'info');
    if (streamBtn) streamBtn.disabled = true;
    if (connectBtn) connectBtn.disabled = true;
  });

  peer.on('error', (err) => {
    console.error('PeerJS Error:', err);
    if (err.type === 'peer-unavailable') {
      showToast('ID do amigo não encontrado ou offline.', 'error');
      // Identifica o host pendente no Map sem depender do targetInput
      for (const [hostId, hostData] of watchingHosts.entries()) {
        if (hostData && hostData.state === 'CONNECTING') {
          disconnectHost(hostId);
          break;
        }
      }
    } else {
      showToast(`Erro P2P: ${err.type || err.message}`, 'error');
    }
  });
}

// ==========================================
// DISCORD VOICE & CHAT P2P INTEGRATION
// ==========================================

export function broadcastDataMessage(payload, excludePeerId = null) {
  // Transmissor envia para todos os espectadores conectados
  connectedViewers.forEach((conn, peerId) => {
    if (peerId !== excludePeerId && conn && conn.open) {
      try {
        conn.send(payload);
      } catch (e) {}
    }
  });

  // Espectador envia para o host
  watchingHosts.forEach((hostData) => {
    if (hostData.conn && hostData.conn.open) {
      try {
        hostData.conn.send(payload);
      } catch (e) {}
    }
  });
}

export function setupVoiceMediaCall(call, remotePeerId) {
  if (!call) return;
  activeVoiceCalls.set(remotePeerId, call);

  call.on('stream', (remoteVoiceStream) => {
    const isHost = !window.location.pathname.endsWith('viewer.html');
    const role = call.metadata?.role || (isHost ? 'viewer' : 'host');
    const name = call.metadata?.name || (isHost ? `Amigo ${remotePeerId.slice(0, 4)}` : 'Streamer');

    voiceManager.addRemoteParticipant(remotePeerId, {
      name,
      role,
      stream: remoteVoiceStream,
    });
  });

  call.on('close', () => {
    voiceManager.removeRemoteParticipant(remotePeerId);
    activeVoiceCalls.delete(remotePeerId);
  });

  call.on('error', (err) => {
    console.warn(`[Voice Call Error] com ${remotePeerId}:`, err);
    voiceManager.removeRemoteParticipant(remotePeerId);
    activeVoiceCalls.delete(remotePeerId);
  });
}

export function handleIncomingVoiceCall(call) {
  const remotePeerId = call.peer;
  const isAuthorized = connectedViewers.has(remotePeerId) || watchingHosts.has(remotePeerId);
  if (!isAuthorized) {
    console.warn(`Chamada de voz não autorizada rejeitada de: ${remotePeerId}`);
    try { call.close(); } catch (e) {}
    return;
  }

  const streamToAnswer = voiceManager.localStream || new MediaStream();
  call.answer(streamToAnswer);
  setupVoiceMediaCall(call, remotePeerId);
}

export function handleIncomingP2PMessage(data, sourceConn) {
  if (!data || typeof data !== 'object') return;

  if (data.type === 'CHAT_MESSAGE') {
    if (data.message) {
      chatManager.addMessage(data.message);
      if (connectedViewers.size > 0) {
        broadcastDataMessage(data, sourceConn?.peer);
      }
    }
    return;
  }

  if (data.type === 'VOICE_STATE_UPDATE') {
    voiceManager.updateParticipantState(data.peerId, {
      isSpeaking: data.isSpeaking,
      isMuted: data.isMuted,
      isDeafened: data.isDeafened,
    });
    if (connectedViewers.size > 0) {
      broadcastDataMessage(data, sourceConn?.peer);
    }
    return;
  }

  if (data.type === 'VOICE_SIGNAL') {
    if (data.action === 'LEAVE') {
      voiceManager.removeRemoteParticipant(data.peerId);
      const call = activeVoiceCalls.get(data.peerId);
      if (call) {
        try { call.close(); } catch (e) {}
        activeVoiceCalls.delete(data.peerId);
      }
    } else if (data.action === 'HOST_VOICE_ACTIVE') {
      showToast('O Streamer está na sala de voz!', 'info');
      if (voiceManager.isInVoice && peer) {
        const call = peer.call(data.peerId, voiceManager.localStream, {
          metadata: { type: 'VOICE_CHAT', name: voiceManager.myName, role: voiceManager.myRole },
        });
        setupVoiceMediaCall(call, data.peerId);
      }
    }
    if (connectedViewers.size > 0) {
      broadcastDataMessage(data, sourceConn?.peer);
    }
    return;
  }
}

export function initDiscordFeatures() {
  if (typeof document === 'undefined') return;

  discordUI = new DiscordUIController({
    onSendMessage: (text) => {
      const isHost = !window.location.pathname.endsWith('viewer.html');
      const coopState = getCoopState();
      const role = isHost ? 'host' : (coopState.isPlayer2 ? 'player2' : 'viewer');
      const senderName = isHost ? 'Streamer' : (coopState.isPlayer2 ? 'Player 2' : `Amigo ${myId ? myId.slice(0, 4) : ''}`);

      const msg = chatManager.createMessage({
        senderId: myId,
        senderName,
        role,
        text,
        channel: chatManager.getActiveChannel(),
      });

      if (!msg) return;
      chatManager.addMessage(msg);
      broadcastDataMessage({ type: 'CHAT_MESSAGE', message: msg });
    },
    onJoinVoice: async () => {
      try {
        const isHost = !window.location.pathname.endsWith('viewer.html');
        const coopState = getCoopState();
        const role = isHost ? 'host' : (coopState.isPlayer2 ? 'player2' : 'viewer');
        const name = isHost ? 'Streamer' : (coopState.isPlayer2 ? 'Player 2' : `Amigo ${myId ? myId.slice(0, 4) : ''}`);

        const stream = await voiceManager.joinVoice({
          peerId: myId,
          name,
          role,
        });

        showToast('Conectado à sala de voz!', 'info');

        if (!isHost) {
          watchingHosts.forEach((hostData, hostId) => {
            if (hostData.state === 'CONNECTED' && peer) {
              const call = peer.call(hostId, stream, {
                metadata: { type: 'VOICE_CHAT', name, role },
              });
              setupVoiceMediaCall(call, hostId);
            }
          });
        } else {
          broadcastDataMessage({ type: 'VOICE_SIGNAL', action: 'HOST_VOICE_ACTIVE', peerId: myId, name, role });
        }
      } catch (err) {
        showToast('Não foi possível acessar o microfone.', 'error');
      }
    },
    onLeaveVoice: () => {
      activeVoiceCalls.forEach((call) => {
        try { call.close(); } catch (e) {}
      });
      activeVoiceCalls.clear();

      voiceManager.leaveVoice();
      broadcastDataMessage({ type: 'VOICE_SIGNAL', action: 'LEAVE', peerId: myId });
      showToast('Você saiu da sala de voz.', 'info');
    },
  });

  discordUI.init();

  voiceManager.on('speakingChange', ({ peerId, isSpeaking }) => {
    if (peerId === myId) {
      broadcastDataMessage({ type: 'VOICE_STATE_UPDATE', peerId: myId, isSpeaking });
    }
  });

  voiceManager.on('voiceStateChange', (state) => {
    broadcastDataMessage({
      type: 'VOICE_STATE_UPDATE',
      peerId: myId,
      isMuted: state.isMuted,
      isDeafened: state.isDeafened,
    });
  });
}

// Controle: Transmissor recebe pedido de espectador
function setupIncomingDataConnection(conn) {
  // Limite de espectadores simultâneos
  if (connectedViewers.size >= maxViewers && !connectedViewers.has(conn.peer)) {
    console.warn(`Rejeitando conexão de ${conn.peer}: limite de ${maxViewers} espectadores atingido.`);
    conn.on('open', () => {
      conn.send({ type: 'STREAM_REJECTED', reason: `Limite de ${maxViewers} espectadores atingido.` });
      setTimeout(() => conn.close(), 500);
    });
    showToast(`Conexão de ${conn.peer.slice(0, 6)} recusada: sala cheia.`, 'info');
    return;
  }

  conn.on('open', () => {
    console.log(`Espectador conectado: ${conn.peer}`);
    connectedViewers.set(conn.peer, conn);
    updateViewerCountUI();

    if (localStream) {
      initiateMediaCallToViewer(conn.peer);
      conn.send({ type: 'STREAM_STATUS', isStreaming: true });
    } else {
      conn.send({ type: 'STREAM_STATUS', isStreaming: false });
    }

    // Sincroniza configurações atuais com o novo espectador conectado
    conn.send({
      type: 'STREAM_CONFIG_UPDATED',
      preset: qualityPresetSelect ? qualityPresetSelect.value : null,
      bitrate: customBitrateBps,
      fps: selectedProfile.fps,
      height: selectedProfile.height,
      audioMode: audioModeSelect ? audioModeSelect.value : 'system'
    });
    conn.send({
      type: 'COOP_CONFIG',
      enabled: getCoopState().isCoopEnabled
    });
  });

  conn.on('data', (data) => {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'CHAT_MESSAGE' || data.type === 'VOICE_STATE_UPDATE' || data.type === 'VOICE_SIGNAL') {
      handleIncomingP2PMessage(data, conn);
      return;
    }

    if (data.type === 'REQUEST_STREAM') {
      showToast(`Amigo (${conn.peer.slice(0, 6)}) solicitou o stream.`, 'info');
      if (localStream) {
        initiateMediaCallToViewer(conn.peer);
      }
    } else if (data.type && (data.type.startsWith('COOP_') || data.type.startsWith('INPUT_'))) {
      handleHostCoopMessage(conn.peer, data, conn);
    }
  });

  conn.on('close', () => {
    // Notifica módulo Co-op caso este espectador fosse o Player 2
    handleHostCoopMessage(conn.peer, { type: 'COOP_RELEASE' }, conn);
    connectedViewers.delete(conn.peer);
    stopStatsMonitor(conn.peer);
    updateViewerCountUI();
  });

  conn.on('error', (err) => {
    console.error(`Erro na DataConnection com ${conn.peer}:`, err);
    handleHostCoopMessage(conn.peer, { type: 'COOP_RELEASE' }, conn);
    connectedViewers.delete(conn.peer);
    stopStatsMonitor(conn.peer);
    updateViewerCountUI();
  });
}

// Transmissor envia o vídeo com foco em alta fluidez (Idempotente)
function initiateMediaCallToViewer(viewerPeerId) {
  if (!localStream || !peer) return;

  // Garante que não criamos chamadas duplicadas para o mesmo espectador
  const existingCall = activeMediaCalls.get(viewerPeerId);
  if (existingCall && existingCall.open !== false && !existingCall._closed) {
    console.log(`Chamada de mídia já ativa ou em andamento para: ${viewerPeerId}`);
    return;
  }

  console.log(`Iniciando chamada com foco em alta fluidez para: ${viewerPeerId}`);
  const call = peer.call(viewerPeerId, localStream);
  
  if (call) {
    activeMediaCalls.set(viewerPeerId, call);

    if (call.peerConnection) {
      hookPeerConnectionSdp(call.peerConnection, () => customBitrateBps);
      applyTransceiverOptimizations(call.peerConnection);

      setTimeout(() => {
        let scaleFactor = 1;
        const videoTrack = localStream?.getVideoTracks()[0];
        if (videoTrack && typeof videoTrack.getSettings === 'function') {
          const settings = videoTrack.getSettings();
          const nativeHeight = settings.height || 1080;
          const targetHeight = selectedProfile.height || 1080;
          if (nativeHeight > targetHeight) {
            scaleFactor = Number((nativeHeight / targetHeight).toFixed(2));
          }
        } else if (selectedProfile.height && selectedProfile.height < 1080) {
          scaleFactor = Number((1080 / selectedProfile.height).toFixed(2));
        }
        applySenderOptimizations(call.peerConnection, customBitrateBps, selectedProfile.fps, scaleFactor);
      }, 300);
    }

    call.on('close', () => {
      call._closed = true;
      if (activeMediaCalls.get(viewerPeerId) === call) {
        activeMediaCalls.delete(viewerPeerId);
        stopStatsMonitor(viewerPeerId);
      }
    });

    call.on('error', (err) => {
      console.error(`Erro na chamada com ${viewerPeerId}:`, err);
      call._closed = true;
      if (activeMediaCalls.get(viewerPeerId) === call) {
        activeMediaCalls.delete(viewerPeerId);
        stopStatsMonitor(viewerPeerId);
      }
    });
  }
}

// Espectador recebe o stream do amigo (Rejeita chamadas não solicitadas)
function handleIncomingMediaCall(call) {
  console.log(`Recebendo chamada de mídia de: ${call.peer}`);

  // Se for chamada de áudio da Sala de Voz
  if (call.metadata?.type === 'VOICE_CHAT') {
    handleIncomingVoiceCall(call);
    return;
  }

  // Rejeição de chamadas não solicitadas: só aceita se o host estiver cadastrado em watchingHosts
  if (!watchingHosts.has(call.peer)) {
    console.warn(`Chamada de mídia não solicitada rejeitada de: ${call.peer}`);
    try {
      call.close();
    } catch (e) {}
    return;
  }

  // Se já existe uma chamada antiga desse host, fecha a anterior antes de aceitar a nova
  const existingCall = activeMediaCalls.get(call.peer);
  if (existingCall && existingCall !== call) {
    try { existingCall.close(); } catch (e) {}
  }

  call.answer();

  if (call.peerConnection) {
    hookPeerConnectionSdp(call.peerConnection, () => customBitrateBps);
    applyTransceiverOptimizations(call.peerConnection);
  }

  call.on('stream', (remoteStream) => {
    console.log(`Stream remoto recebido de ${call.peer}`);
    
    hideCardLoading(call.peer);
    setCardStreamPaused(call.peer, false);

    const hostConn = watchingHosts.get(call.peer)?.conn;

    addOrUpdateVideoCard({
      stream: remoteStream,
      peerId: call.peer,
      label: `🎮 Tela de ${call.peer.slice(0, 6)}`,
      isLocal: false,
      onDisconnect: () => disconnectHost(call.peer),
      onCoopClick: (hostId) => {
        const state = getCoopState();
        if (state.isPlayer2) {
          releaseCoopControl();
        } else {
          requestCoopControl(hostId, hostConn || watchingHosts.get(hostId)?.conn);
        }
      }
    });
    
    if (call.peerConnection) {
      applyTransceiverOptimizations(call.peerConnection);
      startStatsMonitor(call.peer, call.peerConnection, false);
    }

    showToast(`Transmissão de ${call.peer.slice(0, 6)} conectada em alta fluidez!`, 'success');
  });

  call.on('close', () => {
    const hostData = watchingHosts.get(call.peer);
    if (hostData && hostData.conn && hostData.conn.open === true) {
      // Streamer apenas pausou a transmissão ou alternou fonte; mantém o card pausado sem desmontar
      setCardStreamPaused(call.peer, true, 'Transmissão pausada pelo streamer.');
      stopStatsMonitor(call.peer);
    } else {
      showToast(`Transmissão de ${call.peer.slice(0, 6)} encerrada.`, 'info');
      removeVideoCard(call.peer);
      stopStatsMonitor(call.peer);
    }
    if (activeMediaCalls.get(call.peer) === call) {
      activeMediaCalls.delete(call.peer);
    }
  });

  call.on('error', (err) => {
    console.error('Erro no stream recebido:', err);
    showToast(`Erro no stream: ${err.message}`, 'error');
    removeVideoCard(call.peer);
    stopStatsMonitor(call.peer);
    if (activeMediaCalls.get(call.peer) === call) {
      activeMediaCalls.delete(call.peer);
    }
  });

  activeMediaCalls.set(call.peer, call);
}

// ==========================================
// CONECTAR COMO ESPECTADOR
// ==========================================

export function watchFriend(rawTargetId) {
  let targetId = rawTargetId ? String(rawTargetId).trim() : '';
  
  if (targetId.includes('#watch=')) {
    targetId = targetId.split('#watch=')[1].split('&')[0];
  } else if (targetId.includes('watch=')) {
    const urlParams = new URLSearchParams(targetId.split('?')[1] || targetId);
    targetId = urlParams.get('watch') || targetId;
  }

  // Validação estrita de formato e tamanho
  if (!isValidPeerId(targetId)) {
    return showToast('Por favor, insira um ID válido.', 'error');
  }

  if (targetId === myId) {
    return showToast('Você não pode assistir ao seu próprio ID.', 'error');
  }

  // Bloqueio contra conexão repetida
  const existingHost = watchingHosts.get(targetId);
  if (existingHost && (existingHost.state === 'CONNECTING' || existingHost.state === 'CONNECTED')) {
    return showToast(`Você já está conectado ou conectando a ${targetId.slice(0, 6)}.`, 'info');
  }

  showToast(`Conectando a ${targetId.slice(0, 6)}...`, 'info');
  createPlaceholderCard(targetId, `Conectando a ${targetId.slice(0, 6)}...`, () => disconnectHost(targetId));

  const hostEntry = {
    state: 'CONNECTING',
    conn: null,
    call: null,
    timeoutTimer: null
  };
  watchingHosts.set(targetId, hostEntry);

  if (!peer) {
    initPeer();
  }

  const conn = peer.connect(targetId, { reliable: true });
  hostEntry.conn = conn;

  // Timeout de conexão pendente (15s)
  hostEntry.timeoutTimer = setTimeout(() => {
    if (hostEntry.state === 'CONNECTING') {
      showToast(`Tempo de conexão esgotado ao tentar conectar com ${targetId.slice(0, 6)}.`, 'error');
      disconnectHost(targetId);
    }
  }, 15000);

  conn.on('open', () => {
    // Se foi cancelado antes do open, aborta imediatamente
    if (hostEntry.state === 'CANCELLED') {
      conn.close();
      return;
    }

    hostEntry.state = 'CONNECTED';
    if (hostEntry.timeoutTimer) {
      clearTimeout(hostEntry.timeoutTimer);
      hostEntry.timeoutTimer = null;
    }

    conn.send({ type: 'REQUEST_STREAM' });
    showToast(`Conectado a ${targetId.slice(0, 6)}! Aguardando stream...`, 'info');
  });

  conn.on('data', (data) => {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'CHAT_MESSAGE' || data.type === 'VOICE_STATE_UPDATE' || data.type === 'VOICE_SIGNAL') {
      handleIncomingP2PMessage(data, conn);
      return;
    }

    if (data.type === 'STREAM_STATUS') {
      if (!data.isStreaming) {
        updateCardStatus(targetId, 'Amigo conectado! Aguardando ele iniciar o jogo...');
        showToast('Amigo está online, aguardando início da transmissão.', 'info');
      } else {
        updateCardStatus(targetId, 'Sincronizando stream em tempo real...');
      }
    } else if (data.type === 'STREAM_STOPPED') {
      showToast('O amigo pausou a transmissão.', 'info');
      setCardStreamPaused(targetId, true, 'Transmissão pausada pelo streamer.');
    } else if (data.type === 'STREAM_REJECTED') {
      showToast(`Conexão recusada: ${data.reason || 'Sala cheia'}`, 'error');
      disconnectHost(targetId);
    } else if (data.type && data.type.startsWith('COOP_')) {
      const card = document.getElementById(`card-${targetId}`);
      handleViewerCoopMessage(data, targetId, card);
    } else if (data.type === 'STREAM_CONFIG_UPDATED') {
      if (data.audioMode) {
        const audioLabels = {
          system: 'Áudio do Jogo',
          mic: 'Microfone do Transmissor',
          none: 'Apenas Vídeo (Mudo)'
        };
        const label = audioLabels[data.audioMode] || data.audioMode;
        showToast(`Fonte de áudio da transmissão: ${label}`, 'info');
      }
      if (data.preset || data.bitrate) {
        const mbps = data.bitrate ? `${(data.bitrate / 1000000).toFixed(1)} Mbps` : '';
        const res = data.height ? `${data.height}p` : '';
        const info = [res, mbps].filter(Boolean).join(' • ');
        if (info) {
          showToast(`Qualidade ajustada pelo streamer: ${info}`, 'info');
        }
      }
    }
  });

  conn.on('close', () => {
    const coopState = getCoopState();
    if (coopState.isPlayer2 && coopState.activeHostPeerId === targetId) {
      releaseCoopControl();
    }
    showToast(`Conexão com ${targetId.slice(0, 6)} encerrada.`, 'info');
    removeVideoCard(targetId);
    watchingHosts.delete(targetId);
    stopStatsMonitor(targetId);
  });

  conn.on('error', (err) => {
    console.error(`Erro de conexão com host ${targetId}:`, err);
    showToast(`Falha ao conectar: ${err.message || 'Amigo indisponível'}`, 'error');
    disconnectHost(targetId);
  });
}

export function disconnectHost(peerId) {
  // Se o espectador era Player 2 deste host, libera os controles
  const coopState = getCoopState();
  if (coopState.isPlayer2 && coopState.activeHostPeerId === peerId) {
    releaseCoopControl();
  }

  const hostData = watchingHosts.get(peerId);
  if (hostData) {
    hostData.state = 'CANCELLED';
    if (hostData.timeoutTimer) {
      clearTimeout(hostData.timeoutTimer);
      hostData.timeoutTimer = null;
    }
    if (hostData.conn) {
      try {
        hostData.conn.close();
      } catch (e) {}
    }
  }

  const mediaCall = activeMediaCalls.get(peerId);
  if (mediaCall) {
    try {
      mediaCall.close();
    } catch (e) {}
    activeMediaCalls.delete(peerId);
  }

  watchingHosts.delete(peerId);
  removeVideoCard(peerId);
  stopStatsMonitor(peerId);
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
  // Prevenção de condições de corrida (duplo clique durante permissão do navegador)
  if (isStartingStream) return;

  if (localStream) {
    stopLocalStream();
    return;
  }

  isStartingStream = true;
  if (streamBtn) streamBtn.disabled = true;

  const audioMode = audioModeSelect ? audioModeSelect.value : 'system';

  // Restrições de vídeo com Alvo de 60 FPS
  const videoConstraints = {
    width: { ideal: selectedProfile.width, max: 1920 },
    height: { ideal: selectedProfile.height, max: 1080 },
    frameRate: { ideal: 60, max: 60 },
    cursor: 'always'
  };

  let capturedDisplayStream = null;
  let capturedMicStream = null;
  let audioFailedReason = null;

  try {
    const wantSystemAudio = (audioMode === 'system');

    try {
      // Tentativa 1: Captura com áudio se solicitado
      capturedDisplayStream = await navigator.mediaDevices.getDisplayMedia({
        video: videoConstraints,
        audio: wantSystemAudio,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include'
      });
    } catch (captureErr) {
      // Se o usuário cancelou o seletor do navegador
      if (captureErr.name === 'NotAllowedError') {
        return;
      }

      // Fallback gracioso se o loopback de áudio for rejeitado pelo driver do fone/Windows
      if (wantSystemAudio && (captureErr.name === 'NotReadableError' || captureErr.message?.toLowerCase().includes('audio'))) {
        console.warn('Loopback de áudio rejeitado pelo driver/Windows. Fallback apenas vídeo...', captureErr);
        audioFailedReason = 'O driver de áudio rejeitou a captura em loopback.';
        showToast('Aviso: Áudio do sistema indisponível. Continuando apenas com vídeo...', 'info', 5000);

        capturedDisplayStream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
          audio: false,
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include'
        });
      } else {
        throw captureErr;
      }
    }

    localStream = capturedDisplayStream;
    if (wantSystemAudio && localStream.getAudioTracks().length > 0) {
      capturedSystemAudioTrack = localStream.getAudioTracks()[0];
    }

    // Se selecionou Microfone, captura e anexa a trilha de voz
    if (audioMode === 'mic') {
      try {
        capturedMicStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        const micTrack = capturedMicStream.getAudioTracks()[0];
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
    if (audioFailedReason) {
      showToast(`⚠ Áudio indisponível: ${audioFailedReason}`, 'info', 6000);
    } else if (hasAudio) {
      const label = audioMode === 'mic' ? 'Microfone' : 'Áudio do jogo (sistema)';
      showToast(`${label} capturado com sucesso!`, 'success');
    } else if (audioMode === 'system') {
      showToast('Transmissão iniciada (apenas vídeo). Dica: selecione "Tela inteira" e marque a caixa de áudio.', 'info');
    } else {
      showToast('Transmissão iniciada (modo sem áudio).', 'info');
    }

    addOrUpdateVideoCard({
      stream: localStream,
      peerId: 'local-me',
      label: 'Minha Transmissão (Você)',
      isLocal: true,
      onDisconnect: () => stopLocalStream(),
      onPanicClick: () => revokePlayer2()
    });

    // Inicia escuta para Companion Agent Windows (jogos PC nativos)
    initCompanionAgentConnection();
    
    if (streamBtn) {
      streamBtn.innerHTML = '<span>🛑</span> Parar Transmissão';
      streamBtn.classList.add('btn-stop');
    }

    // Notifica e chama todos os espectadores conectados
    connectedViewers.forEach((conn, viewerId) => {
      conn.send({ type: 'STREAM_STATUS', isStreaming: true });
      initiateMediaCallToViewer(viewerId);
    });

    showToast(`Transmissão ativa em alta fluidez (${(customBitrateBps / 1000000).toFixed(1)} Mbps)!`, 'success');

    videoTrack.onended = () => {
      stopLocalStream();
    };

  } catch (err) {
    console.error('Erro ao capturar tela:', err);
    // Limpeza de streams parciais em caso de erro
    if (capturedDisplayStream) {
      capturedDisplayStream.getTracks().forEach(t => t.stop());
    }
    if (capturedMicStream) {
      capturedMicStream.getTracks().forEach(t => t.stop());
    }
    localStream = null;

    if (err.name !== 'NotAllowedError') {
      showToast(`Erro ao iniciar stream: ${err.message}`, 'error');
    }
  } finally {
    isStartingStream = false;
    if (streamBtn) {
      streamBtn.disabled = false;
    }
  }
}

export function stopLocalStream() {
  if (localStream) {
    const stream = localStream;
    localStream = null;
    stream.getTracks().forEach(track => track.stop());
  }

  if (capturedSystemAudioTrack) {
    try { capturedSystemAudioTrack.stop(); } catch (e) {}
    capturedSystemAudioTrack = null;
  }
  if (capturedMicStream) {
    try { capturedMicStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    capturedMicStream = null;
  }

  // Revoga Player 2 se houver algum conectado
  const coopState = getCoopState();
  if (coopState.activePlayer2PeerId) {
    revokePlayer2();
  }

  // Fecha explicitamente todas as chamadas de mídia ativas dos espectadores
  activeMediaCalls.forEach((call, viewerId) => {
    try {
      call.close();
    } catch (e) {}
    stopStatsMonitor(viewerId);
  });
  activeMediaCalls.clear();

  removeVideoCard('local-me');
  stopStatsMonitor('local-me');

  if (streamBtn) {
    streamBtn.innerHTML = '<span>🚀</span> Transmitir Jogo';
    streamBtn.classList.remove('btn-stop');
  }

  connectedViewers.forEach((conn) => {
    conn.send({ type: 'STREAM_STOPPED' });
  });

  updateViewerCountUI();
  showToast('Transmissão encerrada.', 'info');
}

/**
 * Inicialização e controle dos recursos do Desktop App (Tauri / Rust)
 */
export async function initDesktopSupport() {
  if (!isDesktopApp()) return null;

  const desktopBadge = document.getElementById('desktop-badge');
  if (desktopBadge) {
    desktopBadge.style.display = 'inline-flex';
  }

  // Eleva a prioridade de processo imediatamente para alta prioridade de GPU
  await setHighPriority();

  const desktopPickerModal = document.getElementById('desktop-picker-modal');
  const desktopWindowsList = document.getElementById('desktop-windows-list');
  const pickerRefreshBtn = document.getElementById('picker-refresh-btn');
  const pickerCancelBtn = document.getElementById('picker-cancel-btn');
  const pickerScreenFallbackBtn = document.getElementById('picker-screen-fallback-btn');

  async function refreshWindowsList() {
    if (!desktopWindowsList) return;
    desktopWindowsList.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">🔍 Buscando jogos e janelas ativas no Windows...</div>';

    const windows = await getCapturableWindows();
    if (!windows || windows.length === 0) {
      desktopWindowsList.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 20px;">
          Nenhum jogo em janela detectado no momento.<br>
          <small>Você pode iniciar a transmissão de tela inteira abaixo.</small>
        </div>
      `;
      return;
    }

    desktopWindowsList.innerHTML = '';
    windows.forEach((win) => {
      const item = document.createElement('div');
      item.className = 'window-item';
      item.innerHTML = `
        <div class="window-info">
          <span class="window-title" title="${win.title}">🎮 ${win.title}</span>
          <span class="window-process">${win.process_name || 'Processo Windows'}</span>
        </div>
        <button class="window-action-btn">Transmitir</button>
      `;

      item.querySelector('.window-action-btn').addEventListener('click', () => {
        if (desktopPickerModal) desktopPickerModal.style.display = 'none';
        startLocalStream();
      });

      desktopWindowsList.appendChild(item);
    });
  }

  if (pickerRefreshBtn) {
    pickerRefreshBtn.addEventListener('click', refreshWindowsList);
  }

  if (pickerCancelBtn && desktopPickerModal) {
    pickerCancelBtn.addEventListener('click', () => {
      desktopPickerModal.style.display = 'none';
    });
  }

  if (pickerScreenFallbackBtn && desktopPickerModal) {
    pickerScreenFallbackBtn.addEventListener('click', () => {
      desktopPickerModal.style.display = 'none';
      startLocalStream();
    });
  }

  return { refreshWindowsList };
}

export function handleStreamBtnClick() {
  if (localStream) {
    stopLocalStream();
    return;
  }

  if (isDesktopApp()) {
    const desktopPickerModal = document.getElementById('desktop-picker-modal');
    if (desktopPickerModal) {
      desktopPickerModal.style.display = 'flex';
      const refreshBtn = document.getElementById('picker-refresh-btn');
      if (refreshBtn) refreshBtn.click();
      return;
    }
  }

  startLocalStream();
}

if (streamBtn) {
  streamBtn.addEventListener('click', handleStreamBtnClick);
}

// Auto-conexão por URL
function checkAutoWatchUrl() {
  if (window.location.pathname.endsWith('streamer.html')) return;

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
    showToast(`ID detectado: ${targetId.slice(0, 6)}. Conectando...`, 'info');
    watchFriend(targetId);
  }
}

// ==========================================
// INICIALIZAÇÃO GERAL
// ==========================================

window.addEventListener('DOMContentLoaded', () => {
  const acceptedVersion = localStorage.getItem('seemygame_terms_version');
  const legacyAccepted = localStorage.getItem('seemygame_terms_accepted') === 'true';

  // Pré-busca credenciais TURN da API serverless em segundo plano se disponível
  fetchIceServersFromApi().catch(() => {});

  // Inicializa suporte e prioridade nativa se estiver rodando em Desktop Tauri
  initDesktopSupport().catch((err) => console.warn('[Desktop Init]', err));

  // Inicializa recursos Discord (Chat e Voz P2P)
  initDiscordFeatures();

  initTermsModal(() => {
    initPeer();
  });

  // Só conecta à sinalização se os termos já tiverem sido aceitos
  if (acceptedVersion === TERMS_VERSION || (legacyAccepted && !acceptedVersion)) {
    initPeer();
  }
});

// ==========================================
// ATALHOS DE TECLADO GAMER (F = Fullscreen, M = Mute)
// ==========================================

window.addEventListener('keydown', (e) => {
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
    return;
  }

  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    const video = document.querySelector('.video-card:not(#card-local-me) video') || 
                  document.querySelector('video');
    if (video) {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (video.requestFullscreen) {
          video.requestFullscreen().catch(err => console.warn(err));
        } else if (video.webkitRequestFullscreen) {
          video.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(err => console.warn(err));
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    }
  } else if (e.key === 'm' || e.key === 'M') {
    const video = document.querySelector('.video-card:not(#card-local-me) video') || 
                  document.querySelector('video');
    if (video) {
      video.muted = !video.muted;
      showToast(video.muted ? '🔇 Áudio mutado' : '🔊 Áudio desmutado', 'info', 2000);
      document.querySelectorAll('.volume-slider').forEach(s => {
        s.value = video.muted ? '0' : '1';
      });
      document.querySelectorAll('.overlay-btn').forEach(btn => {
        if (btn.innerHTML.includes('🔊') || btn.innerHTML.includes('🔇')) {
          btn.innerHTML = video.muted ? '🔇' : '🔊';
        }
      });
    }
  }
});

