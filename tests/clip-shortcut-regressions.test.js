import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindClipEditor } from '../js/clipping/editor-controller.js';
import { createSessionContext } from '../js/core/session-context.js';

describe('Atalhos de clipping: bordas, identidade e ciclo de vida', () => {
  let session, recorder, poll, pads, editor;
  const pad = (index, id = 'Xbox') => ({ index, id, connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
  const press = (gp, ...indices) => indices.forEach(i => { gp.buttons[i] = { pressed: true, value: 1 }; });
  const key = options => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', cancelable: true, bubbles: true, ...options }));
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    document.body.innerHTML = '<button id="clip-btn"></button><div id="clip-post-modal" style="display:none"></div>';
    pads = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(cb => { poll = cb; return 0; });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
    session = createSessionContext({ role: 'streamer' });
    recorder = { exportClip: vi.fn().mockResolvedValue(null) };
    editor = bindClipEditor(session, { recorder, getPeerId: () => 'local', showToast: vi.fn() });
  });
  afterEach(() => {
    session.dispose();
    vi.restoreAllMocks();
    delete navigator.getGamepads;
    vi.useRealTimers();
    document.body.innerHTML = '';
  });
  it('Share/Create Sony é botão 8 e funciona sozinho', () => {
    pads = [pad(0, 'DualSense (Vendor: 054c)')]; press(pads[0], 8); poll();
    expect(recorder.exportClip).toHaveBeenCalledOnce();
  });
  it('informa que os atalhos da página dependem de foco e restaura o tooltip ao descartar', () => {
    const button = document.getElementById('clip-btn');
    expect(button.title).toContain('SeeMyGame em foco');
    session.dispose(); expect(button.hasAttribute('title')).toBe(false);
  });
  it.each(['Xbox', 'DualSense', 'Nintendo Switch'])('Home/Guide não dispara clipe em %s', id => {
    pads = [pad(0, id)]; press(pads[0], 16); poll();
    expect(recorder.exportClip).not.toHaveBeenCalled();
  });
  it('Back sozinho no Xbox não é Share', () => {
    pads = [pad(0)]; press(pads[0], 8); poll();
    expect(recorder.exportClip).not.toHaveBeenCalled();
  });
  it('não presume índices padrão de um controle não padronizado', () => {
    pads = [pad(0, 'DualSense')]; pads[0].mapping = ''; press(pads[0], 8, 5); poll();
    expect(recorder.exportClip).not.toHaveBeenCalled();
  });
  it('detecta borda de cada controle mesmo quando outro mantém o combo pressionado', () => {
    pads = [pad(0), pad(3)]; press(pads[0], 8, 5); poll();
    vi.advanceTimersByTime(1600); poll();
    expect(recorder.exportClip).toHaveBeenCalledTimes(1);
    press(pads[1], 8, 5); poll();
    expect(recorder.exportClip).toHaveBeenCalledTimes(2);
  });
  it('limpa estado de borda de um controle desconectado', () => {
    const gp = pad(2); pads = [gp]; press(gp, 8, 5); poll();
    pads = []; poll(); vi.advanceTimersByTime(1600);
    pads = [gp]; poll(); expect(recorder.exportClip).toHaveBeenCalledTimes(2);
  });
  it('ignora repetição de tecla além da janela de debounce', () => {
    key({ altKey: true }); vi.advanceTimersByTime(1600); key({ altKey: true, repeat: true });
    expect(recorder.exportClip).toHaveBeenCalledOnce();
    key({ altKey: true }); expect(recorder.exportClip).toHaveBeenCalledTimes(2);
  });
  it('preserva composição de texto e eventos já consumidos', () => {
    key({ isComposing: true });
    const event = new KeyboardEvent('keydown', { key: 'c', cancelable: true }); event.preventDefault(); window.dispatchEvent(event);
    expect(recorder.exportClip).not.toHaveBeenCalled();
  });
  it('ignora elementos filhos de contenteditable', () => {
    const field = document.createElement('div'); field.contentEditable = 'true'; field.setAttribute('contenteditable', 'true'); field.innerHTML = '<span>texto</span>'; document.body.appendChild(field);
    field.firstChild.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    expect(recorder.exportClip).not.toHaveBeenCalled();
  });
  it('preserva C da lousa e do editor de clipe abertos', () => {
    const board = document.createElement('div'); board.id = 'whiteboard-modal'; document.body.appendChild(board);
    key({}); board.style.display = 'none'; document.getElementById('clip-post-modal').style.display = 'flex'; key({});
    expect(recorder.exportClip).not.toHaveBeenCalled();
  });
  it('não grava clipes na sala de controles nem dispara Share mantido ao sair', () => {
    const lab = document.createElement('section'); lab.className = 'controller-lab'; document.body.appendChild(lab);
    pads = [pad(0, 'DualSense')]; press(pads[0], 8); poll(); key({}); key({ altKey: true });
    expect(recorder.exportClip).not.toHaveBeenCalled();
    lab.hidden = true; poll(); expect(recorder.exportClip).not.toHaveBeenCalled();
    pads[0].buttons[8] = { pressed: false, value: 0 }; poll(); press(pads[0], 8); poll();
    expect(recorder.exportClip).toHaveBeenCalledOnce();
  });
  it('ignora combinações extras de modificadores', () => {
    key({ altKey: true, shiftKey: true }); key({ ctrlKey: true, shiftKey: true, altKey: true });
    expect(recorder.exportClip).not.toHaveBeenCalled();
  });
  it('descarta listener, frame com id zero e destaque sem permitir exportação após dispose', async () => {
    key({}); session.dispose(); vi.advanceTimersByTime(1600); key({}); poll(); await editor.triggerClip();
    expect(recorder.exportClip).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(0);
    expect(document.getElementById('clip-btn').classList.contains('is-clipping-active')).toBe(false);
  });
});
