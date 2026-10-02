import { createAudioScope } from ".././audio/context-scope.js";
/** ClipRecorder: mixer. State and lifetime remain owned by the composed engine. */
export const withClipRecorderMixer = Base => class extends Base {
_resumeAudioContext() {
    if (!this._audioContext) return;
    if (this._audioContext.state === 'suspended') {
      try {
        const res = this._audioContext.resume();
        if (res && typeof res.catch === 'function') {
          res.catch(() => {});
        }
      } catch (_) {}
    }
  }

_connectAudioTrackToMixer(track) {
    if (!this._audioContext || !this._audioDestination) return;
    if (!track || track.readyState === 'ended') return;
    if (this._audioTrackSources.has(track)) return; // Previne conexões duplicadas

    try {
      const trackStream = typeof MediaStream !== 'undefined' ? new MediaStream([track]) : null;
      if (!trackStream || typeof this._audioContext.createMediaStreamSource !== 'function') return;

      const sourceNode = this._audioContext.createMediaStreamSource(trackStream);
      if (sourceNode && typeof sourceNode.connect === 'function') {
        sourceNode.connect(this._audioDestination);
      }

      const onEnded = () => {
        this._disconnectAudioTrackFromMixer(track);
      };
      if (typeof track.addEventListener === 'function') {
        track.addEventListener('ended', onEnded);
      }

      this._audioTrackSources.set(track, { sourceNode, onEnded, trackStream });
    } catch (err) {
      console.warn('[ClipRecorder] Falha ao conectar trilha de áudio ao mixer:', err);
    }
  }

_disconnectAudioTrackFromMixer(track) {
    if (!this._audioTrackSources || !this._audioTrackSources.has(track)) return;
    const entry = this._audioTrackSources.get(track);
    if (entry) {
      const { sourceNode, onEnded } = entry;
      if (track && typeof track.removeEventListener === 'function' && onEnded) {
        try { track.removeEventListener('ended', onEnded); } catch (_) {}
      }
      if (sourceNode && typeof sourceNode.disconnect === 'function') {
        try { sourceNode.disconnect(); } catch (_) {}
      }
    }
    this._audioTrackSources.delete(track);
  }

_releaseRecordingTracks() {
    if (this.stream && typeof this.stream.removeEventListener === 'function') {
      if (this._streamAddTrackHandler) {
        try { this.stream.removeEventListener('addtrack', this._streamAddTrackHandler); } catch (_) {}
        this._streamAddTrackHandler = null;
      }
      if (this._streamRemoveTrackHandler) {
        try { this.stream.removeEventListener('removetrack', this._streamRemoveTrackHandler); } catch (_) {}
        this._streamRemoveTrackHandler = null;
      }
    }
    if (this._audioGestureCleanup) {
      try { this._audioGestureCleanup(); } catch (_) {}
      this._audioGestureCleanup = null;
    }
    if (this._audioTrackSources) {
      this._audioTrackSources.forEach(({ sourceNode, onEnded }, track) => {
        if (track && typeof track.removeEventListener === 'function' && onEnded) {
          try { track.removeEventListener('ended', onEnded); } catch (_) {}
        }
        if (sourceNode && typeof sourceNode.disconnect === 'function') {
          try { sourceNode.disconnect(); } catch (_) {}
        }
      });
      this._audioTrackSources.clear();
    }
    if (this._audioContext) {
      if (this._ownsAudioScope) this._audioScope.dispose().catch(() => {});
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
};
