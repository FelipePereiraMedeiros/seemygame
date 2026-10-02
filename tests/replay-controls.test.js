import { it, expect, vi } from 'vitest';
import { bindReplayControls } from '../js/clipping/replay-controls.js';
import { ClipRecorderRegistry } from '../js/clipping/registry.js';

it('actual replay control events switch the single recorder, persist opt-in and stop it when disabled', () => {
  document.body.innerHTML = '<div><select id="clip-buffer-duration-select"></select></div>';
  localStorage.clear();
  vi.stubGlobal('MediaRecorder', class {
    static isTypeSupported = type => !type.includes('h264');
    constructor() { this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
  });
  const registry = new ClipRecorderRegistry();
  const cleanups = [];
  const session = { addEventListener: (node, type, handler) => node.addEventListener(type, handler), registerCleanup: handler => cleanups.push(handler) };
  const change = (id, value) => {
    const input = document.getElementById(id);
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  try {
    bindReplayControls(session, registry);
    const stream = id => ({ id, getTracks: () => [] });
    registry.start(stream('alice'), 'alice'); registry.start(stream('me'), 'local-me');
    const first = registry.getRecorder('alice');
    change('replay-local-enabled', true); change('replay-source', 'local-me');
    expect(first.isRecording).toBe(false); expect(registry.isRecordingFor('local-me')).toBe(true);
    expect(registry.recorders.size).toBe(1);
    expect(JSON.parse(localStorage.getItem('seemygame_replay_preferences')).recordLocal).toBe(true);
    change('replay-enabled', false);
    expect(registry.recorders.size).toBe(0); expect(registry.isRecording).toBe(false);
    expect(document.querySelector('.replay-status').textContent).toContain('desativado');
  } finally { cleanups.forEach(cleanup => cleanup()); registry.dispose?.(); registry.stop(); document.body.innerHTML = ''; localStorage.clear(); vi.unstubAllGlobals(); }
});
