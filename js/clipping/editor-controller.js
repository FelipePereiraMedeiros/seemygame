import * as audioEffects from '../audio-meme.js';
import { openClipPostModal, closeClipPostModal } from '../app/clip-editor.js';
import { detectGamepadType } from '../coop/input.js';
import { bindReplayControls } from './replay-controls.js';

/** Owns preview URLs, effect state and UI bindings for one clipping feature. */
export function bindClipEditor(session, { recorder, soundboardManager, showToast, broadcastDataMessage, getPeerId, getCoopState = () => ({}) }) {
  bindReplayControls(session, recorder);
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
    if (!blob) { showToast?.('Ative o replay desta transmissão para acumular os próximos segundos.', 'info'); return null; }
    if (session.isDisposed || current !== generation) return null;
    await openClipPostModal(ports, blob);
    if (session.isDisposed || current !== generation) closeClipPostModal(ports);
    return blob;
  };
  let lastClipTriggerAt = -Infinity;
  let highlightTimer = null;
  const controllerLabOpen = () => Boolean(document.querySelector('.controller-lab:not([hidden])'));
  const DEBOUNCE_MS = 1500;

  const triggerClip = async (sourceId = null) => {
    if (session.isDisposed) return null;
    const now = Date.now();
    if (now - lastClipTriggerAt < DEBOUNCE_MS) return null;
    lastClipTriggerAt = now;

    const clipBtn = typeof document !== 'undefined' ? document.getElementById('clip-btn') : null;
    if (clipBtn) {
      clipBtn.classList.add('is-clipping-active');
      clearTimeout(highlightTimer);
      highlightTimer = setTimeout(() => clipBtn.classList.remove('is-clipping-active'), 800);
    }
    showToast?.('🎬 Gravando clipe...', 'info');
    try {
      return await exportClip(sourceId);
    } catch (error) {
      showToast?.(`Erro ao exportar clipe: ${error?.message || error}`, 'error');
      return null;
    }
  };

  const click = () => triggerClip();
  const clipButton = document.getElementById('clip-btn');
  const originalTitle = clipButton?.getAttribute('title');
  if (clipButton) clipButton.title = 'Salvar clipe. Com SeeMyGame em foco: C, Alt+C ou Ctrl+Shift+C. Controle padrão: Back/Select + RB/R1; PlayStation: Share/Create.';
  session.addEventListener(clipButton, 'click', click);
  session.addEventListener(document.getElementById('clip-buffer-duration-select'), 'change', event => {
    ports.syncClipDurationUI(recorder.setMaxDurationSeconds(Number(event.target.value)));
  });

  // Atalhos da página: precisam de foco. O navegador não registra hotkeys do sistema.
  if (typeof window !== 'undefined') {
    const handleKeyDown = (e) => {
      if (session.isDisposed || controllerLabOpen() || e.repeat || e.defaultPrevented || e.isComposing) return;
      const target = e.target;
      if (target && (target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])') || target.isContentEditable)) {
        return;
      }
      const keyUpper = (e.key || '').toUpperCase();
      const code = e.code || '';
      const isAltC = (keyUpper === 'C' || code === 'KeyC') && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
      const isCtrlShiftC = (keyUpper === 'C' || code === 'KeyC') && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey;
      const isPlainC = (keyUpper === 'C' || code === 'KeyC') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;

      if (isAltC || isCtrlShiftC || isPlainC) {
        // C também é ferramenta da lousa; preserve os atalhos do editor aberto.
        const whiteboard = document.getElementById('whiteboard-modal');
        const clipModal = document.getElementById('clip-post-modal');
        if ([whiteboard, clipModal].some(modal => modal && !modal.hidden && window.getComputedStyle(modal).display !== 'none')) return;
        e.preventDefault();
        triggerClip();
      }
    };
    session.addEventListener(window, 'keydown', handleKeyDown);

    // Gamepad padrão: Back/Select(8)+R1/RB(5), ou Share/Create(8) no PlayStation.
    let gamepadPollingActive = true;
    let gamepadPollAnimId = null;
    const pressedByController = new Map();

    const pollGamepadClipShortcut = () => {
      if (!gamepadPollingActive || session.isDisposed) return;
      try {
        const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
        const connectedControllers = new Set();
        for (const [position, gp] of Array.from(gamepads).entries()) {
          if (!gp || !gp.connected || !gp.buttons) continue;
          if (gp.mapping !== undefined && gp.mapping !== 'standard') continue;
          const controllerId = `${gp.index ?? position}:${gp.id || ''}`;
          connectedControllers.add(controllerId);
          const isBtnPressed = (idx) => {
            const b = gp.buttons[idx];
            return b && typeof b === 'object' ? Boolean(b.pressed || b.value > 0.5) : b === 1.0;
          };
          const backAndR1 = isBtnPressed(8) && isBtnPressed(5);
          const shareBtn = detectGamepadType(gp.id) === 'playstation' && isBtnPressed(8);
          const comboActive = backAndR1 || shareBtn;
          if (comboActive && !pressedByController.get(controllerId) && !controllerLabOpen()) triggerClip();
          pressedByController.set(controllerId, comboActive);
        }
        for (const id of pressedByController.keys()) {
          if (!connectedControllers.has(id)) pressedByController.delete(id);
        }
      } catch (err) {}

      if (gamepadPollingActive && !session.isDisposed) {
        gamepadPollAnimId = requestAnimationFrame(pollGamepadClipShortcut);
      }
    };
    gamepadPollAnimId = requestAnimationFrame(pollGamepadClipShortcut);

    session.registerCleanup(() => {
      gamepadPollingActive = false;
      pressedByController.clear();
      if (gamepadPollAnimId !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(gamepadPollAnimId);
      }
    });
  }
  session.registerCleanup(() => {
    generation++;
    clearTimeout(highlightTimer);
    document.getElementById('clip-btn')?.classList.remove('is-clipping-active');
    if (clipButton) {
      if (originalTitle === null) clipButton.removeAttribute('title');
      else clipButton.setAttribute('title', originalTitle);
    }
    closeClipPostModal(ports);
    const modal = document.getElementById('clip-post-modal');
    modal?.querySelectorAll('button,input,select').forEach(element => {
      element.onclick = element.oninput = element.onchange = null;
    });
    ports.activeClipBlob = ports.activeAudioBuffer = null;
  });
  return { exportClip, triggerClip, close: ports.closeClipPostModal };
}
