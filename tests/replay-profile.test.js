import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRecordingProfile } from '../js/clipping/recording-profile.js';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('Recording profiles leave live capture tracks intact', () => {
  it('source profile introduces no canvas or modified tracks', () => {
    const source = { getVideoTracks: vi.fn() };
    expect(createRecordingProfile(source, 'source')).toBeNull(); expect(source.getVideoTracks).not.toHaveBeenCalled();
  });
  it.each([['light', 15, 852, 480], ['balanced', 30, 1280, 720]])('%s uses a separate limited track and stops only its own track', async (profile, fps, width, height) => {
    vi.useFakeTimers();
    const originalVideo = { getSettings: () => ({ width: 1920, height: 1080 }), stop: vi.fn(), applyConstraints: vi.fn() };
    const audio = { stop: vi.fn() }, derived = { stop: vi.fn() };
    const canvas = { getContext: () => ({ drawImage: vi.fn() }), captureStream: vi.fn(() => ({ getVideoTracks: () => [derived], getTracks: () => [derived], addTrack: vi.fn() })) };
    const video = { readyState: 2, videoWidth: 1920, videoHeight: 1080, play: () => Promise.resolve(), pause: vi.fn() };
    vi.spyOn(document, 'createElement').mockImplementation(type => type === 'canvas' ? canvas : video);
    vi.stubGlobal('MediaStream', class { constructor(tracks) { this.tracks = tracks; } });
    const result = createRecordingProfile({ getVideoTracks: () => [originalVideo], getAudioTracks: () => [audio] }, profile);
    await Promise.resolve();
    expect(canvas.captureStream).toHaveBeenCalledWith(fps); expect(canvas.width).toBe(width); expect(canvas.height).toBe(height);
    result.stop(); expect(derived.stop).toHaveBeenCalledOnce(); expect(video.srcObject).toBeNull();
    expect(originalVideo.applyConstraints).not.toHaveBeenCalled(); expect(originalVideo.stop).not.toHaveBeenCalled(); expect(audio.stop).not.toHaveBeenCalled();
  });
});
