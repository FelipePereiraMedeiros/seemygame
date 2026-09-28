/** Opções do seletor web, independentes do dispositivo de reprodução. */
export function buildDisplayMediaOptions({ video = true, audio, audioMode = 'system', displaySurface, monitorTypeSurfaces } = {}) {
  const wantsAudio = audioMode === 'system' || audioMode === 'process';
  const resolvedAudio = audio !== undefined ? audio : (wantsAudio ? true : false);
  return {
    video: displaySurface ? { ...(typeof video === 'object' ? video : {}), displaySurface } : video,
    audio: resolvedAudio,
    systemAudio: wantsAudio ? 'include' : 'exclude',
    // Compatibilidade com Google Meet e navegadores Chromium:
    // Não força windowAudio: 'system' para capturas de sistema, pois o Chromium 142+ já compartilha
    // o áudio do dispositivo (device audio) nativamente ao selecionar janelas quando systemAudio é 'include'.
    // Forçar windowAudio: 'system' e restrições de APM de microfone (AEC/AGC/NS) causa "Could not start audio source"
    // em dispositivos de áudio wireless / USB (ex: headsets gamer como MCHOOSE V9 PRO).
    ...(wantsAudio ? (audioMode === 'process' ? { windowAudio: 'window' } : {}) : { windowAudio: 'exclude' }),
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
