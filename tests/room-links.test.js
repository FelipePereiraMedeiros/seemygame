import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getSanitizedPath,
  createRoomKey,
  buildRoomUrl,
  parseRoomIdentifier
} from '../js/navigation/room-links.js';

describe('M14: Navegação, Identidade e Links Canônicos (js/navigation/room-links.js)', () => {
  let originalLocation;

  beforeEach(() => {
    originalLocation = window.location;
  });

  afterEach(() => {
    delete window.location;
    window.location = originalLocation;
  });

  it('createRoomKey deve gerar string segura com pelo menos 16 caracteres alfanuméricos', () => {
    const key = createRoomKey();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThanOrEqual(16);
    expect(/^[a-zA-Z0-9_-]+$/.test(key)).toBe(true);
  });

  it('getSanitizedPath deve normalizar subdiretórios removendo o nome do arquivo .html', () => {
    delete window.location;
    window.location = new URL('https://seemygame.com/app/v2/lobby.html');
    expect(getSanitizedPath()).toBe('/app/v2/');

    window.location = new URL('https://seemygame.com/lobby.html');
    expect(getSanitizedPath()).toBe('/');

    window.location = new URL('https://seemygame.com/portal/');
    expect(getSanitizedPath()).toBe('/portal/');
  });

  it('buildRoomUrl deve preservar roomId, roomKey e roomPin no hash canônico', () => {
    delete window.location;
    window.location = new URL('https://seemygame.com/lobby.html');

    const url = buildRoomUrl({
      roomId: 'resenha-gamer',
      roomKey: 'secretKey1234567890abcdef',
      roomPin: '4321'
    });

    expect(url).toContain('https://seemygame.com/room.html#room=resenha-gamer');
    expect(url).toContain('&key=secretKey1234567890abcdef');
    expect(url).toContain('&pin=4321');
  });

  it('parseRoomIdentifier deve extrair roomId e roomKey de links completos ou fragmentos', () => {
    const fromUrl = parseRoomIdentifier('https://seemygame.com/room.html#room=arena-boss&key=secretKey1234567890abcdef');
    expect(fromUrl.roomId).toBe('arena-boss');
    expect(fromUrl.roomKey).toBe('secretKey1234567890abcdef');

    const fromFriendly = parseRoomIdentifier('pixel-turbo-fogo');
    expect(fromFriendly.roomId).toBe('pixel-turbo-fogo');
    expect(fromFriendly.roomKey).toBeNull();
  });
});
