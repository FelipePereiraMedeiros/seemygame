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
  initCompanionAgentConnection,
  setupGamepadTesterModal
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
import { createSessionContext } from '../core/session-context.js';
import { bindSessionMessageHandlers } from '../protocol/session-handlers.js';
import { registerSessionFeatures } from '../plugins/session-composition.js';
import {
  PROTOCOL_TYPES,
  AdmissionGate
} from '../protocol/index.js';

export const isStreamerPage = true;
export const isHost = true;

// Estado central da sessão de transmissão
export const streamerState = {
  peer: null,
  streamerId: null,
  customId: null,
  streamerPin: null,
  admissionGate: new AdmissionGate(),
  localStream: null,
  captureProvider: null,
  currentProfile: DEFAULT_PROFILE,
  targetBitrateBps: DEFAULT_BITRATE_BPS,
  fpsTarget: 60,
  activeCalls: new Map(), // viewerPeerId -> call
  connectedViewers: new Map(), // viewerPeerId -> conn
  session: null,
  messageHandlers: null
};

export const connectedViewers = streamerState.connectedViewers;

/**
 * Define ou limpa o PIN da transmissão
 */
export function setStreamerPin(pin) {
  const normalized = pin ? String(pin).trim() : null;
  streamerState.streamerPin = normalized;
  streamerState.admissionGate.roomPin = normalized;
  if (typeof localStorage !== 'undefined') {
    if (normalized) {
      localStorage.setItem('seemygame_streamer_pin', normalized);
    } else {
      localStorage.removeItem('seemygame_streamer_pin');
    }
  }
}

/**
 * Obtém o PIN da transmissão
 */
export function getStreamerPin() {
  if (streamerState.streamerPin) return streamerState.streamerPin;
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('seemygame_streamer_pin');
    if (saved) {
      streamerState.streamerPin = String(saved).trim();
      streamerState.admissionGate.roomPin = streamerState.streamerPin;
      return streamerState.streamerPin;
    }
  }
  return null;
}

/**
 * Inicializa a instância PeerJS do Streamer.
 */
export async function initStreamerPeer(customId = null, session = streamerState.session) {
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
      (session?.eventBus || globalBus).emit('streamer:ready', { streamerId: id });
      resolve(peer);
    });

    peer.on('connection', (conn) => {
      handleViewerConnection(conn, session);
    });

    peer.on('call', (call) => {
      if (call.metadata?.type === 'VOICE_CHAT' && streamerState.admissionGate.isAuthenticated(call.peer)) {
        streamerState.messageHandlers?.answerVoiceCall(call);
      }
    });

    peer.on('error', (err) => {
      console.error('[Streamer] Erro no Peer:', err);
      if (err.type === 'unavailable-id') {
        showToast('ID customizado já em uso. Tentando ID aleatório...', 'warning');
        initStreamerPeer(null, session).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Gerencia a conexão P2P de dados com um espectador.
 */
function handleViewerConnection(conn, session = streamerState.session) {
  const viewerId = conn.peer;

  conn.on('open', () => {
    streamerState.connectedViewers.set(viewerId, conn);
    console.log(`[Streamer] Espectador conectado: ${viewerId}`);

    getStreamerPin();

    if (streamerState.admissionGate.roomPin) {
      // Sala com PIN: solicita autenticação antes de liberar áudio/vídeo
      conn.send({ type: PROTOCOL_TYPES.ADMISSION.PIN_REQUIRED });
    } else {
      // Sala sem PIN: autoriza imediatamente
      streamerState.admissionGate.authenticate(viewerId);
      notifyViewerVoiceState(conn, viewerId);
      if (streamerState.localStream) {
        callViewerWithStream(viewerId, session);
        conn.send({ type: PROTOCOL_TYPES.MEDIA.STREAM_STATUS, isStreaming: true });
      } else {
        conn.send({ type: PROTOCOL_TYPES.MEDIA.STREAM_STATUS, isStreaming: false });
      }
    }

    updateViewerCount();
  });

  conn.on('data', (data) => {
    if (!data || typeof data !== 'object') return;

    if (data.type === PROTOCOL_TYPES.MEDIA.REQUEST_STREAM || data.type === PROTOCOL_TYPES.ADMISSION.VIEWER_HELLO) {
      getStreamerPin();
      if (streamerState.admissionGate.roomPin) {
        const isValid = streamerState.admissionGate.validateAuthAttempt({ pin: data.pin });
        if (isValid) {
          streamerState.admissionGate.authenticate(viewerId);
          notifyViewerVoiceState(conn, viewerId);
          conn.send({ type: PROTOCOL_TYPES.ADMISSION.PIN_ACCEPTED });
          if (streamerState.localStream) {
            callViewerWithStream(viewerId, session);
            conn.send({ type: PROTOCOL_TYPES.MEDIA.STREAM_STATUS, isStreaming: true });
          } else {
            conn.send({ type: PROTOCOL_TYPES.MEDIA.STREAM_STATUS, isStreaming: false });
          }
          showToast(`Amigo (${viewerId.slice(0, 6)}) autenticou com PIN.`, 'success');
        } else {
          conn.send({
            type: PROTOCOL_TYPES.ADMISSION.PIN_REQUIRED,
            error: 'PIN incorreto. Tente novamente.'
          });
        }
        return;
      } else {
        streamerState.admissionGate.authenticate(viewerId);
        notifyViewerVoiceState(conn, viewerId);
        if (streamerState.localStream) {
          callViewerWithStream(viewerId, session);
          conn.send({ type: PROTOCOL_TYPES.MEDIA.STREAM_STATUS, isStreaming: true });
        } else {
          conn.send({ type: PROTOCOL_TYPES.MEDIA.STREAM_STATUS, isStreaming: false });
        }
        return;
      }
    }

    // Se o espectador não estiver autenticado pelo AdmissionGate, bloqueia tráfego de dados
    if (!streamerState.admissionGate.isAuthenticated(viewerId)) {
      conn.send({
        type: PROTOCOL_TYPES.ADMISSION.PIN_REQUIRED,
        error: 'Autenticação necessária com PIN.'
      });
      return;
    }

    // Processamento com isolamento de falha
    (session?.dispatcher || p2pDispatcher).dispatch(data, conn, streamerState.peer);
  });

  conn.on('close', () => {
    streamerState.connectedViewers.delete(viewerId);
    streamerState.admissionGate.revoke(viewerId);
    streamerState.activeCalls.delete(viewerId);
    updateViewerCount();
    console.log(`[Streamer] Espectador desconectado: ${viewerId}`);
  });
}

function notifyViewerVoiceState(conn, viewerId) {
  if (!voiceManager.isInVoice || !conn?.open) return;
  conn.send({
    type: 'VOICE_SIGNAL',
    action: 'HOST_VOICE_ACTIVE',
    peerId: streamerState.streamerId,
    name: 'Streamer',
    role: 'host'
  });
  streamerState.messageHandlers?.connectVoiceTo(viewerId);
}

/**
 * Dispara chamada WebRTC com a trilha local para um espectador.
 */
export function callViewerWithStream(viewerId, session = streamerState.session) {
  if (!streamerState.peer || !streamerState.localStream) return null;
  if (!streamerState.admissionGate.isAuthenticated(viewerId)) {
    console.warn(`[Streamer] Chamada de mídia bloqueada: peer ${viewerId} não autenticado.`);
    return null;
  }

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
export async function startCapture(sourceId = null, captureOptions = {}, session = streamerState.session) {
  let stream = null;

  try {
    if (isDesktopApp() && sourceId) {
      // Captura de alto desempenho via Tauri / GStreamer / WGC
      streamerState.captureProvider = new NativeCaptureProvider();
      const captureResult = await streamerState.captureProvider.start({
        sourceId,
        fps: streamerState.fpsTarget,
        bitrateKbps: Math.round(streamerState.targetBitrateBps / 1000),
        ...captureOptions
      });
      stream = captureResult?.stream || captureResult;
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

    // Transmite a todos os espectadores conectados e autenticados
    for (const viewerId of streamerState.connectedViewers.keys()) {
      if (streamerState.admissionGate.isAuthenticated(viewerId)) {
        callViewerWithStream(viewerId, session);
      }
    }

    addOrUpdateVideoCard({
      peerId: 'local-me',
      stream,
      label: 'Sua Transmissão (Ao Vivo)',
      isLocal: true
    });

    const streamBtn = document.getElementById('stream-btn');
    if (streamBtn) {
      streamBtn.classList.add('streaming');
      streamBtn.innerHTML = '<span>⏹️</span> Parar Transmissão';
    }

    (session?.eventBus || globalBus).emit('stream:started', { stream });
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
export function stopCapture(session = streamerState.session) {
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

  removeVideoCard('local-me');

  const streamBtn = document.getElementById('stream-btn');
  if (streamBtn) {
    streamBtn.classList.remove('streaming');
    streamBtn.innerHTML = '<span>🚀</span> Transmitir Jogo';
  }

  (session?.eventBus || globalBus).emit('stream:stopped');
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
  const streamBtn = document.getElementById('stream-btn');
  if (streamBtn) streamBtn.disabled = false;
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
  const session = createSessionContext({
    role: 'streamer',
    exclusiveKey: 'streamer-entry',
    eventBus: options.eventBus,
    messageDispatcher: options.messageDispatcher,
    pluginManager: options.pluginManager,
    initialState: streamerState
  });
  streamerState.session = session;

  const features = registerSessionFeatures(session, {
    role: 'streamer',
    includeClipping: true,
    showToast,
    chatManager,
    getPeerId: () => streamerState.streamerId || 'streamer',
    getRole: () => 'host',
    getDisplayName: () => 'Streamer',
    getViewersCount: () => streamerState.connectedViewers.size,
    broadcastDataMessage: (data, excludePeerId) => {
      streamerState.connectedViewers.forEach((conn, peerId) => {
        if (peerId !== excludePeerId && conn.open && streamerState.admissionGate.isAuthenticated(peerId)) conn.send(data);
      });
    }
  });
  const messageHandlers = bindSessionMessageHandlers(session, {
    role: 'streamer',
    chatManager,
    voiceManager,
    getPeer: () => streamerState.peer,
    getLocalPeerId: () => streamerState.streamerId,
    showToast,
    broadcast: (data, excludePeerId) => {
      streamerState.connectedViewers.forEach((conn, peerId) => {
        if (peerId !== excludePeerId && conn.open && streamerState.admissionGate.isAuthenticated(peerId)) conn.send(data);
      });
    }
  });
  streamerState.messageHandlers = messageHandlers;
  session.registerCleanup(() => {
    if (streamerState.messageHandlers === messageHandlers) streamerState.messageHandlers = null;
  });

  // Registra modal de prompt de Co-op para aceitar/recusar Jogador 2
  const unregisterCoopPrompt = registerCoopPromptHandler((promptOptions) => {
    showCoopPromptModal(promptOptions);
  });
  if (typeof unregisterCoopPrompt === 'function') {
    session.registerCleanup(unregisterCoopPrompt);
  }

  // Vincula controles DOM do streamer se existirem na página
  const roomPinInput = document.getElementById('room-pin-input');
  if (roomPinInput) {
    if (streamerState.streamerPin && !roomPinInput.value) {
      roomPinInput.value = streamerState.streamerPin;
    }
    const onPinInput = (e) => setStreamerPin(e.target.value);
    roomPinInput.addEventListener('input', onPinInput);
    session.registerCleanup(() => roomPinInput.removeEventListener('input', onPinInput));
  }

  const streamBtn = document.getElementById('stream-btn');
  if (streamBtn) {
    const onStreamClick = () => {
      if (!streamerState.localStream) {
        startCapture(null, {}, session);
      } else {
        stopCapture(session);
      }
    };
    streamBtn.addEventListener('click', onStreamClick);
    session.registerCleanup(() => streamBtn.removeEventListener('click', onStreamClick));
  }

  const qualitySelect = document.getElementById('quality-preset');
  if (qualitySelect) {
    const onQualityChange = (e) => setQualityProfile(e.target.value);
    qualitySelect.addEventListener('change', onQualityChange);
    session.registerCleanup(() => qualitySelect.removeEventListener('change', onQualityChange));
  }

  const bitrateSlider = document.getElementById('bitrate-slider');
  const bitrateDisplay = document.getElementById('bitrate-display');
  if (bitrateSlider) {
    const onBitrateInput = (e) => {
      const kbps = parseInt(e.target.value, 10);
      streamerState.targetBitrateBps = kbps * 1000;
      if (bitrateDisplay) {
        bitrateDisplay.textContent = `${(kbps / 1000).toFixed(1)} Mbps`;
      }
    };
    bitrateSlider.addEventListener('input', onBitrateInput);
    session.registerCleanup(() => bitrateSlider.removeEventListener('input', onBitrateInput));
  }

  // Configura modal de teste e calibração de controle físico
  setupGamepadTesterModal();

  // Instancia controlador da interface Discord (Chat, Voz, Emojis, Sons)
  if (typeof DiscordUIController !== 'undefined') {
    const discordUI = new DiscordUIController({
      chatManager,
      voiceManager,
      soundboardManager: features.soundboard?.manager,
      onSendMessage: (text) => {
        const msg = chatManager.createMessage({
          senderId: streamerState.streamerId || 'streamer',
          senderName: 'Streamer',
          role: 'host',
          text,
          channel: chatManager.getActiveChannel()
        });
        const stored = msg && chatManager.addMessage(msg);
        if (stored) {
          for (const conn of streamerState.connectedViewers.values()) {
            if (conn.open && streamerState.admissionGate.isAuthenticated(conn.peer)) {
              conn.send({ type: PROTOCOL_TYPES.COMMUNICATION.CHAT_MESSAGE, message: stored });
            }
          }
        }
      },
      onJoinVoice: async () => {
        try {
          const stream = await voiceManager.joinVoice({ peerId: streamerState.streamerId, name: 'Streamer', role: 'host' });
          const payload = { type: 'VOICE_SIGNAL', action: 'HOST_VOICE_ACTIVE', peerId: streamerState.streamerId, name: 'Streamer', role: 'host' };
          streamerState.connectedViewers.forEach((conn, peerId) => {
            if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) conn.send(payload);
          });
          for (const peerId of streamerState.connectedViewers.keys()) {
            if (!streamerState.admissionGate.isAuthenticated(peerId)) continue;
            const call = streamerState.peer?.call(peerId, stream, { metadata: { type: 'VOICE_CHAT', name: 'Streamer', role: 'host' } });
            messageHandlers.bindVoiceCall(call);
          }
        } catch (_) { showToast('Não foi possível acessar o microfone.', 'error'); }
      },
      onLeaveVoice: () => {
        messageHandlers.activeVoiceCalls.forEach((call) => { try { call.close(); } catch (_) {} });
        messageHandlers.activeVoiceCalls.clear();
        voiceManager.leaveVoice();
        streamerState.connectedViewers.forEach((conn, peerId) => {
          if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) conn.send({ type: 'VOICE_SIGNAL', action: 'LEAVE', peerId: streamerState.streamerId });
        });
      },
      onToggleMic: (isMuted) => {
        const data = { type: 'VOICE_STATE_UPDATE', peerId: streamerState.streamerId, isMuted };
        streamerState.connectedViewers.forEach((conn, peerId) => {
          if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) conn.send(data);
        });
      },
      onToggleDeaf: (isDeafened) => {
        const data = { type: 'VOICE_STATE_UPDATE', peerId: streamerState.streamerId, isDeafened };
        streamerState.connectedViewers.forEach((conn, peerId) => {
          if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) conn.send(data);
        });
      },
      onToggleStream: () => streamerState.localStream ? stopCapture(session) : startCapture(null, {}, session),
      onOpenTuning: () => { const modal = document.getElementById('tuning-modal'); if (modal) modal.style.display = 'flex'; },
      onOpenWhiteboard: () => features.whiteboardUI?.open(),
      onPlaySound: (soundId) => {
        features.soundboard?.manager.playSound(soundId);
        const data = { type: 'SOUNDBOARD_PLAY', soundId, senderName: 'Streamer' };
        streamerState.connectedViewers.forEach((conn, peerId) => {
          if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) conn.send(data);
        });
      },
      onSendReaction: (emoji) => {
        const data = { type: 'EMOJI_REACTION', emoji, senderName: 'Streamer' };
        features.reactions?.manager.spawnReaction(data);
        streamerState.connectedViewers.forEach((conn, peerId) => {
          if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) conn.send(data);
        });
      },
      onPlayCustomSound: (sound) => {
        features.soundboard?.manager.playCustomSound(sound);
        const data = { type: 'SOUNDBOARD_PLAY_CUSTOM', ...sound, senderName: 'Streamer' };
        streamerState.connectedViewers.forEach((conn, peerId) => {
          if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) conn.send(data);
        });
      }
    });
    discordUI.init();
    session.registerCleanup(() => discordUI.destroy());
  }

  initTermsModal(() => {
    initStreamerPeer(options.customId || null, session);
  });

  return {
    isStreamer: true,
    session,
    dispose: () => {
      stopCapture(session);
      if (streamerState.peer && !streamerState.peer.destroyed) {
        try { streamerState.peer.destroy(); } catch (e) {}
      }
      streamerState.peer = null;
      streamerState.connectedViewers.clear();
      streamerState.activeCalls.clear();
      if (streamerState.session === session) streamerState.session = null;
      voiceManager.leaveVoice();
      session.dispose();
    },
    startCapture: (sourceId, captureOptions) => startCapture(sourceId, captureOptions, session),
    stopCapture: () => stopCapture(session),
    setQualityProfile,
    setStreamerPin,
    getStreamerPin,
    state: streamerState
  };
}

// Auto-inicialização somente quando carregado como entrypoint direto da página
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const isStreamer = window.location && window.location.pathname.endsWith('streamer.html');
  const isDirectEntry = Boolean(document.querySelector?.('script[src*="streamer-entry"]'));
  if (isStreamer && isDirectEntry && !window.__SEEMYGAME_BOOTSTRAPPED__) {
    window.__SEEMYGAME_BOOTSTRAPPED__ = 'streamer';
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => initStreamerApp());
    } else {
      initStreamerApp();
    }
  }
}
