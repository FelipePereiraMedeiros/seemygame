const mounts = new WeakMap();

/** One consent binding per dialog. Remount replaces its callback and listeners. */
export function initTermsModal({ TERMS_VERSION, showToast }, onAcceptCallback) {
  const modal = document.getElementById('terms-modal');
  const age = document.getElementById('check-age');
  const terms = document.getElementById('check-terms');
  const accept = document.getElementById('accept-btn');
  if (!modal || !age || !terms || !accept) return () => {};
  mounts.get(modal)?.();
  const cleanups = [];
  const listen = (target, event, callback) => {
    if (!target) return;
    target.addEventListener(event, callback);
    cleanups.push(() => target.removeEventListener(event, callback));
  };
  const unmount = () => {
    cleanups.splice(0).forEach(cleanup => cleanup());
    if (mounts.get(modal) === unmount) { mounts.delete(modal); delete modal.dataset.termsInitialized; }
  };
  mounts.set(modal, unmount);
  modal.dataset.termsInitialized = 'true';
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  const synchronize = () => {
    const disabled = !age.checked || !terms.checked;
    accept.disabled = disabled; accept.setAttribute('aria-disabled', String(disabled));
    accept.classList.toggle('disabled', disabled);
  };
  const proceed = () => {
    try {
      Promise.resolve(onAcceptCallback?.()).catch(error => {
        console.error('[Terms] Initialization failed', error);
        showToast?.('Falha ao iniciar sessão.', 'error');
      });
    } catch (error) { console.error('[Terms] Initialization failed', error); }
  };
  for (const event of ['change', 'input', 'click']) {
    listen(age, event, synchronize); listen(terms, event, synchronize);
  }
  listen(accept, 'click', () => {
    if (!age.checked || !terms.checked) { synchronize(); return; }
    try { localStorage.setItem('seemygame_terms_version', TERMS_VERSION); localStorage.setItem('seemygame_terms_accepted', 'true'); } catch (_) {}
    modal.style.display = 'none'; showToast?.('Termos aceitos com sucesso!', 'success'); proceed();
  });
  listen(document.getElementById('open-terms-link'), 'click', () => {
    age.checked = terms.checked = true; synchronize(); modal.style.display = 'flex';
  });
  synchronize();
  let accepted = false;
  try {
    const version = localStorage.getItem('seemygame_terms_version');
    accepted = version === TERMS_VERSION || (!version && localStorage.getItem('seemygame_terms_accepted') === 'true');
  } catch (_) {}
  modal.style.display = accepted ? 'none' : 'flex';
  if (accepted) proceed();
  return unmount;
}
