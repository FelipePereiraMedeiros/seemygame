/**
 * SeeMyGame - Shared Peer ID Validation
 * Validação pura de formato e integridade de Peer IDs (sem dependência de DOM ou UI).
 */

/**
 * Valida o formato e tamanho seguro de um Peer ID
 * @param {string} id
 * @returns {boolean}
 */
export function isValidPeerId(id) {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  return /^[a-zA-Z0-9_-]{1,64}$/.test(trimmed);
}
