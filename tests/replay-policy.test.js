import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { ClipRecorderRegistry } from '../js/clipping/registry.js';
import { NativeReplayRecorder } from '../js/clipping/native-recorder.js';
import { ClipRecorder } from '../js/clipping/engine.js';

class Recorder {
  static isTypeSupported = () => true;
  constructor(stream, options) { this.stream = stream; this.options = options; this.state = 'inactive'; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
}
const stream = id => ({ id, getTracks: () => [] });
describe('Replay prioritizes streaming and records one selected source', () => {
  beforeEach(() => { localStorage.clear(); vi.stubGlobal('MediaRecorder', Recorder); });
  afterEach(() => { delete window.__TAURI_INTERNALS__; vi.unstubAllGlobals(); });
  it('does not record the publisher automatically but can opt in after capture starts', () => {
    const registry = new ClipRecorderRegistry();
    expect(registry.start(stream('me'), 'local-me')).toBe(false);
    expect(registry.recorders.size).toBe(0);
    registry.setPreferences({ recordLocal: true });
    expect(registry.isRecordingFor('local-me')).toBe(true); registry.stop();
  });
  it('records at most one source and explicit export never falls back to another user', async () => {
    const registry = new ClipRecorderRegistry();
    registry.start(stream('first'), 'alice'); const first = registry.getRecorder('alice');
    registry.start(stream('second'), 'bob');
    expect(registry.recorders.size).toBe(1);
    expect(await registry.exportClip(null, 'bob')).toBeNull();
    expect(registry.selectSource('bob')).toBe(true);
    expect(first.isRecording).toBe(false);
    expect(registry.isRecordingFor('bob')).toBe(true);
    expect(registry.recorders.size).toBe(1); registry.stop();
  });
  it('repeated audio/video track events do not reset history for the same stream', () => {
    const registry = new ClipRecorderRegistry(), source = stream('a');
    registry.start(source, 'alice'); const first = registry.getRecorder();
    first.chunks.push({ blob: new Blob(['history']), timestamp: Date.now() });
    registry.start(source, 'alice');
    expect(registry.getRecorder()).toBe(first); expect(first.chunks.length).toBe(1); registry.stop();
  });
  it('disable stops encoding; reenable retains source selection without a new stream event', () => {
    const registry = new ClipRecorderRegistry(); registry.start(stream('a'), 'alice');
    const first = registry.getRecorder(); registry.setPreferences({ enabled: false });
    expect(first.isRecording).toBe(false); expect(registry.recorders.size).toBe(0);
    registry.setPreferences({ enabled: true }); expect(registry.isRecordingFor('alice')).toBe(true); registry.stop();
  });
  it('selects a remaining received source when the selected publisher leaves', () => {
    const registry = new ClipRecorderRegistry(); registry.start(stream('a'), 'alice'); registry.start(stream('b'), 'bob');
    registry.stop('alice'); expect(registry.isRecordingFor('bob')).toBe(true);
    expect(registry.recorders.size).toBe(1); registry.stop(); expect(registry.sources.size).toBe(0);
  });
  it('persists opt-in, profile and codec; rejects unknown codec/profile values', () => {
    const registry = new ClipRecorderRegistry(); registry.setPreferences({ recordLocal: true, profile: 'light', codec: 'h264' });
    const next = new ClipRecorderRegistry(); expect(next.preferences).toMatchObject({ recordLocal: true, profile: 'light', codec: 'h264' });
    next.setPreferences({ profile: 'invalid', codec: 'invalid' }); expect(next.preferences.profile).toBe('light'); expect(next.preferences.codec).toBe('h264');
  });
  it('allows H.264/MP4 for full recording, but avoids unsupported circular MP4 and falls back to VP8', () => {
    Recorder.isTypeSupported = type => type.includes('avc1');
    expect(new ClipRecorder({ codec: 'h264', maxDurationSeconds: 0 })._resolveSupportedMimeType(true)).toBe('video/mp4;codecs=avc1,mp4a.40.2');
    expect(new ClipRecorder({ codec: 'h264' })._resolveSupportedMimeType(true)).not.toContain('mp4');
    Recorder.isTypeSupported = type => type.includes('vp8') || type.includes('vp9');
    expect(new ClipRecorder({ codec: 'h264' })._resolveSupportedMimeType(true)).toBe('video/webm;codecs=vp8,opus');
    Recorder.isTypeSupported = () => true;
  });
  it('reports a recorder failure and releases it instead of pretending replay started', () => {
    vi.stubGlobal('MediaRecorder', class { static isTypeSupported = () => true; constructor() { throw new Error('encoder unavailable'); } });
    const registry = new ClipRecorderRegistry();
    expect(registry.start(stream('a'), 'alice')).toBe(false);
    expect(registry.recorders.size).toBe(0); expect(registry.lastError.message).toBe('encoder unavailable');
    registry.setPreferences({ enabled: false }); expect(registry.lastError).toBeNull(); registry.stop();
  });
  it('routes local native replay to Rust without creating a MediaRecorder', async () => {
    const invoke = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])); window.__TAURI_INTERNALS__ = { invoke };
    const registry = new ClipRecorderRegistry({ preferences: { recordLocal: true }, getNativeContext: () => ({ sessionId: 'capture' }) });
    registry.start(stream('me'), 'local-me'); await registry.getRecorder().ready;
    expect(registry.getRecorder()).toBeInstanceOf(NativeReplayRecorder);
    expect(registry.mediaRecorder).toBeNull();
    const blob = await registry.exportClip(); expect(blob.type).toBe('video/mp4'); expect(blob.size).toBe(3);
    const recorder = registry.getRecorder(); registry.stop(); await recorder.stopped;
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['start_native_replay', 'export_native_replay', 'stop_native_replay']);
  });
  it('serializes native stop/restart and reports failures without browser fallback', async () => {
    const order = []; window.__TAURI_INTERNALS__ = { invoke: async command => { order.push(command); await new Promise(resolve => setTimeout(resolve, 10)); } };
    const first = new NativeReplayRecorder({ sessionId: 'capture' }); first.start(); first.stop();
    const second = new NativeReplayRecorder({ sessionId: 'capture' }); second.start(); await second.ready;
    expect(order).toEqual(['start_native_replay', 'stop_native_replay', 'start_native_replay']);
    expect(first.isRecording).toBe(false); expect(second.isRecording).toBe(true); await second.stop();
    window.__TAURI_INTERNALS__.invoke = vi.fn().mockRejectedValue('unsupported codec');
    const failed = new NativeReplayRecorder({ sessionId: 'bad' }); failed.start(); await failed.ready;
    expect(failed.isRecording).toBe(false); await expect(failed.exportClip()).rejects.toThrow('unsupported codec');
  });
  it('switches recording backend when native session or mic mode changes on the same stream', async () => {
    window.__TAURI_INTERNALS__ = { invoke: vi.fn().mockResolvedValue(undefined) };
    let context = { sessionId: 'first' };
    const registry = new ClipRecorderRegistry({ preferences: { recordLocal: true }, getNativeContext: () => context });
    const source = stream('me'); registry.start(source, 'local-me');
    const first = registry.getRecorder(); await first.ready;
    context = { sessionId: 'second' }; registry.start(source, 'local-me');
    const second = registry.getRecorder(); await second.ready; await first.stopped;
    expect(first.isRecording).toBe(false); expect(second.sessionId).toBe('second');
    context = null; registry.start(source, 'local-me'); await second.stopped;
    expect(registry.getRecorder()).toBeInstanceOf(ClipRecorder); expect(second.isRecording).toBe(false);
    expect(registry.recorders.size).toBe(1); registry.stop();
  });
});
