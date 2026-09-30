import { isDesktopApp, getCapturableSources, getAudioExclusionCandidates } from '../desktop.js';
import { readCaptureSettings } from './settings.js';

/** Desktop source selection is UI only; the caller owns capture and errors. */
export function bindSourcePicker(session, { start, stop, isStreaming, showToast }) {
  const modal = document.getElementById('desktop-picker-modal');
  const list = document.getElementById('desktop-windows-list');
  let generation = 0;
  const choose = source => {
    if (session.isDisposed) return;
    if (modal) modal.style.display = 'none';
    const exclusion = document.getElementById('picker-audio-exclude-select')?.value || '';
    return start({ ...readCaptureSettings(), sourceId: source.sourceId || source.id, sourceType: source.sourceType, excludeApp: exclusion || null });
  };
  const refresh = async () => {
    const current = ++generation;
    const [sources, exclusions] = await Promise.all([getCapturableSources(), getAudioExclusionCandidates()]);
    if (session.isDisposed || current !== generation) return;
    if (list) {
      list.replaceChildren();
      for (const source of sources) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'window-item';
        button.textContent = source.title || source.name || source.sourceId;
        button.onclick = () => choose(source)?.catch?.(error => showToast(error.message, 'error'));
        list.append(button);
      }
      if (!sources.length) list.textContent = 'Nenhuma janela ou monitor disponível.';
    }
    const select = document.getElementById('picker-audio-exclude-select');
    if (select) {
      const selected = select.value; select.replaceChildren(new Option('Não excluir aplicativo', ''));
      exclusions.forEach(source => select.add(new Option(source.title || source.name || source.processName || source.id, source.id)));
      select.value = selected;
    }
  };
  const toggle = async () => {
    if (isStreaming()) return stop();
    if (!isDesktopApp() || !modal) return start(readCaptureSettings());
    modal.style.display = 'flex';
    await refresh();
  };
  session.addEventListener(document.getElementById('picker-refresh-btn'), 'click', () => refresh().catch(error => showToast(error.message, 'error')));
  session.addEventListener(document.getElementById('picker-cancel-btn'), 'click', () => { if (modal) modal.style.display = 'none'; });
  session.addEventListener(document.getElementById('picker-screen-fallback-btn'), 'click', async () => {
    try { const sources = await getCapturableSources(); const source = sources.find(source => source.sourceType === 'monitor'); if (source) await choose(source); }
    catch (error) { showToast(error.message, 'error'); }
  });
  session.registerCleanup(() => { generation++; if (modal) modal.style.display = 'none'; list?.replaceChildren(); });
  return { toggle, refresh };
}
