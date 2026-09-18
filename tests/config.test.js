import { describe, it, expect } from 'vitest';
import {
  PEER_CONFIG,
  QUALITY_PROFILES,
  DEFAULT_PROFILE,
  DEFAULT_BITRATE_BPS,
  PUBLIC_WEB_ORIGIN,
  getPublicOrigin
} from '../js/config.js';

describe('Módulo: config.js', () => {
  it('deve usar o domínio Vercel como origem pública canônica', () => {
    expect(PUBLIC_WEB_ORIGIN).toBe('https://seemygame.vercel.app');
    expect(getPublicOrigin()).toBe('https://seemygame.vercel.app');
  });

  describe('PEER_CONFIG', () => {
    it('deve possuir a estrutura de configuração correta do PeerJS / WebRTC', () => {
      expect(PEER_CONFIG).toBeDefined();
      expect(PEER_CONFIG).toHaveProperty('config');
      expect(PEER_CONFIG.config).toHaveProperty('iceServers');
      expect(Array.isArray(PEER_CONFIG.config.iceServers)).toBe(true);
      expect(PEER_CONFIG.config.sdpSemantics).toBe('unified-plan');
      expect(PEER_CONFIG.config.iceCandidatePoolSize).toBe(10);
    });

    it('deve conter servidores STUN confiáveis da Google e Cloudflare', () => {
      const urls = PEER_CONFIG.config.iceServers.map(server => server.urls);
      expect(urls).toContain('stun:stun.l.google.com:19302');
      expect(urls).toContain('stun:stun.cloudflare.com:3478');
      expect(urls.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('QUALITY_PROFILES', () => {
    it('deve conter os 3 perfis de qualidade esperados: ultra, balanced e high', () => {
      expect(QUALITY_PROFILES).toHaveProperty('ultra');
      expect(QUALITY_PROFILES).toHaveProperty('balanced');
      expect(QUALITY_PROFILES).toHaveProperty('high');
    });

    it('todos os perfis devem travar a taxa em 60 FPS', () => {
      Object.values(QUALITY_PROFILES).forEach(profile => {
        expect(profile.fps).toBe(60);
      });
    });

    it('deve configurar corretamente o perfil ultra (720p60 - 4.5 Mbps)', () => {
      const ultra = QUALITY_PROFILES.ultra;
      expect(ultra.id).toBe('ultra');
      expect(ultra.width).toBe(1280);
      expect(ultra.height).toBe(720);
      expect(ultra.fps).toBe(60);
      expect(ultra.bitrate).toBe(4500000);
    });

    it('deve configurar corretamente o perfil balanced (1080p60 - 7.5 Mbps)', () => {
      const balanced = QUALITY_PROFILES.balanced;
      expect(balanced.id).toBe('balanced');
      expect(balanced.width).toBe(1920);
      expect(balanced.height).toBe(1080);
      expect(balanced.fps).toBe(60);
      expect(balanced.bitrate).toBe(7500000);
    });

    it('deve configurar corretamente o perfil high (1080p60 - 12 Mbps)', () => {
      const high = QUALITY_PROFILES.high;
      expect(high.id).toBe('high');
      expect(high.width).toBe(1920);
      expect(high.height).toBe(1080);
      expect(high.fps).toBe(60);
      expect(high.bitrate).toBe(12000000);
    });
  });

  describe('DEFAULT_PROFILE e DEFAULT_BITRATE_BPS', () => {
    it('DEFAULT_PROFILE deve apontar para o perfil balanced', () => {
      expect(DEFAULT_PROFILE).toBe(QUALITY_PROFILES.balanced);
    });

    it('DEFAULT_BITRATE_BPS deve ser igual ao bitrate do DEFAULT_PROFILE', () => {
      expect(DEFAULT_BITRATE_BPS).toBe(QUALITY_PROFILES.balanced.bitrate);
      expect(DEFAULT_BITRATE_BPS).toBe(7500000);
    });
  });

  describe('fetchIceServersFromApi', () => {
    it('deve usar fallback para DEFAULT_ICE_SERVERS quando API falhar ou der timeout', async () => {
      const { fetchIceServersFromApi, DEFAULT_ICE_SERVERS, _resetDynamicIceCache } = await import('../js/config.js');
      _resetDynamicIceCache();

      const originalFetch = global.fetch;
      global.fetch = () => Promise.reject(new Error('Network error or timeout'));

      const servers = await fetchIceServersFromApi(100);
      expect(servers).toEqual(DEFAULT_ICE_SERVERS);

      global.fetch = originalFetch;
      _resetDynamicIceCache();
    });
  });
});
