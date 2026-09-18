import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VoiceManager } from '../js/voice.js';

describe('Módulo: voice.js (Chat de Voz P2P Estilo Discord)', () => {
  let voice;
  let mockTrack;
  let mockStream;

  beforeEach(() => {
    mockTrack = {
      kind: 'audio',
      enabled: true,
      stop: vi.fn(),
    };
    mockStream = {
      getAudioTracks: vi.fn().mockReturnValue([mockTrack]),
      getTracks: vi.fn().mockReturnValue([mockTrack]),
    };

    voice = new VoiceManager();
  });

  afterEach(() => {
    voice.leaveVoice();
    vi.clearAllMocks();
  });

  describe('Conexão e Desconexão de Voz', () => {
    it('deve entrar na sala de voz com stream customizado', async () => {
      const joinSpy = vi.fn();
      voice.on('voiceJoined', joinSpy);

      const stream = await voice.joinVoice({
        peerId: 'streamer-1',
        name: 'HostGamer',
        role: 'host',
        customStream: mockStream,
      });

      expect(stream).toBe(mockStream);
      expect(voice.isInVoice).toBe(true);
      expect(voice.myPeerId).toBe('streamer-1');
      expect(joinSpy).toHaveBeenCalledWith({ stream: mockStream, peerId: 'streamer-1' });

      const participants = voice.getParticipantsList();
      expect(participants).toHaveLength(1);
      expect(participants[0].peerId).toBe('streamer-1');
      expect(participants[0].name).toBe('HostGamer');
      expect(participants[0].isLocal).toBe(true);
    });

    it('deve sair da sala de voz, parar faixas e limpar participantes', async () => {
      await voice.joinVoice({
        peerId: 'streamer-1',
        customStream: mockStream,
      });

      const leaveSpy = vi.fn();
      voice.on('voiceLeft', leaveSpy);

      voice.leaveVoice();

      expect(voice.isInVoice).toBe(false);
      expect(mockTrack.stop).toHaveBeenCalled();
      expect(voice.getParticipantsList()).toHaveLength(0);
      expect(leaveSpy).toHaveBeenCalled();
    });
  });

  describe('Controles Gamer: Mute e Deafen', () => {
    beforeEach(async () => {
      await voice.joinVoice({
        peerId: 'user-1',
        customStream: mockStream,
      });
    });

    it('toggleMute deve alternar o estado do microfone e desabilitar audio tracks', () => {
      const stateSpy = vi.fn();
      voice.on('voiceStateChange', stateSpy);

      const muted = voice.toggleMute();
      expect(muted).toBe(true);
      expect(mockTrack.enabled).toBe(false);
      expect(voice.isMuted).toBe(true);
      expect(stateSpy).toHaveBeenCalled();

      const unmuted = voice.toggleMute();
      expect(unmuted).toBe(false);
      expect(mockTrack.enabled).toBe(true);
      expect(voice.isMuted).toBe(false);
    });

    it('toggleDeaf deve ensurdecer e mutar o microfone automaticamente (padrão Discord)', () => {
      const deafened = voice.toggleDeaf();
      expect(deafened).toBe(true);
      expect(voice.isDeafened).toBe(true);
      expect(voice.isMuted).toBe(true);
      expect(mockTrack.enabled).toBe(false);
    });

    it('toggleDeafen deve funcionar como alias para toggleDeaf', () => {
      expect(voice.toggleDeafen()).toBe(true);
      expect(voice.isDeafened).toBe(true);
    });

    it('setVoiceMode e setPttActive devem controlar Push-to-Talk', () => {
      voice.setVoiceMode('ptt');
      expect(voice.voiceMode).toBe('ptt');
      expect(voice.isMuted).toBe(true);

      // Pressiona tecla PTT
      voice.setPttActive(true);
      expect(voice.isPttActive).toBe(true);
      expect(voice.isMuted).toBe(false);
      expect(mockTrack.enabled).toBe(true);

      // Solta tecla PTT
      voice.setPttActive(false);
      expect(voice.isPttActive).toBe(false);
      expect(voice.isMuted).toBe(true);
      expect(mockTrack.enabled).toBe(false);

      // Retorna para VAD contínuo
      voice.setVoiceMode('vad');
      expect(voice.voiceMode).toBe('vad');
      expect(voice.isMuted).toBe(false);
    });
  });

  describe('Participantes Remotos e Estado de Fala (VAD)', () => {
    it('deve adicionar participante remoto e notificar via participantUpdate', () => {
      const updateSpy = vi.fn();
      voice.on('participantUpdate', updateSpy);

      voice.addRemoteParticipant('friend-99', {
        name: 'Player 2 Amigo',
        role: 'player2',
        stream: mockStream,
      });

      const list = voice.getParticipantsList();
      expect(list).toHaveLength(1);
      expect(list[0].peerId).toBe('friend-99');
      expect(list[0].name).toBe('Player 2 Amigo');
      expect(list[0].role).toBe('player2');
      expect(updateSpy).toHaveBeenCalled();
    });

    it('deve atualizar estado de fala e disparar evento speakingChange', () => {
      voice.addRemoteParticipant('friend-99', { name: 'Player 2' });

      const speakingSpy = vi.fn();
      voice.on('speakingChange', speakingSpy);

      voice.updateParticipantState('friend-99', { isSpeaking: true });

      const list = voice.getParticipantsList();
      expect(list[0].isSpeaking).toBe(true);
      expect(speakingSpy).toHaveBeenCalledWith({ peerId: 'friend-99', isSpeaking: true });
    });

    it('deve remover participante remoto adequadamente', () => {
      voice.addRemoteParticipant('friend-99', { name: 'Player 2' });
      expect(voice.getParticipantsList()).toHaveLength(1);

      voice.removeRemoteParticipant('friend-99');
      expect(voice.getParticipantsList()).toHaveLength(0);
    });
  });

  describe('Seleção de Dispositivos de Áudio (Microfone e Saída)', () => {
    it('deve armazenar e persistir preferências de microfone e saída', async () => {
      await voice.setAudioOutputDevice('speaker-usb-123');
      expect(voice.selectedSpeakerId).toBe('speaker-usb-123');
      expect(localStorage.getItem('seemygame_audio_output_id')).toBe('speaker-usb-123');

      await voice.setAudioInputDevice('mic-headset-456');
      expect(voice.selectedMicId).toBe('mic-headset-456');
      expect(localStorage.getItem('seemygame_audio_input_id')).toBe('mic-headset-456');
    });

    it('deve atualizar elementos de áudio dos participantes ao alterar a saída de som', async () => {
      const origCreateElement = document.createElement.bind(document);
      const realAudio = origCreateElement('audio');
      realAudio.setSinkId = vi.fn().mockResolvedValue(undefined);

      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        if (tag === 'audio') return realAudio;
        return origCreateElement(tag);
      });

      voice.addRemoteParticipant('friend-audio', { name: 'Amigo Audio', stream: mockStream });

      await voice.setAudioOutputDevice('speaker-hdmi');
      expect(realAudio.setSinkId).toHaveBeenCalledWith('speaker-hdmi');
    });

    it('deve emitir audioInputTrackChange ao alternar microfone enquanto conectado', async () => {
      await voice.joinVoice({ peerId: 'user-mic', customStream: mockStream });

      const newTrack = { kind: 'audio', enabled: true, stop: vi.fn() };
      const newStream = {
        getAudioTracks: vi.fn().mockReturnValue([newTrack]),
        getTracks: vi.fn().mockReturnValue([newTrack]),
      };

      navigator.mediaDevices = {
        getUserMedia: vi.fn().mockResolvedValue(newStream),
      };

      const trackChangeSpy = vi.fn();
      voice.on('audioInputTrackChange', trackChangeSpy);

      await voice.setAudioInputDevice('mic-novo');
      expect(trackChangeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          newTrack,
          stream: newStream,
          deviceId: 'mic-novo',
        })
      );
    });
  });
});
