import { isValidPeerId } from ".././shared/peer-id.js";
import { sanitizeRoomId } from ".././room/room-id.js";
export { isValidPeerId };

export { sanitizeRoomId } from './room-id.js';

export const ROOM_PREFIX = 'smg_room_';

export const MASTER_SUFFIX = '_host';

export const MAX_ROOM_MEMBERS = 16;

export const MAX_PENDING_ROOM_CONNECTIONS = 16;

export const MAX_ROOM_MESSAGE_BYTES = 64 * 1024;

export const ROOM_HEARTBEAT_INTERVAL_MS = 4000;

export const ROOM_MEMBER_TIMEOUT_MS = 30000;

export function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function hashRoomKey(roomId, roomKey) {
  const value = `${sanitizeRoomId(roomId)}|${String(roomKey)}`;
  const seeds = [2166136261, 2246822519, 3266489917, 668265263];
  return seeds.map((seed) => {
    let hash = seed;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }).join('');
}

export function getRoomMasterPeerId(roomId, roomKey = null) {
  const sanitized = sanitizeRoomId(roomId);
  if (typeof roomKey === 'string' && roomKey.length >= 16) {
    return `${ROOM_PREFIX}${sanitized}_${hashRoomKey(sanitized, roomKey)}${MASTER_SUFFIX}`.slice(0, 64);
  }
  return `${ROOM_PREFIX}${sanitized}${MASTER_SUFFIX}`;
}

export function isWithinMessageLimit(payload) {
  try {
    const serialized = JSON.stringify(payload);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(serialized).length <= MAX_ROOM_MESSAGE_BYTES;
    }
    return serialized.length <= MAX_ROOM_MESSAGE_BYTES;
  } catch (error) {
    return false;
  }
}
