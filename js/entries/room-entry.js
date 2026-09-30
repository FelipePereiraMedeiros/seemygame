/**
 * SeeMyGame - Dedicated Room Entrypoint (Paradigma Discord / Mesh Room)
 * Gerencia sessões multi-usuário completas com:
 * 1. Topologia Full-Mesh e Árvore de Relay (Tree Mesh)
 * 2. Transmissão e recepção simultânea de vídeo em grade dinâmica
 * 3. Chat de voz Full-Mesh com cancelamento de eco e detecção VAD
 * 4. Canais de texto e UI estilo Discord (Sidebar, Stage e Dock)
 * 5. Registro e orquestração de plugins autônomos
 * 6. Pré-sala de entrada (Green Room) para checagem de microfone e fone
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
  RoomManager, 
  sanitizeRoomId, 
  getRoomMasterPeerId 
} from '../room.js';
import { 
  RelayManager 
} from '../relay.js';
import { 
  voiceManager 
} from '../voice.js';
import { 
  chatManager 
} from '../chat.js';
import { 
  DiscordUIController 
} from '../discord-ui.js';
import { 
  getAudioDevices, 
  populateDeviceSelect, 
  playTestTone, 
  isAudioOutputSupported 
} from '../audio-devices.js';
import { 
  showToast, 
  initTermsModal, 
  addOrUpdateVideoCard, 
  removeVideoCard 
} from '../ui.js';
import { globalBus } from '../core/event-bus.js';
import { createSessionContext } from '../core/session-context.js';
import { bindSessionMessageHandlers } from '../protocol/session-handlers.js';
import { registerSessionFeatures } from '../plugins/session-composition.js';
import { setupGamepadTesterModal } from '../coop.js';

export const isRoomPage = true;

// Estado central da sala
export const roomState = {
  peer: null,
  roomManager: null,
  relayManager: null,
  discordUI: null,
  currentRoomId: 'general',
  currentPin: null,
  userName: 'Gamer',
  isTreeRelayEnabled: true,
  session: null,
  coordinatorConn: null,
  localStream: null,
  screenCalls: new Map(),
  messageHandlers: null
};

/**
 * Extrai informações da sala (ID, PIN e roomKey) a partir do hash e query da URL
 */
export function getRoomInfoFromUrl() {
  if (typeof window === 'undefined' || !window.location) {
    return { roomId: 'general', roomPin: null, roomKey: null };
  }
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  const full = `${search}&${hash.replace(/^#/, '')}`;

  const match = hash.match(/room=([a-zA-Z0-9_-]+)/) || search.match(/room=([a-zA-Z0-9_-]+)/);
  const roomId = match ? sanitizeRoomId(match[1]) : 'general';

  const pinMatch = full.match(/pin=([0-9]{4,8})/);
  const roomPin = pinMatch ? pinMatch[1] : null;

  const keyMatch = full.match(/key=([A-Za-z0-9_-]{16,128})/);
  const roomKey = keyMatch ? keyMatch[1] : null;

  return { roomId, roomPin, roomKey };
}

/**
 * Inicializa a modal do Green Room (pré-sala) com seleção e teste de áudio.
 */
export async function initGreenRoomLobby(onProceed) {
  const greenRoomModal = document.getElementById('green-room-modal');
  if (greenRoomModal) {
    greenRoomModal.style.display = 'flex';
  }

  const info = getRoomInfoFromUrl();
  const idLabel = document.getElementById('green-room-id-label');
  if (idLabel && info?.roomId) {
    idLabel.textContent = `#${info.roomId}`;
  }

  const joinBtn = document.getElementById('green-room-join-btn');
  const nameInput = document.getElementById('green-room-user-name');
  if (nameInput) {
    const savedName = typeof localStorage !== 'undefined' ? localStorage.getItem('seemygame_user_name') : null;
    if (savedName && !nameInput.value) nameInput.value = savedName;
  }

  const micSelect = document.getElementById('green-room-mic-select');
  const speakerSelect = document.getElementById('green-room-speaker-select');
  const testSpeakerBtn = document.getElementById('green-room-test-speaker-btn');
  const vuBar = document.getElementById('green-room-vu-bar');

  // Popula microfones e alto-falantes
  try {
    const { microphones, speakers } = await getAudioDevices();
    if (micSelect && microphones.length > 0) populateDeviceSelect(micSelect, microphones);
    if (speakerSelect && speakers.length > 0 && isAudioOutputSupported()) populateDeviceSelect(speakerSelect, speakers);
  } catch (err) {
    console.warn('[Room GreenRoom] Dispositivos de áudio:', err);
  }

  if (testSpeakerBtn && isAudioOutputSupported()) {
    testSpeakerBtn.onclick = async () => {
      const selectedSinkId = speakerSelect ? speakerSelect.value : '';
      try {
        await playTestTone(selectedSinkId);
      } catch (e) {
        console.warn('[Room GreenRoom] Erro no teste de áudio:', e);
      }
    };
  }

  if (joinBtn) {
    joinBtn.onclick = () => {
      if (nameInput && nameInput.value.trim() && typeof localStorage !== 'undefined') {
        localStorage.setItem('seemygame_user_name', nameInput.value.trim());
        roomState.userName = nameInput.value.trim();
      }
      if (greenRoomModal) {
        greenRoomModal.style.display = 'none';
      }
      if (typeof onProceed === 'function') {
        onProceed();
      }
    };
  }
}

/**
 * Inicializa a sessão completa da sala no PeerJS e conecta à rede Mesh.
 */
export async function setupRoomSession(peerId, session = roomState.session) {
  const { roomId, roomPin, roomKey } = getRoomInfoFromUrl();
  roomState.currentRoomId = roomId;
  roomState.currentPin = roomPin;
  roomState.currentKey = roomKey;

  const coordinatorId = getRoomMasterPeerId(roomId, roomKey);
  const isMaster = peerId === coordinatorId;

  // Instancia o RoomManager para a sala indicada com o contrato real de objeto de opções
  const rm = new RoomManager({
    roomId,
    userName: roomState.userName,
    clientSessionId: session?.sessionId || peerId,
    roomPin,
    roomKey
  });
  roomState.roomManager = rm;
  const submitPinBtn = document.getElementById('viewer-pin-submit-btn');
  const cancelPinBtn = document.getElementById('viewer-pin-cancel-btn');
  const pinInput = document.getElementById('viewer-pin-input');
  const submitPin = () => {
    const pin = String(pinInput?.value || '').trim();
    if (!/^[0-9]{4,8}$/.test(pin)) {
      const error = document.getElementById('viewer-pin-error');
      if (error) { error.textContent = 'Digite um PIN de 4 a 8 números.'; error.style.display = 'block'; }
      return;
    }
    roomState.currentPin = pin;
    joinCoordinator(pin);
  };
  if (submitPinBtn) {
    submitPinBtn.addEventListener('click', submitPin);
    session?.registerCleanup(() => submitPinBtn.removeEventListener('click', submitPin));
  }
  if (pinInput) {
    const onPinKey = (event) => { if (event.key === 'Enter') { event.preventDefault(); submitPin(); } };
    pinInput.addEventListener('keydown', onPinKey);
    session?.registerCleanup(() => pinInput.removeEventListener('keydown', onPinKey));
  }
  if (cancelPinBtn) {
    const onCancel = () => { const modal = document.getElementById('pin-prompt-modal'); if (modal) modal.style.display = 'none'; };
    cancelPinBtn.addEventListener('click', onCancel);
    session?.registerCleanup(() => cancelPinBtn.removeEventListener('click', onCancel));
  }

  // Instancia RelayManager para escalabilidade em árvore
  roomState.relayManager = new RelayManager({
    originPeerId: isMaster ? peerId : null,
    maxDirectViewers: 8
  });

  // Conecta eventos do RoomManager à UI e ao barramento da sessão
  rm.on('streamPublished', ({ peerId: streamerPeerId, details, member }) => {
    if (streamerPeerId !== rm.myPeerId) {
      showToast(`🎮 ${member?.name || 'Um amigo'} começou a transmitir!`, 'info', 4000);
      (session?.eventBus || globalBus).emit('room:streamPublished', { peerId: streamerPeerId, details, member });
    }
  });

  rm.on('streamUnpublished', ({ peerId: streamerPeerId, member }) => {
    if (streamerPeerId !== rm.myPeerId) {
      showToast(`Transmissão de ${member?.name || streamerPeerId.slice(0, 6)} encerrada.`, 'info');
      removeVideoCard(streamerPeerId);
      (session?.eventBus || globalBus).emit('room:streamUnpublished', { peerId: streamerPeerId, member });
    }
  });

  rm.on('pinRequired', ({ error }) => {
    const promptModal = document.getElementById('pin-prompt-modal');
    const errEl = document.getElementById('viewer-pin-error');
    if (promptModal) promptModal.style.display = 'flex';
    if (errEl && error) {
      errEl.textContent = error;
      errEl.style.display = 'block';
    }
    (session?.eventBus || globalBus).emit('room:pinRequired', { error });
  });

  rm.on('pinAccepted', () => {
    const promptModal = document.getElementById('pin-prompt-modal');
    if (promptModal) promptModal.style.display = 'none';
    showToast('Entrada na sala autorizada!', 'success');
    (session?.eventBus || globalBus).emit('room:pinAccepted');
  });

  rm.on('memberLeft', (member) => {
    if (member && member.peerId) {
      removeVideoCard(member.peerId);
      (session?.eventBus || globalBus).emit('room:memberLeft', member);
    }
  });

  const connectMeshMembers = () => {
    if (!roomState.peer || roomState.peer.destroyed || !rm.isInRoom || rm.isMaster) return;
    for (const member of rm.members.values()) {
      if (member.peerId === rm.myPeerId || member.peerId === rm.masterPeerId || member.isMaster) continue;
      if (rm.myPeerId.localeCompare(member.peerId) >= 0) continue;
      if (rm.meshConnections.get(member.peerId)?.open || rm.pendingConnections.get(member.peerId)?.open) continue;
      const conn = roomState.peer.connect(member.peerId, { reliable: true, metadata: { type: 'ROOM_MESH', roomId } });
      if (conn) attachRoomDataConnection(conn, rm, session, { authenticateMember: true });
    }
  };
  rm.on('membersUpdated', connectMeshMembers);

  const joinCoordinator = (pin = roomPin) => {
    if (rm.isMaster || !roomState.peer || roomState.peer.destroyed) return null;
    if (roomState.coordinatorConn && roomState.coordinatorConn.open) {
      try { roomState.coordinatorConn.close(); } catch (_) {}
    }
    const conn = roomState.peer.connect(rm.masterPeerId, {
      reliable: true,
      metadata: { type: 'ROOM_JOIN', roomId: rm.roomId }
    });
    roomState.coordinatorConn = conn;
    attachRoomDataConnection(conn, rm, session, { requestAdmission: true, pin });
    return conn;
  };
  roomState.requestRoomJoin = joinCoordinator;

  // Vincula controlador de UI Discord
  if (typeof DiscordUIController !== 'undefined') {
    roomState.discordUI = new DiscordUIController({
      chatManager,
      voiceManager,
      roomManager: rm,
      soundboardManager: roomState.session?.pluginManager.get('soundboard')?.manager,
      onOpenTuning: () => {
        const modal = document.getElementById('tuning-modal');
        if (modal) modal.style.display = 'flex';
      },
      onSendMessage: (text) => {
        if (chatManager) {
          const msg = chatManager.createMessage({
            senderId: rm.myPeerId || peerId,
            senderName: rm.userName || roomState.userName,
            role: rm.isMaster ? 'host' : 'viewer',
            text,
            channel: chatManager.getActiveChannel()
          });
          const storedMessage = msg && chatManager.addMessage(msg);
          if (storedMessage) {
            rm.broadcast({ type: 'CHAT_MESSAGE', message: storedMessage });
          }
        }
      },
      onJoinVoice: () => {
        joinRoomVoice(rm, session);
      },
      onLeaveVoice: () => {
        leaveRoomVoice(rm, session);
      },
      onToggleMic: (isMuted) => rm.setLocalVoiceState({ isMuted }),
      onToggleDeaf: (isDeafened) => rm.setLocalVoiceState({ isDeafened }),
      onOpenWhiteboard: () => roomState.features?.whiteboardUI?.open(),
      onPlaySound: (soundId) => {
        roomState.session?.pluginManager.get('soundboard')?.manager.playSound(soundId);
        rm.broadcast({ type: 'SOUNDBOARD_PLAY', soundId, senderName: roomState.userName });
      },
      onPlayCustomSound: (sound) => {
        roomState.features?.soundboard?.manager.playCustomSound(sound);
        rm.broadcast({ type: 'SOUNDBOARD_PLAY_CUSTOM', ...sound, senderName: rm.userName });
      },
      onSendReaction: (emoji) => {
        const data = { type: 'EMOJI_REACTION', emoji, senderName: roomState.userName };
        roomState.session?.pluginManager.get('reactions')?.manager.spawnReaction(data);
        rm.broadcast(data);
      },
      onToggleStream: () => roomState.localStream ? stopRoomCapture(rm, session) : startRoomCapture(rm, session),
      onLeaveRoom: () => {
        leaveRoomVoice(rm, session);
        rm.leave();
        try { roomState.peer?.destroy(); } catch (_) {}
      }
    });
    roomState.discordUI.init();
  }

  // Inicia o processo de ingresso na sala P2P
  const joined = await rm.join(peerId, isMaster);
  if (joined !== false) {
    roomState.peer.on('connection', (conn) => {
      attachRoomDataConnection(conn, rm, session);
    });
    roomState.peer.on('call', (call) => handleRoomMediaCall(call, rm, session));
    if (isMaster) {
      connectMeshMembers();
    } else {
      joinCoordinator(roomPin);
    }
    showToast(`Você entrou na sala #${roomId}!`, 'success');
    (session?.eventBus || globalBus).emit('room:joined', { roomId, peerId });
  }
}

function attachRoomDataConnection(conn, rm, session, { requestAdmission = false, authenticateMember = false, pin = null } = {}) {
  if (!conn?.peer || !rm.registerConnection(conn.peer, conn)) return false;
  conn.on('open', () => {
    if (requestAdmission) {
      conn.send({
        type: 'ROOM_JOIN_REQUEST',
        roomId: rm.roomId,
        roomKey: rm.roomKey,
        pin,
        name: rm.userName,
        clientSessionId: rm.clientSessionId
      });
    } else if (authenticateMember) {
      conn.send({ type: 'ROOM_MEMBER_AUTH', roomId: rm.roomId, roomKey: rm.roomKey });
    }
  });
  conn.on('data', (message) => {
    const handled = rm.handleRoomMessage(conn.peer, message, conn);
    if (!handled) session?.dispatcher.dispatch(message, conn, roomState.peer);
  });
  conn.on('close', () => {
    if (roomState.coordinatorConn === conn) roomState.coordinatorConn = null;
    rm.removeMember(conn.peer);
  });
  conn.on('error', (error) => console.warn(`[Room] Conexão com ${conn.peer} falhou:`, error));
  return true;
}

function handleRoomMediaCall(call, rm, session) {
  if (!call || !rm.isPeerAuthorized(call.peer)) {
    try { call?.close?.(); } catch (_) {}
    return;
  }
  if (call.metadata?.type === 'VOICE_CHAT') {
    session?.messageHandlers?.answerVoiceCall(call);
    return;
  }
  call.answer();
  call.on('stream', (stream) => {
    const member = rm.members.get(call.peer);
    addOrUpdateVideoCard({ peerId: call.peer, stream, label: member?.name || `Amigo ${call.peer.slice(-4)}`, isLocal: false });
  });
  call.on('close', () => removeVideoCard(call.peer));
}

async function joinRoomVoice(rm, session) {
  if (voiceManager.isInVoice) return;
  try {
    const stream = await voiceManager.joinVoice({ peerId: rm.myPeerId, name: rm.userName, role: rm.isMaster ? 'host' : 'member' });
    rm.setLocalVoiceState({ isMuted: voiceManager.isMuted, isDeafened: voiceManager.isDeafened, isSpeaking: false });
    rm.broadcast({ type: 'VOICE_SIGNAL', action: 'VOICE_JOINED', peerId: rm.myPeerId, name: rm.userName, role: rm.isMaster ? 'host' : 'member' });
    for (const [memberId, conn] of rm.meshConnections) {
      if (!conn.open || !rm.isPeerAuthorized(memberId) || rm.myPeerId.localeCompare(memberId) >= 0) continue;
      const call = roomState.peer?.call(memberId, stream, { metadata: { type: 'VOICE_CHAT', name: rm.userName, role: rm.isMaster ? 'host' : 'member' } });
      session?.messageHandlers?.bindVoiceCall(call);
    }
  } catch (error) {
    showToast('Não foi possível acessar o microfone.', 'error');
  }
}

function leaveRoomVoice(rm, session) {
  session?.messageHandlers?.activeVoiceCalls.forEach((call) => { try { call.close(); } catch (_) {} });
  session?.messageHandlers?.activeVoiceCalls.clear();
  voiceManager.leaveVoice();
  rm.broadcast({ type: 'VOICE_SIGNAL', action: 'LEAVE', peerId: rm.myPeerId });
}

async function startRoomCapture(rm, session) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    showToast('Captura de tela não está disponível neste navegador.', 'error');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    roomState.localStream = stream;
    stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => stopRoomCapture(rm, session), { once: true }));
    addOrUpdateVideoCard({ peerId: 'local-me', stream, label: `${rm.userName} (Ao Vivo)`, isLocal: true });
    roomState.discordUI?.setStreamingState(true);
    rm.setLocalStreaming(true, { sourceType: 'display', title: 'Compartilhamento de tela' });
    for (const [memberId, conn] of rm.meshConnections) {
      if (!conn.open || !rm.isPeerAuthorized(memberId)) continue;
      const call = roomState.peer?.call(memberId, stream, { metadata: { type: 'ROOM_STREAM', name: rm.userName } });
      if (call) roomState.screenCalls.set(memberId, call);
    }
    session?.eventBus.emit('stream:started', { stream });
  } catch (error) {
    showToast('Não foi possível iniciar o compartilhamento.', 'error');
  }
}

function stopRoomCapture(rm, session) {
  if (!roomState.localStream) return;
  roomState.localStream.getTracks?.().forEach((track) => { try { track.stop(); } catch (_) {} });
  roomState.screenCalls.forEach((call) => { try { call.close(); } catch (_) {} });
  roomState.screenCalls.clear();
  roomState.localStream = null;
  removeVideoCard('local-me');
  roomState.discordUI?.setStreamingState(false);
  rm.setLocalStreaming(false);
  session?.eventBus.emit('stream:stopped');
}

/**
 * Inicializa a instância PeerJS da sala.
 */
export async function initRoomPeer(customId = null) {
  if (typeof Peer === 'undefined') {
    throw new Error('PeerJS não está carregado no escopo global.');
  }

  await fetchIceServersFromApi().catch(() => {});
  const config = getPeerConfig();
  const { roomId, roomKey } = getRoomInfoFromUrl();
  const coordinatorId = getRoomMasterPeerId(roomId, roomKey);

  const createPeer = (id, retryAsGuest) => new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, config) : new Peer(config);
    roomState.peer = peer;
    let settled = false;
    peer.on('open', (openedId) => {
      settled = true;
      console.log(`[Room] Peer registrado com ID: ${openedId}`);
      resolve(peer);
    });
    peer.on('error', (err) => {
      if (err?.type === 'unavailable-id' && retryAsGuest && !settled) {
        settled = true;
        try { peer.destroy(); } catch (_) {}
        createPeer(null, false).then(resolve, reject);
        return;
      }
      if (settled) return;
      settled = true;
      console.error('[Room] Erro no Peer:', err);
      showToast('Erro de conexão ao servidor de sinalização.', 'error');
      reject(err);
    });
  });

  if (customId) return createPeer(customId, false);
  return createPeer(coordinatorId, true);
}

/**
 * Configura os listeners dos botões de fechar e salvar do modal de configurações (#tuning-modal)
 */
export function setupTuningModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('tuning-modal');
  if (!modal) return;
  if (modal.dataset.tuningMounted === 'true') return;
  modal.dataset.tuningMounted = 'true';

  const closeBtn = document.getElementById('close-tuning-modal-btn');
  const saveBtn = document.getElementById('save-tuning-btn');

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
}

/**
 * Inicializa a aplicação completa de Room.
 */
export async function initRoomApp(options = {}) {
  const session = createSessionContext({
    role: 'room',
    exclusiveKey: 'room-entry',
    eventBus: options.eventBus,
    messageDispatcher: options.messageDispatcher,
    pluginManager: options.pluginManager,
    initialState: roomState
  });
  roomState.session = session;

  const features = registerSessionFeatures(session, {
    role: 'room',
    includeClipping: true,
    showToast,
    chatManager,
    getPeerId: () => roomState.peer?.id || 'room-member',
    getRole: () => roomState.roomManager?.isMaster ? 'host' : 'viewer',
    getDisplayName: () => roomState.userName,
    broadcastDataMessage: (data, excludePeerId) => roomState.roomManager?.broadcast(data, excludePeerId)
  });
  roomState.features = features;
  const messageHandlers = bindSessionMessageHandlers(session, {
    role: 'room',
    chatManager,
    voiceManager,
    getPeer: () => roomState.peer,
    getLocalPeerId: () => roomState.peer?.id,
    showToast,
    broadcast: (data, excludePeerId) => roomState.roomManager?.broadcast(data, excludePeerId)
  });
  roomState.messageHandlers = messageHandlers;
  session.registerCleanup(() => {
    if (roomState.messageHandlers === messageHandlers) roomState.messageHandlers = null;
    if (roomState.features === features) roomState.features = null;
    if (roomState.requestRoomJoin) roomState.requestRoomJoin = null;
  });

  // Configura modais de calibração de controle e configurações
  setupTuningModal();
  setupGamepadTesterModal();

  const startRoomFlow = () => {
    initGreenRoomLobby(async () => {
      try {
        const peer = await initRoomPeer(options.customId || null);
        await setupRoomSession(peer.id, session);
      } catch (err) {
        console.error('[Room] Falha ao inicializar peer da sala:', err);
      }
    });
  };

  initTermsModal(startRoomFlow);

  return {
    isRoom: true,
    session,
    dispose: () => {
      if (roomState.roomManager) {
        if (roomState.localStream) stopRoomCapture(roomState.roomManager, session);
        leaveRoomVoice(roomState.roomManager, session);
        try { roomState.roomManager.leave(); } catch (e) {}
      }
      if (roomState.discordUI) {
        try { roomState.discordUI.destroy(); } catch (e) {}
      }
      if (roomState.peer && !roomState.peer.destroyed) {
        try { roomState.peer.destroy(); } catch (e) {}
      }
      roomState.peer = null;
      roomState.roomManager = null;
      roomState.relayManager = null;
      roomState.discordUI = null;
      roomState.coordinatorConn = null;
      roomState.screenCalls.clear();
      if (roomState.session === session) roomState.session = null;
      session.dispose();
    },
    state: roomState,
    getRoomInfo: getRoomInfoFromUrl
  };
}

// Auto-inicialização somente quando carregado como entrypoint direto da página
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const isRoom = window.location && window.location.pathname.endsWith('room.html');
  const isDirectEntry = Boolean(document.querySelector?.('script[src*="room-entry"]'));
  if (isRoom && isDirectEntry && !window.__SEEMYGAME_BOOTSTRAPPED__) {
    window.__SEEMYGAME_BOOTSTRAPPED__ = 'room';
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => initRoomApp());
    } else {
      initRoomApp();
    }
  }
}
