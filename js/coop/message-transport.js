/** Native companion messages use their own WebSocket protocol; P2P uses session envelopes. */
export function sendCoopMessage(ports, connection, message) {
  if (ports.sendMessage) return ports.sendMessage(connection, message);
  // Compatibility facade for older consumers with an externally owned connection.
  return connection.send(message);
}
