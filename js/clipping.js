/**
 * SeeMyGame - Módulo de Clipping e Instant Replay (30 segundos em Buffer Circular)
 * Permite salvar os últimos 30 segundos da transmissão diretamente no computador sem servidores.
 */

export class ClipRecorder {
  constructor(options = {}) {
    this.maxDurationSeconds = options.maxDurationSeconds || 30;
    this.timesliceMs = Number(options.timesliceMs) || 3000;
    this.chunks = []; // Array de { blob, timestamp }
    this.initializationChunk = null;
    this.mediaRecorder = null;
    this.stream = null;
    this.recordingStream = null;
    this.recordingTracks = [];
    this.isRecording = false;
    this.lastError = null;
    this._recordingGeneration = 0;
    this._nextChunkSequence = 0;
    this._audioContext = null;
    this._audioDestination = null;
    this._audioSourceNode = null;
    this.mimeType = this._resolveSupportedMimeType();
  }

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

  /**
   * Inicia o buffer circular gravando fatias de 1 segundo
   * @param {MediaStream} stream
   */
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
            this._audioContext = new AudioCtx();
            if (typeof this._audioContext.createMediaStreamDestination === 'function') {
              this._audioDestination = this._audioContext.createMediaStreamDestination();
              const mixedTrack = this._audioDestination.stream.getAudioTracks()[0];
              if (mixedTrack) {
                const audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
                if (audioTracks.length > 0 && typeof this._audioContext.createMediaStreamSource === 'function') {
                  this._audioSourceNode = this._audioContext.createMediaStreamSource(new MediaStream(audioTracks));
                  this._audioSourceNode.connect(this._audioDestination);
                }
                isolatedStream.getAudioTracks().forEach(t => isolatedStream.removeTrack(t));
                isolatedStream.addTrack(mixedTrack);
                this.recordingTracks.push({ track: mixedTrack, owned: true });
              }
            }
          } catch (audioErr) {
            console.warn('[ClipRecorder] Falha ao configurar mixer Web Audio:', audioErr);
          }
        }

        // Escuta novas trilhas adicionadas dinamicamente ao stream de origem (ex: áudio chegando após vídeo)
        if (typeof stream.addEventListener === 'function') {
          const onTrackAdded = (e) => {
            if (generation !== this._recordingGeneration || !this.isRecording) return;
            if (!e.track || e.track.readyState === 'ended') return;

            // Se for áudio e tivermos um mixer Web Audio ativo, roteia para o mixer sem alterar o MediaRecorder
            if (e.track.kind === 'audio' && this._audioContext && this._audioDestination) {
              try {
                if (this._audioContext.state === 'suspended') {
                  this._audioContext.resume().catch(() => {});
                }
                const newSource = this._audioContext.createMediaStreamSource(new MediaStream([e.track]));
                newSource.connect(this._audioDestination);
                return;
              } catch (routeErr) {
                console.warn('[ClipRecorder] Falha ao rotear áudio dinâmico ao mixer:', routeErr);
              }
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
          stream.addEventListener('addtrack', onTrackAdded);
          this._streamAddTrackHandler = onTrackAdded;
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

        const cutoff = now - (this.maxDurationSeconds * 1000);
        this.chunks = this.chunks.filter((item) => item === this.initializationChunk || item.timestamp >= cutoff);
      }
    };

    recorder.onerror = (event) => {
      if (this.mediaRecorder !== recorder || generation !== this._recordingGeneration) return;
      this.lastError = event?.error || new Error('Falha desconhecida do MediaRecorder');
      this.isRecording = false;
      console.warn('[ClipRecorder] Erro no MediaRecorder:', this.lastError);
    };
  }

  _releaseRecordingTracks() {
    if (this.stream && this._streamAddTrackHandler && typeof this.stream.removeEventListener === 'function') {
      try { this.stream.removeEventListener('addtrack', this._streamAddTrackHandler); } catch (_) {}
      this._streamAddTrackHandler = null;
    }
    if (this._audioSourceNode) {
      try { this._audioSourceNode.disconnect(); } catch (_) {}
      this._audioSourceNode = null;
    }
    if (this._audioContext) {
      try { this._audioContext.close(); } catch (_) {}
      this._audioContext = null;
    }
    this._audioDestination = null;

    this.recordingTracks.forEach(({ track, owned }) => {
      if (owned && typeof track.stop === 'function') {
        try { track.stop(); } catch (e) {}
      }
    });
    this.recordingTracks = [];
    this.recordingStream = null;
  }

  /**
   * Força o descarregamento imediato de dados em buffer no MediaRecorder ativo
   * @param {number} [timeoutMs=1000]
   * @returns {Promise<void>}
   */
  async flushPendingData(timeoutMs = 1000) {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') return;
    if (typeof this.mediaRecorder.requestData !== 'function') return;

    return new Promise((resolve, reject) => {
      let timer = null;
      let done = false;
      const media = this.mediaRecorder;

      const origOnData = media.ondataavailable;
      const wrappedOnData = (e) => {
        if (typeof origOnData === 'function') {
          try { origOnData(e); } catch (_) {}
        }
        onData();
      };

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (typeof media.removeEventListener === 'function') {
          media.removeEventListener('dataavailable', onData);
        }
        if (media.ondataavailable === wrappedOnData) {
          media.ondataavailable = origOnData;
        }
      };

      const onData = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };

      const onTimeout = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };

      if (typeof media.addEventListener === 'function') {
        media.addEventListener('dataavailable', onData);
      } else {
        media.ondataavailable = wrappedOnData;
      }

      try {
        media.requestData();
      } catch (err) {
        cleanup();
        resolve();
        return;
      }

      timer = setTimeout(onTimeout, timeoutMs);
    });
  }

  /**
   * Exporta o clipe gravado dos últimos segundos em arquivo para download
   * @param {string} [customFilename]
   * @returns {Blob|Promise<Blob>|null}
   */
  exportClip(customFilename = null) {
    if (!this.chunks || this.chunks.length === 0) {
      return null;
    }

    const orderedChunks = [...this.chunks].sort((a, b) => a.timestamp - b.timestamp || (a.sequence || 0) - (b.sequence || 0));
    const actualMimeType = this.mediaRecorder?.mimeType || this.mimeType || 'video/webm';
    const cutoff = Date.now() - (this.maxDurationSeconds * 1000);

    // MediaRecorder's first WebM chunk contains both the EBML/track header
    // and the first Cluster. Keeping that whole chunk forever resurrects old
    // frames in a long-running replay. Removing the obsolete Cluster must be
    // asynchronous because Blob bytes are only available through
    // arrayBuffer() in the browser.
    const staleInitializationChunk = this.initializationChunk &&
      this.initializationChunk.timestamp < cutoff && actualMimeType.includes('webm');
    if (staleInitializationChunk) {
      return this._exportWithoutStaleInitializationCluster(
        orderedChunks,
        cutoff,
        actualMimeType,
        customFilename
      );
    }

    return this._finalizeExport(orderedChunks.map(item => item.blob), actualMimeType, customFilename);
  }

  async _exportWithoutStaleInitializationCluster(orderedChunks, cutoff, actualMimeType, customFilename) {
    const initialization = this.initializationChunk;
    const initializationBytes = new Uint8Array(await initialization.blob.arrayBuffer());
    const clusterMarker = new Uint8Array([0x1f, 0x43, 0xb6, 0x75]);
    let clusterOffset = -1;
    for (let index = 0; index <= initializationBytes.length - clusterMarker.length; index += 1) {
      let matches = true;
      for (let markerIndex = 0; markerIndex < clusterMarker.length; markerIndex += 1) {
        if (initializationBytes[index + markerIndex] !== clusterMarker[markerIndex]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        clusterOffset = index;
        break;
      }
    }

    if (clusterOffset < 0) {
      // A pure initialization chunk has no media payload to remove.
      return this._finalizeExport(
        [initialization.blob, ...orderedChunks
          .filter(item => item !== initialization && item.timestamp >= cutoff)
          .map(item => item.blob)],
        actualMimeType,
        customFilename
      );
    }

    const header = initializationBytes.slice(0, clusterOffset);
    const recentChunks = orderedChunks.filter(item => item !== initialization && item.timestamp >= cutoff);
    if (recentChunks.length === 0) {
      return this._finalizeExport(orderedChunks.map(item => item.blob), actualMimeType, customFilename);
    }

    const recentBlobs = recentChunks.map(item => item.blob);
    const recentCombined = new Uint8Array(await new Blob(recentBlobs).arrayBuffer());

    // Localiza o primeiro marcador de Cluster [0x1f, 0x43, 0xb6, 0x75] válido dentro do stream recente.
    // Em transmissões contínuas com timeslice, o início de recentBlobs[0] pode conter
    // resíduos parciais do cluster anterior descartado. Descartar esses bytes até
    // o próximo marcador garante que o container WebM permaneça perfeitamente alinhado e decodificável.
    let targetClusterOffset = -1;
    for (let index = 0; index <= recentCombined.length - clusterMarker.length; index += 1) {
      let matches = true;
      for (let markerIndex = 0; markerIndex < clusterMarker.length; markerIndex += 1) {
        if (recentCombined[index + markerIndex] !== clusterMarker[markerIndex]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        targetClusterOffset = index;
        break;
      }
    }

    if (targetClusterOffset < 0) {
      // Se nenhum cluster foi localizado nos chunks recentes, preserva o corpo completo
      return this._finalizeExport([header, recentCombined], actualMimeType, customFilename);
    }

    const cleanClusters = recentCombined.slice(targetClusterOffset);
    return this._finalizeExport([header, cleanClusters], actualMimeType, customFilename);
  }

  _finalizeExport(rawBlobs, actualMimeType, customFilename) {
    const clipBlob = new Blob(rawBlobs, { type: actualMimeType });

    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const extension = actualMimeType.includes('mp4') ? 'mp4' : 'webm';
    const filename = customFilename || `SeeMyGame-Clip-${dateStr}.${extension}`;

    clipBlob.fileName = filename;
    clipBlob.blob = clipBlob;
    this.lastClipBlob = clipBlob;
    this.lastClipFileName = filename;

    if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try {
        const url = URL.createObjectURL(clipBlob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1500);
      } catch (err) {
        console.warn('[ClipRecorder] Falha no download automático do clipe:', err);
      }
    }

    return clipBlob;
  }

  /**
   * Retorna o último Blob de clipe gerado
   * @returns {Blob|null}
   */
  getRecentClipBlob() {
    return this.lastClipBlob || null;
  }

  /**
   * Verifica se há um clipe recente pronto para edição
   * @returns {boolean}
   */
  hasRecentClip() {
    return !!this.lastClipBlob;
  }

  /**
   * Encerra a gravação e limpa o buffer
   */
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
}

/**
 * Mantém um buffer independente por cartão de vídeo. Um singleton único não
 * é suficiente quando o espectador acompanha dois hosts (ou a própria
 * transmissão e um host) ao mesmo tempo: cada MediaRecorder precisa manter
 * seus próprios cabeçalhos, timestamps e janela circular.
 */
export class ClipRecorderRegistry {
  constructor(options = {}) {
    this.options = options;
    this.recorders = new Map();
    this.activeSourceId = null;
    this._compatRecordingOverride = null;
  }

  _normalizeSourceId(sourceId = 'default') {
    return sourceId === null || sourceId === undefined || sourceId === ''
      ? 'default'
      : String(sourceId);
  }

  getRecorder(sourceId = null) {
    if (sourceId !== null && sourceId !== undefined && sourceId !== '') {
      const normalized = String(sourceId);
      const found = this.recorders.get(normalized);
      if (found) return found;
    }

    if (this.activeSourceId && this.recorders.has(this.activeSourceId)) {
      return this.recorders.get(this.activeSourceId);
    }

    for (const recorder of this.recorders.values()) {
      if (recorder && recorder.isRecording) return recorder;
    }

    return this.recorders.values().next().value || null;
  }

  get isRecording() {
    if (this._compatRecordingOverride !== null) return this._compatRecordingOverride;
    return Array.from(this.recorders.values()).some((recorder) => recorder.isRecording);
  }

  // Kept for compatibility with integrations that used the original
  // singleton in tests or UI adapters.
  set isRecording(value) {
    this._compatRecordingOverride = Boolean(value);
    const active = this.getRecorder();
    if (active) active.isRecording = Boolean(value);
  }

  get chunks() {
    return this.getRecorder()?.chunks || [];
  }

  get mediaRecorder() {
    return this.getRecorder()?.mediaRecorder || null;
  }

  start(stream, sourceId = 'default') {
    const id = this._normalizeSourceId(sourceId);
    const previous = this.recorders.get(id);
    previous?.stop();

    const recorder = new ClipRecorder(this.options);
    if (!recorder.start(stream)) return false;

    this.recorders.set(id, recorder);
    this.activeSourceId = id;
    this._compatRecordingOverride = null;
    return true;
  }

  isRecordingFor(sourceId) {
    return Boolean(this.recorders.get(this._normalizeSourceId(sourceId))?.isRecording);
  }

  stop(sourceId = null) {
    if (sourceId === null || sourceId === undefined) {
      this.recorders.forEach((recorder) => recorder.stop());
      this.recorders.clear();
      this.activeSourceId = null;
      this._compatRecordingOverride = false;
      return;
    }

    const id = this._normalizeSourceId(sourceId);
    const recorder = this.recorders.get(id);
    recorder?.stop();
    this.recorders.delete(id);
    if (this.activeSourceId === id) {
      this.activeSourceId = this.recorders.keys().next().value || null;
    }
  }

  async exportClip(customFilename = null, sourceId = null) {
    const recorder = this.getRecorder(sourceId);
    if (!recorder) return null;
    await recorder.flushPendingData();
    return recorder.exportClip(customFilename);
  }

  async exportClipFor(sourceId, customFilename = null) {
    return this.exportClip(customFilename, sourceId);
  }

  getRecentClipBlob(sourceId = null) {
    return this.getRecorder(sourceId)?.getRecentClipBlob() || null;
  }

  hasRecentClip(sourceId = null) {
    return Boolean(this.getRecorder(sourceId)?.hasRecentClip());
  }

  clear(sourceId = null) {
    if (sourceId === null || sourceId === undefined) {
      this.recorders.forEach((recorder) => recorder.clear());
      return;
    }
    this.getRecorder(sourceId)?.clear();
  }
}

export const clipRecorder = new ClipRecorderRegistry();
