import { ClipRecorder } from './engine.js';
export class ClipRecorderRegistry {
  constructor(options = {}) {
    let savedDuration = 30;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const item = window.localStorage.getItem('seemygame_clip_duration');
        if (item !== null) {
          const parsed = Number(item);
          if (!isNaN(parsed) && parsed >= 0) savedDuration = parsed;
        }
      } catch (_) {}
    }
    this.options = { maxDurationSeconds: savedDuration, ...options };
    this.recorders = new Map();
    this.activeSourceId = null;
    this._compatRecordingOverride = null;
  }

  setMaxDurationSeconds(seconds) {
    const parsed = Number(seconds);
    const val = isNaN(parsed) || parsed < 0 ? 30 : parsed;
    this.options = { ...this.options, maxDurationSeconds: val };
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem('seemygame_clip_duration', String(val));
      } catch (_) {}
    }
    for (const recorder of this.recorders.values()) {
      if (recorder) {
        recorder.maxDurationSeconds = val;
        if (val > 0) {
          const now = Date.now();
          const cutoff = now - (val * 1000);
          recorder.chunks = recorder.chunks.filter((item) => item === recorder.initializationChunk || item.timestamp >= cutoff);
        }
      }
    }
    return val;
  }

  getMaxDurationSeconds() {
    return this.options?.maxDurationSeconds !== undefined ? this.options.maxDurationSeconds : 30;
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

