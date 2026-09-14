/**
 * SeeMyGame - Gerenciador de Salas P2P (Room-First Architecture)
 * 
 * Permite que múltiplos participantes entrem na mesma sala (Full Mesh P2P),
 * compartilhem presença, chat de voz e transmitam telas sob demanda.
 */

import { isValidPeerId } from './ui.js';

export const ROOM_PREFIX = 'smg_room_';
export const MASTER_SUFFIX = '_host';

/**
 * Sanitiza o ID da sala para garantir caracteres seguros
 * @param {string} rawId 
 * @returns {string}
 */
export function sanitizeRoomId(rawId) {
  if (!rawId || typeof rawId !== 'string') return 'general';
  const clean = rawId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
  return clean.slice(0, 32) || 'general';
}

/**
 * Gera o Peer ID fixo do Coordenador/Master da sala
 * @param {string} roomId 
 * @returns {string}
 */
export function getRoomMasterPeerId(roomId) {
  const sanitized = sanitizeRoomId(roomId);
  return `${ROOM_PREFIX}${sanitized}${MASTER_SUFFIX}`;
}

export class RoomManager {
  constructor({ roomId = 'general', userName = 'Amigo', roomPin = null, onStateChange } = {}) {
    this.roomId = sanitizeRoomId(roomId);
    this.userName = String(userName || 'Amigo').trim().slice(0, 30);
    this.roomPin = roomPin ? String(roomPin).trim() : null;
    this.onStateChange = onStateChange || (() => {});

    this.isMaster = false;
    this.isInRoom = false;
    this.myPeerId = null;

    // Estado local da transmissão
    this.localStreamingState = {
      isStreaming: false,
      title: 'Jogo / Tela',
      preset: 'ultra',
      fps: 60,
      height: 1080,
      audioMode: 'system'
    };

    // Mapa de membros: peerId -> { peerId, name, isMaster, isMuted, isSpeaking, isDeafened, isStreaming, streamDetails, joinedAt }
    this.members = new Map();

    // Conexões de dados ativas na malha: peerId -> DataConnection
    this.meshConnections = new Map();

    // Callbacks de eventos
    this.listeners = {
      memberJoined: new Set(),
      memberLeft: new Set(),
      membersUpdated: new Set(),
      streamPublished: new Set(),
      streamUnpublished: new Set(),
      roomClosed: new Set(),
      pinRequired: new Set()
    };
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].add(callback);
    }
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => {
        try { cb(data); } catch (err) { console.error(`[RoomManager] Erro no listener ${event}:`, err); }
      });
    }
  }

  /**
   * Inicializa a entrada na sala com o Peer ID do usuário
   * @param {string} peerId 
   * @param {boolean} [isMaster=false] 
   */
  join(peerId, isMaster = false) {
    this.myPeerId = peerId;
    this.isMaster = isMaster;
    this.isInRoom = true;

    // Adiciona a si mesmo na lista de membros
    const selfMember = {
      peerId: this.myPeerId,
      name: this.userName,
      isMaster: this.isMaster,
      isMuted: false,
      isDeafened: false,
      isSpeaking: false,
      isStreaming: this.localStreamingState.isStreaming,
      streamDetails: this.localStreamingState.isStreaming ? { ...this.localStreamingState } : null,
      joinedAt: Date.now()
    };

    this.members.set(this.myPeerId, selfMember);
    this.emit('membersUpdated', this.getMembersList());
    this.notifyState();
  }

  /**
   * Registra uma conexão DataConnection estabelecida com outro membro da sala
   * @param {string} peerId 
   * @param {Object} conn 
   * @param {Object} [initialInfo] 
   */
  registerConnection(peerId, conn, initialInfo = {}) {
    if (!peerId || peerId === this.myPeerId) return;

    this.meshConnections.set(peerId, conn);

    if (!this.members.has(peerId)) {
      const newMember = {
        peerId,
        name: initialInfo.name || `Amigo ${peerId.slice(-4)}`,
        isMaster: Boolean(initialInfo.isMaster),
        isMuted: Boolean(initialInfo.isMuted),
        isDeafened: Boolean(initialInfo.isDeafened),
        isSpeaking: false,
        isStreaming: Boolean(initialInfo.isStreaming),
        streamDetails: initialInfo.streamDetails || null,
        joinedAt: initialInfo.joinedAt || Date.now()
      };
      this.members.set(peerId, newMember);
      this.emit('memberJoined', newMember);
      this.emit('membersUpdated', this.getMembersList());
      this.notifyState();
    }
  }

  /**
   * Remove conexão e membro da sala
   * @param {string} peerId 
   */
  removeMember(peerId) {
    if (!peerId) return;

    this.meshConnections.delete(peerId);
    if (this.members.has(peerId)) {
      const removed = this.members.get(peerId);
      this.members.delete(peerId);
      this.emit('memberLeft', removed);

      if (removed.isStreaming) {
        this.emit('streamUnpublished', { peerId });
      }

      this.emit('membersUpdated', this.getMembersList());
      this.notifyState();
    }
  }

  /**
   * Processa mensagens de protocolo da sala recebidas via DataConnection
   * @param {string} senderPeerId 
   * @param {Object} message 
   * @param {Object} conn 
   * @returns {boolean} Retorna true se a mensagem foi tratada pelo protocolo da sala
   */
  handleRoomMessage(senderPeerId, message, conn) {
    if (!message || typeof message !== 'object') return false;

    switch (message.type) {
      case 'ROOM_JOIN_REQUEST': {
        // Validação de PIN se configurado no Master
        if (this.isMaster && this.roomPin) {
          if (message.pin !== this.roomPin) {
            conn?.send?.({ type: 'ROOM_PIN_REQUIRED', error: 'PIN incorreto para esta sala.' });
            return true;
          }
        }

        // Aceita o novo membro
        const memberInfo = {
          peerId: senderPeerId,
          name: message.name || `Amigo ${senderPeerId.slice(-4)}`,
          isMaster: false,
          isMuted: Boolean(message.isMuted),
          isDeafened: Boolean(message.isDeafened),
          isStreaming: Boolean(message.isStreaming),
          streamDetails: message.streamDetails || null,
          joinedAt: Date.now()
        };

        this.members.set(senderPeerId, memberInfo);
        this.meshConnections.set(senderPeerId, conn);

        // Se eu sou o Master, envio a lista de todos os membros e aviso aos outros membros
        if (this.isMaster) {
          conn?.send?.({
            type: 'ROOM_SYNC_ALL',
            roomId: this.roomId,
            members: this.getMembersList()
          });

          this.broadcast({
            type: 'ROOM_MEMBER_JOINED',
            member: memberInfo
          }, senderPeerId);
        }

        this.emit('memberJoined', memberInfo);
        this.emit('membersUpdated', this.getMembersList());
        this.notifyState();
        return true;
      }

      case 'ROOM_SYNC_ALL': {
        if (Array.isArray(message.members)) {
          message.members.forEach((m) => {
            if (m && m.peerId && m.peerId !== this.myPeerId) {
              const prev = this.members.get(m.peerId);
              this.members.set(m.peerId, { ...prev, ...m });
            }
          });
          this.emit('membersUpdated', this.getMembersList());
          this.notifyState();
        }
        return true;
      }

      case 'ROOM_MEMBER_JOINED': {
        if (message.member && message.member.peerId && message.member.peerId !== this.myPeerId) {
          this.members.set(message.member.peerId, message.member);
          this.emit('memberJoined', message.member);
          this.emit('membersUpdated', this.getMembersList());
          this.notifyState();
        }
        return true;
      }

      case 'ROOM_MEMBER_LEFT': {
        const leftId = message.peerId || senderPeerId;
        this.removeMember(leftId);
        return true;
      }

      case 'ROOM_STREAM_PUBLISHED': {
        const peerId = message.peerId || senderPeerId;
        const member = this.members.get(peerId);
        if (member) {
          member.isStreaming = true;
          member.streamDetails = message.details || null;
          this.emit('streamPublished', { peerId, details: member.streamDetails, member });
          this.emit('membersUpdated', this.getMembersList());
          this.notifyState();
        }
        return true;
      }

      case 'ROOM_STREAM_UNPUBLISHED': {
        const peerId = message.peerId || senderPeerId;
        const member = this.members.get(peerId);
        if (member) {
          member.isStreaming = false;
          member.streamDetails = null;
          this.emit('streamUnpublished', { peerId, member });
          this.emit('membersUpdated', this.getMembersList());
          this.notifyState();
        }
        return true;
      }

      case 'ROOM_MEMBER_STATE_UPDATE': {
        const peerId = message.peerId || senderPeerId;
        const member = this.members.get(peerId);
        if (member) {
          if (typeof message.isMuted === 'boolean') member.isMuted = message.isMuted;
          if (typeof message.isDeafened === 'boolean') member.isDeafened = message.isDeafened;
          if (typeof message.isSpeaking === 'boolean') member.isSpeaking = message.isSpeaking;
          this.emit('membersUpdated', this.getMembersList());
          this.notifyState();
        }
        return true;
      }

      default:
        return false;
    }
  }

  /**
   * Atualiza o estado da transmissão local ("Go Live")
   * @param {boolean} isStreaming 
   * @param {Object} [details] 
   */
  setLocalStreaming(isStreaming, details = {}) {
    this.localStreamingState.isStreaming = Boolean(isStreaming);
    if (details.title) this.localStreamingState.title = details.title;
    if (details.preset) this.localStreamingState.preset = details.preset;
    if (details.fps) this.localStreamingState.fps = details.fps;
    if (details.height) this.localStreamingState.height = details.height;
    if (details.audioMode) this.localStreamingState.audioMode = details.audioMode;

    const selfMember = this.members.get(this.myPeerId);
    if (selfMember) {
      selfMember.isStreaming = this.localStreamingState.isStreaming;
      selfMember.streamDetails = this.localStreamingState.isStreaming ? { ...this.localStreamingState } : null;
    }

    if (this.localStreamingState.isStreaming) {
      this.broadcast({
        type: 'ROOM_STREAM_PUBLISHED',
        peerId: this.myPeerId,
        details: { ...this.localStreamingState }
      });
      this.emit('streamPublished', { peerId: this.myPeerId, details: { ...this.localStreamingState }, member: selfMember });
    } else {
      this.broadcast({
        type: 'ROOM_STREAM_UNPUBLISHED',
        peerId: this.myPeerId
      });
      this.emit('streamUnpublished', { peerId: this.myPeerId, member: selfMember });
    }

    this.emit('membersUpdated', this.getMembersList());
    this.notifyState();
  }

  /**
   * Atualiza o estado de voz local do usuário (Mute, Deafen, Speaking)
   * @param {Object} state 
   */
  setLocalVoiceState({ isMuted, isDeafened, isSpeaking } = {}) {
    const selfMember = this.members.get(this.myPeerId);
    if (!selfMember) return;

    if (typeof isMuted === 'boolean') selfMember.isMuted = isMuted;
    if (typeof isDeafened === 'boolean') selfMember.isDeafened = isDeafened;
    if (typeof isSpeaking === 'boolean') selfMember.isSpeaking = isSpeaking;

    this.broadcast({
      type: 'ROOM_MEMBER_STATE_UPDATE',
      peerId: this.myPeerId,
      isMuted: selfMember.isMuted,
      isDeafened: selfMember.isDeafened,
      isSpeaking: selfMember.isSpeaking
    });

    this.emit('membersUpdated', this.getMembersList());
    this.notifyState();
  }

  /**
   * Envia uma mensagem via broadcast para todas as conexões ativas na sala
   * @param {Object} payload 
   * @param {string} [excludePeerId] 
   */
  broadcast(payload, excludePeerId = null) {
    this.meshConnections.forEach((conn, peerId) => {
      if (peerId !== excludePeerId && conn && conn.open) {
        try {
          conn.send(payload);
        } catch (e) {
          console.warn(`[RoomManager] Erro ao enviar mensagem para ${peerId}:`, e);
        }
      }
    });
  }

  /**
   * Retorna a lista completa de membros presentes na sala
   * @returns {Array<Object>}
   */
  getMembersList() {
    return Array.from(this.members.values());
  }

  /**
   * Retorna os membros que estão transmitindo tela ativamente no momento
   * @returns {Array<Object>}
   */
  getActiveStreamers() {
    return Array.from(this.members.values()).filter((m) => m.isStreaming);
  }

  notifyState() {
    try {
      this.onStateChange({
        roomId: this.roomId,
        isMaster: this.isMaster,
        membersCount: this.members.size,
        streamersCount: this.getActiveStreamers().length,
        members: this.getMembersList()
      });
    } catch (e) {}
  }

  leave() {
    this.broadcast({
      type: 'ROOM_MEMBER_LEFT',
      peerId: this.myPeerId
    });

    this.meshConnections.forEach((conn) => {
      try { conn.close(); } catch (e) {}
    });
    this.meshConnections.clear();
    this.members.clear();
    this.isInRoom = false;
    this.emit('roomClosed', { roomId: this.roomId });
    this.notifyState();
  }
}
