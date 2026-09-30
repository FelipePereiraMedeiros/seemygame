import * as audioEffects from '../audio-meme.js';
import { openClipPostModal, closeClipPostModal } from '../app/clip-editor.js';

/** Owns preview URLs, effect state and UI bindings for one clipping feature. */
export function bindClipEditor(session, { recorder, soundboardManager, showToast, broadcastDataMessage, getPeerId, getCoopState = () => ({}) }) {
  const ports = {
    ...audioEffects, clipRecorder: recorder, soundboardManager, showToast,
    broadcastDataMessage, getCoopState,
    currentPreviewController: null, activeClipBlob: null, activeAudioBuffer: null, activeEffectId: 'none',
    getAudioContext: () => session.audioScope.getContext(),
    get myId() { return getPeerId(); },
    closeClipPostModal: () => closeClipPostModal(ports),
    syncClipDurationUI: seconds => {
      for (const id of ['clip-buffer-duration-select', 'clip-modal-duration-select']) {
        const select = document.getElementById(id);
        if (select) select.value = String(seconds);
      }
    }
  };
  let generation = 0;
  const exportClip = async (sourceId = null) => {
    const current = ++generation;
    const blob = await recorder.exportClip(null, sourceId);
    if (!blob || session.isDisposed || current !== generation) return null;
    await openClipPostModal(ports, blob);
    if (session.isDisposed || current !== generation) closeClipPostModal(ports);
    return blob;
  };
  const click = () => exportClip().catch(error => showToast(`Erro ao exportar clip: ${error.message}`, 'error'));
  session.addEventListener(document.getElementById('clip-btn'), 'click', click);
  session.addEventListener(document.getElementById('clip-buffer-duration-select'), 'change', event => {
    ports.syncClipDurationUI(recorder.setMaxDurationSeconds(Number(event.target.value)));
  });
  session.registerCleanup(() => {
    generation++;
    closeClipPostModal(ports);
    const modal = document.getElementById('clip-post-modal');
    modal?.querySelectorAll('button,input,select').forEach(element => {
      element.onclick = element.oninput = element.onchange = null;
    });
    ports.activeClipBlob = ports.activeAudioBuffer = null;
  });
  return { exportClip, close: ports.closeClipPostModal };
}
