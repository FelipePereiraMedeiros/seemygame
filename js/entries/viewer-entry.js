/**
 * SeeMyGame - Dedicated Viewer Entrypoint
 * Focado exclusivamente em:
 * 1. Recepção de stream audiovisual WebRTC de baixa latência
 * 2. Cliente de controle Co-op (Jogador 2) para envio de inputs via DataChannel
 * 3. HUD de Telemetria (Bitrate, FPS, RTT, perda de pacotes)
 * 4. Recursos periféricos (Chat, Voz, Reações, Ping tático, Lousa colaborativa)
 * 
 * NÃO importa capturadores de tela, Three.js, ou ferramentas pesadas do streamer.
 */

import { 
  getPeerConfig, 
  fetchIceServersFromApi,
  TERMS_VERSION 
} from '../config.js';
import { 
  hookPeerConnectionSdp, 
  applyTransceiverOptimizations 
} from '../webrtc.js';
import { 
  startStatsMonitor, 
  stopStatsMonitor, 
  getLastMetrics 
} from '../stats.js';
import { 
  showToast, 
  initTermsModal, 
  createPlaceholderCard, 
  updateCardStatus, 
  hideCardLoading, 
  setCardStreamPaused, 
  removeVideoCard, 
  addOrUpdateVideoCard,
  updateCoopUI,
  isValidPeerId 
} from '../ui.js';
import { 
  handleViewerCoopMessage, 
  requestCoopControl, 
  releaseCoopControl, 
  getCoopState, 
  registerCoopStateChangeHandler 
} from '../coop.js';
import { chatManager } from '../chat.js';
import { voiceManager } from '../voice.js';
import { DiscordUIController } from '../discord-ui.js';
import { globalBus } from '../core/event-bus.js';
import { p2pDispatcher } from '../core/message-dispatcher.js';
import { pluginManager } from '../core/plugin-manager.js';
import { 
  whiteboardPlugin, 
  soundboardPlugin, 
  tacticalPingPlugin, 
  reactionsPlugin 
} from '../plugins/index.js';

export const isViewerPage = true;
export const isHost = false;

// Estado local do visualizador
export const viewerState = {
  peer: null,
  targetHostId: null,
  activeCall: null,
  activeConn: null,
  statsMonitorActive: false,
  remoteStream: null
};

export const watchingHosts = new Map();

/**
 * Extrai o ID do Streamer a partir da URL (#watch=ID ou query ?streamer=ID)
 */
export function getTargetStreamerId() {
  if (typeof window === 'undefined' || !window.location) return null;
  const hash = window.location.hash || '';
  const match = hash.match(/watch=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];

  const params = new URLSearchParams(window.location.search);
  return params.get('streamer') || null;
}

/**
 * Conecta o visualizador a um streamer pelo seu Peer ID.
 */
export async function connectToStreamer(streamerId, pin = null) {
  if (!streamerId || !isValidPeerId(streamerId)) {
    showToast('ID do streamer inválido.', 'error');
    return false;
  }

  viewerState.targetHostId = streamerId;
  createPlaceholderCard(streamerId, `Streamer: ${streamerId.slice(0, 8)}`);
  updateCardStatus(streamerId, 'Conectando ao Streamer...');

  if (!viewerState.peer || viewerState.peer.destroyed) {
    await initViewerPeer();
  }

  const conn = viewerState.peer.connect(streamerId, { 
    reliable: true,
    metadata: { role: 'viewer', pin: pin || '' }
  });

  viewerState.activeConn = conn;
  watchingHosts.set(streamerId, {
    state: 'CONNECTING',
    conn,
    call: null
  });

  conn.on('open', () => {
    updateCardStatus(streamerId, 'Conectado! Aguardando vídeo...');
    const hostEntry = watchingHosts.get(streamerId);
    if (hostEntry) hostEntry.state = 'CONNECTED';

    // Notifica o host sobre a conexão
    conn.send({
      type: 'VIEWER_HELLO',
      peerId: viewerState.peer.id,
      pin: pin || ''
    });

    globalBus.emit('viewer:connected', { streamerId });
  });

  conn.on('data', (data) => {
    p2pDispatcher.dispatch(data, conn, viewerState.peer);
  });

  conn.on('close', () => {
    updateCardStatus(streamerId, 'Desconectado do streamer.');
    removeVideoCard(streamerId);
    watchingHosts.delete(streamerId);
    globalBus.emit('viewer:disconnected', { streamerId });
  });

  conn.on('error', (err) => {
    console.error(`[Viewer] Erro na conexão com ${streamerId}:`, err);
    updateCardStatus(streamerId, 'Erro na conexão P2P.');
    showToast(`Erro ao conectar com ${streamerId.slice(0, 6)}`, 'error');
  });

  return true;
}

/**
 * Inicializa a instância PeerJS do Viewer.
 */
export async function initViewerPeer() {
  if (typeof Peer === 'undefined') {
    throw new Error('PeerJS não está carregado no escopo global.');
  }

  await fetchIceServersFromApi().catch(() => {});
  const config = getPeerConfig();

  return new Promise((resolve, reject) => {
    const peer = new Peer(config);
    viewerState.peer = peer;

    peer.on('open', (id) => {
      console.log(`[Viewer] Peer conectado com ID: ${id}`);
      resolve(peer);
    });

    peer.on('call', (call) => {
      handleIncomingStreamCall(call);
    });

    peer.on('error', (err) => {
      console.error('[Viewer] Erro no Peer:', err);
      reject(err);
    });
  });
}

/**
 * Recebe a chamada audiovisual do host e monta no grid.
 */
function handleIncomingStreamCall(call) {
  hookPeerConnectionSdp(call.peerConnection);
  call.answer(); // Responde sem enviar stream local
  viewerState.activeCall = call;

  const hostId = call.peer;
  const hostEntry = watchingHosts.get(hostId) || { state: 'CONNECTED', conn: viewerState.activeConn };
  hostEntry.call = call;
  watchingHosts.set(hostId, hostEntry);

  call.on('stream', (remoteStream) => {
    viewerState.remoteStream = remoteStream;
    addOrUpdateVideoCard(hostId, remoteStream, {
      title: `Ao Vivo: ${hostId.slice(0, 8)}`,
      isHost: false
    });
    hideCardLoading(hostId);

    // Inicia monitoramento de estatísticas no HUD
    if (call.peerConnection) {
      startStatsMonitor(call.peerConnection, (stats) => {
        updateStatsHud(stats);
      });
      viewerState.statsMonitorActive = true;
    }

    globalBus.emit('stream:received', { hostId, stream: remoteStream });
  });

  call.on('close', () => {
    stopStatsMonitor();
    viewerState.statsMonitorActive = false;
    removeVideoCard(hostId);
  });
}

/**
 * Atualiza valores na interface do HUD de Estatísticas.
 */
function updateStatsHud(stats) {
  const fpsEl = document.getElementById('stat-fps');
  const bitrateEl = document.getElementById('stat-bitrate');
  const rttEl = document.getElementById('stat-rtt');
  const lossEl = document.getElementById('stat-loss');

  if (fpsEl && stats.fps != null) fpsEl.textContent = `${Math.round(stats.fps)} FPS`;
  if (bitrateEl && stats.bitrateKbps != null) bitrateEl.textContent = `${(stats.bitrateKbps / 1000).toFixed(1)} Mbps`;
  if (rttEl && stats.rttMs != null) rttEl.textContent = `${Math.round(stats.rttMs)} ms`;
  if (lossEl && stats.packetLossRatio != null) lossEl.textContent = `${(stats.packetLossRatio * 100).toFixed(1)}%`;
}

/**
 * Inicializa a aplicação completa do espectador.
 */
export async function initViewerApp(options = {}) {
  // Registra plugins relevantes para espectadores
  try {
    pluginManager.register(whiteboardPlugin);
    pluginManager.register(soundboardPlugin);
    pluginManager.register(tacticalPingPlugin);
    pluginManager.register(reactionsPlugin);
    pluginManager.initAll({
      eventBus: globalBus,
      p2pDispatcher: p2pDispatcher,
      role: 'viewer'
    });
  } catch (err) {
    console.warn('[Viewer] Falha ao registrar plugins:', err);
  }

  // Registra manipuladores Co-op do Jogador 2
  registerCoopStateChangeHandler((state) => {
    updateCoopUI(state);
  });

  const targetStreamer = options.targetStreamerId || getTargetStreamerId();
  if (targetStreamer) {
    initTermsModal(() => {
      connectToStreamer(targetStreamer, options.pin || null);
    });
  } else {
    initTermsModal();
  }

  return {
    isViewer: true,
    connect: connectToStreamer,
    requestCoop: (hId) => requestCoopControl(hId, viewerState.activeConn),
    releaseCoop: (hId) => releaseCoopControl(hId, viewerState.activeConn),
    state: viewerState
  };
}

// Auto-inicialização quando executado diretamente em viewer.html
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const isViewer = window.location && window.location.pathname.endsWith('viewer.html');
  if (isViewer) {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => initViewerApp());
    } else {
      initViewerApp();
    }
  }
}
