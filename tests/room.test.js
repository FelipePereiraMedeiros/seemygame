import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomManager, sanitizeRoomId, getRoomMasterPeerId } from '../js/room.js';

describe('Módulo: room.js (Gerenciador de Salas P2P - Paradigma Room-First)', () => {
  it('sanitizeRoomId deve sanitizar IDs de sala para caracteres válidos', () => {
    expect(sanitizeRoomId('  Sala do Clã #1  ')).toBe('sala-do-cl-1');
    expect(sanitizeRoomId('Gaming_Room-2026')).toBe('gaming_room-2026');
    expect(sanitizeRoomId('')).toBe('general');
    expect(sanitizeRoomId(null)).toBe('general');
  });

  it('getRoomMasterPeerId deve gerar o identificador determinístico do coordenador da sala', () => {
    expect(getRoomMasterPeerId('amigos')).toBe('smg_room_amigos_host');
    expect(getRoomMasterPeerId('jogatina vip')).toBe('smg_room_jogatina-vip_host');
  });

  it('chave de convite deve tornar o ID do coordenador imprevisÃ­vel e determinÃ­stico', () => {
    const first = getRoomMasterPeerId('amigos', '0123456789abcdef');
    expect(first).toBe(getRoomMasterPeerId('amigos', '0123456789abcdef'));
    expect(first).not.toBe(getRoomMasterPeerId('amigos', 'fedcba9876543210'));
    expect(first).not.toBe(getRoomMasterPeerId('amigos'));
  });

  describe('RoomManager Lifecycle & State', () => {
    let room;

    beforeEach(() => {
      room = new RoomManager({
        roomId: 'jogatina',
        userName: 'Diogo'
      });
    });

    it('deve inicializar com estado padrão', () => {
      expect(room.roomId).toBe('jogatina');
      expect(room.userName).toBe('Diogo');
      expect(room.isInRoom).toBe(false);
      expect(room.isMaster).toBe(false);
      expect(room.members.size).toBe(0);
      expect(room.getActiveStreamers().length).toBe(0);
    });

    it('join deve adicionar o usuário local como membro da sala', () => {
      const updateSpy = vi.fn();
      room.on('membersUpdated', updateSpy);

      room.join('peer-local-1', true);

      expect(room.isInRoom).toBe(true);
      expect(room.isMaster).toBe(true);
      expect(room.myPeerId).toBe('peer-local-1');
      expect(room.members.size).toBe(1);

      const self = room.members.get('peer-local-1');
      expect(self.name).toBe('Diogo');
      expect(self.isMaster).toBe(true);
      expect(self.isStreaming).toBe(false);
      expect(updateSpy).toHaveBeenCalledWith(expect.arrayContaining([self]));
    });

    it('registerConnection deve adicionar novos membros e emitir memberJoined', () => {
      room.join('peer-local-1');
      const joinedSpy = vi.fn();
      room.on('memberJoined', joinedSpy);

      const fakeConn = { open: true, send: vi.fn(), close: vi.fn() };
      room.registerConnection('peer-remote-2', fakeConn, { name: 'Lucas' });
      room.promoteConnection('peer-remote-2', fakeConn, { name: 'Lucas' });

      expect(room.members.size).toBe(2);
      expect(room.meshConnections.has('peer-remote-2')).toBe(true);
      expect(joinedSpy).toHaveBeenCalledWith(expect.objectContaining({
        peerId: 'peer-remote-2',
        name: 'Lucas'
      }));
    });

    it('removeMember deve remover o membro e emitir memberLeft e streamUnpublished se estivesse transmitindo', () => {
      room.join('peer-local-1');
      const fakeConn = { open: true, send: vi.fn() };
      room.registerConnection('peer-remote-2', fakeConn, { name: 'Lucas', isStreaming: true });
      room.promoteConnection('peer-remote-2', fakeConn, { name: 'Lucas', isStreaming: true });

      const leftSpy = vi.fn();
      const streamUnpubSpy = vi.fn();
      room.on('memberLeft', leftSpy);
      room.on('streamUnpublished', streamUnpubSpy);

      room.removeMember('peer-remote-2');

      expect(room.members.size).toBe(1);
      expect(leftSpy).toHaveBeenCalledWith(expect.objectContaining({ peerId: 'peer-remote-2' }));
      expect(streamUnpubSpy).toHaveBeenCalledWith({ peerId: 'peer-remote-2' });
    });

    it('setLocalStreaming deve alternar o estado de transmissão e notificar via broadcast', () => {
      room.join('peer-local-1');
      const fakeConn = { open: true, send: vi.fn() };
      room.registerConnection('peer-remote-2', fakeConn);
      room.promoteConnection('peer-remote-2', fakeConn);

      const pubSpy = vi.fn();
      room.on('streamPublished', pubSpy);

      // Inicia stream
      room.setLocalStreaming(true, { title: 'CS2 Competitivo', fps: 60, height: 1080 });

      expect(room.localStreamingState.isStreaming).toBe(true);
      expect(room.getActiveStreamers().length).toBe(1);
      expect(pubSpy).toHaveBeenCalledWith(expect.objectContaining({
        peerId: 'peer-local-1',
        details: expect.objectContaining({ title: 'CS2 Competitivo', fps: 60 })
      }));
      expect(fakeConn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ROOM_STREAM_PUBLISHED',
        peerId: 'peer-local-1'
      }));

      // Para stream
      const unpubSpy = vi.fn();
      room.on('streamUnpublished', unpubSpy);

      room.setLocalStreaming(false);

      expect(room.localStreamingState.isStreaming).toBe(false);
      expect(room.getActiveStreamers().length).toBe(0);
      expect(unpubSpy).toHaveBeenCalledWith(expect.objectContaining({ peerId: 'peer-local-1' }));
      expect(fakeConn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ROOM_STREAM_UNPUBLISHED',
        peerId: 'peer-local-1'
      }));
    });

    it('setLocalVoiceState deve atualizar o estado de voz e transmitir aos outros membros', () => {
      room.join('peer-local-1');
      const fakeConn = { open: true, send: vi.fn() };
      room.registerConnection('peer-remote-2', fakeConn);
      room.promoteConnection('peer-remote-2', fakeConn);

      room.setLocalVoiceState({ isMuted: true, isDeafened: false, isSpeaking: false });

      const self = room.members.get('peer-local-1');
      expect(self.isMuted).toBe(true);
      expect(fakeConn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ROOM_MEMBER_STATE_UPDATE',
        peerId: 'peer-local-1',
        isMuted: true
      }));
    });

    it('handleRoomMessage deve processar ROOM_JOIN_REQUEST com validação de PIN', () => {
      const pinRoom = new RoomManager({ roomId: 'secreta', roomPin: '1234' });
      pinRoom.join('peer-master', true);

      const fakeConn = { open: true, send: vi.fn() };

      // Tentativa com PIN errado
      const handledWrong = pinRoom.handleRoomMessage('guest-1', {
        type: 'ROOM_JOIN_REQUEST',
        pin: 'wrong'
      }, fakeConn);

      expect(handledWrong).toBe(true);
      expect(fakeConn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ROOM_PIN_REQUIRED'
      }));
      expect(pinRoom.members.has('guest-1')).toBe(false);

      // Tentativa com PIN correto
      const handledCorrect = pinRoom.handleRoomMessage('guest-1', {
        type: 'ROOM_JOIN_REQUEST',
        name: 'Convidado VIP',
        pin: '1234'
      }, fakeConn);

      expect(handledCorrect).toBe(true);
      expect(pinRoom.members.has('guest-1')).toBe(true);
      expect(fakeConn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ROOM_SYNC_ALL'
      }));
    });

    it('deve exigir a chave da sala antes de promover uma conexÃ£o pendente', () => {
      const roomKey = '0123456789abcdef';
      const keyedRoom = new RoomManager({ roomId: 'privada', roomKey });
      keyedRoom.join(getRoomMasterPeerId('privada', roomKey), true);

      const wrongConn = { peer: 'guest-key-1', open: true, send: vi.fn(), close: vi.fn() };
      keyedRoom.registerConnection(wrongConn.peer, wrongConn);
      keyedRoom.handleRoomMessage(wrongConn.peer, {
        type: 'ROOM_JOIN_REQUEST',
        roomId: 'privada',
        roomKey: 'wrong-key-0000000'
      }, wrongConn);

      expect(wrongConn.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'ROOM_KEY_REQUIRED' }));
      expect(keyedRoom.members.has(wrongConn.peer)).toBe(false);
      expect(keyedRoom.isPeerAuthorized(wrongConn.peer)).toBe(false);

      const validConn = { peer: 'guest-key-1', open: true, send: vi.fn(), close: vi.fn() };
      keyedRoom.registerConnection(validConn.peer, validConn);
      keyedRoom.handleRoomMessage(validConn.peer, {
        type: 'ROOM_JOIN_REQUEST',
        roomId: 'privada',
        roomKey,
        name: 'Convidado'
      }, validConn);

      expect(keyedRoom.members.has(validConn.peer)).toBe(true);
      expect(keyedRoom.isPeerAuthorized(validConn.peer)).toBe(true);
      expect(validConn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ROOM_PIN_ACCEPTED',
        roomKey
      }));
    });

    it('deve manter conexÃ£o publica pendente ate o handshake de admissÃ£o', () => {
      const publicRoom = new RoomManager({ roomId: 'publica' });
      publicRoom.join('master-public', true);
      const conn = { peer: 'guest-public', open: true, send: vi.fn(), close: vi.fn() };

      expect(publicRoom.registerConnection(conn.peer, conn)).toBe(true);
      expect(publicRoom.pendingConnections.has(conn.peer)).toBe(true);
      expect(publicRoom.meshConnections.has(conn.peer)).toBe(false);
      expect(publicRoom.isPeerAuthorized(conn.peer)).toBe(false);
    });

    it('handleRoomMessage deve processar ROOM_STREAM_PUBLISHED e ROOM_STREAM_UNPUBLISHED remotos', () => {
      room.join('peer-local-1');
      const fakeConn = { open: true, send: vi.fn() };
      room.registerConnection('peer-remote-2', fakeConn);
      room.promoteConnection('peer-remote-2', fakeConn);

      const pubSpy = vi.fn();
      const unpubSpy = vi.fn();
      room.on('streamPublished', pubSpy);
      room.on('streamUnpublished', unpubSpy);

      room.handleRoomMessage('peer-remote-2', {
        type: 'ROOM_STREAM_PUBLISHED',
        peerId: 'peer-remote-2',
        details: { title: 'Jogo Remoto', fps: 60 }
      }, fakeConn);

      expect(room.getActiveStreamers().length).toBe(1);
      expect(pubSpy).toHaveBeenCalledWith(expect.objectContaining({
        peerId: 'peer-remote-2',
        details: { title: 'Jogo Remoto', fps: 60 }
      }));

      room.handleRoomMessage('peer-remote-2', {
        type: 'ROOM_STREAM_UNPUBLISHED',
        peerId: 'peer-remote-2'
      }, fakeConn);

      expect(room.getActiveStreamers().length).toBe(0);
      expect(unpubSpy).toHaveBeenCalledWith(expect.objectContaining({
        peerId: 'peer-remote-2'
      }));
    });

    it('leave deve fechar todas as conexões e limpar os membros', () => {
      room.join('peer-local-1');
      const fakeConn = { open: true, send: vi.fn(), close: vi.fn() };
      room.registerConnection('peer-remote-2', fakeConn);
      room.promoteConnection('peer-remote-2', fakeConn);

      const closeSpy = vi.fn();
      room.on('roomClosed', closeSpy);

      room.leave();

      expect(fakeConn.close).toHaveBeenCalled();
      expect(room.isInRoom).toBe(false);
      expect(room.members.size).toBe(0);
      expect(room.meshConnections.size).toBe(0);
      expect(closeSpy).toHaveBeenCalledWith({ roomId: 'jogatina' });
    });
  });
});
