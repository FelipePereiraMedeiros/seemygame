import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionContext } from '../js/core/session-context.js';
import { AudioScope } from '../js/audio/context-scope.js';
import { sendSessionMessage, validateReceivedMessage } from '../js/protocol/transport.js';
import { MessageDispatcher } from '../js/core/message-dispatcher.js';
import { createStatsMonitorScope } from '../js/stats.js';
import { VoiceManager } from '../js/voice.js';
import { createViewerSession } from '../js/session/viewer-session.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });
describe('Modular architecture regressions', () => {
  it('keeps independently created viewers isolated and ignores an old disposer after reinitialization', async () => {
    const factoryA = createViewerSession(), factoryB = createViewerSession();
    const first = await factoryA.initViewerApp({ targetStreamerId: null });
    const other = await factoryB.initViewerApp({ targetStreamerId: null });
    const chat = first.session.services.chatManager;
    chat.addMessage(chat.createMessage({ senderId: 'a', senderName: 'A', text: 'isolated', role: 'viewer' }));
    expect(other.session.services.chatManager.getMessages()).toHaveLength(0);
    expect(first.session.services.coopController).not.toBe(other.session.services.coopController);
    expect(first.session.audioScope).not.toBe(other.session.audioScope);
    first.dispose();
    const replacement = await factoryA.initViewerApp({ targetStreamerId: null });
    first.dispose();
    expect(replacement.session.isDisposed).toBe(false);
    replacement.dispose(); other.dispose();
    await Promise.all([first.session.disposeAsync(), replacement.session.disposeAsync(), other.session.disposeAsync()]);
  });
  it('awaits asynchronous release, reports failures and immediately releases late registrations', async () => {
    const borrowed = { dispose: vi.fn() }, session = createSessionContext({ audioScope: borrowed });
    const errors = []; session.eventBus.on('system:error', value => errors.push(value));
    let finish; const pending = new Promise(resolve => { finish = resolve; });
    session.registerCleanup(() => pending);
    session.registerCleanup(() => Promise.reject(new Error('release failure')));
    let completed = false;
    const disposal = session.disposeAsync().then(() => { completed = true; });
    await Promise.resolve(); expect(completed).toBe(false);
    const late = vi.fn(); session.registerCleanup(late); expect(late).toHaveBeenCalledOnce();
    finish(); await disposal;
    expect(errors[0].error.message).toBe('release failure');
    expect(borrowed.dispose).not.toHaveBeenCalled();
  });
  it('closes only contexts owned by the released audio scope and separates recorder/playback', async () => {
    class Context { state = 'running'; close = vi.fn(async () => { this.state = 'closed'; }); }
    const first = new AudioScope({ AudioContextClass: Context }), second = new AudioScope({ AudioContextClass: Context });
    const playback = first.getContext(), recorder = first.getContext('recorder-mixer'), foreign = second.getContext();
    expect(playback).not.toBe(recorder); expect(first.getContext()).toBe(playback);
    await first.dispose(); expect(playback.close).toHaveBeenCalledOnce(); expect(recorder.close).toHaveBeenCalledOnce();
    expect(foreign.close).not.toHaveBeenCalled(); expect(() => first.getContext()).toThrow(/disposed/);
    await second.dispose();
  });
  it('awaits a late async unlisten registered by a subscription that was still being installed', async () => {
    const session = createSessionContext(); let install, unlisten;
    const installation = new Promise(resolve => { install = resolve; });
    const releasing = new Promise(resolve => { unlisten = resolve; });
    session.registerCleanup(() => installation.then(() => session.registerCleanup(() => releasing)));
    let completed = false; const disposal = session.disposeAsync().then(() => { completed = true; });
    install(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(completed).toBe(false); unlisten(); await disposal; expect(completed).toBe(true);
  });
  it('preserves broadcast/relay message identity and replaces the identity of each transport hop', () => {
    const packets = [], conn = { open: true, send: packet => packets.push(packet) };
    const event = { type: 'WHITEBOARD_ELEMENT_ADD', id: 'element-a', senderPeerId: 'spoof' };
    sendSessionMessage({ getPeerId: () => 'host' }, conn, event);
    sendSessionMessage({ getPeerId: () => 'host' }, conn, event);
    sendSessionMessage({ getPeerId: () => 'relay' }, conn, packets[0]);
    expect(new Set(packets.map(packet => packet.msgId)).size).toBe(1);
    expect(packets[2].senderPeerId).toBe('relay');
    expect(validateReceivedMessage(packets[2], { peer: 'host' })).toBe(false);
    expect(validateReceivedMessage(packets[2], { peer: 'relay' })).toBe(true);
  });
  it('does not deduplicate successive edits by entity id and contains asynchronous handler failures', async () => {
    const dispatcher = new MessageDispatcher(), handled = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dispatcher.register('EDIT', () => Promise.reject(new Error('handler'))); dispatcher.register('EDIT', handled);
    dispatcher.dispatch({ type: 'EDIT', id: 'same-entity', value: 1 });
    dispatcher.dispatch({ type: 'EDIT', id: 'same-entity', value: 2 });
    await Promise.resolve(); expect(handled).toHaveBeenCalledTimes(2); expect(dispatcher.getMetrics().errors).toBe(2);
  });
  it('does not revive stats after a pending sample finishes on a disposed scope', async () => {
    vi.useFakeTimers(); const scope = createStatsMonitorScope(); let finish;
    const pc = { connectionState: 'connected', getStats: vi.fn(() => new Promise(resolve => { finish = resolve; })) };
    const telemetry = vi.fn(); scope.startStatsMonitor('peer', pc, false, telemetry);
    await vi.advanceTimersByTimeAsync(1000); scope.dispose(); finish(new Map()); await Promise.resolve();
    expect(telemetry).not.toHaveBeenCalled(); expect(scope.getLastMetrics('peer')).toBeNull();
  });
  it('stops microphone tracks when permission resolves after leaving voice', async () => {
    let finish; vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const voice = new VoiceManager(); const pending = voice.joinVoice({ peerId: 'a' }); voice.leaveVoice();
    const track = { stop: vi.fn(), kind: 'audio' }, stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    finish(stream); expect(await pending).toBeNull(); expect(track.stop).toHaveBeenCalledOnce(); expect(voice.isInVoice).toBe(false);
  });
});
