import { chatManager } from ".././chat.js";
import { voiceManager } from ".././voice.js";
import { SOUNDBOARD_PRESETS, soundboardManager } from ".././soundboard.js";
import { EMOJI_REACTION_PRESETS } from './shared.js';
/** DiscordUIController: chat. State and lifetime remain owned by the composed engine. */
export const withDiscordUIControllerChat = Base => class extends Base {
bindChatEvents() {
    this.observe(chatManager, 'message', (msg) => {
      this.renderChatMessage(msg);
    });

    this.observe(chatManager, 'unread', ({ total }) => {
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

      const avatar = document.createElement('div');
      avatar.className = 'chat-message-avatar';
      avatar.textContent = initial;

      const body = document.createElement('div');
      body.className = 'chat-message-body';

      const meta = document.createElement('div');
      meta.className = 'chat-message-meta';

      const author = document.createElement('span');
      author.className = 'chat-author';
      author.textContent = msg.senderName || 'Amigo';

      const roleBadge = document.createElement('span');
      const safeRole = ['host', 'player2', 'viewer', 'system'].includes(msg.role) ? msg.role : 'viewer';
      roleBadge.className = `chat-role-badge ${safeRole}`;
      roleBadge.textContent = (msg.role || 'espectador').toUpperCase();

      const time = document.createElement('span');
      time.className = 'chat-timestamp';
      time.textContent = msg.formattedTime || '';

      meta.appendChild(author);
      meta.appendChild(roleBadge);
      meta.appendChild(time);

      const content = document.createElement('div');
      content.className = 'chat-content';
      content.textContent = msg.text || '';

      body.appendChild(meta);
      body.appendChild(content);

      item.appendChild(avatar);
      item.appendChild(body);
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
};
