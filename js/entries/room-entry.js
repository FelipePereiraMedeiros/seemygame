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
import { p2pDispatcher } from '../core/message-dispatcher.js';
import { pluginManager } from '../core/plugin-manager.js';
import { 
  whiteboardPlugin, 
  soundboardPlugin, 
  tacticalPingPlugin, 
  reactionsPlugin, 
  clippingPlugin 
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
  isTreeRelayEnabled: true
};

/**
 * Extrai informações da sala (ID e PIN) a partir do hash da URL (#room=resenha&pin=1234)
 */
export function getRoomInfoFromUrl() {
  if (typeof window === 'undefined' || !window.location) {
    return { roomId: 'general', roomPin: null };
  }
  const hash = window.location.hash || '';
  const match = hash.match(/room=([a-zA-Z0-9_-]+)/);
  const roomId = match ? sanitizeRoomId(match[1]) : 'general';

  const pinMatch = hash.match(/pin=([0-9]{4,8})/);
  const roomPin = pinMatch ? pinMatch[1] : null;

  return { roomId, roomPin };
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
export async function setupRoomSession(peerId) {
  const { roomId, roomPin } = getRoomInfoFromUrl();
  roomState.currentRoomId = roomId;
  roomState.currentPin = roomPin;

  // Instancia o RoomManager para a sala indicada
  const rm = new RoomManager(roomState.peer, roomId, roomState.userName, {
    pin: roomPin
  });
  roomState.roomManager = rm;

  // Instancia RelayManager para escalabilidade em árvore
  roomState.relayManager = new RelayManager(roomState.peer, {
    maxDirectViewers: 8
  });

  // Vincula o VoiceManager à sala
  if (voiceManager) {
    voiceManager.init(roomState.peer);
  }

  // Vincula controlador de UI Discord
  if (typeof DiscordUIController !== 'undefined') {
    roomState.discordUI = new DiscordUIController({
      chatManager,
      voiceManager,
      roomManager: rm
    });
    roomState.discordUI.init();
  }

  // Inicia o processo de ingresso na sala P2P
  await rm.join();
  showToast(`Você entrou na sala #${roomId}!`, 'success');
  globalBus.emit('room:joined', { roomId, peerId });
}

/**
 * Inicializa a aplicação completa de Room.
 */
export async function initRoomApp(options = {}) {
  // Registra todos os plugins com clipping ativado
  try {
    pluginManager.register(whiteboardPlugin);
    pluginManager.register(soundboardPlugin);
    pluginManager.register(tacticalPingPlugin);
    pluginManager.register(reactionsPlugin);
    pluginManager.register(clippingPlugin);
    pluginManager.initAll({
      eventBus: globalBus,
      p2pDispatcher: p2pDispatcher,
      role: 'room'
    });
  } catch (err) {
    console.warn('[Room] Falha ao registrar plugins:', err);
  }

  // Prepara PeerJS
  await fetchIceServersFromApi().catch(() => {});
  const config = getPeerConfig();

  const startRoomFlow = () => {
    initGreenRoomLobby(() => {
      const peer = new Peer(config);
      roomState.peer = peer;

      peer.on('open', (id) => {
        console.log(`[Room] Peer registrado com ID: ${id}`);
        setupRoomSession(id);
      });

      peer.on('error', (err) => {
        console.error('[Room] Erro no Peer:', err);
        showToast('Erro de conexão ao servidor de sinalização.', 'error');
      });
    });
  };

  initTermsModal(startRoomFlow);

  return {
    isRoom: true,
    state: roomState,
    getRoomInfo: getRoomInfoFromUrl
  };
}

// Auto-inicialização quando executado diretamente em room.html
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const isRoom = window.location && window.location.pathname.endsWith('room.html');
  if (isRoom) {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => initRoomApp());
    } else {
      initRoomApp();
    }
  }
}
