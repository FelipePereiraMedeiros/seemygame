/**
 * SeeMyGame - Controlador de Interface Estilo Discord (Voz, Chat, Emojis e Sons)
 */

import { chatManager } from './chat.js';
import { voiceManager } from './voice.js';
import { SOUNDBOARD_PRESETS } from './soundboard.js';

export const EMOJI_REACTION_PRESETS = [
  { emoji: '🔥', name: 'Hype', desc: 'Jogada de mestre' },
  { emoji: '💀', name: 'RIP / F', desc: 'Não deu dessa vez' },
  { emoji: '🎯', name: 'Mira Boa', desc: 'Na mosca!' },
  { emoji: '👏', name: 'Palmas', desc: 'Boa, time!' },
  { emoji: '😂', name: 'Kkkk', desc: 'Rindo muito' },
  { emoji: 'GG', name: 'Good Game', desc: 'Partida lendária' },
  { emoji: '🚀', name: 'Decolou', desc: 'Voando alto' },
  { emoji: '❤️', name: 'Amei', desc: 'Muito carinho' },
];

export class DiscordUIController {
  constructor({
    onSendMessage,
    onJoinVoice,
    onLeaveVoice,
    onPlaySound,
    onSendReaction,
    onToggleMic,
    onToggleDeaf,
    onToggleStream,
    onOpenTuning,
    onOpenWhiteboard,
    onLeaveRoom,
  } = {}) {
    this.onSendMessage = onSendMessage || (() => {});
    this.onJoinVoice = onJoinVoice || (() => {});
    this.onLeaveVoice = onLeaveVoice || (() => {});
    this.onPlaySound = onPlaySound || (() => {});
    this.onSendReaction = onSendReaction || (() => {});
    this.onToggleMic = onToggleMic || (() => {});
    this.onToggleDeaf = onToggleDeaf || (() => {});
    this.onToggleStream = onToggleStream || (() => {});
    this.onOpenTuning = onOpenTuning || (() => {});
    this.onOpenWhiteboard = onOpenWhiteboard || (() => {});
    this.onLeaveRoom = onLeaveRoom || (() => {});
    this.activeTab = 'chat'; // 'chat' | 'voice' | 'emojis' | 'soundboard'
    this.isDrawerOpen = false;

    this.elements = {};
  }

  init() {
    if (typeof document === 'undefined') return;

    this.elements = {
      drawer: document.getElementById('discord-drawer'),
      toggleChatBtn: document.getElementById('toggle-chat-btn'),
      toggleVoiceBtn: document.getElementById('toggle-voice-btn'),
      toggleEmojisBtn: document.getElementById('toggle-emojis-btn'),
      toggleSoundBtn: document.getElementById('toggle-soundboard-btn'),
      railChatBtn: document.getElementById('rail-btn-chat'),
      railVoiceBtn: document.getElementById('rail-btn-voice'),
      railEmojisBtn: document.getElementById('rail-btn-emojis'),
      railSoundboardBtn: document.getElementById('rail-btn-soundboard'),
      chatBadge: document.getElementById('chat-unread-badge'),
      voiceBadge: document.getElementById('voice-badge'),
      railChatBadge: document.getElementById('rail-chat-badge'),
      railVoiceBadge: document.getElementById('rail-voice-badge'),
      closeBtn: document.getElementById('drawer-close-btn'),
      tabVoice: document.getElementById('tab-btn-voice'),
      tabChat: document.getElementById('tab-btn-chat'),
      tabEmojis: document.getElementById('tab-btn-emojis'),
      tabSoundboard: document.getElementById('tab-btn-soundboard'),
      panelVoice: document.getElementById('drawer-panel-voice'),
      panelChat: document.getElementById('drawer-panel-chat'),
      panelEmojis: document.getElementById('drawer-panel-emojis'),
      panelSoundboard: document.getElementById('drawer-panel-soundboard'),
      emojisGrid: document.getElementById('emojis-grid'),
      soundboardGrid: document.getElementById('soundboard-grid'),
      chatMessages: document.getElementById('chat-messages-container'),
      chatInput: document.getElementById('chat-input'),
      chatSendBtn: document.getElementById('chat-send-btn'),
      chatEmojiTriggerBtn: document.getElementById('chat-emoji-trigger-btn'),
      voiceParticipants: document.getElementById('voice-participants-list'),
      voiceMuteBtn: document.getElementById('voice-mute-btn'),
      voiceDeafBtn: document.getElementById('voice-deaf-btn'),
      voiceModeBtn: document.getElementById('voice-mode-btn'),
      voiceConnectBtn: document.getElementById('voice-connect-btn'),
      voiceStatusBar: document.getElementById('voice-status-bar'),

      // Elementos do Layout da Sala (Room-First)
      roomParticipantsList: document.getElementById('room-participants-list'),
      voiceStageGrid: document.getElementById('voice-stage-grid'),
      videoGrid: document.getElementById('video-grid'),
      sidebarMembersCount: document.getElementById('sidebar-members-count'),
      sidebarRoomName: document.getElementById('sidebar-room-name'),
      localUserName: document.getElementById('local-user-name'),
      localAvatar: document.getElementById('local-avatar'),
      dockMicBtn: document.getElementById('dock-mic-btn'),
      dockDeafBtn: document.getElementById('dock-deaf-btn'),
      dockStreamBtn: document.getElementById('dock-stream-btn'),
      dockTuningBtn: document.getElementById('dock-tuning-btn'),
      dockWhiteboardBtn: document.getElementById('dock-whiteboard-btn'),
      dockLeaveBtn: document.getElementById('dock-leave-btn'),
      quickMicBtn: document.getElementById('quick-mic-btn'),
      quickDeafBtn: document.getElementById('quick-deaf-btn'),
      quickTuningBtn: document.getElementById('quick-tuning-btn'),
    };

    this.bindEvents();
    this.bindChatEvents();
    this.bindVoiceEvents();
    this.bindRoomDockEvents();
    this.initSoundboard();
    this.initEmojis();
  }

  bindEvents() {
    const {
      toggleChatBtn,
      toggleVoiceBtn,
      toggleEmojisBtn,
      toggleSoundBtn,
      railChatBtn,
      railVoiceBtn,
      railEmojisBtn,
      railSoundboardBtn,
      closeBtn,
      tabVoice,
      tabChat,
      tabEmojis,
      tabSoundboard,
      chatInput,
      chatSendBtn,
      chatEmojiTriggerBtn,
      voiceMuteBtn,
      voiceDeafBtn,
      voiceModeBtn,
      voiceConnectBtn,
    } = this.elements;

    // Abertura / Alternância do Drawer (Topo)
    if (toggleChatBtn) {
      toggleChatBtn.addEventListener('click', () => this.toggleDrawer('chat'));
    }
    if (toggleVoiceBtn) {
      toggleVoiceBtn.addEventListener('click', () => this.toggleDrawer('voice'));
    }
    if (toggleEmojisBtn) {
      toggleEmojisBtn.addEventListener('click', () => this.toggleDrawer('emojis'));
    }
    if (toggleSoundBtn) {
      toggleSoundBtn.addEventListener('click', () => this.toggleDrawer('soundboard'));
    }

    // Mini-Rail Lateral Discord (Margem Esquerda)
    if (railChatBtn) {
      railChatBtn.addEventListener('click', () => this.toggleDrawer('chat'));
    }
    if (railVoiceBtn) {
      railVoiceBtn.addEventListener('click', () => this.toggleDrawer('voice'));
    }
    if (railEmojisBtn) {
      railEmojisBtn.addEventListener('click', () => this.toggleDrawer('emojis'));
    }
    if (railSoundboardBtn) {
      railSoundboardBtn.addEventListener('click', () => this.toggleDrawer('soundboard'));
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeDrawer());
    }

    // Abas de Canais
    if (tabChat) {
      tabChat.addEventListener('click', () => this.switchTab('chat'));
    }
    if (tabVoice) {
      tabVoice.addEventListener('click', () => this.switchTab('voice'));
    }
    if (tabEmojis) {
      tabEmojis.addEventListener('click', () => this.switchTab('emojis'));
    }
    if (tabSoundboard) {
      tabSoundboard.addEventListener('click', () => this.switchTab('soundboard'));
    }

    // Botão de Emoji no Chat
    if (chatEmojiTriggerBtn) {
      chatEmojiTriggerBtn.addEventListener('click', () => {
        this.switchTab('emojis');
      });
    }

    // Atalho Escape para fechar
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isDrawerOpen) {
          this.closeDrawer();
        }
      });
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
    const {
      toggleChatBtn,
      toggleVoiceBtn,
      toggleEmojisBtn,
      toggleSoundBtn,
      railChatBtn,
      railVoiceBtn,
      railEmojisBtn,
      railSoundboardBtn,
    } = this.elements;

    if (toggleChatBtn) toggleChatBtn.classList.remove('active');
    if (toggleVoiceBtn) toggleVoiceBtn.classList.remove('active');
    if (toggleEmojisBtn) toggleEmojisBtn.classList.remove('active');
    if (toggleSoundBtn) toggleSoundBtn.classList.remove('active');

    if (railChatBtn) railChatBtn.classList.remove('active');
    if (railVoiceBtn) railVoiceBtn.classList.remove('active');
    if (railEmojisBtn) railEmojisBtn.classList.remove('active');
    if (railSoundboardBtn) railSoundboardBtn.classList.remove('active');

    chatManager.setChatOpen(false);
  }

  switchTab(tab) {
    this.activeTab = tab;
    const {
      tabVoice,
      tabChat,
      tabEmojis,
      tabSoundboard,
      panelVoice,
      panelChat,
      panelEmojis,
      panelSoundboard,
      toggleChatBtn,
      toggleVoiceBtn,
      toggleEmojisBtn,
      toggleSoundBtn,
      railChatBtn,
      railVoiceBtn,
      railEmojisBtn,
      railSoundboardBtn,
    } = this.elements;

    if (tabChat) tabChat.classList.toggle('active', tab === 'chat');
    if (tabVoice) tabVoice.classList.toggle('active', tab === 'voice');
    if (tabEmojis) tabEmojis.classList.toggle('active', tab === 'emojis');
    if (tabSoundboard) tabSoundboard.classList.toggle('active', tab === 'soundboard');

    if (panelChat) panelChat.style.display = tab === 'chat' ? 'flex' : 'none';
    if (panelVoice) panelVoice.style.display = tab === 'voice' ? 'flex' : 'none';
    if (panelEmojis) panelEmojis.style.display = tab === 'emojis' ? 'flex' : 'none';
    if (panelSoundboard) panelSoundboard.style.display = tab === 'soundboard' ? 'flex' : 'none';

    if (toggleChatBtn) toggleChatBtn.classList.toggle('active', tab === 'chat');
    if (toggleVoiceBtn) toggleVoiceBtn.classList.toggle('active', tab === 'voice');
    if (toggleEmojisBtn) toggleEmojisBtn.classList.toggle('active', tab === 'emojis');
    if (toggleSoundBtn) toggleSoundBtn.classList.toggle('active', tab === 'soundboard');

    if (railChatBtn) railChatBtn.classList.toggle('active', tab === 'chat');
    if (railVoiceBtn) railVoiceBtn.classList.toggle('active', tab === 'voice');
    if (railEmojisBtn) railEmojisBtn.classList.toggle('active', tab === 'emojis');
    if (railSoundboardBtn) railSoundboardBtn.classList.toggle('active', tab === 'soundboard');

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

  initEmojis() {
    const grid = this.elements.emojisGrid;
    if (!grid) return;
    grid.innerHTML = '';
    EMOJI_REACTION_PRESETS.forEach((preset) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'emoji-reaction-card';
      card.dataset.emoji = preset.emoji;
      card.setAttribute('data-emoji', preset.emoji);
      card.title = `Disparar reação ${preset.emoji} (${preset.name})`;
      card.innerHTML = `
        <span class="emoji-icon">${preset.emoji}</span>
        <span class="emoji-name">${preset.name}</span>
        <span class="emoji-desc">${preset.desc}</span>
      `;
      card.addEventListener('click', () => {
        this.onSendReaction(preset.emoji);
      });
      grid.appendChild(card);
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
    const badges = [this.elements.chatBadge, this.elements.railChatBadge];
    badges.forEach((badge) => {
      if (!badge) return;
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    });
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
    const badges = [this.elements.voiceBadge, this.elements.railVoiceBadge];

    badges.forEach((badge) => {
      if (!badge) return;
      if (participants && participants.length > 0) {
        badge.textContent = participants.length;
        badge.style.display = 'inline-block';
        badge.classList.add('voice-active-badge');
      } else {
        badge.style.display = 'none';
      }
    });

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

    // Sincroniza botões do Dock inferior e Quick actions
    const { dockMicBtn, quickMicBtn, dockDeafBtn, quickDeafBtn } = this.elements;
    if (dockMicBtn) {
      if (state.isMuted) {
        dockMicBtn.innerHTML = '<span>🔇</span> <span class="dock-label">Desmutar</span>';
        dockMicBtn.classList.add('is-muted');
      } else {
        dockMicBtn.innerHTML = '<span>🎙️</span> <span class="dock-label">Microfone</span>';
        dockMicBtn.classList.remove('is-muted');
      }
    }
    if (quickMicBtn) {
      quickMicBtn.classList.toggle('active-muted', Boolean(state.isMuted));
      quickMicBtn.innerHTML = state.isMuted ? '🔇' : '🎙️';
    }

    if (dockDeafBtn) {
      if (state.isDeafened) {
        dockDeafBtn.innerHTML = '<span>🎧❌</span> <span class="dock-label">Desensurdecer</span>';
        dockDeafBtn.classList.add('is-muted');
      } else {
        dockDeafBtn.innerHTML = '<span>🎧</span> <span class="dock-label">Áudio</span>';
        dockDeafBtn.classList.remove('is-muted');
      }
    }
    if (quickDeafBtn) {
      quickDeafBtn.classList.toggle('active-muted', Boolean(state.isDeafened));
      quickDeafBtn.innerHTML = state.isDeafened ? '🎧❌' : '🎧';
    }
  }

  bindRoomDockEvents() {
    const {
      dockMicBtn,
      dockDeafBtn,
      dockStreamBtn,
      dockTuningBtn,
      dockWhiteboardBtn,
      dockLeaveBtn,
      quickMicBtn,
      quickDeafBtn,
      quickTuningBtn,
    } = this.elements;

    const handleMicToggle = () => {
      const isMuted = voiceManager.toggleMute();
      this.onToggleMic(isMuted);
    };

    const handleDeafToggle = () => {
      const isDeaf = voiceManager.toggleDeafen();
      this.onToggleDeaf(isDeaf);
    };

    if (dockMicBtn) dockMicBtn.addEventListener('click', handleMicToggle);
    if (quickMicBtn) quickMicBtn.addEventListener('click', handleMicToggle);

    if (dockDeafBtn) dockDeafBtn.addEventListener('click', handleDeafToggle);
    if (quickDeafBtn) quickDeafBtn.addEventListener('click', handleDeafToggle);

    if (dockStreamBtn) dockStreamBtn.addEventListener('click', () => this.onToggleStream());
    if (dockTuningBtn) dockTuningBtn.addEventListener('click', () => this.onOpenTuning());
    if (quickTuningBtn) quickTuningBtn.addEventListener('click', () => this.onOpenTuning());
    if (dockWhiteboardBtn) dockWhiteboardBtn.addEventListener('click', () => this.onOpenWhiteboard());
    if (dockLeaveBtn) dockLeaveBtn.addEventListener('click', () => this.onLeaveRoom());
  }

  setStreamingState(isStreaming) {
    const { dockStreamBtn } = this.elements;
    if (dockStreamBtn) {
      if (isStreaming) {
        dockStreamBtn.innerHTML = '<span>⏹️</span> <span class="dock-label">Parar Stream</span>';
        dockStreamBtn.classList.add('is-streaming');
      } else {
        dockStreamBtn.innerHTML = '<span>🚀</span> <span class="dock-label">Transmitir Jogo</span>';
        dockStreamBtn.classList.remove('is-streaming');
      }
    }
  }

  updateRoomPresence(members) {
    const { roomParticipantsList, voiceStageGrid, sidebarMembersCount } = this.elements;

    if (sidebarMembersCount && Array.isArray(members)) {
      sidebarMembersCount.textContent = `${members.length} online`;
    }

    if (roomParticipantsList && Array.isArray(members)) {
      roomParticipantsList.innerHTML = '';
      members.forEach((m) => {
        const initial = (m.name || 'A').charAt(0).toUpperCase();
        const item = document.createElement('div');
        item.className = 'participant-item';
        item.id = `participant-item-${m.peerId}`;

        const isSpeaking = m.isSpeaking ? 'speaking' : '';
        const muteIcon = m.isMuted ? '🔇' : '';
        const deafIcon = m.isDeafened ? '🎧❌' : '';

        item.innerHTML = `
          <div class="participant-avatar-wrapper">
            <div class="participant-avatar ${isSpeaking}" id="sidebar-avatar-${m.peerId}">
              ${initial}
            </div>
          </div>
          <div class="participant-info">
            <div class="participant-name-row">
              <span class="participant-name">${m.name}</span>
            </div>
            <div class="participant-badges">
              ${m.isMaster ? '<span class="badge-host-tag">HOST</span>' : ''}
              ${m.isStreaming ? '<span class="badge-live-tag">AO VIVO</span>' : ''}
            </div>
          </div>
          <div class="participant-icons">
            ${muteIcon ? `<span>${muteIcon}</span>` : ''}
            ${deafIcon ? `<span>${deafIcon}</span>` : ''}
          </div>
        `;
        roomParticipantsList.appendChild(item);
      });
    }

    if (voiceStageGrid && Array.isArray(members)) {
      voiceStageGrid.innerHTML = '';
      members.forEach((m) => {
        const initial = (m.name || 'A').charAt(0).toUpperCase();
        const tile = document.createElement('div');
        tile.className = `voice-tile ${m.isSpeaking ? 'speaking' : ''}`;
        tile.id = `stage-tile-${m.peerId}`;

        tile.innerHTML = `
          <div class="voice-tile-avatar">${initial}</div>
          <div class="voice-tile-name">${m.name}</div>
          ${m.isStreaming ? '<div class="badge-live-tag" style="margin-top: 6px;">AO VIVO</div>' : ''}
        `;
        voiceStageGrid.appendChild(tile);
      });
    }
  }

  syncStageView(hasActiveStreams) {
    const { voiceStageGrid, videoGrid } = this.elements;
    if (videoGrid && voiceStageGrid) {
      if (hasActiveStreams) {
        videoGrid.style.display = 'flex';
        voiceStageGrid.style.display = 'none';
      } else {
        videoGrid.style.display = 'none';
        voiceStageGrid.style.display = 'flex';
      }
    }
  }
}

