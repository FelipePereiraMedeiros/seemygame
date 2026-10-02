// A separate recording track: never apply constraints to the live WebRTC track.
export function createRecordingProfile(stream, profile = 'source') {
  if (profile === 'source') return null;
  const source = stream.getVideoTracks?.()[0];
  if (!source || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  if (typeof canvas.captureStream !== 'function') throw new Error('Replay reduzido indisponível neste navegador');
  const video = document.createElement('video');
  const fps = profile === 'light' ? 15 : 30;
  const maxHeight = profile === 'light' ? 480 : 720;
  const maxWidth = profile === 'light' ? 854 : 1280;
  const settings = source.getSettings?.() || {};
  const resize = () => {
    const width = video.videoWidth || settings.width || 1280;
    const height = video.videoHeight || settings.height || 720;
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    canvas.width = Math.max(2, Math.floor(width * scale / 2) * 2);
    canvas.height = Math.max(2, Math.floor(height * scale / 2) * 2);
  };
  resize();
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Não foi possível preparar o replay');
  // Advertise the real recording cadence to MediaRecorder. A zero-FPS track
  // with manual requests can lead to poorly spaced keyframes after rollover.
  const output = canvas.captureStream(fps);
  const track = output.getVideoTracks()[0];
  if (!track) {
    output.getTracks().forEach(t => t.stop());
    throw new Error('Replay reduzido sem trilha de vídeo');
  }
  stream.getAudioTracks?.().forEach(t => output.addTrack(t));
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([source]);
  let active = true, timer = null;
  const telemetry = { frames: 0, totalDrawMs: 0, maxDrawMs: 0, targetFps: fps };
  const draw = now => {
    if (!active) return;
    if (video.readyState >= 2) {
      if (!telemetry.frames) resize();
      const start = performance.now();
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const duration = performance.now() - start;
      telemetry.frames++; telemetry.totalDrawMs += duration;
      telemetry.maxDrawMs = Math.max(telemetry.maxDrawMs, duration);
    }
    // An unattached video may not be submitted to the compositor, so rVFC
    // cannot be the clock of this hidden recording-only track.
    timer = setTimeout(() => draw(performance.now()), 1000 / fps);
  };
  video.play().then(() => draw(performance.now())).catch(() => { telemetry.playbackError = true; });
  return { stream: output, telemetry, stop() {
    active = false;
    clearTimeout(timer); video.pause(); video.srcObject = null;
    track.stop(); // Audio belongs to the live stream.
  } };
}
