// Configurações de STUN/ICE Públicos Confiáveis para Travessia de NAT
export const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ],
    sdpSemantics: 'unified-plan',
    iceCandidatePoolSize: 10
  }
};

// Perfis de Qualidade focados em 60 FPS
export const QUALITY_PROFILES = {
  ultra: {
    id: 'ultra',
    label: '60 FPS Competitivo (720p)',
    width: 1280,
    height: 720,
    fps: 60,
    bitrate: 4500000
  },
  balanced: {
    id: 'balanced',
    label: '60 FPS Dinâmico (1080p)',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrate: 7500000
  },
  high: {
    id: 'high',
    label: '60 FPS Alta Fidelidade (1080p)',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrate: 12000000
  }
};

export const DEFAULT_PROFILE = QUALITY_PROFILES.balanced;
export const DEFAULT_BITRATE_BPS = DEFAULT_PROFILE.bitrate;
