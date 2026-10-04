import { describe, it, expect, vi, afterEach } from 'vitest';
import { DiscordUIController } from '../js/discord-ui.js';
import { VoiceManager, voiceManager as legacyVoice } from '../js/voice.js';
import { ChatManager, chatManager as legacyChat } from '../js/chat.js';
import { RoomManager } from '../js/room.js';
import { bindRoomVoiceState } from '../js/session/room-voice-state.js';
import { bindRoomIdentity } from '../js/session/room-identity.js';
import { PUBLIC_WEB_ORIGIN } from '../js/config.js';

const disposers = [];
function sessionScope() {
  const scope = { isDisposed: false, registerCleanup: fn => disposers.push(fn),
    addEventListener: (el, type, fn) => { el.addEventListener(type, fn); disposers.push(() => el.removeEventListener(type, fn)); } };
  return scope;
}
afterEach(() => {
  disposers.splice(0).reverse().forEach(fn => fn());
  delete window.__TAURI_INTERNALS__;
  vi.restoreAllMocks(); document.body.innerHTML = '';
});

describe('Room UI uses session managers', () => {
  it('keeps the header online count and local nickname in sync with actual membership', () => {
    document.body.innerHTML = '<span id="viewer-count"><strong>0</strong></span><span id="sidebar-members-count"></span><span id="local-user-name"></span><span id="local-avatar"></span>';
    const room = new RoomManager({ roomId: 'controls' }); room.myPeerId = 'local-peer';
    const ui = new DiscordUIController({ roomManager: room, voiceManager: new VoiceManager(), chatManager: new ChatManager() });
    ui.init(); disposers.push(() => ui.destroy());
    const members = [{ peerId: 'local-peer', name: 'Ana' }, { peerId: 'remote-peer', name: 'Bruno' }];
    ui.updateRoomPresence(members);
    expect(document.querySelector('#viewer-count strong').textContent).toBe('2');
    expect(document.getElementById('local-user-name').textContent).toBe('Ana');
    ui.updateRoomPresence(members.slice(0, 1)); expect(document.querySelector('#viewer-count strong').textContent).toBe('1');
  });
  it('dock, quick and drawer mute/deafen operate on live session tracks without touching the legacy singleton', () => {
    document.body.innerHTML = ['dock-mic-btn', 'dock-deaf-btn', 'quick-mic-btn', 'quick-deaf-btn', 'voice-mute-btn', 'voice-deaf-btn', 'voice-connect-btn'].map(id => `<button id="${id}"></button>`).join('');
    const voice = new VoiceManager(), chat = new ChatManager();
    voice.isInVoice = true;
    const track = { enabled: true };
    voice.localStream = voice.rawLocalStream = { getAudioTracks: () => [track] };
    const join = vi.fn(), globalMute = vi.spyOn(legacyVoice, 'toggleMute'), globalDeaf = vi.spyOn(legacyVoice, 'toggleDeafen');
    const ui = new DiscordUIController({ voiceManager: voice, chatManager: chat, onJoinVoice: join });
    ui.init(); disposers.push(() => ui.destroy());
    for (const id of ['dock-mic-btn', 'quick-mic-btn', 'voice-mute-btn']) {
      document.getElementById(id).click(); expect(voice.isMuted).toBe(true); expect(track.enabled).toBe(false);
      expect(document.getElementById('dock-mic-btn').classList.contains('is-muted')).toBe(true);
      document.getElementById(id).click(); expect(track.enabled).toBe(true);
    }
    for (const id of ['dock-deaf-btn', 'quick-deaf-btn', 'voice-deaf-btn']) {
      document.getElementById(id).click(); expect(voice.isDeafened).toBe(true); expect(track.enabled).toBe(false);
      document.getElementById(id).click(); voice.setMuted(false);
    }
    expect(join).not.toHaveBeenCalled(); expect(globalMute).not.toHaveBeenCalled(); expect(globalDeaf).not.toHaveBeenCalled();
    expect(legacyVoice.listeners.voiceStateChange.has([...voice.listeners.voiceStateChange][0])).toBe(false);
  });

  it('renders messages emitted by the session chat, not the singleton', () => {
    document.body.innerHTML = '<div id="chat-messages-container"></div>';
    const chat = new ChatManager(), voice = new VoiceManager();
    const ui = new DiscordUIController({ chatManager: chat, voiceManager: voice }); ui.init(); disposers.push(() => ui.destroy());
    chat.addMessage(chat.createMessage({ senderId: 'test-peer', senderName: 'Session', text: 'session-message', channel: 'geral' }));
    expect(document.body.textContent).toContain('session-message');
    legacyChat.addMessage(legacyChat.createMessage({ senderId: 'global-peer', senderName: 'Global', text: 'global-message', channel: 'geral' }));
    expect(document.body.textContent).not.toContain('global-message');
  });
});

describe('Room voice presence synchronization', () => {
  function bind() {
    const scope = sessionScope(), room = new RoomManager({ roomId: 'controls' }), voice = new VoiceManager();
    room.myPeerId = voice.myPeerId = 'local-peer'; voice.isInVoice = true;
    room.members.set('local-peer', { peerId: 'local-peer', isMuted: false, isDeafened: false, isSpeaking: false });
    bindRoomVoiceState(scope, { roomManager: room, voiceManager: voice });
    return { scope, room, voice };
  }
  it('publishes complete mute/deafen and PTT state, including automatic microphone mute on deafen', () => {
    const { room, voice } = bind(); const send = vi.spyOn(room, 'broadcast');
    voice.setDeafened(true);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ isMuted: true, isDeafened: true }));
    voice.setDeafened(false); voice.setVoiceMode('ptt'); voice.setPttActive(true);
    expect(room.members.get('local-peer').isMuted).toBe(false);
    voice.setPttActive(false); expect(room.members.get('local-peer').isMuted).toBe(true);
    send.mockClear(); voice.setOutputVolume(70); expect(send).not.toHaveBeenCalled();
  });
  it('applies authoritative remote state when audio arrives after the membership update', () => {
    const { room, voice } = bind();
    room.members.set('remote-peer', { isMuted: true, isDeafened: true, isSpeaking: false });
    room.emit('membersUpdated', room.getMembersList());
    voice.participants.set('remote-peer', { peerId: 'remote-peer', isMuted: false, isDeafened: false, isSpeaking: false });
    voice.emit('participantUpdate', voice.getParticipantsList());
    expect(voice.participants.get('remote-peer')).toMatchObject({ isMuted: true, isDeafened: true });
    room.members.get('remote-peer').isMuted = false; room.emit('membersUpdated', room.getMembersList());
    expect(voice.participants.get('remote-peer').isMuted).toBe(false);
  });
  it('publishes local speaking changes and releases subscriptions on disposal', () => {
    const { scope, room, voice } = bind();
    voice.localVad.isSpeaking = true; voice.emit('speakingChange', { peerId: 'local-peer', isSpeaking: true });
    expect(room.members.get('local-peer').isSpeaking).toBe(true);
    scope.isDisposed = true; disposers.splice(0).forEach(fn => fn());
    voice.setMuted(true); expect(room.members.get('local-peer').isMuted).toBe(false);
    expect(voice.listeners.voiceStateChange.size).toBe(0); expect(room.listeners.membersUpdated.size).toBe(0);
  });
});

describe('Room connection header and invitation', () => {
  function bind() {
    document.body.innerHTML = '<span id="copy-badge"></span><span id="room-header-badge"></span><button id="share-link-btn"></button>';
    const scope = sessionScope(), toast = vi.fn();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const ui = bindRoomIdentity(scope, { getRoomInfo: () => ({ roomId: 'controls', roomKey: '0123456789abcdef', roomPin: '1234' }), showToast: toast });
    return { scope, toast, write, ui };
  }
  it('updates connecting, ready and error states; copies key/PIN and removes listeners', async () => {
    const { scope, write, ui } = bind();
    expect(document.getElementById('copy-badge').textContent).toContain('Conectando');
    expect(document.getElementById('share-link-btn').disabled).toBe(true);
    ui.update('ready'); document.getElementById('share-link-btn').click(); await Promise.resolve();
    expect(document.getElementById('room-header-badge').textContent).toBe('Sala: #controls');
    expect(write).toHaveBeenCalledWith(expect.stringContaining('#room=controls&key=0123456789abcdef&pin=1234'));
    ui.update('error'); expect(document.getElementById('copy-badge').textContent).toContain('indisponível');
    ui.update('connecting'); expect(document.getElementById('share-link-btn').disabled).toBe(true);
    ui.update('ready'); scope.isDisposed = true; disposers.splice(0).forEach(fn => fn()); write.mockClear();
    document.getElementById('copy-badge').click(); expect(write).not.toHaveBeenCalled();
  });
  it('copies a public invitation in desktop instead of the internal WebView origin', async () => {
    const { ui, write } = bind(); window.__TAURI_INTERNALS__ = {}; ui.update('ready');
    document.getElementById('share-link-btn').click(); await Promise.resolve();
    expect(write.mock.calls[0][0]).toContain(PUBLIC_WEB_ORIGIN);
  });
  it('shows clipboard failures without an unhandled rejection', async () => {
    const { ui, write, toast } = bind(); write.mockRejectedValue(new Error('clipboard denied')); ui.update('ready');
    document.getElementById('copy-badge').click(); await Promise.resolve();
    expect(toast).toHaveBeenCalledWith('Não foi possível copiar o link da sala.', 'error');
  });
});
