import { createAudioScope } from ".././audio/context-scope.js";
/** ClipRecorder: recorder. State and lifetime remain owned by the composed engine. */
export const withClipRecorderRecorder = Base => class extends Base {
_resolveSupportedMimeType(hasAudio = true) {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return 'video/webm';
    }

    const candidatesWithAudio = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4'
    ];

    const candidatesVideoOnly = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm;codecs=h264',
      'video/webm',
      'video/mp4;codecs=avc1',
      'video/mp4'
    ];

    const candidates = hasAudio ? candidatesWithAudio : candidatesVideoOnly;

    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return 'video/webm';
  }

start(stream) {
    if (!stream || typeof MediaRecorder === 'undefined') return false;

    this.stop();
    this.stream = stream;
    this.chunks = [];
    this.initializationChunk = null;
    this.lastError = null;
    this.lastClipBlob = null;
    this.lastClipFileName = null;
    this._nextChunkSequence = 0;
    const generation = ++this._recordingGeneration;

    try {
      // Isola o stream encapsulador sem clonar as trilhas físicas.
      // Clonar trilhas de captura (getDisplayMedia) ou WebRTC no Chromium/WebView2
      // impede a entrega de frames ao MediaRecorder e zera os chunks gravados.
      this.recordingStream = stream;
      this.recordingTracks = [];
      if (typeof MediaStream !== 'undefined' && typeof stream.getTracks === 'function') {
        const isolatedStream = new MediaStream();
        stream.getTracks().forEach((track) => {
          if (track && track.readyState !== 'ended') {
            isolatedStream.addTrack(track);
            this.recordingTracks.push({ track, owned: false });
          }
        });

        // Se Web Audio estiver disponível, cria um mixer de áudio estável para manter a topologia
        // inalterada mesmo que trilhas cheguem tardiamente (ex: WebRTC conectando vídeo antes de áudio)
        const AudioCtx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
          (typeof AudioContext !== 'undefined' ? AudioContext : null);

        if (AudioCtx) {
          try {
            if (this._audioScope.disposed && this._ownsAudioScope) this._audioScope = createAudioScope();
            this._audioContext = this._audioScope.getContext('recorder-mixer');
            if (typeof this._audioContext.createMediaStreamDestination === 'function') {
              this._audioDestination = this._audioContext.createMediaStreamDestination();
              const mixedTrack = this._audioDestination.stream.getAudioTracks()[0];
              if (mixedTrack) {
                const audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
                audioTracks.forEach((t) => this._connectAudioTrackToMixer(t));

                isolatedStream.getAudioTracks().forEach(t => isolatedStream.removeTrack(t));
                isolatedStream.addTrack(mixedTrack);
                this.recordingTracks.push({ track: mixedTrack, owned: true });
              }
            }

            // P2: Trata ativação inicial do AudioContext e recuperação em estado suspenso
            const wasSuspended = this._audioContext.state === 'suspended';
            this._resumeAudioContext();
            if (wasSuspended || this._audioContext.state === 'suspended') {
              const onUserGesture = () => {
                this._resumeAudioContext();
                if (!this._audioContext || this._audioContext.state !== 'suspended') {
                  if (typeof window !== 'undefined') {
                    window.removeEventListener('click', onUserGesture);
                    window.removeEventListener('keydown', onUserGesture);
                  }
                  this._audioGestureCleanup = null;
                }
              };
              if (typeof window !== 'undefined') {
                window.addEventListener('click', onUserGesture, { passive: true });
                window.addEventListener('keydown', onUserGesture, { passive: true });
                this._audioGestureCleanup = () => {
                  window.removeEventListener('click', onUserGesture);
                  window.removeEventListener('keydown', onUserGesture);
                };
              }
            }
          } catch (audioErr) {
            console.warn('[ClipRecorder] Falha ao configurar mixer Web Audio:', audioErr);
          }
        }

        // Escuta novas trilhas adicionadas ou removidas dinamicamente do stream de origem
        if (typeof stream.addEventListener === 'function') {
          const onTrackAdded = (e) => {
            if (generation !== this._recordingGeneration || !this.isRecording) return;
            if (!e.track || e.track.readyState === 'ended') return;

            // Se for áudio e tivermos um mixer Web Audio ativo, roteia para o mixer sem alterar o MediaRecorder
            if (e.track.kind === 'audio' && this._audioContext && this._audioDestination) {
              this._resumeAudioContext();
              this._connectAudioTrackToMixer(e.track);
              return;
            }

            // Fallback (ou mudança de vídeo): conforme especificação W3C, não podemos injetar
            // trilhas em MediaRecorder em gravação. Reinicia gravador com nova topologia,
            // resetando histórico incompatível para não corromper cabeçalhos WebM.
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
              try { this.mediaRecorder.stop(); } catch (_) {}
            }
            this.clear();
            try { isolatedStream.addTrack(e.track); } catch (_) {}
            this.recordingTracks.push({ track: e.track, owned: false });

            const hasAudioNow = typeof this.recordingStream.getAudioTracks === 'function' &&
              this.recordingStream.getAudioTracks().length > 0;
            this.mimeType = this._resolveSupportedMimeType(hasAudioNow);
            const recOptions = this.mimeType ? { mimeType: this.mimeType } : {};

            try {
              const newRec = new MediaRecorder(this.recordingStream, recOptions);
              this.mediaRecorder = newRec;
              this._bindRecorderEvents(newRec, generation);
              newRec.start(this.timesliceMs || 3000);
            } catch (reErr) {
              console.warn('[ClipRecorder] Falha ao recriar MediaRecorder:', reErr);
            }
          };

          const onTrackRemoved = (e) => {
            if (generation !== this._recordingGeneration || !this.isRecording) return;
            if (!e.track) return;

            // P1: Desconecta a fonte do mixer para não continuar gravando áudio desativado/removido
            if (e.track.kind === 'audio') {
              this._disconnectAudioTrackFromMixer(e.track);
            }

            // Fallback sem mixer: remove da topologia isolada
            if (!this._audioDestination && isolatedStream) {
              try { isolatedStream.removeTrack(e.track); } catch (_) {}
            }
          };

          stream.addEventListener('addtrack', onTrackAdded);
          stream.addEventListener('removetrack', onTrackRemoved);
          this._streamAddTrackHandler = onTrackAdded;
          this._streamRemoveTrackHandler = onTrackRemoved;
        }

        this.recordingStream = isolatedStream;
      }

      const hasAudio = typeof this.recordingStream.getAudioTracks === 'function' &&
        this.recordingStream.getAudioTracks().length > 0;
      this.mimeType = this._resolveSupportedMimeType(hasAudio);
      const options = this.mimeType ? { mimeType: this.mimeType } : {};

      let recorder;
      try {
        recorder = new MediaRecorder(this.recordingStream, options);
      } catch (recorderErr) {
        console.warn('[ClipRecorder] Falha ao criar MediaRecorder com mimeType:', this.mimeType, recorderErr);
        recorder = new MediaRecorder(this.recordingStream);
      }
      this.mediaRecorder = recorder;
      this._bindRecorderEvents(recorder, generation);

      // Fatias de 3 segundos (3000ms padrão) para evitar picos de flush e congelamento a cada 1 segundo
      const timeslice = this.timesliceMs || 3000;
      recorder.start(timeslice);
      this.isRecording = true;
      return true;
    } catch (err) {
      console.warn('[ClipRecorder] Falha ao iniciar gravação em buffer circular:', err);
      this.lastError = err;
      this.isRecording = false;
      this.mediaRecorder = null;
      this._releaseRecordingTracks();
      return false;
    }
  }

_bindRecorderEvents(recorder, generation) {
    recorder.ondataavailable = (e) => {
      if (this.mediaRecorder !== recorder || generation !== this._recordingGeneration) return;
      if (e.data && e.data.size > 0) {
        const now = Date.now();
        const chunk = { blob: e.data, timestamp: now, sequence: this._nextChunkSequence++ };
        if (!this.initializationChunk) this.initializationChunk = chunk;
        this.chunks.push(chunk);

        this.chunks.sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);

        if (this.maxDurationSeconds && this.maxDurationSeconds > 0) {
          const cutoff = now - (this.maxDurationSeconds * 1000);
          this.chunks = this.chunks.filter((item) => item === this.initializationChunk || item.timestamp >= cutoff);
        }
      }
    };

    recorder.onerror = (event) => {
      if (this.mediaRecorder !== recorder || generation !== this._recordingGeneration) return;
      this.lastError = event?.error || new Error('Falha desconhecida do MediaRecorder');
      this.isRecording = false;
      console.warn('[ClipRecorder] Erro no MediaRecorder:', this.lastError);
    };
  }

stop() {
    const recorder = this.mediaRecorder;
    this._recordingGeneration++;
    this.mediaRecorder = null;
    if (recorder) {
      try {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      } catch (e) {}
    }
    this.isRecording = false;
    this._releaseRecordingTracks();
    this.stream = null;
  }

clear() {
    this.chunks = [];
    this.initializationChunk = null;
    this.lastClipBlob = null;
    this.lastClipFileName = null;
  }

dispose() {
    this.stop();
    this.clear();
  }
};
