import { sendSessionMessage } from '../protocol/transport.js';
import { isValidPeerId } from ".././shared/peer-id.js";
import { sanitizeRoomId } from ".././room/room-id.js";
import { ROOM_PREFIX, MASTER_SUFFIX, MAX_ROOM_MEMBERS, MAX_PENDING_ROOM_CONNECTIONS, MAX_ROOM_MESSAGE_BYTES, ROOM_HEARTBEAT_INTERVAL_MS, ROOM_MEMBER_TIMEOUT_MS, sanitizeText, hashRoomKey, getRoomMasterPeerId, isWithinMessageLimit } from './shared.js';
/** RoomManager: admission. State and lifetime remain owned by the composed engine. */
export const withRoomManagerAdmission = Base => class extends Base {
registerConnection(peerId, conn, initialInfo = {}) {
    if (!isValidPeerId(peerId) || peerId === this.myPeerId) return false;
    if (!this.members.has(peerId) && this.members.size >= MAX_ROOM_MEMBERS) return false;

    // Se já temos uma conexão de malha aberta e autenticada com este peer, mantém a existente
    const existingMesh = this.meshConnections.get(peerId);
    if (existingMesh && existingMesh.open && this.authenticatedPeers.has(peerId)) {
      return true;
    }

    // Se já temos uma conexão pendente aberta (ex: masterConn de saída), não a substitua por conexão reversa
    const existingPending = this.pendingConnections.get(peerId);
    if (existingPending && existingPending !== conn && existingPending.open) {
      return true;
    }

    // Every room connection starts pending. Public rooms still need the room
    // admission handshake; otherwise a peer could connect directly to a
    // guest and bypass the coordinator's membership list.
    if (!this.authenticatedPeers.has(peerId)) {
      if (!this.pendingConnections.has(peerId) && this.pendingConnections.size >= MAX_PENDING_ROOM_CONNECTIONS) return false;
      this.pendingConnections.set(peerId, conn);
      return true;
    }

    return this.promoteConnection(peerId, conn, initialInfo);
  }

promoteConnection(peerId, conn, initialInfo = {}) {
    if (!isValidPeerId(peerId) || peerId === this.myPeerId || !conn) return false;
    if (!this.members.has(peerId) && this.members.size >= MAX_ROOM_MEMBERS) return false;

    this.authenticatedPeers.add(peerId);
    this.pendingConnections.delete(peerId);
    this.meshConnections.set(peerId, conn);

    if (!this.members.has(peerId)) {
      const newMember = {
        peerId,
        name: typeof initialInfo.name === 'string' && initialInfo.name.trim() ? sanitizeText(initialInfo.name).slice(0, 30) : `Amigo ${peerId.slice(-4)}`,
        clientSessionId: initialInfo.clientSessionId || null,
        isMaster: Boolean(initialInfo.isMaster),
        isMuted: Boolean(initialInfo.isMuted),
        isDeafened: Boolean(initialInfo.isDeafened),
        isSpeaking: false,
        isStreaming: Boolean(initialInfo.isStreaming),
        streamDetails: initialInfo.streamDetails || null,
        joinedAt: initialInfo.joinedAt || Date.now(),
        lastSeen: Date.now()
      };
      this.members.set(peerId, newMember);
      this.emit('memberJoined', newMember);
      this.emit('membersUpdated', this.getMembersList());
      this.notifyState();
    } else {
      const existing = this.members.get(peerId);
      existing.lastSeen = Date.now();
      if (initialInfo.name && initialInfo.name.trim()) {
        existing.name = sanitizeText(initialInfo.name).slice(0, 30);
      }
      if (initialInfo.clientSessionId) {
        existing.clientSessionId = initialInfo.clientSessionId;
      }
    }
    return true;
  }

isPeerAuthorized(peerId) {
    if (peerId === this.myPeerId) return true;
    return this.authenticatedPeers.has(peerId);
  }
};
