import { processImageFile } from './whiteboard.js';

export function bindWhiteboardUI(manager, {
  broadcast = () => {},
  chatManager = null,
  peerId = () => null,
  displayName = () => 'Jogador',
  role = () => 'viewer',
  showToast = () => {}
} = {}) {
  if (typeof document === 'undefined') return { open() {}, close() {}, destroy() {} };
  const modal = document.getElementById('whiteboard-modal');
  const canvas = document.getElementById('whiteboard-canvas');
  if (!modal || !canvas || !manager) return { open() {}, close() {}, destroy() {} };

  const cleanups = [];
  const listen = (target, type, handler, options) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };
  const click = (id, handler) => listen(document.getElementById(id), 'click', handler);
  const setActive = (selector, predicate) => {
    modal.querySelectorAll(selector).forEach((el) => el.classList.toggle('active', predicate(el)));
  };
  const previous = {
    onElementCreated: manager.onElementCreated,
    onElementUpdated: manager.onElementUpdated,
    onElementDeleted: manager.onElementDeleted,
    onBoardCleared: manager.onBoardCleared,
    onCursorMoved: manager.onCursorMoved,
    onToolChanged: manager.onToolChanged
  };
  manager.onElementCreated = (element) => { previous.onElementCreated?.(element); broadcast({ type: 'WHITEBOARD_ELEMENT_ADD', element }); };
  manager.onElementUpdated = (element) => { previous.onElementUpdated?.(element); broadcast({ type: 'WHITEBOARD_ELEMENT_UPDATE', element }); };
  manager.onElementDeleted = (element) => { previous.onElementDeleted?.(element); broadcast({ type: 'WHITEBOARD_ELEMENT_DELETE', elementId: element.id }); };
  manager.onBoardCleared = () => { previous.onBoardCleared?.(); broadcast({ type: 'WHITEBOARD_CLEAR' }); };
  let cursorSentAt = 0;
  manager.onCursorMoved = (position) => {
    previous.onCursorMoved?.(position);
    if (Date.now() - cursorSentAt < 50) return;
    cursorSentAt = Date.now();
    broadcast({ type: 'WHITEBOARD_CURSOR', ...position, userName: displayName() });
  };
  manager.onToolChanged = (toolId) => {
    previous.onToolChanged?.(toolId);
    setActive('.wb-tool-btn', (button) => button.dataset.tool === toolId);
  };

  const resizeCanvas = () => {
    const width = window.innerWidth || canvas.parentElement?.clientWidth || 1280;
    const height = window.innerHeight || canvas.parentElement?.clientHeight || 720;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      manager.render();
    }
  };
  const open = () => {
    modal.style.display = 'flex';
    resizeCanvas();
    manager.setCanvas(canvas);
    manager.render();
    document.getElementById('toggle-whiteboard-btn')?.classList.add('active');
    document.getElementById('dock-whiteboard-btn')?.classList.add('is-active');
    broadcast({ type: 'WHITEBOARD_REQUEST_SYNC' });
  };
  const close = () => {
    modal.style.display = 'none';
    document.getElementById('toggle-whiteboard-btn')?.classList.remove('active');
    document.getElementById('dock-whiteboard-btn')?.classList.remove('is-active');
  };
  const toggle = () => modal.style.display === 'flex' ? close() : open();
  click('toggle-whiteboard-btn', toggle);
  ['wb-close-btn', 'wb-back-room-btn', 'wb-floating-close-btn'].forEach((id) => click(id, close));
  listen(window, 'resize', resizeCanvas);
  listen(window, 'keydown', (event) => {
    if (modal.style.display !== 'flex') return;
    if (event.key === 'Escape') { close(); return; }
    if (event.target?.matches?.('input,textarea')) return;
    if ((event.ctrlKey || event.metaKey) && ['z', 'Z'].includes(event.key)) {
      event.preventDefault();
      const changed = event.shiftKey ? manager.redo() : manager.undo();
      if (changed) broadcast({ type: 'WHITEBOARD_SYNC', elements: manager.elements });
    } else if ((event.ctrlKey || event.metaKey) && ['y', 'Y'].includes(event.key)) {
      event.preventDefault();
      if (manager.redo()) broadcast({ type: 'WHITEBOARD_SYNC', elements: manager.elements });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      if (manager.selectedElementId) { event.preventDefault(); manager.deleteSelected(); }
    }
  });

  modal.querySelectorAll('.wb-tool-btn').forEach((button) => listen(button, 'click', () => {
    const tool = button.dataset.tool;
    if (tool === 'image') { document.getElementById('wb-image-input')?.click(); return; }
    manager.setTool(tool);
  }));
  const imageInput = document.getElementById('wb-image-input');
  listen(imageInput, 'change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await processImageFile(file);
      if (dataUrl) await manager.addImageFromDataUrl(dataUrl);
      showToast('Imagem inserida na lousa!', 'success');
    } catch (_) { showToast('Erro ao carregar imagem na lousa.', 'error'); }
    event.target.value = '';
  });
  const bindOptions = (selector, value, setter, apply) => modal.querySelectorAll(selector).forEach((button) => {
    listen(button, 'click', () => {
      const next = button.dataset[value];
      setter(next);
      setActive(selector, (candidate) => candidate === button);
      apply?.(next);
    });
  });
  bindOptions('.wb-color-dot', 'color', (color) => manager.setColor(color));
  bindOptions('#wb-width-group .wb-opt-btn', 'width', (width) => manager.setStrokeWidth(Number(width)));
  bindOptions('#wb-fill-group .wb-opt-btn', 'fill', (fill) => manager.setFill(fill));
  bindOptions('#wb-rough-group .wb-opt-btn', 'rough', (rough) => manager.setRough(rough === 'true'));
  bindOptions('#wb-bg-group .wb-opt-btn', 'bg', (mode) => manager.setBackgroundMode(mode), (mode) => {
    modal.style.background = mode === 'transparent' ? 'transparent' : mode === 'light' ? '#f8fafc' : '#12131c';
  });
  click('wb-undo-btn', () => { if (manager.undo()) broadcast({ type: 'WHITEBOARD_SYNC', elements: manager.elements }); });
  click('wb-redo-btn', () => { if (manager.redo()) broadcast({ type: 'WHITEBOARD_SYNC', elements: manager.elements }); });
  click('wb-clear-btn', () => { if (typeof confirm !== 'function' || confirm('Deseja realmente limpar toda a lousa?')) manager.clear(true); });
  click('wb-export-btn', async () => {
    try {
      const blob = await manager.exportToBlob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `SeeMyGame-Lousa-${Date.now()}.png`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (_) { showToast('Erro ao exportar imagem da lousa.', 'error'); }
  });
  click('wb-chat-btn', () => {
    if (!chatManager) return;
    const message = chatManager.createMessage({
      senderId: peerId(), senderName: displayName(), role: role(),
      text: 'Compartilhei um esquema na lousa interativa.', channel: chatManager.getActiveChannel()
    });
    const stored = message && chatManager.addMessage(message);
    if (stored) { broadcast({ type: 'CHAT_MESSAGE', message: stored }); showToast('Aviso enviado para o chat.', 'info'); }
  });
  const onDrop = async (event) => {
    if (modal.style.display !== 'flex') return;
    event.preventDefault();
    const file = Array.from(event.dataTransfer?.files || []).find((item) => item.type?.startsWith('image/'));
    if (!file) return;
    try {
      const dataUrl = await processImageFile(file);
      const rect = canvas.getBoundingClientRect();
      await manager.addImageFromDataUrl(dataUrl, Math.round((event.clientX - rect.left) / (rect.width || 1) * 1920), Math.round((event.clientY - rect.top) / (rect.height || 1) * 1080));
    } catch (_) { showToast('Erro ao carregar imagem solta na lousa.', 'error'); }
  };
  listen(modal, 'dragover', (event) => { if (modal.style.display === 'flex') event.preventDefault(); });
  listen(modal, 'drop', onDrop);
  listen(window, 'paste', async (event) => {
    if (modal.style.display !== 'flex' || event.target?.matches?.('input,textarea')) return;
    const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type?.startsWith('image/'));
    const file = item?.getAsFile?.();
    if (!file) return;
    event.preventDefault();
    try { const dataUrl = await processImageFile(file); await manager.addImageFromDataUrl(dataUrl); }
    catch (_) { showToast('Erro ao processar imagem colada.', 'error'); }
  });

  return {
    open,
    close,
    toggle,
    destroy() {
      cleanups.splice(0).forEach((cleanup) => cleanup());
      Object.entries(previous).forEach(([key, callback]) => { manager[key] = callback; });
    }
  };
}
