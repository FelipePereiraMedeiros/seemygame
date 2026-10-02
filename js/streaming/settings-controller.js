import { readCaptureSettings } from '../capture/settings.js';
import { QUALITY_PROFILES } from '../config.js';
import { applySenderOptimizations } from '../webrtc/sender.js';
/** Change resolution/FPS live, but codec changes require a new negotiation/capture. */
export function bindStreamingQuality(session, { getStream, getCalls, getProvider, onSettings, showToast }) {
  let pending = Promise.resolve();
  for (const id of ['quality-preset', 'bitrate-slider', 'video-codec-select']) {
    session.addEventListener(document.getElementById(id), 'change', () => {
      if (!getStream()) return;
      if (id === 'video-codec-select') { showToast('O novo codec será usado ao reiniciar a transmissão.', 'info'); return; }
      const settings = readCaptureSettings();
      if (id === 'quality-preset') {
        const profile = QUALITY_PROFILES[document.getElementById('quality-preset')?.value];
        if (profile) { settings.bitrateKbps = profile.bitrate / 1000; const slider = document.getElementById('bitrate-slider'); if (slider) slider.value = String(settings.bitrateKbps); }
      }
      pending = pending.catch(() => {}).then(async () => {
        if (session.isDisposed || !getStream()) return;
        if (!getProvider()?.session) {
          const track = getStream().getVideoTracks()[0];
          try { await track?.applyConstraints?.({ width: { ideal: settings.width, max: settings.width }, height: { ideal: settings.height, max: settings.height }, frameRate: { ideal: settings.fps, max: settings.fps } }); }
          catch (_) { showToast('A fonte não aceitou a resolução/FPS; confira o resultado no diagnóstico.', 'info'); }
        }
        onSettings(settings);
        for (const call of getCalls()) await applySenderOptimizations(call.peerConnection, settings.bitrateKbps * 1000, settings.fps);
      }).catch(error => showToast(error.message, 'error'));
    });
  }
  session.registerCleanup(() => pending);
}
