import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiscordUIController } from '../js/discord-ui.js';
import { chatManager } from '../js/chat.js';
import { voiceManager } from '../js/voice.js';

describe('Módulo: discord-ui.js (Controlador de UI Discord)', () => {
  let controller;
  let onSendMock;
  let onJoinMock;
  let onLeaveMock;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="toggle-chat-btn">Chat</button>
      <button id="toggle-voice-btn">Voz</button>
      <span id="chat-unread-badge" style="display:none;">0</span>
      <span id="voice-badge" style="display:none;">0</span>

      <div id="discord-drawer" class="discord-drawer">
        <div class="drawer-header">
          <div class="drawer-tabs">
            <button id="tab-btn-chat" class="drawer-tab active">Chat</button>
            <button id="tab-btn-voice" class="drawer-tab">Voz</button>
          </div>
          <button id="drawer-close-btn">✕</button>
        </div>

        <div id="drawer-panel-chat" class="chat-panel">
          <div id="chat-messages-container" class="chat-messages-container"></div>
          <div class="chat-input-bar">
            <input type="text" id="chat-input">
            <button id="chat-send-btn">Enviar</button>
          </div>
        </div>

        <div id="drawer-panel-voice" class="voice-panel" style="display:none;">
          <div id="voice-status-bar">Status</div>
          <div id="voice-participants-list" class="voice-participants-list"></div>
          <div class="voice-dock">
            <button id="voice-mute-btn" class="voice-dock-btn">Mutar</button>
            <button id="voice-deaf-btn" class="voice-dock-btn">Ensurdecer</button>
            <button id="voice-connect-btn" class="voice-dock-btn join-btn">Entrar na Voz</button>
          </div>
        </div>
      </div>
    `;

    onSendMock = vi.fn();
    onJoinMock = vi.fn();
    onLeaveMock = vi.fn();

    chatManager.clearChannel('geral');
    chatManager.clearChannel('comandos');
    chatManager.setChatOpen(false);

    controller = new DiscordUIController({
      onSendMessage: onSendMock,
      onJoinVoice: onJoinMock,
      onLeaveVoice: onLeaveMock,
    });
    controller.init();
  });

  afterEach(() => {
    controller.closeDrawer();
  });

  describe('Drawer e Alternância de Abas', () => {
    it('deve abrir e fechar o drawer via toggleDrawer', () => {
      const drawer = document.getElementById('discord-drawer');
      expect(drawer.classList.contains('open')).toBe(false);

      controller.toggleDrawer('chat');
      expect(drawer.classList.contains('open')).toBe(true);
      expect(controller.isDrawerOpen).toBe(true);

      controller.toggleDrawer('chat');
      expect(drawer.classList.contains('open')).toBe(false);
      expect(controller.isDrawerOpen).toBe(false);
    });

    it('deve alternar abas entre chat e voz', () => {
      const panelChat = document.getElementById('drawer-panel-chat');
      const panelVoice = document.getElementById('drawer-panel-voice');

      controller.openDrawer('voice');
      expect(panelVoice.style.display).toBe('flex');
      expect(panelChat.style.display).toBe('none');

      controller.switchTab('chat');
      expect(panelChat.style.display).toBe('flex');
      expect(panelVoice.style.display).toBe('none');
    });
  });

  describe('Envio e Renderização de Chat', () => {
    it('deve disparar onSendMessage ao clicar no botão enviar', () => {
      const input = document.getElementById('chat-input');
      const sendBtn = document.getElementById('chat-send-btn');

      input.value = 'Olá time!';
      sendBtn.click();

      expect(onSendMock).toHaveBeenCalledWith('Olá time!');
      expect(input.value).toBe('');
    });

    it('deve renderizar nova mensagem no feed do chat', () => {
      const container = document.getElementById('chat-messages-container');
      const msg = chatManager.createMessage({
        senderId: 'user-abc',
        senderName: 'Felipe',
        role: 'host',
        text: 'Vamos jogar!',
      });

      chatManager.addMessage(msg);

      expect(container.children.length).toBeGreaterThan(0);
      expect(container.textContent).toContain('Felipe');
      expect(container.textContent).toContain('Vamos jogar!');
    });

    it('deve atualizar o badge de não lidas quando receber mensagem com chat fechado', () => {
      controller.closeDrawer();
      const badge = document.getElementById('chat-unread-badge');

      chatManager.addMessage(chatManager.createMessage({ senderId: 'u2', text: 'Oi' }));
      expect(badge.style.display).not.toBe('none');
      expect(badge.textContent).toBe('1');
    });
  });

  describe('Interface de Voz e VAD (Anel Verde)', () => {
    it('deve disparar onJoinVoice ao clicar em Entrar na Voz quando desconectado', () => {
      const connectBtn = document.getElementById('voice-connect-btn');
      connectBtn.click();
      expect(onJoinMock).toHaveBeenCalled();
    });

    it('deve renderizar lista de participantes de voz', () => {
      const list = document.getElementById('voice-participants-list');
      voiceManager.participants.set('peer-1', {
        peerId: 'peer-1',
        name: 'Diogo',
        role: 'host',
        isMuted: false,
        isDeafened: false,
        isSpeaking: false,
      });

      controller.renderVoiceParticipants(voiceManager.getParticipantsList());

      expect(list.textContent).toContain('Diogo');
      expect(list.textContent).toContain('HOST');
    });

    it('deve adicionar classe .speaking (anel verde) quando o participante estiver falando', () => {
      voiceManager.participants.set('peer-1', {
        peerId: 'peer-1',
        name: 'Diogo',
        role: 'host',
        isMuted: false,
        isDeafened: false,
        isSpeaking: false,
      });
      controller.renderVoiceParticipants(voiceManager.getParticipantsList());

      const avatar = document.getElementById('voice-avatar-peer-1');
      expect(avatar.classList.contains('speaking')).toBe(false);

      voiceManager.emit('speakingChange', { peerId: 'peer-1', isSpeaking: true });
      expect(avatar.classList.contains('speaking')).toBe(true);

      voiceManager.emit('speakingChange', { peerId: 'peer-1', isSpeaking: false });
      expect(avatar.classList.contains('speaking')).toBe(false);
    });
  });
});
