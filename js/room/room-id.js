/**
 * SeeMyGame - Room ID Utilities
 * Funções puras de sanitização e validação de identificadores de sala.
 */

/**
 * Sanitiza o ID da sala, removendo caracteres especiais e garantindo formato seguro.
 * @param {string} rawId
 * @returns {string}
 */
export function sanitizeRoomId(rawId) {
  if (!rawId || typeof rawId !== 'string') return 'general';
  const clean = rawId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
  return clean.slice(0, 32) || 'general';
}
