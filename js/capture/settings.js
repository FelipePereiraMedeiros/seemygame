import { QUALITY_PROFILES, DEFAULT_PROFILE } from '../config.js';

/** Shared capture settings for browser and native providers. */
export function readCaptureSettings(root = document) {
  const value = id => root.getElementById(id)?.value;
  const key = value('quality-preset') || 'balanced';
  const profile = QUALITY_PROFILES[key === 'fhd60' ? 'balanced' : key === 'hd60' ? 'ultra' : key] || DEFAULT_PROFILE;
  return {
    width: profile.width, height: profile.height, fps: profile.fps,
    bitrateKbps: Number(value('bitrate-slider')) || Math.round(profile.bitrate / 1000),
    audioMode: value('audio-mode-select') || 'system',
    videoCodec: value('video-codec-select') || null,
    h264Encoder: value('h264-encoder-select') || null,
    showCursor: root.getElementById('capture-cursor-toggle')?.checked !== false,
    excludeApp: value('picker-audio-exclude-select') || value('audio-exclude-select') || null
  };
}

/** Serializes live provider changes and removes all subscriptions with the session. */
export function bindCaptureSettings(session, getProvider, showToast) {
  let pending = Promise.resolve();
  for (const id of ['quality-preset', 'bitrate-slider', 'audio-mode-select', 'video-codec-select', 'h264-encoder-select', 'capture-cursor-toggle', 'audio-exclude-select']) {
    session.addEventListener(document.getElementById(id), 'change', () => {
      const provider = getProvider();
      if (!provider?.session) return;
      const settings = readCaptureSettings();
      pending = pending.then(async () => {
        if (!session.isDisposed && getProvider() === provider && provider.session) await provider.reconfigure(settings);
      }).catch(error => showToast(error.message, 'error'));
    });
  }
  session.registerCleanup(() => pending);
}
