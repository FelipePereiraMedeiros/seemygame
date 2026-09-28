/** Opções do seletor web, independentes do dispositivo de reprodução. */
export function buildDisplayMediaOptions({ video = true, audio, audioMode = 'system', windowAudio, displaySurface, monitorTypeSurfaces } = {}) {
  const wantsAudio = audioMode === 'system' || audioMode === 'process';
  const resolvedAudio = audio !== undefined ? audio : (wantsAudio ? true : false);
  const resolvedWindowAudio = windowAudio !== undefined
    ? windowAudio
    : (wantsAudio ? 'window' : 'exclude');

  return {
    video: displaySurface ? { ...(typeof video === 'object' ? video : {}), displaySurface } : video,
    audio: resolvedAudio,
    systemAudio: wantsAudio ? 'include' : 'exclude',
    // windowAudio: 'window' ativa a captura do processo isolado (Application Audio) no Chromium.
    // Isso evita o erro "Could not start audio source" (NotReadableError) em desktops com drivers de áudio/headsets exclusivos.
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
    // Não reabrir o seletor com audio:false: isso oculta a opção de som e
    // transforma um erro de captura em uma aparente limitação do dispositivo.
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
