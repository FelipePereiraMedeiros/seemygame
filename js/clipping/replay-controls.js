export function bindReplayControls(session, registry) {
  if (typeof document === 'undefined' || !registry.setPreferences) return;
  const anchor = document.getElementById('clip-buffer-duration-select')?.parentElement || document.getElementById('clip-btn')?.parentElement;
  if (!anchor) return;
  const panel = document.createElement('details');
  panel.className = 'replay-settings';
  panel.innerHTML = `<summary>Replay e desempenho</summary>
    <label><input id="replay-enabled" type="checkbox"> Ativar replay</label>
    <label><input id="replay-local-enabled" type="checkbox"> Permitir replay da minha transmissão</label>
    <label>Transmissão gravada <select id="replay-source"></select></label>
    <label>Qualidade do replay <select id="replay-profile"><option value="light">Leve · até 480p / 15 FPS</option><option value="balanced">Equilibrado · até 720p / 30 FPS</option><option value="source">Resolução e FPS da fonte</option></select></label>
    <label>Codec web <select id="replay-codec"><option value="auto">Automático (prioriza VP9)</option><option value="vp8">VP8</option><option value="h264">H.264, se suportado</option><option value="vp9">VP9</option></select></label>
    <p class="replay-status" role="status"></p>
    <small>Apenas uma transmissão é gravada. Alterar a gravação reinicia o histórico. No aplicativo, H.264 nativo é salvo sem recodificar, por até 120s / 128 MB.</small>`;
  anchor.appendChild(panel);
  const get = id => panel.querySelector(`#replay-${id}`);
  const update = () => {
    get('enabled').checked = registry.preferences.enabled;
    get('local-enabled').checked = registry.preferences.recordLocal;
    get('profile').value = registry.preferences.profile;
    get('codec').value = registry.preferences.codec;
    const h264 = get('codec').querySelector('option[value="h264"]');
    const supportsH264 = typeof MediaRecorder !== 'undefined' &&
      ['video/webm;codecs=h264,opus', 'video/webm;codecs=h264'].some(type => MediaRecorder.isTypeSupported(type));
    h264.disabled = registry.getMaxDurationSeconds() !== 0 && !supportsH264;
    const select = get('source');
    const signature = JSON.stringify([registry.preferences.recordLocal, ...registry.sources.keys()]);
    if (select.dataset.sources !== signature) {
      select.dataset.sources = signature; select.replaceChildren();
      for (const id of registry.sources.keys()) {
        const option = document.createElement('option'); option.value = id;
        option.textContent = id === 'local-me' ? 'Minha transmissão' : `Transmissão ${id.slice(-8)}`;
        option.disabled = id === 'local-me' && !registry.preferences.recordLocal;
        select.appendChild(option);
      }
    }
    select.value = registry.selectedSourceId || '';
    const recorder = registry.getRecorder();
    const native = Boolean(recorder?.sessionId);
    get('profile').disabled = native; get('codec').disabled = native;
    panel.querySelector('.replay-status').textContent = (recorder?.lastError || registry.lastError) ? `Replay indisponível: ${recorder?.lastError || registry.lastError}`
      : !registry.preferences.enabled ? 'Replay desativado.' : !recorder ? 'Escolha uma transmissão. Gravação local desativada por padrão.'
        : native ? 'Replay nativo: reutiliza vídeo e áudio codificados.' : 'Replay web: gravação independente da transmissão.';
  };
  for (const [id, preference] of [['enabled', 'enabled'], ['local-enabled', 'recordLocal'], ['profile', 'profile'], ['codec', 'codec']]) {
    session.addEventListener(get(id), 'change', event => registry.setPreferences({ [preference]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  }
  session.addEventListener(get('source'), 'change', event => registry.selectSource(event.target.value));
  registry.onChange = update;
  const timer = setInterval(update, 2000);
  session.registerCleanup(() => { clearInterval(timer); registry.onChange = null; panel.remove(); });
  update();
}
