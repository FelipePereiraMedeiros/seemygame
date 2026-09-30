import { createAudioScope } from '../audio/context-scope.js';
import { withClipRecorderMixer } from './mixer.js';
import { withClipRecorderExporter } from './exporter.js';
import { withClipRecorderRecorder } from './recorder.js';
export class ClipRecorder extends withClipRecorderRecorder(withClipRecorderExporter(withClipRecorderMixer(class {}))) {
constructor(options = {}) {
    super();
    this.maxDurationSeconds = options.maxDurationSeconds !== undefined ? Number(options.maxDurationSeconds) : 30;
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
    this._audioScope = options.audioScope || createAudioScope();
    this._ownsAudioScope = !options.audioScope;
    this._audioDestination = null;
    this._audioTrackSources = new Map();
    this._audioGestureCleanup = null;
    this._streamAddTrackHandler = null;
    this._streamRemoveTrackHandler = null;
    this.mimeType = this._resolveSupportedMimeType();
  }
}
