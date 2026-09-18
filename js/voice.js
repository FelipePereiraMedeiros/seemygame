/**
 * SeeMyGame - Módulo de Chat de Voz P2P Estilo Discord (WebRTC + Web Audio VAD)
 */

import { getAudioContext } from './audio.js';
import { isValidPeerId } from './ui.js';

export const VAD_THRESHOLD = 14; // Limiar de sensibilidade do microfone (0-100)
export const VAD_SILENCE_DELAY_MS = 300; // Tempo de retenção antes de desligar o anel verde
export const MAX_VOICE_PARTICIPANTS = 16;

export class VoiceManager {
  constructor() {
    this.isInVoice = false;
    this.isMuted = false;
    this.isDeafened = false;
    this.voiceMode = 'vad'; // 'vad' | 'ptt'
    this.isPttActive = false;
    this.localStream = null;
    this.myPeerId = null;
    this.myName = 'Você';
    this.myRole = 'host';

    // Map: peerId -> { peerId, name, role, isMuted, isDeafened, isSpeaking, stream, audioElem, analyser, vadTimer }
    this.participants = new Map();

    this.localVad = {
      source: null,
      analyser: null,
      intervalId: null,
      lastSpokeTime: 0,
      isSpeaking: false,
    };

    this.selectedMicId = (typeof localStorage !== 'undefined' ? localStorage.getItem('seemygame_audio_input_id') : '') || '';
    this.selectedSpeakerId = (typeof localStorage !== 'undefined' ? localStorage.getItem('seemygame_audio_output_id') : '') || '';

    this.listeners = {
      participantUpdate: new Set(),
      speakingChange: new Set(),
      voiceStateChange: new Set(),
      voiceJoined: new Set(),
      voiceLeft: new Set(),
      audioInputTrackChange: new Set(),
      audioOutputDeviceChange: new Set(),
    };
  }

  async joinVoice({ peerId, name = 'Você', role = 'host', customStream = null, inputDeviceId = null } = {}) {
    if (this.isInVoice) return this.localStream;

    this.myPeerId = peerId;
    this.myName = name;
    this.myRole = role;
    if (inputDeviceId !== null && inputDeviceId !== undefined) {
      this.selectedMicId = inputDeviceId;
    }

    try {
      if (customStream) {
        this.localStream = customStream;
      } else if (navigator?.mediaDevices?.getUserMedia) {
        const audioConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };
        if (this.selectedMicId) {
          audioConstraints.deviceId = { exact: this.selectedMicId };
        }

        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false,
          });
        } catch (deviceErr) {
          if (this.selectedMicId) {
            console.warn('[Voice] Microfone preferencial indisponível, usando padrão:', deviceErr);
            this.localStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
              video: false,
            });
          } else {
            throw deviceErr;
          }
        }
      } else {
        throw new Error('getUserMedia não suportado neste ambiente');
      }

      this.isInVoice = true;

      // SEGURANÇA / PRIVACIDADE (A07): Se estiver em modo PTT e a tecla não estiver ativa,
      // inicializa o microfone mutado para não vazar áudio ao entrar ou reconectar
      if (this.voiceMode === 'ptt' && !this.isPttActive) {
        this.isMuted = true;
      }

      if (this.localStream) {
        this.localStream.getAudioTracks().forEach((track) => {
          track.enabled = !this.isMuted;
        });
      }

      // Registra a si mesmo como participante local
      this.participants.set(this.myPeerId, {
        peerId: this.myPeerId,
        name: this.myName,
        role: this.myRole,
        isMuted: this.isMuted,
        isDeafened: this.isDeafened,
        isSpeaking: false,
        isLocal: true,
      });

      this.initLocalVAD();

      this.emit('voiceJoined', { stream: this.localStream, peerId: this.myPeerId });
      this.emit('voiceStateChange', this.getLocalVoiceState());
      this.emit('participantUpdate', this.getParticipantsList());

      return this.localStream;
    } catch (err) {
      console.warn('[Voice] Falha ao acessar microfone:', err);
      this.isInVoice = false;
      throw err;
    }
  }

  leaveVoice() {
    this.stopLocalVAD();

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch (e) {}
      });
      this.localStream = null;
    }

    // Fecha elementos de áudio dos participantes remotos
    for (const p of this.participants.values()) {
      if (p.audioElem) {
        try {
          p.audioElem.pause();
          p.audioElem.srcObject = null;
          p.audioElem.remove();
        } catch (e) {}
      }
      if (p.vadInterval) {
        clearInterval(p.vadInterval);
      }
    }

    this.participants.clear();
    this.isInVoice = false;
    if (this.voiceMode === 'ptt') {
      this.isMuted = true;
      this.isPttActive = false;
    } else {
      this.isMuted = false;
    }
    this.isDeafened = false;

    this.emit('voiceLeft');
    this.emit('voiceStateChange', this.getLocalVoiceState());
    this.emit('participantUpdate', []);
  }

  toggleMute() {
    return this.setMuted(!this.isMuted);
  }

  setMuted(muted) {
    this.isMuted = Boolean(muted);
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMuted;
      });
    }

    const me = this.participants.get(this.myPeerId);
    if (me) {
      me.isMuted = this.isMuted;
      if (this.isMuted && me.isSpeaking) {
        me.isSpeaking = false;
        this.emit('speakingChange', { peerId: this.myPeerId, isSpeaking: false });
      }
    }

    this.emit('voiceStateChange', this.getLocalVoiceState());
    this.emit('participantUpdate', this.getParticipantsList());
    return this.isMuted;
  }

  toggleDeaf() {
    return this.setDeafened(!this.isDeafened);
  }

  toggleDeafen() {
    return this.toggleDeaf();
  }

  setVoiceMode(mode) {
    this.voiceMode = mode === 'ptt' ? 'ptt' : 'vad';
    if (this.voiceMode === 'ptt' && !this.isPttActive) {
      this.setMuted(true);
    } else if (this.voiceMode === 'vad') {
      this.setMuted(false);
    }
    this.emit('voiceStateChange', this.getLocalVoiceState());
    return this.voiceMode;
  }

  setPttActive(active) {
    if (this.voiceMode !== 'ptt') return false;
    this.isPttActive = Boolean(active);
    this.setMuted(!this.isPttActive);
    return this.isPttActive;
  }

  setDeafened(deafened) {
    this.isDeafened = Boolean(deafened);

    // Muta ou desmuta elementos de áudio dos amigos
    for (const p of this.participants.values()) {
      if (p.audioElem) {
        p.audioElem.muted = this.isDeafened;
      }
    }

    // Padrão Discord: se ensurdecer, muta o microfone automaticamente
    if (this.isDeafened && !this.isMuted) {
      this.setMuted(true);
    }

    const me = this.participants.get(this.myPeerId);
    if (me) {
      me.isDeafened = this.isDeafened;
    }

    this.emit('voiceStateChange', this.getLocalVoiceState());
    this.emit('participantUpdate', this.getParticipantsList());
    return this.isDeafened;
  }

  getLocalVoiceState() {
    return {
      isInVoice: this.isInVoice,
      isMuted: this.isMuted,
      isDeafened: this.isDeafened,
      voiceMode: this.voiceMode,
      isPttActive: this.isPttActive,
      peerId: this.myPeerId,
      name: this.myName,
      role: this.myRole,
    };
  }

  addRemoteParticipant(peerId, { name = 'Amigo', role = 'viewer', stream = null } = {}) {
    if (!isValidPeerId(peerId) || peerId === this.myPeerId) return false;
    if (!this.participants.has(peerId) && this.participants.size >= MAX_VOICE_PARTICIPANTS) return false;

    if (this.participants.has(peerId)) {
      this.removeRemoteParticipant(peerId);
    }

    let audioElem = null;
    if (stream && typeof document !== 'undefined') {
      audioElem = document.createElement('audio');
      audioElem.autoplay = true;
      audioElem.muted = this.isDeafened;
      audioElem.srcObject = stream;
      audioElem.style.display = 'none';
      if (this.selectedSpeakerId && typeof audioElem.setSinkId === 'function') {
        audioElem.setSinkId(this.selectedSpeakerId).catch((err) => {
          console.warn('[Voice] Falha ao configurar saída de áudio para participante:', err);
        });
      }
      document.body.appendChild(audioElem);
    }

    const participant = {
      peerId,
      name,
      role,
      isMuted: false,
      isDeafened: false,
      isSpeaking: false,
      isLocal: false,
      stream,
      audioElem,
      vadInterval: null,
    };

    if (stream) {
      this.initRemoteVAD(participant);
    }

    this.participants.set(peerId, participant);
    this.emit('participantUpdate', this.getParticipantsList());
    return true;
  }

  removeRemoteParticipant(peerId) {
    const p = this.participants.get(peerId);
    if (p) {
      if (p.audioElem) {
        try {
          p.audioElem.pause();
          p.audioElem.srcObject = null;
          p.audioElem.remove();
        } catch (e) {}
      }
      if (p.vadInterval) {
        clearInterval(p.vadInterval);
      }
      this.participants.delete(peerId);
      this.emit('participantUpdate', this.getParticipantsList());
    }
  }

  updateParticipantState(peerId, { isMuted, isDeafened, isSpeaking } = {}) {
    const p = this.participants.get(peerId);
    if (!p) return;

    if (typeof isMuted === 'boolean') p.isMuted = isMuted;
    if (typeof isDeafened === 'boolean') p.isDeafened = isDeafened;
    if (typeof isSpeaking === 'boolean') {
      const changed = p.isSpeaking !== isSpeaking;
      p.isSpeaking = isSpeaking;
      if (changed) {
        this.emit('speakingChange', { peerId, isSpeaking });
      }
    }

    this.emit('participantUpdate', this.getParticipantsList());
  }

  getParticipantsList() {
    return Array.from(this.participants.values()).map((p) => ({
      peerId: p.peerId,
      name: p.name,
      role: p.role,
      isMuted: p.isMuted,
      isDeafened: p.isDeafened,
      isSpeaking: p.isSpeaking,
      isLocal: Boolean(p.isLocal),
    }));
  }

  initLocalVAD() {
    if (!this.localStream || this.localStream.getAudioTracks().length === 0) return;

    try {
      const ctx = getAudioContext();
      this.localVad.source = ctx.createMediaStreamSource(this.localStream);
      this.localVad.analyser = ctx.createAnalyser();
      this.localVad.analyser.fftSize = 64;
      this.localVad.source.connect(this.localVad.analyser);

      const buffer = new Uint8Array(this.localVad.analyser.frequencyBinCount);

      this.localVad.intervalId = setInterval(() => {
        if (!this.isInVoice || this.isMuted) {
          if (this.localVad.isSpeaking) {
            this.setLocalSpeaking(false);
          }
          return;
        }

        this.localVad.analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i];
        const avg = sum / buffer.length;

        const now = Date.now();
        if (avg >= VAD_THRESHOLD) {
          this.localVad.lastSpokeTime = now;
          if (!this.localVad.isSpeaking) {
            this.setLocalSpeaking(true);
          }
        } else if (this.localVad.isSpeaking && now - this.localVad.lastSpokeTime > VAD_SILENCE_DELAY_MS) {
          this.setLocalSpeaking(false);
        }
      }, 80);
    } catch (err) {
      console.warn('[Voice VAD] Erro ao inicializar VAD local:', err);
    }
  }

  setLocalSpeaking(isSpeaking) {
    this.localVad.isSpeaking = isSpeaking;
    const me = this.participants.get(this.myPeerId);
    if (me) {
      me.isSpeaking = isSpeaking;
    }
    this.emit('speakingChange', { peerId: this.myPeerId, isSpeaking });
    this.emit('participantUpdate', this.getParticipantsList());
  }

  stopLocalVAD() {
    if (this.localVad.intervalId) {
      clearInterval(this.localVad.intervalId);
      this.localVad.intervalId = null;
    }
    try {
      if (this.localVad.source) {
        this.localVad.source.disconnect();
        this.localVad.source = null;
      }
    } catch (e) {}
    this.localVad.isSpeaking = false;
  }

  initRemoteVAD(participant) {
    if (!participant.stream || participant.stream.getAudioTracks().length === 0) return;

    try {
      const ctx = getAudioContext();
      const source = ctx.createMediaStreamSource(participant.stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      let lastSpoke = 0;

      participant.vadInterval = setInterval(() => {
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i];
        const avg = sum / buffer.length;

        const now = Date.now();
        if (avg >= VAD_THRESHOLD) {
          lastSpoke = now;
          if (!participant.isSpeaking) {
            participant.isSpeaking = true;
            this.emit('speakingChange', { peerId: participant.peerId, isSpeaking: true });
            this.emit('participantUpdate', this.getParticipantsList());
          }
        } else if (participant.isSpeaking && now - lastSpoke > VAD_SILENCE_DELAY_MS) {
          participant.isSpeaking = false;
          this.emit('speakingChange', { peerId: participant.peerId, isSpeaking: false });
          this.emit('participantUpdate', this.getParticipantsList());
        }
      }, 80);
    } catch (err) {
      console.warn(`[Remote VAD] Falha para ${participant.peerId}:`, err);
    }
  }

  async setAudioInputDevice(deviceId) {
    this.selectedMicId = deviceId || '';
    try {
      if (typeof localStorage !== 'undefined') {
        if (this.selectedMicId) {
          localStorage.setItem('seemygame_audio_input_id', this.selectedMicId);
        } else {
          localStorage.removeItem('seemygame_audio_input_id');
        }
      }
    } catch (e) {}

    if (!this.isInVoice) return null;

    try {
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      if (this.selectedMicId) {
        audioConstraints.deviceId = { exact: this.selectedMicId };
      }

      let newStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false,
        });
      } catch (e) {
        if (this.selectedMicId) {
          console.warn('[Voice] Microfone falhou, voltando para o padrão:', e);
          newStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
        } else {
          throw e;
        }
      }

      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return null;
      newTrack.enabled = !this.isMuted;

      // Interrompe faixas anteriores
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach((t) => {
          try { t.stop(); } catch (err) {}
        });
      }

      this.localStream = newStream;

      // Reinicializa o analisador VAD local com a nova faixa
      this.initLocalVAD();

      // Notifica para atualização dos senders WebRTC nas conexões ativas
      this.emit('audioInputTrackChange', { newTrack, stream: newStream, deviceId: this.selectedMicId });
      return newStream;
    } catch (err) {
      console.warn('[Voice] Falha ao alternar dispositivo de microfone:', err);
      throw err;
    }
  }

  async setAudioOutputDevice(deviceId) {
    this.selectedSpeakerId = deviceId || '';
    try {
      if (typeof localStorage !== 'undefined') {
        if (this.selectedSpeakerId) {
          localStorage.setItem('seemygame_audio_output_id', this.selectedSpeakerId);
        } else {
          localStorage.removeItem('seemygame_audio_output_id');
        }
      }
    } catch (e) {}

    const updatePromises = [];
    for (const p of this.participants.values()) {
      if (p.audioElem && typeof p.audioElem.setSinkId === 'function') {
        updatePromises.push(
          p.audioElem.setSinkId(this.selectedSpeakerId).catch((err) => {
            console.warn('[Voice] Erro ao aplicar sinkId no participante:', err);
          })
        );
      }
    }

    if (typeof document !== 'undefined') {
      const mediaElements = document.querySelectorAll('video, audio');
      mediaElements.forEach((el) => {
        if (typeof el.setSinkId === 'function') {
          updatePromises.push(
            el.setSinkId(this.selectedSpeakerId).catch(() => {})
          );
        }
      });
    }

    await Promise.all(updatePromises);
    this.emit('audioOutputDeviceChange', { deviceId: this.selectedSpeakerId });
    return this.selectedSpeakerId;
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
          console.error(`Erro no listener de voz (${event}):`, e);
        }
      });
    }
  }
}

// Instância singleton padrão
export const voiceManager = new VoiceManager();
