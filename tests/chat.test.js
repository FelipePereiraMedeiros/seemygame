import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatManager, sanitizeText, formatTimestamp } from '../js/chat.js';

describe('Módulo: chat.js (Chat de Texto Estilo Discord)', () => {
  let chat;

  beforeEach(() => {
    chat = new ChatManager();
  });

  describe('Sanitização e Formatação', () => {
    it('deve sanitizar tags HTML e caracteres perigosos contra XSS', () => {
      const malicious = '<script>alert("hack")</script> & "teste" \'aspas\'';
      const clean = sanitizeText(malicious);
      expect(clean).not.toContain('<script>');
      expect(clean).toContain('&lt;script&gt;');
      expect(clean).toContain('&amp;');
      expect(clean).toContain('&quot;');
      expect(clean).toContain('&#39;');
    });

    it('deve formatar timestamps corretamente em HH:MM', () => {
      const formatted = formatTimestamp(1700000000000);
      expect(formatted).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  describe('Criação e Adição de Mensagens', () => {
    it('deve criar uma mensagem de chat estruturada com timestamp e id', () => {
      const msg = chat.createMessage({
        senderId: 'user-123',
        senderName: 'GamerPro',
        role: 'host',
        text: 'Olá mundo!',
      });

      expect(msg).toBeDefined();
      expect(msg.id).toMatch(/^msg_/);
      expect(msg.senderName).toBe('GamerPro');
      expect(msg.role).toBe('host');
      expect(msg.text).toBe('Olá mundo!');
      expect(msg.channel).toBe('geral');
      expect(msg.isSystem).toBe(false);
    });

    it('não deve criar mensagem com texto vazio ou apenas espaços', () => {
      const msg = chat.createMessage({
        senderId: 'user-123',
        text: '   ',
      });
      expect(msg).toBeNull();
    });

    it('deve adicionar mensagem e recuperá-la na lista do canal', () => {
      const msg = chat.createMessage({
        senderId: 'user-123',
        text: 'Primeira mensagem',
      });
      chat.addMessage(msg);

      const messages = chat.getMessages('geral');
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Primeira mensagem');
    });

    it('deve permitir mensagens de sistema com role system', () => {
      const sysMsg = chat.addSystemMessage('Jogador 2 conectou-se!');
      expect(sysMsg.role).toBe('system');
      expect(sysMsg.isSystem).toBe(true);
      expect(sysMsg.text).toBe('Jogador 2 conectou-se!');
    });
  });

  describe('Canais e Não Lidas', () => {
    it('deve incrementar contador de não lidas se o chat estiver fechado', () => {
      chat.setChatOpen(false);
      const msg = chat.createMessage({ senderId: 'u1', text: 'Oi' });
      chat.addMessage(msg);

      expect(chat.getUnreadCount('geral')).toBe(1);
      expect(chat.getTotalUnreadCount()).toBe(1);
    });

    it('não deve incrementar contador de não lidas do canal ativo se o chat estiver aberto', () => {
      chat.setChatOpen(true);
      const msg = chat.createMessage({ senderId: 'u1', text: 'Oi' });
      chat.addMessage(msg);

      expect(chat.getUnreadCount('geral')).toBe(0);
      expect(chat.getTotalUnreadCount()).toBe(0);
    });

    it('deve zerar as não lidas ao marcar o canal como lido ou abrir o chat', () => {
      chat.setChatOpen(false);
      chat.addMessage(chat.createMessage({ senderId: 'u1', text: 'Oi 1' }));
      chat.addMessage(chat.createMessage({ senderId: 'u1', text: 'Oi 2' }));
      expect(chat.getUnreadCount('geral')).toBe(2);

      chat.setChatOpen(true);
      expect(chat.getUnreadCount('geral')).toBe(0);
    });

    it('deve gerenciar canais múltiplos e alternar canal ativo', () => {
      chat.setActiveChannel('comandos');
      expect(chat.getActiveChannel()).toBe('comandos');

      chat.addMessage(chat.createMessage({ senderId: 'u1', text: '!help', channel: 'comandos' }));
      expect(chat.getMessages('comandos')).toHaveLength(1);
      expect(chat.getMessages('geral')).toHaveLength(0);
    });

    it('deve disparar eventos de mensagem, unread e channelChange', () => {
      const msgSpy = vi.fn();
      const unreadSpy = vi.fn();
      const chanSpy = vi.fn();

      chat.on('message', msgSpy);
      chat.on('unread', unreadSpy);
      chat.on('channelChange', chanSpy);

      chat.setChatOpen(false);
      chat.setActiveChannel('comandos');
      expect(chanSpy).toHaveBeenCalledWith('comandos');

      chat.addMessage(chat.createMessage({ senderId: 'u1', text: 'Teste evento' }));
      expect(msgSpy).toHaveBeenCalled();
      expect(unreadSpy).toHaveBeenCalled();
    });

    it('deve limpar mensagens de um canal quando solicitado', () => {
      chat.addMessage(chat.createMessage({ senderId: 'u1', text: 'Msg 1' }));
      expect(chat.getMessages('geral')).toHaveLength(1);

      chat.clearChannel('geral');
      expect(chat.getMessages('geral')).toHaveLength(0);
    });
  });
});
