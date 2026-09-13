/**
 * SeeMyGame - Módulo de Chat de Texto Estilo Discord (P2P DataChannel)
 */

export const DEFAULT_CHANNEL = 'geral';

export function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTimestamp(timestamp = Date.now()) {
  const d = new Date(timestamp);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export class ChatManager {
  constructor() {
    this.channels = new Map(); // channelName -> Array of messages
    this.activeChannel = DEFAULT_CHANNEL;
    this.unreadCounts = new Map(); // channelName -> number
    this.isChatOpen = false;
    this.listeners = {
      message: new Set(),
      unread: new Set(),
      channelChange: new Set(),
    };

    this.initChannel(DEFAULT_CHANNEL);
    this.initChannel('comandos');
  }

  initChannel(channelName) {
    if (!this.channels.has(channelName)) {
      this.channels.set(channelName, []);
      this.unreadCounts.set(channelName, 0);
    }
  }

  setActiveChannel(channelName) {
    this.initChannel(channelName);
    this.activeChannel = channelName;
    if (this.isChatOpen) {
      this.markChannelAsRead(channelName);
    }
    this.emit('channelChange', channelName);
  }

  getActiveChannel() {
    return this.activeChannel;
  }

  setChatOpen(isOpen) {
    this.isChatOpen = Boolean(isOpen);
    if (this.isChatOpen) {
      this.markChannelAsRead(this.activeChannel);
    }
  }

  createMessage({ senderId, senderName, role = 'viewer', text, channel = this.activeChannel, isSystem = false }) {
    const cleanText = isSystem ? text : sanitizeText(text).trim();
    if (!cleanText && !isSystem) return null;

    return {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      channel: channel || DEFAULT_CHANNEL,
      senderId: senderId || 'anon',
      senderName: senderName || (senderId ? senderId.slice(0, 6) : 'Amigo'),
      role, // 'host' | 'player2' | 'viewer' | 'system'
      text: cleanText,
      timestamp: Date.now(),
      formattedTime: formatTimestamp(),
      isSystem: Boolean(isSystem),
    };
  }

  addMessage(msg) {
    if (!msg || !msg.text) return null;
    const channel = msg.channel || DEFAULT_CHANNEL;
    this.initChannel(channel);

    const list = this.channels.get(channel);
    list.push(msg);

    // Limita o histórico por canal a 200 mensagens para evitar consumo excessivo de memória
    if (list.length > 200) {
      list.shift();
    }

    // Incrementa contador de não lidas se o chat estiver fechado ou se for outro canal
    if (!this.isChatOpen || channel !== this.activeChannel) {
      const current = this.unreadCounts.get(channel) || 0;
      this.unreadCounts.set(channel, current + 1);
      this.emit('unread', { channel, count: current + 1, total: this.getTotalUnreadCount() });
    }

    this.emit('message', msg);
    return msg;
  }

  addSystemMessage(text, channel = this.activeChannel) {
    const msg = this.createMessage({
      senderId: 'system',
      senderName: 'SeeMyGame',
      role: 'system',
      text,
      channel,
      isSystem: true,
    });
    return this.addMessage(msg);
  }

  markChannelAsRead(channel = this.activeChannel) {
    if (this.unreadCounts.has(channel)) {
      this.unreadCounts.set(channel, 0);
      this.emit('unread', { channel, count: 0, total: this.getTotalUnreadCount() });
    }
  }

  getMessages(channel = this.activeChannel) {
    this.initChannel(channel);
    return [...(this.channels.get(channel) || [])];
  }

  getUnreadCount(channel = this.activeChannel) {
    return this.unreadCounts.get(channel) || 0;
  }

  getTotalUnreadCount() {
    let total = 0;
    for (const count of this.unreadCounts.values()) {
      total += count;
    }
    return total;
  }

  clearChannel(channel = this.activeChannel) {
    if (this.channels.has(channel)) {
      this.channels.set(channel, []);
      this.markChannelAsRead(channel);
      this.emit('message', { type: 'CHANNEL_CLEARED', channel });
    }
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].add(callback);
    }
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => {
        try {
          cb(data);
        } catch (e) {
          console.error(`Erro no listener de chat (${event}):`, e);
        }
      });
    }
  }
}

// Instância singleton padrão para o aplicativo
export const chatManager = new ChatManager();
