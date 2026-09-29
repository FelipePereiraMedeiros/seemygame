/**
 * SeeMyGame - Dedicated Streamer Entrypoint
 * Focado nas responsabilidades de transmissão de alta performance:
 * 1. Captura de tela (Desktop nativo Tauri / WASAPI / WGC ou Browser getDisplayMedia)
 * 2. Gestão de dispositivos de áudio, loopback de sistema e microfone
 * 3. Perfis de qualidade de vídeo e tuning de encoder WebRTC (60 FPS, Bitrate, ABR)
 * 4. Servidor Host de Co-op (Jogador 2 e Party Mode com injeção ViGEm)
 * 5. Gerenciamento de espectadores conectados e árvore P2P
 */

import { 
  getPeerConfig, 
  fetchIceServersFromApi,
  QUALITY_PROFILES, 
  DEFAULT_PROFILE, 
  DEFAULT_BITRATE_BPS,
  TERMS_VERSION 
} from '../config.js';
import { 
  hookPeerConnectionSdp, 
  applyTransceiverOptimizations,
  applySenderOptimizations,
  swapStreamAudioTrack 
} from '../webrtc.js';
import { 
  NativeCaptureProvider 
} from '../capture.js';
import { 
  requestBrowserDisplayMedia 
} from '../browser-capture.js';
import { 
  getAudioDevices, 
  populateDeviceSelect, 
  playTestTone, 
  getSavedAudioPreferences, 
  saveAudioPreference, 
  watchDeviceChanges 
} from '../audio-devices.js';
import { 
  initAudioAnalyser, 
  stopAudioAnalyser, 
  applyMicrophoneProcessing 
} from '../audio.js';
import { 
  adaptiveBitrateController 
} from '../abr.js';
import { 
  handleHostCoopMessage, 
  revokePlayer2, 
  setCoopEnabled, 
  setMaxCoopPlayers, 
  setPartyModeEnabled, 
  getCoopState, 
  registerCoopPromptHandler, 
  registerCoopStateChangeHandler, 
  initCompanionAgentConnection 
} from '../coop.js';
import { 
  isDesktopApp, 
  getCapturableWindows, 
  getCapturableSources, 
  getNativeCaptureCapabilities, 
  setHighPriority 
} from '../desktop.js';
import { 
  showToast, 
  initTermsModal, 
  createPlaceholderCard, 
  updateCardStatus, 
  addOrUpdateVideoCard,
  removeVideoCard,
  showCoopPromptModal 
} from '../ui.js';
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
  reactionsPlugin, 
  clippingPlugin 
} from '../plugins/index.js';

export const isStreamerPage = true;
export const isHost = true;

// Estado central da sessão de transmissão
export const streamerState = {
  peer: null,
  streamerId: null,
  customId: null,
  streamerPin: null,
  localStream: null,
  captureProvider: null,
  currentProfile: DEFAULT_PROFILE,
  targetBitrateBps: DEFAULT_BITRATE_BPS,
  fpsTarget: 60,
  activeCalls: new Map(), // viewerPeerId -> call
  connectedViewers: new Map() // viewerPeerId -> conn
};

export const connectedViewers = streamerState.connectedViewers;

/**
 * Inicializa a instância PeerJS do Streamer.
 */
export async function initStreamerPeer(customId = null) {
  if (typeof Peer === 'undefined') {
    throw new Error('PeerJS não está carregado no escopo global.');
  }

  await fetchIceServersFromApi().catch(() => {});
  const config = getPeerConfig();

  return new Promise((resolve, reject) => {
    const idToUse = customId || streamerState.customId;
    const peer = idToUse ? new Peer(idToUse, config) : new Peer(config);
    streamerState.peer = peer;

    peer.on('open', (id) => {
      streamerState.streamerId = id;
      console.log(`[Streamer] Host registrado com ID: ${id}`);
      updateStreamerUI(id);
      globalBus.emit('streamer:ready', { streamerId: id });
      resolve(peer);
    });

    peer.on('connection', (conn) => {
      handleViewerConnection(conn);
    });

    peer.on('error', (err) => {
      console.error('[Streamer] Erro no Peer:', err);
      if (err.type === 'unavailable-id') {
        showToast('ID customizado já em uso. Tentando ID aleatório...', 'warning');
        initStreamerPeer(null).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Gerencia a conexão P2P de dados com um espectador.
 */
function handleViewerConnection(conn) {
  const viewerId = conn.peer;

  conn.on('open', () => {
    streamerState.connectedViewers.set(viewerId, conn);
    console.log(`[Streamer] Espectador conectado: ${viewerId}`);

    // Se já estiver transmitindo, estabelece chamada de mídia imediatamente
    if (streamerState.localStream) {
      callViewerWithStream(viewerId);
    }

    updateViewerCount();
  });

  conn.on('data', (data) => {
    // Processamento com isolamento de falha
    p2pDispatcher.dispatch(data, conn, streamerState.peer);
  });

  conn.on('close', () => {
    streamerState.connectedViewers.delete(viewerId);
    streamerState.activeCalls.delete(viewerId);
    updateViewerCount();
    console.log(`[Streamer] Espectador desconectado: ${viewerId}`);
  });
}

/**
 * Dispara chamada WebRTC com a trilha local para um espectador.
 */
export function callViewerWithStream(viewerId) {
  if (!streamerState.peer || !streamerState.localStream) return null;

  const call = streamerState.peer.call(viewerId, streamerState.localStream);
  if (!call) return null;

  hookPeerConnectionSdp(call.peerConnection);
  applySenderOptimizations(
    call.peerConnection, 
    streamerState.targetBitrateBps, 
    streamerState.fpsTarget
  );

  streamerState.activeCalls.set(viewerId, call);
  return call;
}

/**
 * Inicia a captura de tela e áudio do jogo.
 */
export async function startCapture(sourceId = null, captureOptions = {}) {
  let stream = null;

  try {
    if (isDesktopApp() && sourceId) {
      // Captura de alto desempenho via Tauri / GStreamer / WGC
      streamerState.captureProvider = new NativeCaptureProvider();
      stream = await streamerState.captureProvider.startCapture(sourceId, {
        fps: streamerState.fpsTarget,
        bitrate: streamerState.targetBitrateBps,
        ...captureOptions
      });
      setHighPriority(true).catch(() => {});
    } else {
      // Captura via API padrão de navegadores (Screen Capture API)
      stream = await requestBrowserDisplayMedia({
        audio: true,
        video: {
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 }
        }
      });
    }

    streamerState.localStream = stream;

    // Transmite a todos os espectadores conectados
    for (const viewerId of streamerState.connectedViewers.keys()) {
      callViewerWithStream(viewerId);
    }

    addOrUpdateVideoCard('local-stream', stream, {
      title: 'Sua Transmissão (Ao Vivo)',
      isHost: true
    });

    globalBus.emit('stream:started', { stream });
    showToast('Transmissão iniciada com sucesso!', 'success');
    return stream;
  } catch (err) {
    console.error('[Streamer] Falha ao iniciar captura:', err);
    showToast('Não foi possível iniciar a captura de tela.', 'error');
    throw err;
  }
}

/**
 * Encerra a transmissão local.
 */
export function stopCapture() {
  if (streamerState.localStream) {
    streamerState.localStream.getTracks().forEach(t => t.stop());
    streamerState.localStream = null;
  }

  if (streamerState.captureProvider) {
    streamerState.captureProvider.stop();
    streamerState.captureProvider = null;
  }

  for (const call of streamerState.activeCalls.values()) {
    try { call.close(); } catch (e) {}
  }
  streamerState.activeCalls.clear();

  removeVideoCard('local-stream');
  globalBus.emit('stream:stopped');
  showToast('Transmissão encerrada.', 'info');
}

/**
 * Atualiza o contador de espectadores na interface.
 */
function updateViewerCount() {
  const countEl = document.getElementById('viewer-count');
  if (countEl) {
    const total = streamerState.connectedViewers.size;
    countEl.textContent = `${total} espectador${total !== 1 ? 'es' : ''}`;
  }
}

/**
 * Atualiza badges e links de compartilhamento na tela do host.
 */
function updateStreamerUI(id) {
  const badgeEl = document.getElementById('copy-badge');
  if (badgeEl) badgeEl.textContent = id;

  const shareBtn = document.getElementById('share-link-btn');
  if (shareBtn) shareBtn.style.display = 'inline-flex';
}

/**
 * Configura o perfil de qualidade do encoder.
 */
export function setQualityProfile(profileName) {
  const normalizedKey = profileName === 'fhd60' ? 'balanced' : (profileName === 'hd60' ? 'ultra' : profileName);
  const profile = QUALITY_PROFILES[normalizedKey] || QUALITY_PROFILES[profileName];
  if (!profile) return;

  streamerState.currentProfile = normalizedKey;
  streamerState.targetBitrateBps = profile.bitrate;
  streamerState.fpsTarget = profile.fps;

  // Aplica aos senders de conexões ativas
  for (const call of streamerState.activeCalls.values()) {
    if (call.peerConnection) {
      applySenderOptimizations(
        call.peerConnection,
        streamerState.targetBitrateBps,
        streamerState.fpsTarget,
        profile.scaleFactor || 1
      );
    }
  }

  showToast(`Qualidade ajustada para: ${profile.label}`, 'info');
}

/**
 * Inicializa a aplicação completa do streamer.
 */
export async function initStreamerApp(options = {}) {
  // Registra todos os plugins com clipping ativado para o host
  try {
    pluginManager.register(whiteboardPlugin);
    pluginManager.register(soundboardPlugin);
    pluginManager.register(tacticalPingPlugin);
    pluginManager.register(reactionsPlugin);
    pluginManager.register(clippingPlugin);
    pluginManager.initAll({
      eventBus: globalBus,
      p2pDispatcher: p2pDispatcher,
      role: 'streamer'
    });
  } catch (err) {
    console.warn('[Streamer] Falha ao registrar plugins:', err);
  }

  // Registra modal de prompt de Co-op para aceitar/recusar Jogador 2
  registerCoopPromptHandler((peerId, promptOptions) => {
    showCoopPromptModal(peerId, promptOptions);
  });

  initTermsModal(() => {
    initStreamerPeer(options.customId || null);
  });

  return {
    isStreamer: true,
    startCapture,
    stopCapture,
    setQualityProfile,
    state: streamerState
  };
}

// Auto-inicialização quando executado diretamente em streamer.html
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const isStreamer = window.location && window.location.pathname.endsWith('streamer.html');
  if (isStreamer) {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => initStreamerApp());
    } else {
      initStreamerApp();
    }
  }
}
