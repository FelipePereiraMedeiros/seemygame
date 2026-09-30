import { bindSourcePicker } from '../capture/source-picker.js';
import { installNativeCaptureBridge } from '../native-webrtc.js';
import { sendSessionMessage } from '../protocol/transport.js';
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
import { createCoopController } from '../coop/controller.js';
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
import { ChatManager } from '../chat.js';
import { VoiceManager } from '../voice.js';
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

/** Creates a runtime whose state and resource lifetime belong to one session. */
export function createStreamerSession(options = {}) {
const statsScope = createStatsMonitorScope();
const { startStatsMonitor, stopStatsMonitor, getLastMetrics } = statsScope;
const coopController = options.coopController || createCoopController();
const {  
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
 } = coopController;
const chatManager = options.chatManager || new ChatManager();
let audioScope = null;
const voiceManager = options.voiceManager || new VoiceManager({ audioContextProvider: () => audioScope?.getContext() });
const instanceKey = Symbol('streamer-entry');

const isStreamerPage = true;

const isHost = true;

const streamerState = {
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

const connectedViewers = streamerState.connectedViewers;

function setStreamerPin(pin) {
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

function getStreamerPin() {
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

async function initStreamerPeer(customId = null, session = streamerState.session) {
  if (typeof Peer === 'undefined') {
    throw new Error('PeerJS não está carregado no escopo global.');
  }

  await fetchIceServersFromApi().catch(() => {});
  if (session?.isDisposed) throw new DOMException("Session disposed", "AbortError");
  const config = getPeerConfig();

  return new Promise((resolve, reject) => {
    const idToUse = customId || streamerState.customId;
    const peer = idToUse ? new Peer(idToUse, config) : new Peer(config);
    streamerState.peer = peer;
    session?.registerCleanup(() => peer.destroy());
    session?.signal.addEventListener('abort', () => reject(new DOMException('Session disposed', 'AbortError')), { once: true });

    peer.on('open', (id) => {
      if (session?.isDisposed) { peer.destroy(); return; }
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

function handleViewerConnection(conn, session = streamerState.session) {
  const viewerId = conn.peer;

  conn.on('open', () => {
    streamerState.connectedViewers.set(viewerId, conn);
    console.log(`[Streamer] Espectador conectado: ${viewerId}`);

    getStreamerPin();

    if (streamerState.admissionGate.roomPin) {
      // Sala com PIN: solicita autenticação antes de liberar áudio/vídeo
      sendSessionMessage(streamerState.session, conn, { type: PROTOCOL_TYPES.ADMISSION.PIN_REQUIRED });
    } else {
      // Sala sem PIN: autoriza imediatamente
      streamerState.admissionGate.authenticate(viewerId);
      notifyViewerVoiceState(conn, viewerId);
      if (streamerState.localStream) {
        callViewerWithStream(viewerId, session);
        sendSessionMessage(streamerState.session, conn, { type: PROTOCOL_TYPES.MEDIA.STREAM_STATUS, isStreaming: true });
      } else {
        sendSessionMessage(streamerState.session, conn, { type: PROTOCOL_TYPES.MEDIA.STREAM_STATUS, isStreaming: false });
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
          sendSessionMessage(streamerState.session, conn, { type: PROTOCOL_TYPES.ADMISSION.PIN_ACCEPTED });
          if (streamerState.localStream) {
            callViewerWithStream(viewerId, session);
            sendSessionMessage(streamerState.session, conn, { type: PROTOCOL_TYPES.MEDIA.STREAM_STATUS, isStreaming: true });
          } else {
            sendSessionMessage(streamerState.session, conn, { type: PROTOCOL_TYPES.MEDIA.STREAM_STATUS, isStreaming: false });
          }
          showToast(`Amigo (${viewerId.slice(0, 6)}) autenticou com PIN.`, 'success');
        } else {
          sendSessionMessage(streamerState.session, conn, {
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
          sendSessionMessage(streamerState.session, conn, { type: PROTOCOL_TYPES.MEDIA.STREAM_STATUS, isStreaming: true });
        } else {
          sendSessionMessage(streamerState.session, conn, { type: PROTOCOL_TYPES.MEDIA.STREAM_STATUS, isStreaming: false });
        }
        return;
      }
    }

    // Se o espectador não estiver autenticado pelo AdmissionGate, bloqueia tráfego de dados
    if (!streamerState.admissionGate.isAuthenticated(viewerId)) {
      sendSessionMessage(streamerState.session, conn, {
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
  sendSessionMessage(streamerState.session, conn, {
    type: 'VOICE_SIGNAL',
    action: 'HOST_VOICE_ACTIVE',
    peerId: streamerState.streamerId,
    name: 'Streamer',
    role: 'host'
  });
  streamerState.messageHandlers?.connectVoiceTo(viewerId);
}

function callViewerWithStream(viewerId, session = streamerState.session) {
  if (!streamerState.peer || !streamerState.localStream) return null;
  if (!streamerState.admissionGate.isAuthenticated(viewerId)) {
    console.warn(`[Streamer] Chamada de mídia bloqueada: peer ${viewerId} não autenticado.`);
    return null;
  }

  const dataConnection = streamerState.connectedViewers.get(viewerId);
  if (streamerState.features?.nativeMedia.broadcastTo(dataConnection)) return null;
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

async function startCapture(sourceId = null, captureOptions = {}, session = streamerState.session) {
  let stream = null;

  try {
    if (isDesktopApp() && sourceId) {
      // Captura de alto desempenho via Tauri / GStreamer / WGC
      streamerState.captureProvider = new NativeCaptureProvider();
      session?.registerCleanup(() => streamerState.captureProvider?.stop());
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

    if (session?.isDisposed) { stream?.getTracks().forEach(track => track.stop()); await streamerState.captureProvider?.stop(); return null; }
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

    (session?.eventBus || globalBus).emit('stream:started', { stream, sourceId: 'local-me' });
    showToast('Transmissão iniciada com sucesso!', 'success');
    return stream;
  } catch (err) {
    console.error('[Streamer] Falha ao iniciar captura:', err);
    showToast('Não foi possível iniciar a captura de tela.', 'error');
    throw err;
  }
}

function stopCapture(session = streamerState.session) {
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

function updateViewerCount() {
  const countEl = document.getElementById('viewer-count');
  if (countEl) {
    const total = streamerState.connectedViewers.size;
    countEl.textContent = `${total} espectador${total !== 1 ? 'es' : ''}`;
  }
}

function updateStreamerUI(id) {
  const badgeEl = document.getElementById('copy-badge');
  if (badgeEl) badgeEl.textContent = id;

  const shareBtn = document.getElementById('share-link-btn');
  if (shareBtn) shareBtn.style.display = 'inline-flex';
  const streamBtn = document.getElementById('stream-btn');
  if (streamBtn) streamBtn.disabled = false;
}

function setQualityProfile(profileName) {
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

async function initStreamerApp(options = {}) {
  const session = createSessionContext({
    role: 'streamer',
    exclusiveKey: instanceKey,
    eventBus: options.eventBus,
    messageDispatcher: options.messageDispatcher,
    pluginManager: options.pluginManager,
    initialState: streamerState
  });
  streamerState.session = session;
  session.getPeerId = () => streamerState.peer?.id;
  audioScope = session.audioScope;
  session.services = { chatManager, voiceManager, coopController, statsScope };
  session.registerCleanup(() => statsScope.dispose());
  installNativeCaptureBridge();
  const sourcePicker = bindSourcePicker(session, {
    start: captureOptions => startCapture(captureOptions.sourceId, captureOptions, session),
    stop: () => stopCapture(session), isStreaming: () => Boolean(streamerState.localStream), showToast
  });
  session.registerCleanup(() => voiceManager.leaveVoice());
  session.registerCleanup(() => coopController.dispose());

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
        if (peerId !== excludePeerId && conn.open && streamerState.admissionGate.isAuthenticated(peerId)) sendSessionMessage(streamerState.session, conn, data);
      });
    }
  });
  const messageHandlers = bindSessionMessageHandlers(session, { coopController,
    role: 'streamer',
    chatManager,
    voiceManager,
    getPeer: () => streamerState.peer,
    getLocalPeerId: () => streamerState.streamerId,
    showToast,
    broadcast: (data, excludePeerId) => {
      streamerState.connectedViewers.forEach((conn, peerId) => {
        if (peerId !== excludePeerId && conn.open && streamerState.admissionGate.isAuthenticated(peerId)) sendSessionMessage(streamerState.session, conn, data);
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
    const onStreamClick = () => sourcePicker.toggle().catch(error => showToast(error.message, 'error'));
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
              sendSessionMessage(streamerState.session, conn, { type: PROTOCOL_TYPES.COMMUNICATION.CHAT_MESSAGE, message: stored });
            }
          }
        }
      },
      onJoinVoice: async () => {
        try {
          const stream = await voiceManager.joinVoice({ peerId: streamerState.streamerId, name: 'Streamer', role: 'host' });
          const payload = { type: 'VOICE_SIGNAL', action: 'HOST_VOICE_ACTIVE', peerId: streamerState.streamerId, name: 'Streamer', role: 'host' };
          streamerState.connectedViewers.forEach((conn, peerId) => {
            if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) sendSessionMessage(streamerState.session, conn, payload);
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
          if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) sendSessionMessage(streamerState.session, conn, { type: 'VOICE_SIGNAL', action: 'LEAVE', peerId: streamerState.streamerId });
        });
      },
      onToggleMic: (isMuted) => {
        const data = { type: 'VOICE_STATE_UPDATE', peerId: streamerState.streamerId, isMuted };
        streamerState.connectedViewers.forEach((conn, peerId) => {
          if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) sendSessionMessage(streamerState.session, conn, data);
        });
      },
      onToggleDeaf: (isDeafened) => {
        const data = { type: 'VOICE_STATE_UPDATE', peerId: streamerState.streamerId, isDeafened };
        streamerState.connectedViewers.forEach((conn, peerId) => {
          if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) sendSessionMessage(streamerState.session, conn, data);
        });
      },
      onToggleStream: () => sourcePicker.toggle(),
      onOpenTuning: () => { const modal = document.getElementById('tuning-modal'); if (modal) modal.style.display = 'flex'; },
      onOpenWhiteboard: () => features.whiteboardUI?.open(),
      onPlaySound: (soundId) => {
        features.soundboard?.manager.playSound(soundId);
        const data = { type: 'SOUNDBOARD_PLAY', soundId, senderName: 'Streamer' };
        streamerState.connectedViewers.forEach((conn, peerId) => {
          if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) sendSessionMessage(streamerState.session, conn, data);
        });
      },
      onSendReaction: (emoji) => {
        const data = { type: 'EMOJI_REACTION', emoji, senderName: 'Streamer' };
        features.reactions?.manager.spawnReaction(data);
        streamerState.connectedViewers.forEach((conn, peerId) => {
          if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) sendSessionMessage(streamerState.session, conn, data);
        });
      },
      onPlayCustomSound: (sound) => {
        features.soundboard?.manager.playCustomSound(sound);
        const data = { type: 'SOUNDBOARD_PLAY_CUSTOM', ...sound, senderName: 'Streamer' };
        streamerState.connectedViewers.forEach((conn, peerId) => {
          if (conn.open && streamerState.admissionGate.isAuthenticated(peerId)) sendSessionMessage(streamerState.session, conn, data);
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
    startCapture: (sourceId, captureOptions) => typeof sourceId === 'object' ? startCapture(sourceId.sourceId, sourceId, session) : startCapture(sourceId, captureOptions, session),
    stopCapture: () => stopCapture(session),
    setQualityProfile,
    setStreamerPin,
    getStreamerPin,
    state: streamerState
  };
}
return {
get isStreamerPage() { return isStreamerPage; },
get isHost() { return isHost; },
get streamerState() { return streamerState; },
get connectedViewers() { return connectedViewers; },
setStreamerPin,
getStreamerPin,
initStreamerPeer,
callViewerWithStream,
startCapture,
stopCapture,
setQualityProfile,
initStreamerApp
};
}
