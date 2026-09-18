import { describe, it, expect } from 'vitest';
import {
  generateGamerRoomCode,
  generateMeetRoomCode,
  generateFriendlyRoomCode,
  parseRoomIdentifier,
  formatRoomCodeInput
} from '../js/room-codes.js';

describe('Módulo: room-codes.js (Gerenciamento de Salas Amigável)', () => {
  describe('generateGamerRoomCode', () => {
    it('deve gerar um código com 2 ou 3 palavras separadas por hífen', () => {
      const code = generateGamerRoomCode();
      expect(typeof code).toBe('string');
      const parts = code.split('-');
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(parts.length).toBeLessThanOrEqual(3);
      parts.forEach((part) => {
        expect(part.length).toBeGreaterThanOrEqual(3);
        expect(/^[a-z]+$/.test(part)).toBe(true);
      });
    });
  });

  describe('generateMeetRoomCode', () => {
    it('deve gerar código no padrão Google Meet (3-4-3 letras separadas por hífen)', () => {
      const code = generateMeetRoomCode();
      expect(typeof code).toBe('string');
      expect(code).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    });

    it('não deve conter caracteres visualmente ambíguos (l, 1, 0, o)', () => {
      for (let i = 0; i < 20; i++) {
        const code = generateMeetRoomCode();
        expect(code).not.toMatch(/[l01o]/);
      }
    });
  });

  describe('generateFriendlyRoomCode', () => {
    it('deve respeitar o estilo solicitado ("gamer" ou "meet")', () => {
      const gamerCode = generateFriendlyRoomCode('gamer');
      expect(gamerCode.split('-').length).toBeGreaterThanOrEqual(2);

      const meetCode = generateFriendlyRoomCode('meet');
      expect(meetCode).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    });
  });

  describe('parseRoomIdentifier', () => {
    it('deve extrair a sala a partir de um código simples', () => {
      const result = parseRoomIdentifier('turbo-pixel-squad');
      expect(result.roomId).toBe('turbo-pixel-squad');
      expect(result.roomKey).toBeNull();
    });

    it('deve extrair a sala a partir de URL completa com hash #room=', () => {
      const result = parseRoomIdentifier('https://seemygame.app/room.html#room=resenha-gamer');
      expect(result.roomId).toBe('resenha-gamer');
    });

    it('deve extrair a sala e a chave a partir de URL com key', () => {
      const result = parseRoomIdentifier('https://seemygame.app/room.html#room=clube&key=abcdef1234567890abcdef');
      expect(result.roomId).toBe('clube');
      expect(result.roomKey).toBe('abcdef1234567890abcdef');
    });

    it('deve extrair a sala a partir de query string ?room=', () => {
      const result = parseRoomIdentifier('http://localhost:3000/room.html?room=sala-vip');
      expect(result.roomId).toBe('sala-vip');
    });

    it('deve normalizar ID técnico do coordenador PeerJS (smg_room_..._host)', () => {
      const result = parseRoomIdentifier('smg_room_meu-esquadrao_host');
      expect(result.roomId).toBe('meu-esquadrao');
    });

    it('deve sanitizar entradas estranhas e caracteres inválidos', () => {
      const result = parseRoomIdentifier('  SALA DOS AMIGOS! 123  ');
      expect(result.roomId).toBe('sala-dos-amigos-123');
    });

    it('deve usar fallback "general" se a entrada for vazia ou inválida', () => {
      expect(parseRoomIdentifier('').roomId).toBe('general');
      expect(parseRoomIdentifier(null).roomId).toBe('general');
    });
  });

  describe('formatRoomCodeInput', () => {
    it('deve auto-formatar 10 letras contínuas no padrão Meet xxx-yyyy-zzz', () => {
      expect(formatRoomCodeInput('abcdefghij')).toBe('abc-defg-hij');
    });

    it('deve preservar códigos que já contenham hífens e sanitizar', () => {
      expect(formatRoomCodeInput('turbo-pixel-fogo')).toBe('turbo-pixel-fogo');
      expect(formatRoomCodeInput('TURBO_PIXEL')).toBe('turbo_pixel');
    });
  });
});
