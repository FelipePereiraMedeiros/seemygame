import { chatManager } from ".././chat.js";
import { voiceManager } from ".././voice.js";
import { SOUNDBOARD_PRESETS, soundboardManager } from ".././soundboard.js";
import { EMOJI_REACTION_PRESETS } from './shared.js';
/** DiscordUIController: drawer. State and lifetime remain owned by the composed engine. */
export const withDiscordUIControllerDrawer = Base => class extends Base {
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
      this.listen(toggleChatBtn, 'click', () => this.toggleDrawer('chat'));
    }
    if (toggleVoiceBtn) {
      this.listen(toggleVoiceBtn, 'click', () => this.toggleDrawer('voice'));
    }
    if (toggleEmojisBtn) {
      this.listen(toggleEmojisBtn, 'click', () => this.toggleDrawer('emojis'));
    }
    if (toggleSoundBtn) {
      this.listen(toggleSoundBtn, 'click', () => this.toggleDrawer('soundboard'));
    }

    // Mini-Rail Lateral Discord (Margem Esquerda)
    if (railChatBtn) {
      this.listen(railChatBtn, 'click', () => this.toggleDrawer('chat'));
    }
    if (railVoiceBtn) {
      this.listen(railVoiceBtn, 'click', () => this.toggleDrawer('voice'));
    }
    if (railEmojisBtn) {
      this.listen(railEmojisBtn, 'click', () => this.toggleDrawer('emojis'));
    }
    if (railSoundboardBtn) {
      this.listen(railSoundboardBtn, 'click', () => this.toggleDrawer('soundboard'));
    }

    if (closeBtn) {
      this.listen(closeBtn, 'click', () => this.closeDrawer());
    }

    // Abas de Canais
    if (tabChat) {
      this.listen(tabChat, 'click', () => this.switchTab('chat'));
    }
    if (tabVoice) {
      this.listen(tabVoice, 'click', () => this.switchTab('voice'));
    }
    if (tabEmojis) {
      this.listen(tabEmojis, 'click', () => this.switchTab('emojis'));
    }
    if (tabSoundboard) {
      this.listen(tabSoundboard, 'click', () => this.switchTab('soundboard'));
    }

    // Botão de Emoji no Chat
    if (chatEmojiTriggerBtn) {
      this.listen(chatEmojiTriggerBtn, 'click', () => {
        this.switchTab('emojis');
      });
    }

    // Atalho Escape para fechar
    if (typeof window !== 'undefined') {
      this.listen(window, 'keydown', (e) => {
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
      this.listen(chatSendBtn, 'click', handleSend);
    }
    if (chatInput) {
      this.listen(chatInput, 'keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });
    }

    // Controles de voz
    if (voiceMuteBtn) {
      this.listen(voiceMuteBtn, 'click', () => {
        voiceManager.toggleMute();
      });
    }
    if (voiceDeafBtn) {
      this.listen(voiceDeafBtn, 'click', () => {
        voiceManager.toggleDeafen();
      });
    }
    if (voiceModeBtn) {
      this.listen(voiceModeBtn, 'click', () => {
        const nextMode = voiceManager.voiceMode === 'vad' ? 'ptt' : 'vad';
        voiceManager.setVoiceMode(nextMode);
      });
    }
    if (voiceConnectBtn) {
      this.listen(voiceConnectBtn, 'click', () => {
        if (voiceManager.isInVoice) {
          this.onLeaveVoice();
        } else {
          this.onJoinVoice();
        }
      });
    }

    // Controles de Volume Pessoal (Mic e Saída Master)
    const { voiceSelfMicSlider, voiceSelfMicVal, voiceSelfOutputSlider, voiceSelfOutputVal, voiceSelfResetBtn } = this.elements;
    if (voiceSelfMicSlider) {
      voiceSelfMicSlider.value = voiceManager.inputVolume;
      if (voiceSelfMicVal) voiceSelfMicVal.textContent = `${voiceManager.inputVolume}%`;
      this.listen(voiceSelfMicSlider, 'input', (e) => {
        const vol = voiceManager.setInputVolume(e.target.value);
        if (voiceSelfMicVal) voiceSelfMicVal.textContent = `${vol}%`;
      });
    }

    if (voiceSelfOutputSlider) {
      voiceSelfOutputSlider.value = voiceManager.outputVolume;
      if (voiceSelfOutputVal) voiceSelfOutputVal.textContent = `${voiceManager.outputVolume}%`;
      this.listen(voiceSelfOutputSlider, 'input', (e) => {
        const vol = voiceManager.setOutputVolume(e.target.value);
        if (voiceSelfOutputVal) voiceSelfOutputVal.textContent = `${vol}%`;
      });
    }

    if (voiceSelfResetBtn) {
      this.listen(voiceSelfResetBtn, 'click', () => {
        voiceManager.setInputVolume(100);
        voiceManager.setOutputVolume(100);
        if (voiceSelfMicSlider) voiceSelfMicSlider.value = 100;
        if (voiceSelfMicVal) voiceSelfMicVal.textContent = '100%';
        if (voiceSelfOutputSlider) voiceSelfOutputSlider.value = 100;
        if (voiceSelfOutputVal) voiceSelfOutputVal.textContent = '100%';
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
};
