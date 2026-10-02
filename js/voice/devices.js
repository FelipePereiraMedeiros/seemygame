import { getAudioContext } from ".././audio.js";
import { isValidPeerId } from ".././shared/peer-id.js";
import { VAD_THRESHOLD, VAD_SILENCE_DELAY_MS, MAX_VOICE_PARTICIPANTS } from './shared.js';
/** VoiceManager: devices. State and lifetime remain owned by the composed engine. */
export const withVoiceManagerDevices = Base => class extends Base {
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
};
