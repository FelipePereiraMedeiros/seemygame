/** Restrições de áudio ideais para captura de jogos e som de sistema (padrão Google Meet sem APM). */
export const DEFAULT_BROWSER_AUDIO_CONSTRAINTS = Object.freeze({
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
  suppressLocalAudioPlayback: false,
  restrictOwnAudio: true
});

/** Opções do seletor web, alinhadas aos padrões de alta fidelidade e compatibilidade de hardware. */
export function buildDisplayMediaOptions({ video = true, audio, audioMode = 'system', windowAudio, displaySurface, monitorTypeSurfaces } = {}) {
  const wantsAudio = audioMode === 'system' || audioMode === 'process';

  let resolvedAudio = false;
  if (audio !== undefined) {
    if (typeof audio === 'object' && audio !== null) {
      resolvedAudio = { ...DEFAULT_BROWSER_AUDIO_CONSTRAINTS, ...audio };
    } else {
      resolvedAudio = audio ? { ...DEFAULT_BROWSER_AUDIO_CONSTRAINTS } : false;
    }
  } else if (wantsAudio) {
    resolvedAudio = { ...DEFAULT_BROWSER_AUDIO_CONSTRAINTS };
  }

  // No modo 'process' (exclusivo para Janela isolada), sugerimos 'window'.
  // No modo 'system' (jogos/tela inteira), sugerimos 'system' para máxima compatibilidade com WASAPI Loopback.
  const resolvedWindowAudio = windowAudio !== undefined
    ? windowAudio
    : (audioMode === 'process' ? 'window' : (wantsAudio ? 'system' : 'exclude'));

  return {
    video: displaySurface ? { ...(typeof video === 'object' ? video : {}), displaySurface } : video,
    audio: resolvedAudio,
    systemAudio: wantsAudio ? 'include' : 'exclude',
    windowAudio: resolvedWindowAudio,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    ...(monitorTypeSurfaces ? { monitorTypeSurfaces } : {})
  };
}

export async function requestBrowserDisplayMedia(options, mediaDevices = globalThis.navigator?.mediaDevices) {
  if (!mediaDevices?.getDisplayMedia) throw new Error('Captura de tela não é suportada neste navegador');
  const constraints = buildDisplayMediaOptions(options);
  console.info('[Capture Browser] Solicitação ao seletor:', constraints);
  try {
    return await mediaDevices.getDisplayMedia(constraints);
  } catch (error) {
    console.warn('[Capture Browser] Falha no seletor (sem repetição automática):', {
      name: error?.name,
      message: error?.message,
      constraint: error?.constraint,
      audioRequested: constraints.audio !== false,
      windowAudio: constraints.windowAudio
    });
    throw error;
  }
}
