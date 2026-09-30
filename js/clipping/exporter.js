import { createAudioScope } from ".././audio/context-scope.js";
/** ClipRecorder: exporter. State and lifetime remain owned by the composed engine. */
export const withClipRecorderExporter = Base => class extends Base {
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

exportClip(customFilename = null) {
    if (!this.chunks || this.chunks.length === 0) {
      return null;
    }

    const orderedChunks = [...this.chunks].sort((a, b) => a.timestamp - b.timestamp || (a.sequence || 0) - (b.sequence || 0));
    const actualMimeType = this.mediaRecorder?.mimeType || this.mimeType || 'video/webm';
    const hasCutoff = this.maxDurationSeconds && this.maxDurationSeconds > 0;
    const cutoff = hasCutoff ? Date.now() - (this.maxDurationSeconds * 1000) : 0;

    // MediaRecorder's first WebM chunk contains both the EBML/track header
    // and the first Cluster. Keeping that whole chunk forever resurrects old
    // frames in a long-running replay. Removing the obsolete Cluster must be
    // asynchronous because Blob bytes are only available through
    // arrayBuffer() in the browser.
    const staleInitializationChunk = hasCutoff && this.initializationChunk &&
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

getRecentClipBlob() {
    return this.lastClipBlob || null;
  }

hasRecentClip() {
    return !!this.lastClipBlob;
  }
};
