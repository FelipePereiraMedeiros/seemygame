import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  broadcastDataMessage,
  handleIncomingP2PMessage,
  handleIncomingVoiceCall,
  setupVoiceMediaCall
} from '../js/app.js';
import { chatManager } from '../js/chat.js';
import { voiceManager } from '../js/voice.js';

describe('Integração P2P: Chat e Voz (Discord Features)', () => {
  beforeEach(() => {
    chatManager.clearChannel('geral');
    chatManager.clearChannel('comandos');
    voiceManager.leaveVoice();
    vi.clearAllMocks();
  });

  it('handleIncomingP2PMessage deve receber e registrar CHAT_MESSAGE no chatManager', () => {
    const mockConn = { peer: 'sender-1', send: vi.fn(), open: true };
    const chatData = {
      type: 'CHAT_MESSAGE',
      message: {
        id: 'msg-1',
        channel: 'geral',
        senderId: 'sender-1',
        senderName: 'AmigoGamer',
        role: 'viewer',
        text: 'Fala galera!',
        timestamp: Date.now(),
        formattedTime: '18:00',
        isSystem: false,
      },
    };

    handleIncomingP2PMessage(chatData, mockConn);

    const messages = chatManager.getMessages('geral');
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('Fala galera!');
    expect(messages[0].senderName).toBe('AmigoGamer');
  });

  it('handleIncomingP2PMessage deve atualizar estado do participante em VOICE_STATE_UPDATE', () => {
    voiceManager.addRemoteParticipant('peer-voice-1', { name: 'Player' });

    const updateData = {
      type: 'VOICE_STATE_UPDATE',
      peerId: 'peer-voice-1',
      isSpeaking: true,
      isMuted: true,
      isDeafened: false,
    };

    handleIncomingP2PMessage(updateData, null);

    const participants = voiceManager.getParticipantsList();
    const p = participants.find((x) => x.peerId === 'peer-voice-1');
    expect(p).toBeDefined();
    expect(p.isSpeaking).toBe(true);
    expect(p.isMuted).toBe(true);
  });

  it('handleIncomingP2PMessage deve remover participante em VOICE_SIGNAL LEAVE', () => {
    voiceManager.addRemoteParticipant('peer-voice-2', { name: 'Player' });
    expect(voiceManager.getParticipantsList()).toHaveLength(1);

    const signalData = {
      type: 'VOICE_SIGNAL',
      action: 'LEAVE',
      peerId: 'peer-voice-2',
    };

    handleIncomingP2PMessage(signalData, null);
    expect(voiceManager.getParticipantsList()).toHaveLength(0);
  });

  it('handleIncomingVoiceCall deve rejeitar chamadas de peers não autorizados', () => {
    const mockCall = {
      peer: 'spammer-unknown',
      metadata: { type: 'VOICE_CHAT' },
      answer: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
    };

    handleIncomingVoiceCall(mockCall);
    expect(mockCall.close).toHaveBeenCalled();
    expect(mockCall.answer).not.toHaveBeenCalled();
  });
});
