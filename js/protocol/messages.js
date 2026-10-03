/**
 * SeeMyGame - Protocol Message Types & Envelopes
 * Define contratos canônicos e envelopes de transporte para mensageria P2P.
 */

export const PROTOCOL_TYPES = Object.freeze({
  // Admissão e Autenticação
  ADMISSION: {
    PIN_REQUIRED: 'PIN_REQUIRED',
    PIN_ACCEPTED: 'PIN_ACCEPTED',
    ROOM_PIN_REQUIRED: 'ROOM_PIN_REQUIRED',
    ROOM_MEMBER_AUTH: 'ROOM_MEMBER_AUTH',
    ROOM_JOIN_REQUEST: 'ROOM_JOIN_REQUEST',
    ROOM_JOIN_ACCEPTED: 'ROOM_JOIN_ACCEPTED',
    ROOM_JOIN_REJECTED: 'ROOM_JOIN_REJECTED',
    VIEWER_HELLO: 'VIEWER_HELLO'
  },

  // Mídia e Transmissão
  MEDIA: {
    REQUEST_STREAM: 'REQUEST_STREAM',
    STREAM_STATUS: 'STREAM_STATUS',
    STREAM_STOPPED: 'STREAM_STOPPED',
    STREAM_REJECTED: 'STREAM_REJECTED',
    STREAM_CONFIG_UPDATED: 'STREAM_CONFIG_UPDATED'
  },

  // Sinalização Direta e ICE
  SIGNALING: {
    START_DIRECT_STREAM: 'START_DIRECT_STREAM',
    DIRECT_STREAM_OFFER: 'DIRECT_STREAM_OFFER',
    DIRECT_STREAM_ANSWER: 'DIRECT_STREAM_ANSWER',
    DIRECT_STREAM_ICE_CANDIDATE: 'DIRECT_STREAM_ICE_CANDIDATE'
  },

  // Topologia em Árvore e Relay P2P
  RELAY: {
    RELAY_FORWARD_REQUEST: 'RELAY_FORWARD_REQUEST',
    RELAY_UPSTREAM_ASSIGNED: 'RELAY_UPSTREAM_ASSIGNED',
    RELAY_TOPOLOGY_UPDATE: 'RELAY_TOPOLOGY_UPDATE'
  },

  // Chat e Presença
  COMMUNICATION: {
    CHAT_MESSAGE: 'CHAT_MESSAGE',
    VOICE_SIGNAL: 'VOICE_SIGNAL',
    VOICE_STATE_UPDATE: 'VOICE_STATE_UPDATE',
    ROOM_MEMBER_STATE_UPDATE: 'ROOM_MEMBER_STATE_UPDATE'
  },

  // Co-op (Jogador 2 e Party Mode)
  COOP: {
    COOP_CONFIG: 'COOP_CONFIG',
    COOP_REQUEST: 'COOP_REQUEST',
    COOP_GRANT: 'COOP_GRANT',
    COOP_DENY: 'COOP_DENY',
    COOP_RELEASE: 'COOP_RELEASE',
    COOP_REVOKE: 'COOP_REVOKE',
    COOP_INPUT: 'COOP_INPUT',
    INPUT_KEY: 'INPUT_KEY',
    INPUT_MOUSE: 'INPUT_MOUSE',
    INPUT_GAMEPAD: 'INPUT_GAMEPAD',
    INPUT_RESET: 'INPUT_RESET'
  },

  // Features e Ferramentas Periféricas
  FEATURES: {
    SOUNDBOARD_PLAY: 'SOUNDBOARD_PLAY',
    SOUNDBOARD_PLAY_CUSTOM: 'SOUNDBOARD_PLAY_CUSTOM',
    EMOJI_REACTION: 'EMOJI_REACTION',
    TACTICAL_PING: 'TACTICAL_PING',
    TACTICAL_LASER: 'TACTICAL_LASER',
    WHITEBOARD_ELEMENT_ADD: 'WHITEBOARD_ELEMENT_ADD',
    WHITEBOARD_ELEMENT_UPDATE: 'WHITEBOARD_ELEMENT_UPDATE',
    WHITEBOARD_ELEMENT_DELETE: 'WHITEBOARD_ELEMENT_DELETE',
    WHITEBOARD_CLEAR: 'WHITEBOARD_CLEAR',
    WHITEBOARD_CURSOR: 'WHITEBOARD_CURSOR',
    WHITEBOARD_REQUEST_SYNC: 'WHITEBOARD_REQUEST_SYNC',
    WHITEBOARD_SYNC: 'WHITEBOARD_SYNC'
  }
});

/**
 * Cria envelope padronizado para transporte com identificador e carimbo de data/hora
 * @param {string} type
 * @param {Object} [payload={}]
 * @param {Object} [meta={}]
 * @returns {Object}
 */
export function createMessageEnvelope(type, payload = {}, meta = {}) {
  if (!type || typeof type !== 'string') {
    throw new TypeError('Tipo de mensagem inválido para criação de envelope.');
  }

  return {
    ...payload,
    type,
    msgId: meta.msgId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Number(meta.timestamp) || Date.now(),
    senderPeerId: meta.senderPeerId || null
  };
}

/**
 * Valida a integridade do envelope de mensagem recebido pela conexão P2P
 * @param {*} data
 * @returns {boolean}
 */
export function isValidMessageEnvelope(data) {
  return Boolean(
    data &&
    typeof data === 'object' &&
    typeof data.type === 'string' &&
    data.type.trim().length > 0 && data.type.length <= 128 &&
    (data.msgId === undefined || (typeof data.msgId === 'string' && data.msgId.length <= 256)) &&
    (data.senderPeerId == null || (typeof data.senderPeerId === 'string' && data.senderPeerId.length <= 64))
  );
}

/**
 * Portão de Admissão de Peers para validação de PIN e chave de sala
 */
export class AdmissionGate {
  /**
   * @param {Object} [options]
   * @param {string} [options.roomPin]
   * @param {string} [options.roomKey]
   */
  constructor({ roomPin = null, roomKey = null } = {}) {
    this.roomPin = roomPin ? String(roomPin).trim() : null;
    this.roomKey = roomKey ? String(roomKey).trim() : null;
    this.authenticatedPeers = new Set();
    this.failedAttempts = new Map();
  }

  recordFailedAttempt(peerId) {
    if (!peerId) return 1;
    const count = (this.failedAttempts.get(peerId) || 0) + 1;
    this.failedAttempts.set(peerId, count);
    return count;
  }

  isRateLimited(peerId) {
    return (this.failedAttempts.get(peerId) || 0) >= 5;
  }

  /**
   * Registra um peer como autenticado após validação
   * @param {string} peerId
   */
  authenticate(peerId) {
    if (peerId) {
      this.authenticatedPeers.add(peerId);
      this.failedAttempts.delete(peerId);
    }
  }

  /**
   * Revoga a autenticação de um peer
   * @param {string} peerId
   */
  revoke(peerId) {
    if (peerId) {
      this.authenticatedPeers.delete(peerId);
      this.failedAttempts.delete(peerId);
    }
  }

  /**
   * Verifica se o peer está autorizado a trafegar dados ou receber mídia
   * @param {string} peerId
   * @returns {boolean}
   */
  isAuthenticated(peerId) {
    // Se a sala não requer PIN nem chave, todos os peers válidos são admitidos
    if (!this.roomPin && !this.roomKey) {
      return true;
    }
    return Boolean(peerId && this.authenticatedPeers.has(peerId));
  }

  /**
   * Valida credenciais fornecidas por um peer
   * @param {Object} credentials
   * @param {string} [credentials.pin]
   * @param {string} [credentials.key]
   * @returns {boolean}
   */
  validateAuthAttempt({ pin, key } = {}) {
    if (this.roomPin && String(pin || '').trim() !== this.roomPin) {
      return false;
    }
    if (this.roomKey && String(key || '').trim() !== this.roomKey) {
      return false;
    }
    return true;
  }

  clear() {
    this.authenticatedPeers.clear();
  }
}
