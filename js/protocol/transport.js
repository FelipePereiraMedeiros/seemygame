import { createMessageEnvelope, isValidMessageEnvelope } from './messages.js';
const messageIdentities = new WeakMap();

/** Per-hop identity and message identity are separate; relays preserve msgId. */
export function sendSessionMessage(session, connection, data) {
  if (!connection || connection.open === false || typeof connection.send !== 'function') return false;
  if (!isValidMessageEnvelope(data)) return false;
  const envelope = createMessageEnvelope(data.type, data, {
    msgId: data.msgId || data.message?.id || messageIdentities.get(data),
    timestamp: data.timestamp,
    senderPeerId: session?.getPeerId?.() || null
  });
  messageIdentities.set(data, envelope.msgId);
  connection.send(envelope);
  return true;
}

/** Accepts legacy envelopes while enforcing the transport's authoritative peer identity. */
export function validateReceivedMessage(data, sourceConnection = null, { maxBytes = 1024 * 1024 } = {}) {
  if (!isValidMessageEnvelope(data)) return false;
  if (data.senderPeerId && sourceConnection?.peer && data.senderPeerId !== sourceConnection.peer) return false;
  try {
    if (new TextEncoder().encode(JSON.stringify(data)).length > maxBytes) return false;
  } catch (_) { return false; }
  // Domain handlers validate their payloads. The dispatcher also accepts
  // extension message types and the legacy wire format.
  return true;
}
