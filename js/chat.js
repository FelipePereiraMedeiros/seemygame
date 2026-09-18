/**
 * SeeMyGame - Módulo de Chat de Texto Estilo Discord (P2P DataChannel)
 */

export const DEFAULT_CHANNEL = 'geral';
export const MAX_CHAT_CHANNELS = 16;
export const MAX_CHAT_MESSAGES = 1000;
export const MAX_CHAT_TEXT_LENGTH = 500;
export const MAX_CHAT_MESSAGE_BYTES = 8192;

function utf8ByteLength(value) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

function normalizeChannelName(channelName) {
  const raw = typeof channelName === 'string' ? channelName.trim() : '';
  return raw ? sanitizeText(raw).slice(0, 32) : '';
}

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
    const normalized = normalizeChannelName(channelName);
    if (!normalized) return false;
    if (!this.channels.has(normalized)) {
      if (this.channels.size >= MAX_CHAT_CHANNELS) return false;
      this.channels.set(normalized, []);
      this.unreadCounts.set(normalized, 0);
    }
    return true;
  }

  setActiveChannel(channelName) {
    if (!this.initChannel(channelName)) return false;
    this.activeChannel = normalizeChannelName(channelName);
    if (this.isChatOpen) {
      this.markChannelAsRead(channelName);
    }
    this.emit('channelChange', channelName);
    return true;
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
    const rawClean = isSystem ? text : sanitizeText(text).trim();
    const cleanText = typeof rawClean === 'string' ? rawClean.slice(0, MAX_CHAT_TEXT_LENGTH) : '';
    if (!cleanText && !isSystem) return null;

    const normalizedChannel = normalizeChannelName(channel) || DEFAULT_CHANNEL;
    if (!this.initChannel(normalizedChannel) || utf8ByteLength(cleanText) > MAX_CHAT_MESSAGE_BYTES) return null;

    return {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      channel: normalizedChannel || DEFAULT_CHANNEL,
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
    if (!msg || typeof msg !== 'object') return null;
    const rawText = typeof msg.text === 'string' ? msg.text : '';
    const cleanText = (msg.isSystem ? rawText : sanitizeText(rawText).trim()).slice(0, MAX_CHAT_TEXT_LENGTH);
    if (!cleanText && !msg.isSystem) return null;

    const channel = normalizeChannelName(msg.channel) || DEFAULT_CHANNEL;
    if (!this.initChannel(channel) || utf8ByteLength(cleanText) > MAX_CHAT_MESSAGE_BYTES) return null;

    const safeRole = ['host', 'player2', 'viewer', 'system'].includes(msg.role) ? msg.role : 'viewer';
    const safeSenderName = typeof msg.senderName === 'string' ? sanitizeText(msg.senderName).slice(0, 32) : 'Amigo';
    const safeSenderId = typeof msg.senderId === 'string' ? sanitizeText(msg.senderId).slice(0, 64) : 'anon';

    const normalizedMsg = {
      ...msg,
      id: msg.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      channel,
      senderId: safeSenderId,
      senderName: safeSenderName || 'Amigo',
      role: safeRole,
      text: cleanText,
      timestamp: Number(msg.timestamp) || Date.now(),
      formattedTime: msg.formattedTime || formatTimestamp(msg.timestamp),
      isSystem: Boolean(msg.isSystem),
    };

    if (utf8ByteLength(JSON.stringify(normalizedMsg)) > MAX_CHAT_MESSAGE_BYTES) return null;

    const list = this.channels.get(channel);
    list.push(normalizedMsg);

    // Limita o histórico por canal a 200 mensagens para evitar consumo excessivo de memória
    if (list.length > 200) {
      list.shift();
    }

    while (this.getTotalMessageCount() > MAX_CHAT_MESSAGES) {
      let oldestChannel = null;
      let oldestTimestamp = Infinity;
      this.channels.forEach((messages, channelName) => {
        if (messages.length > 0 && Number(messages[0].timestamp) < oldestTimestamp) {
          oldestTimestamp = Number(messages[0].timestamp);
          oldestChannel = channelName;
        }
      });
      if (!oldestChannel) break;
      this.channels.get(oldestChannel).shift();
    }

    // Incrementa contador de não lidas se o chat estiver fechado ou se for outro canal
    if (!this.isChatOpen || channel !== this.activeChannel) {
      const current = this.unreadCounts.get(channel) || 0;
      this.unreadCounts.set(channel, current + 1);
      this.emit('unread', { channel, count: current + 1, total: this.getTotalUnreadCount() });
    }

    this.emit('message', normalizedMsg);
    return normalizedMsg;
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
    const normalized = normalizeChannelName(channel);
    if (!this.initChannel(normalized)) return [];
    return [...(this.channels.get(normalized) || [])];
  }

  getTotalMessageCount() {
    let total = 0;
    this.channels.forEach((messages) => { total += messages.length; });
    return total;
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
