/**
 * SeeMyGame - Gerenciamento de Dispositivos de Áudio (Microfone e Saída de Som)
 * Permite listar, selecionar, persistir e testar microfones e alto-falantes/fones de ouvido.
 */

export const STORAGE_KEY_INPUT = 'seemygame_audio_input_id';
export const STORAGE_KEY_OUTPUT = 'seemygame_audio_output_id';

/**
 * Verifica se a saída de áudio personalizada (setSinkId) é suportada pelo navegador
 * @returns {boolean}
 */
export function isAudioOutputSupported() {
  return typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype.setSinkId === 'function';
}

/**
 * Recupera as preferências de dispositivos salvas no localStorage
 * @returns {{ inputId: string, outputId: string }}
 */
export function getSavedAudioPreferences() {
  try {
    if (typeof localStorage !== 'undefined') {
      return {
        inputId: localStorage.getItem(STORAGE_KEY_INPUT) || '',
        outputId: localStorage.getItem(STORAGE_KEY_OUTPUT) || ''
      };
    }
  } catch (e) {
    console.warn('[AudioDevices] Falha ao ler localStorage:', e);
  }
  return { inputId: '', outputId: '' };
}

/**
 * Salva uma preferência de dispositivo no localStorage
 * @param {'input' | 'output'} kind
 * @param {string} deviceId
 */
export function saveAudioPreference(kind, deviceId) {
  try {
    if (typeof localStorage !== 'undefined') {
      const key = kind === 'input' ? STORAGE_KEY_INPUT : STORAGE_KEY_OUTPUT;
      if (deviceId) {
        localStorage.setItem(key, deviceId);
      } else {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.warn('[AudioDevices] Falha ao salvar no localStorage:', e);
  }
}

/**
 * Lista todos os dispositivos de entrada e saída de áudio disponíveis no sistema
 * @returns {Promise<{ microphones: MediaDeviceInfo[], speakers: MediaDeviceInfo[], supportsOutput: boolean }>}
 */
export async function getAudioDevices(requestPermissionIfNeeded = false) {
  const supportsOutput = isAudioOutputSupported();

  if (!navigator?.mediaDevices?.enumerateDevices) {
    return { microphones: [], speakers: [], supportsOutput };
  }

  try {
    let devices = await navigator.mediaDevices.enumerateDevices();
    let microphones = devices.filter((d) => d.kind === 'audioinput');
    let speakers = devices.filter((d) => d.kind === 'audiooutput');

    // Em navegadores/WebView2, os rótulos de dispositivos vêm em branco caso
    // a permissão de microfone ainda não tenha sido concedida pelo usuário.
    const hasLabels = microphones.some((m) => Boolean(m.label));
    if (requestPermissionIfNeeded && !hasLabels && typeof navigator?.mediaDevices?.getUserMedia === 'function') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream?.getTracks?.().forEach((t) => t.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
        microphones = devices.filter((d) => d.kind === 'audioinput');
        speakers = devices.filter((d) => d.kind === 'audiooutput');
      } catch (e) {
        // Permissão negada ou cancelada; mantém os dispositivos disponíveis
      }
    }

    return {
      microphones,
      speakers,
      supportsOutput
    };
  } catch (err) {
    console.warn('[AudioDevices] Erro ao enumerar dispositivos:', err);
    return { microphones: [], speakers: [], supportsOutput };
  }
}

/**
 * Preenche um elemento <select> com a lista de dispositivos
 * @param {HTMLSelectElement} selectElem
 * @param {MediaDeviceInfo[]} devices
 * @param {string} selectedId
 * @param {string} defaultLabel
 */
export function populateDeviceSelect(selectElem, devices = [], selectedId = '', defaultLabel = 'Padrão do Sistema') {
  if (!selectElem) return;

  selectElem.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = defaultLabel;
  selectElem.appendChild(defaultOption);

  let hasMatchedSelected = false;

  devices.forEach((dev, idx) => {
    if (dev.deviceId === 'default') {
      defaultOption.textContent = `${defaultLabel} (${dev.label || 'Dispositivo Padrão'})`;
      return;
    }

    const opt = document.createElement('option');
    opt.value = dev.deviceId;
    opt.textContent = dev.label || `${dev.kind === 'audioinput' ? 'Microfone' : 'Alto-falante'} ${idx + 1}`;

    if (dev.deviceId === selectedId) {
      opt.selected = true;
      hasMatchedSelected = true;
    }

    selectElem.appendChild(opt);
  });

  if (!hasMatchedSelected) {
    defaultOption.selected = true;
  }
}

/**
 * Reproduz um som melódico de teste através do dispositivo de saída indicado
 * @param {string} sinkId DeviceId do alto-falante/fone
 * @returns {Promise<void>}
 */
export async function playTestTone(sinkId = '') {
  const AudioContextClass = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!AudioContextClass) return;

  const ctx = new AudioContextClass();
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }

  // Se o próprio AudioContext suportar setSinkId diretamente (Chrome 110+)
  if (sinkId && typeof ctx.setSinkId === 'function') {
    try {
      await ctx.setSinkId(sinkId);
    } catch (e) {
      console.warn('[AudioDevices] Falha ao definir setSinkId no AudioContext:', e);
    }
  }

  const now = ctx.currentTime;
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(587.33, now); // D5
  osc1.frequency.setValueAtTime(880.00, now + 0.14); // A5

  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(880.00, now);
  osc2.frequency.setValueAtTime(1174.66, now + 0.14); // D6

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.2, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

  osc1.connect(gain);
  osc2.connect(gain);

  let audioElem = null;
  if (sinkId && typeof ctx.createMediaStreamDestination === 'function' && typeof Audio !== 'undefined') {
    try {
      const dest = ctx.createMediaStreamDestination();
      gain.connect(dest);
      audioElem = new Audio();
      audioElem.srcObject = dest.stream;
      if (typeof audioElem.setSinkId === 'function') {
        await audioElem.setSinkId(sinkId).catch(() => {});
      }
      await audioElem.play().catch(() => {});
    } catch (e) {
      gain.connect(ctx.destination);
    }
  } else {
    gain.connect(ctx.destination);
  }

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 0.46);
  osc2.stop(now + 0.46);

  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    if (audioElem) {
      audioElem.pause();
      audioElem.srcObject = null;
    }
    if (ctx.state !== 'closed') {
      await ctx.close().catch(() => {});
    }
  } catch (e) {}
}

/**
 * Adiciona listener para alterações físicas de dispositivos (conectar/desconectar fones/microfones)
 * @param {Function} callback
 * @returns {Function} Função de limpeza (cleanup/unsubscribe)
 */
export function watchDeviceChanges(callback) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) {
    return () => {};
  }

  const handler = () => {
    if (typeof callback === 'function') {
      callback();
    }
  };

  navigator.mediaDevices.addEventListener('devicechange', handler);
  return () => {
    navigator.mediaDevices.removeEventListener('devicechange', handler);
  };
}
