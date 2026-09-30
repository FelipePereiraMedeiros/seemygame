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
import { 
  createWhiteboardPlugin,
  createSoundboardPlugin,
  createTacticalPingPlugin,
  createReactionsPlugin,
  createClippingPlugin
} from '../plugins/index.js';

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
  session: null
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

  const isMaster = Boolean(roomState.peer?.id && roomKey && roomState.peer.id.endsWith('_host'));

  // Instancia o RoomManager para a sala indicada com o contrato real de objeto de opções
  const rm = new RoomManager({
    roomId,
    userName: roomState.userName,
    clientSessionId: peerId,
    roomPin,
    roomKey
  });
  roomState.roomManager = rm;

  // Instancia RelayManager para escalabilidade em árvore
  roomState.relayManager = new RelayManager({
    originPeerId: isMaster ? peerId : null,
    maxDirectViewers: 8
  });

  // Vincula controlador de UI Discord
  if (typeof DiscordUIController !== 'undefined') {
    roomState.discordUI = new DiscordUIController({
      chatManager,
      voiceManager,
      roomManager: rm,
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
        if (voiceManager) {
          voiceManager.joinVoice({ peerId, name: roomState.userName });
        }
      },
      onLeaveVoice: () => {
        if (voiceManager) {
          voiceManager.leaveVoice();
        }
      }
    });
    roomState.discordUI.init();
  }

  // Inicia o processo de ingresso na sala P2P
  const joined = await rm.join(peerId, isMaster);
  if (joined !== false) {
    showToast(`Você entrou na sala #${roomId}!`, 'success');
    (session?.eventBus || globalBus).emit('room:joined', { roomId, peerId });
  }
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

  return new Promise((resolve, reject) => {
    const peer = customId ? new Peer(customId, config) : new Peer(config);
    roomState.peer = peer;

    peer.on('open', (id) => {
      console.log(`[Room] Peer registrado com ID: ${id}`);
      resolve(peer);
    });

    peer.on('error', (err) => {
      console.error('[Room] Erro no Peer:', err);
      showToast('Erro de conexão ao servidor de sinalização.', 'error');
      reject(err);
    });
  });
}

/**
 * Inicializa a aplicação completa de Room.
 */
export async function initRoomApp(options = {}) {
  const session = createSessionContext({
    role: 'room',
    eventBus: options.eventBus,
    messageDispatcher: options.messageDispatcher,
    pluginManager: options.pluginManager,
    initialState: roomState
  });
  roomState.session = session;

  // Registra todos os plugins com clipping ativado
  try {
    session.pluginManager.register(createWhiteboardPlugin());
    session.pluginManager.register(createSoundboardPlugin());
    session.pluginManager.register(createTacticalPingPlugin());
    session.pluginManager.register(createReactionsPlugin());
    session.pluginManager.register(createClippingPlugin());
    session.pluginManager.initAll({
      eventBus: session.eventBus,
      p2pDispatcher: session.dispatcher,
      role: 'room'
    });
  } catch (err) {
    console.warn('[Room] Falha ao registrar plugins:', err);
  }

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
