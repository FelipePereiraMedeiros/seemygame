// ==========================================
// CONFIGURAÇÕES GERAIS, ICE (STUN/TURN) & PRESETS
// ==========================================

export const TERMS_VERSION = '1.1';
export const MAX_VIEWERS_DEFAULT = 4;

export const ROOM_MODES = {
  PUBLIC: 'public',
  PRIVATE: 'private'
};

export const LATENCY_MODES = {
  ULTRA_LOW: 'ultra-low',
  STABLE: 'stable'
};

// Servidores STUN públicos confiáveis e fallback para relay TURN (OpenRelay)
export const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // OpenRelay TURN para travessia de NATs restritivos / Firewalls corporativos
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turns:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

// Configurações de STUN/ICE para PeerJS
export const PEER_CONFIG = {
  config: {
    iceServers: DEFAULT_ICE_SERVERS,
    sdpSemantics: 'unified-plan',
    iceCandidatePoolSize: 10
  }
};

let dynamicIceServers = null;

/**
 * Consulta a rota serverless /api/turn para obter servidores ICE dinâmicos (STUN/TURN)
 * @returns {Promise<Array>}
 */
export async function fetchIceServersFromApi() {
  if (dynamicIceServers) return dynamicIceServers;

  try {
    const res = await fetch('/api/turn');
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        dynamicIceServers = data.iceServers;
        console.log('[ICE/TURN] Servidores STUN/TURN dinâmicos carregados:', dynamicIceServers.length);
        return dynamicIceServers;
      }
    }
  } catch (err) {
    console.info('[ICE/TURN] /api/turn não acessível (modo estático), usando servidores ICE padrão.');
  }

  return DEFAULT_ICE_SERVERS;
}

/**
 * Retorna a configuração do Peer com servidores ICE customizados, da API ou padrão
 * @returns {Object}
 */
export function getPeerConfig(customServers = null) {
  const servers = customServers || dynamicIceServers || DEFAULT_ICE_SERVERS;
  return {
    config: {
      ...PEER_CONFIG.config,
      iceServers: servers
    }
  };
}

// Perfis de Qualidade focados em Máxima Fluidez
export const QUALITY_PROFILES = {
  ultra: {
    id: 'ultra',
    label: 'Modo Competitivo (720p - Fluidez Máxima)',
    width: 1280,
    height: 720,
    fps: 60,
    bitrate: 4500000
  },
  balanced: {
    id: 'balanced',
    label: 'Modo Dinâmico (1080p - Equilibrado & Fluido)',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrate: 7500000
  },
  high: {
    id: 'high',
    label: 'Alta Fidelidade (1080p - Alta Nitidez)',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrate: 12000000
  }
};

export const DEFAULT_PROFILE = QUALITY_PROFILES.balanced;
export const DEFAULT_BITRATE_BPS = DEFAULT_PROFILE.bitrate;

