import { describe, it, expect, beforeEach, vi } from 'vitest';
import { chatManager } from '../js/chat.js';
import { RoomManager } from '../js/room.js';
import { voiceManager } from '../js/voice.js';
import { isDuplicateMessage, handleIncomingP2PMessage, seenMessageIds } from '../js/app.js';
import { AdaptiveBitrateController } from '../js/abr.js';
import { applyTransceiverOptimizations } from '../js/webrtc.js';
import { fetchIceServersFromApi, DEFAULT_ICE_SERVERS, _resetDynamicIceCache } from '../js/config.js';

describe('Auditoria Técnica: Testes de Remediação (A01 a A20)', () => {
  beforeEach(() => {
    chatManager.clearChannel('geral');
    seenMessageIds.clear();
    voiceManager.leaveVoice();
    vi.clearAllMocks();
  });

  describe('A01 / A14: Prevenção contra XSS em Chat e Nomes', () => {
    it('chatManager.addMessage deve sanitizar payloads maliciosos de XSS', () => {
      const malicious = {
        id: 'xss-1',
        channel: 'geral',
        senderId: 'attacker-1',
        senderName: '<script>alert("pwned")</script>Hacker',
        role: '<img src=x onerror=steal()>',
        text: '<button onclick="evil()">Clique aqui</button><script>alert(1)</script>Ola',
        timestamp: Date.now()
      };

      const added = chatManager.addMessage(malicious);
      expect(added).not.toBeNull();
      expect(added.text).not.toContain('<script>');
      expect(added.text).not.toContain('<button');
      expect(added.senderName).not.toContain('<script>');
      expect(added.role).toBe('viewer'); // Role inválida revertida para 'viewer'
    });

    it('chatManager deve limitar tamanho excessivo de mensagens (DoS/Buffer)', () => {
      const longText = 'A'.repeat(2000);
      const msg = {
        id: 'long-1',
        channel: 'geral',
        senderId: 'user-1',
        senderName: 'U'.repeat(100),
        role: 'viewer',
        text: longText,
        timestamp: Date.now()
      };

      const added = chatManager.addMessage(msg);
      expect(added.text.length).toBeLessThanOrEqual(500);
      expect(added.senderName.length).toBeLessThanOrEqual(32);
    });
  });

  describe('A02 / A03: Proteção de Sala por PIN e Prevenção de Falsificação de Remetente', () => {
    let room;
    beforeEach(() => {
      room = new RoomManager();
    });

    it('admissão em sala com PIN não deve admitir conexão antes de ROOM_JOIN_REQUEST com PIN correto', () => {
      room.join('room-master-id', true);
      room.setRoomPin('1234');

      const mockConn = {
        peer: 'guest-1',
        open: true,
        send: vi.fn(),
        close: vi.fn()
      };

      room.registerConnection('guest-1', mockConn);

      // Não deve ser adicionado aos membros nem à malha ativa
      expect(room.members.has('guest-1')).toBe(false);
      expect(room.meshConnections.has('guest-1')).toBe(false);
      expect(room.pendingConnections.has('guest-1')).toBe(true);

      // Envia requisição com PIN incorreto
      room.handleRoomMessage('guest-1', {
        type: 'ROOM_JOIN_REQUEST',
        name: 'Invasor',
        pin: '9999'
      }, mockConn);

      expect(mockConn.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ROOM_PIN_REQUIRED'
      }));
      expect(room.members.has('guest-1')).toBe(false);

      // Agora envia com o PIN correto
      room.handleRoomMessage('guest-1', {
        type: 'ROOM_JOIN_REQUEST',
        name: 'Amigo',
        pin: '1234'
      }, mockConn);

      expect(room.members.has('guest-1')).toBe(true);
      expect(room.meshConnections.has('guest-1')).toBe(true);
      expect(room.isPeerAuthorized('guest-1')).toBe(true);
    });

    it('deve rejeitar ROOM_SYNC_ALL forjado vindo de peer que não é o Master', () => {
      room.join('guest-2', false);
      room.masterPeerId = 'legit-master';

      const mockConn = { peer: 'fake-master', send: vi.fn() };

      // Peer impostor tenta mandar ROOM_SYNC_ALL
      const handled = room.handleRoomMessage('fake-master', {
        type: 'ROOM_SYNC_ALL',
        senderPeerId: 'fake-master',
        members: [{ peerId: 'attacker', name: 'Malicious' }]
      }, mockConn);

      expect(handled).toBe(true);
      // Não deve adicionar o membro injetado
      expect(room.members.has('attacker')).toBe(false);
    });

    it('membro comum não pode atualizar estado de outro membro (ROOM_MEMBER_STATE_UPDATE)', () => {
      room.join('member-self', false);
      room.members.set('victim-peer', { peerId: 'victim-peer', isMuted: false });

      // 'attacker' tenta desmutar ou alterar estado de 'victim-peer'
      room.handleRoomMessage('attacker-peer', {
        type: 'ROOM_MEMBER_STATE_UPDATE',
        peerId: 'victim-peer',
        isMuted: true
      });

      // O estado da vítima não deve ser alterado
      expect(room.members.get('victim-peer').isMuted).toBe(false);
    });
  });

  describe('A08: Deduplicação de Mensagens P2P e Prevenção de Tempestade em Malha', () => {
    it('isDuplicateMessage deve identificar e filtrar mensagens com mesmo msgId', () => {
      expect(isDuplicateMessage('msg-unique-1')).toBe(false);
      expect(isDuplicateMessage('msg-unique-1')).toBe(true);
      expect(isDuplicateMessage('msg-unique-2')).toBe(false);
    });

    it('handleIncomingP2PMessage descarta silenciosamente mensagens duplicadas', () => {
      const mockConn = { peer: 'sender-a', send: vi.fn(), open: true };
      const chatPayload = {
        msgId: 'dedup-msg-123',
        type: 'CHAT_MESSAGE',
        message: {
          id: 'dedup-msg-123',
          channel: 'geral',
          senderId: 'sender-a',
          senderName: 'Amigo',
          role: 'viewer',
          text: 'Mensagem única',
          timestamp: Date.now()
        }
      };

      handleIncomingP2PMessage(chatPayload, mockConn);
      expect(chatManager.getMessages('geral')).toHaveLength(1);

      // Envia a mesma mensagem novamente (loop de malha ou eco)
      handleIncomingP2PMessage(chatPayload, mockConn);
      // Não deve ter adicionado uma segunda mensagem
      expect(chatManager.getMessages('geral')).toHaveLength(1);
    });
  });

  describe('A07: Push-to-Talk (PTT) Inicialização Segura', () => {
    it('ao entrar na voz em modo PTT, faixas locais devem iniciar com enabled = false', async () => {
      const mockTrack = { kind: 'audio', enabled: true, stop: vi.fn() };
      const mockStream = {
        getAudioTracks: () => [mockTrack],
        getTracks: () => [mockTrack]
      };

      voiceManager.setVoiceMode('ptt');
      await voiceManager.joinVoice({
        peerId: 'ptt-user',
        customStream: mockStream
      });

      expect(voiceManager.isMuted).toBe(true);
      expect(mockTrack.enabled).toBe(false);

      // Ativar PTT
      voiceManager.setPttActive(true);
      expect(voiceManager.isMuted).toBe(false);
      expect(mockTrack.enabled).toBe(true);

      // Soltar PTT
      voiceManager.setPttActive(false);
      expect(voiceManager.isMuted).toBe(true);
      expect(mockTrack.enabled).toBe(false);
    });
  });

  describe('A16 / A17 / A18: Confiabilidade de Rede, ABR e WebRTC', () => {
    it('ABR: processSample deve ignorar amostras incompletas ou NaN', () => {
      const abr = new AdaptiveBitrateController({
        targetBitrateBps: 8000000,
        minBitrateBps: 2000000
      });

      abr.processSample({ packetLossRate: 0.1, rttMs: 300 }); // Degrada para 6M
      expect(abr.currentBitrateBps).toBe(6000000);

      // Envia telemetrias nulas ou inválidas
      abr.processSample({});
      abr.processSample({ packetLossRate: NaN, rttMs: undefined });
      abr.processSample(null);

      // Não deve ter recuperado bitrate falsamente
      expect(abr.currentBitrateBps).toBe(6000000);
    });

    it('WebRTC: applyTransceiverOptimizations deve aplicar jitterBufferTarget em ms e playoutDelayHint em s', () => {
      const receiver = { jitterBufferTarget: 0, playoutDelayHint: 0 };
      const pc = {
        getTransceivers: () => [{ receiver }]
      };

      applyTransceiverOptimizations(pc, 'stable');
      expect(receiver.jitterBufferTarget).toBe(50); // 50 milissegundos
      expect(receiver.playoutDelayHint).toBe(0.05); // 0.05 segundos
    });

    it('Config: fetchIceServersFromApi deve usar fallback caso /api/turn dê erro ou timeout', async () => {
      _resetDynamicIceCache();
      const originalFetch = global.fetch;
      global.fetch = () => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 50));

      const servers = await fetchIceServersFromApi(30);
      expect(servers).toEqual(DEFAULT_ICE_SERVERS);

      global.fetch = originalFetch;
      _resetDynamicIceCache();
    });
  });
});
