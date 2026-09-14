/**
 * SeeMyGame - Controlador de Interface Estilo Discord (Voz e Chat)
 */

import { chatManager } from './chat.js';
import { voiceManager } from './voice.js';
import { SOUNDBOARD_PRESETS } from './soundboard.js';

export class DiscordUIController {
  constructor({ onSendMessage, onJoinVoice, onLeaveVoice, onPlaySound } = {}) {
    this.onSendMessage = onSendMessage || (() => {});
    this.onJoinVoice = onJoinVoice || (() => {});
    this.onLeaveVoice = onLeaveVoice || (() => {});
    this.onPlaySound = onPlaySound || (() => {});
    this.activeTab = 'chat'; // 'chat' | 'voice' | 'soundboard'
    this.isDrawerOpen = false;

    this.elements = {};
  }

  init() {
    if (typeof document === 'undefined') return;

    this.elements = {
      drawer: document.getElementById('discord-drawer'),
      toggleChatBtn: document.getElementById('toggle-chat-btn'),
      toggleVoiceBtn: document.getElementById('toggle-voice-btn'),
      chatBadge: document.getElementById('chat-unread-badge'),
      voiceBadge: document.getElementById('voice-badge'),
      closeBtn: document.getElementById('drawer-close-btn'),
      tabVoice: document.getElementById('tab-btn-voice'),
      tabChat: document.getElementById('tab-btn-chat'),
      tabSoundboard: document.getElementById('tab-btn-soundboard'),
      panelVoice: document.getElementById('drawer-panel-voice'),
      panelChat: document.getElementById('drawer-panel-chat'),
      panelSoundboard: document.getElementById('drawer-panel-soundboard'),
      soundboardGrid: document.getElementById('soundboard-grid'),
      chatMessages: document.getElementById('chat-messages-container'),
      chatInput: document.getElementById('chat-input'),
      chatSendBtn: document.getElementById('chat-send-btn'),
      voiceParticipants: document.getElementById('voice-participants-list'),
      voiceMuteBtn: document.getElementById('voice-mute-btn'),
      voiceDeafBtn: document.getElementById('voice-deaf-btn'),
      voiceModeBtn: document.getElementById('voice-mode-btn'),
      voiceConnectBtn: document.getElementById('voice-connect-btn'),
      voiceStatusBar: document.getElementById('voice-status-bar'),
    };

    this.bindEvents();
    this.bindChatEvents();
    this.bindVoiceEvents();
    this.initSoundboard();
  }

  bindEvents() {
    const { toggleChatBtn, toggleVoiceBtn, closeBtn, tabVoice, tabChat, tabSoundboard, chatInput, chatSendBtn, voiceMuteBtn, voiceDeafBtn, voiceModeBtn, voiceConnectBtn } = this.elements;

    if (toggleChatBtn) {
      toggleChatBtn.addEventListener('click', () => this.toggleDrawer('chat'));
    }
    if (toggleVoiceBtn) {
      toggleVoiceBtn.addEventListener('click', () => this.toggleDrawer('voice'));
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeDrawer());
    }

    if (tabVoice) {
      tabVoice.addEventListener('click', () => this.switchTab('voice'));
    }
    if (tabChat) {
      tabChat.addEventListener('click', () => this.switchTab('chat'));
    }
    if (tabSoundboard) {
      tabSoundboard.addEventListener('click', () => this.switchTab('soundboard'));
    }

    // Envio de chat
    const handleSend = () => {
      if (!chatInput) return;
      const text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = '';
      this.onSendMessage(text);
      chatInput.focus();
    };

    if (chatSendBtn) {
      chatSendBtn.addEventListener('click', handleSend);
    }
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });
    }

    // Controles de voz
    if (voiceMuteBtn) {
      voiceMuteBtn.addEventListener('click', () => {
        voiceManager.toggleMute();
      });
    }
    if (voiceDeafBtn) {
      voiceDeafBtn.addEventListener('click', () => {
        voiceManager.toggleDeafen();
      });
    }
    if (voiceModeBtn) {
      voiceModeBtn.addEventListener('click', () => {
        const nextMode = voiceManager.voiceMode === 'vad' ? 'ptt' : 'vad';
        voiceManager.setVoiceMode(nextMode);
      });
    }
    if (voiceConnectBtn) {
      voiceConnectBtn.addEventListener('click', () => {
        if (voiceManager.isInVoice) {
          this.onLeaveVoice();
        } else {
          this.onJoinVoice();
        }
      });
    }
  }

  toggleDrawer(tab = 'chat') {
    if (this.isDrawerOpen && this.activeTab === tab) {
      this.closeDrawer();
    } else {
      this.openDrawer(tab);
    }
  }

  openDrawer(tab = 'chat') {
    this.isDrawerOpen = true;
    if (this.elements.drawer) {
      this.elements.drawer.classList.add('open');
    }
    this.switchTab(tab);
    chatManager.setChatOpen(true);
    this.updateChatBadge(0);
  }

  closeDrawer() {
    this.isDrawerOpen = false;
    if (this.elements.drawer) {
      this.elements.drawer.classList.remove('open');
    }
    if (this.elements.toggleChatBtn) this.elements.toggleChatBtn.classList.remove('active');
    if (this.elements.toggleVoiceBtn) this.elements.toggleVoiceBtn.classList.remove('active');
    chatManager.setChatOpen(false);
  }

  switchTab(tab) {
    this.activeTab = tab;
    const { tabVoice, tabChat, tabSoundboard, panelVoice, panelChat, panelSoundboard, toggleChatBtn, toggleVoiceBtn } = this.elements;

    if (tabVoice) tabVoice.classList.toggle('active', tab === 'voice');
    if (tabChat) tabChat.classList.toggle('active', tab === 'chat');
    if (tabSoundboard) tabSoundboard.classList.toggle('active', tab === 'soundboard');

    if (panelVoice) panelVoice.style.display = tab === 'voice' ? 'flex' : 'none';
    if (panelChat) panelChat.style.display = tab === 'chat' ? 'flex' : 'none';
    if (panelSoundboard) panelSoundboard.style.display = tab === 'soundboard' ? 'flex' : 'none';

    if (toggleVoiceBtn) toggleVoiceBtn.classList.toggle('active', tab === 'voice');
    if (toggleChatBtn) toggleChatBtn.classList.toggle('active', tab === 'chat');

    if (tab === 'chat') {
      chatManager.markChannelAsRead();
      this.updateChatBadge(0);
      if (this.elements.chatInput) this.elements.chatInput.focus();
    }
  }

  initSoundboard() {
    const grid = this.elements.soundboardGrid;
    if (!grid) return;
    grid.innerHTML = '';
    SOUNDBOARD_PRESETS.forEach((preset) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'soundboard-btn';
      btn.dataset.soundId = preset.id;
      btn.innerHTML = `
        <span class="sound-emoji">${preset.icon || preset.emoji || '🔊'}</span>
        <span class="sound-name">${preset.name}</span>
      `;
      btn.addEventListener('click', () => {
        this.onPlaySound(preset.id);
      });
      grid.appendChild(btn);
    });
  }

  bindChatEvents() {
    chatManager.on('message', (msg) => {
      this.renderChatMessage(msg);
    });

    chatManager.on('unread', ({ total }) => {
      if (!this.isDrawerOpen || this.activeTab !== 'chat') {
        this.updateChatBadge(total);
      }
    });
  }

  renderChatMessage(msg) {
    const container = this.elements.chatMessages;
    if (!container || !msg) return;

    if (msg.isSystem) {
      const sysEl = document.createElement('div');
      sysEl.className = 'chat-message-system';
      sysEl.textContent = `ℹ️ ${msg.text}`;
      container.appendChild(sysEl);
    } else {
      const item = document.createElement('div');
      item.className = 'chat-message-item';

      const initial = (msg.senderName || 'U').charAt(0).toUpperCase();
      const roleBadge = `<span class="chat-role-badge ${msg.role || 'viewer'}">${(msg.role || 'espectador').toUpperCase()}</span>`;

      item.innerHTML = `
        <div class="chat-message-avatar">${initial}</div>
        <div class="chat-message-body">
          <div class="chat-message-meta">
            <span class="chat-author">${msg.senderName}</span>
            ${roleBadge}
            <span class="chat-timestamp">${msg.formattedTime || ''}</span>
          </div>
          <div class="chat-content">${msg.text}</div>
        </div>
      `;

      container.appendChild(item);
    }

    // Auto-scroll para a mensagem mais recente
    container.scrollTop = container.scrollHeight;
  }

  updateChatBadge(count) {
    const badge = this.elements.chatBadge;
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  bindVoiceEvents() {
    voiceManager.on('participantUpdate', (participants) => {
      this.renderVoiceParticipants(participants);
    });

    voiceManager.on('speakingChange', ({ peerId, isSpeaking }) => {
      const avatar = document.getElementById(`voice-avatar-${peerId}`);
      if (avatar) {
        if (isSpeaking) {
          avatar.classList.add('speaking');
        } else {
          avatar.classList.remove('speaking');
        }
      }
    });

    voiceManager.on('voiceStateChange', (state) => {
      this.updateVoiceControls(state);
    });
  }

  renderVoiceParticipants(participants) {
    const list = this.elements.voiceParticipants;
    const badge = this.elements.voiceBadge;
    if (badge) {
      if (participants.length > 0) {
        badge.textContent = participants.length;
        badge.style.display = 'inline-block';
        badge.classList.add('voice-active-badge');
      } else {
        badge.style.display = 'none';
      }
    }

    if (!list) return;

    if (!participants || participants.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 24px 12px; font-size: 13px;">
          Ninguém na sala de voz no momento.<br>
          <small>Clique em "Entrar na Voz" abaixo para conversar com microfone.</small>
        </div>
      `;
      return;
    }

    list.innerHTML = '';
    participants.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'voice-user-card';

      const initial = (p.name || 'U').charAt(0).toUpperCase();
      const muteIcon = p.isMuted ? '🔇' : '🎙️';
      const deafIcon = p.isDeafened ? '🎧❌' : '';
      const isSpeakingClass = p.isSpeaking ? 'speaking' : '';

      card.innerHTML = `
        <div class="voice-user-info">
          <div id="voice-avatar-${p.peerId}" class="avatar-circle ${isSpeakingClass}">
            ${initial}
          </div>
          <div class="voice-user-name">
            ${p.name}
            <span class="chat-role-badge ${p.role}">${p.role.toUpperCase()}</span>
          </div>
        </div>
        <div class="voice-user-icons">
          <span title="${p.isMuted ? 'Microfone Mutado' : 'Microfone Ativo'}">${muteIcon}</span>
          ${deafIcon ? `<span title="Ensurdecido">${deafIcon}</span>` : ''}
        </div>
      `;

      list.appendChild(card);
    });
  }

  updateVoiceControls(state) {
    const { voiceMuteBtn, voiceDeafBtn, voiceModeBtn, voiceConnectBtn, voiceStatusBar } = this.elements;

    if (voiceConnectBtn) {
      if (state.isInVoice) {
        voiceConnectBtn.textContent = '📞 Desconectar';
        voiceConnectBtn.className = 'voice-dock-btn leave-btn';
      } else {
        voiceConnectBtn.textContent = '📞 Entrar na Voz';
        voiceConnectBtn.className = 'voice-dock-btn join-btn';
      }
    }

    if (voiceMuteBtn) {
      voiceMuteBtn.disabled = !state.isInVoice;
      if (state.isMuted) {
        voiceMuteBtn.innerHTML = '<span>🔇</span> Desmutar';
        voiceMuteBtn.classList.add('active');
      } else {
        voiceMuteBtn.innerHTML = '<span>🎙️</span> Mutar';
        voiceMuteBtn.classList.remove('active');
      }
    }

    if (voiceDeafBtn) {
      voiceDeafBtn.disabled = !state.isInVoice;
      if (state.isDeafened) {
        voiceDeafBtn.innerHTML = '<span>🎧❌</span> Desensurdecer';
        voiceDeafBtn.classList.add('active');
      } else {
        voiceDeafBtn.innerHTML = '<span>🎧</span> Ensurdecer';
        voiceDeafBtn.classList.remove('active');
      }
    }

    if (voiceModeBtn) {
      voiceModeBtn.disabled = !state.isInVoice;
      if (state.voiceMode === 'ptt') {
        voiceModeBtn.innerHTML = '<span>🎙️</span> PTT (Caps)';
        voiceModeBtn.classList.add('active');
        voiceModeBtn.title = 'Modo Push-to-Talk ativo (segure Caps Lock ou Ctrl Direito para falar)';
      } else {
        voiceModeBtn.innerHTML = '<span>🎤</span> VAD (Auto)';
        voiceModeBtn.classList.remove('active');
        voiceModeBtn.title = 'Modo Detecção de Voz (VAD) contínuo ativo';
      }
    }

    if (voiceStatusBar) {
      if (state.isInVoice) {
        voiceStatusBar.innerHTML = '<span>🟢 Voz Conectada</span> <span>Canal de Baixa Latência</span>';
        voiceStatusBar.style.color = 'var(--accent-green)';
        voiceStatusBar.style.background = 'rgba(16, 185, 129, 0.1)';
        voiceStatusBar.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      } else {
        voiceStatusBar.innerHTML = '<span>⚪ Desconectado da Voz</span> <span>Clique abaixo para entrar</span>';
        voiceStatusBar.style.color = 'var(--text-muted)';
        voiceStatusBar.style.background = 'rgba(255, 255, 255, 0.04)';
        voiceStatusBar.style.borderColor = 'rgba(255, 255, 255, 0.1)';
      }
    }
  }
}
