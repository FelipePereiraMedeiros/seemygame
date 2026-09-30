import { handleHostCoopMessage, handleViewerCoopMessage } from '../coop.js';

export function bindSessionMessageHandlers(session, {
  role,
  coopController = null,
  chatManager,
  voiceManager,
  getPeer = () => null,
  getLocalPeerId = () => null,
  getDataConnections = () => [],
  broadcast = null,
  showToast = () => {},
  getVideoCard = () => null
} = {}) {
  const dispatcher = session.dispatcher;
  const relay = (data, sourceConn) => {
    if (typeof broadcast === 'function') broadcast(data, sourceConn?.peer);
  };
  const unsubs = [];
  const register = (type, handler, description) => {
    unsubs.push(dispatcher.register(type, handler, { description }));
  };

  register('CHAT_MESSAGE', (data, sourceConn) => {
    if (!data.message || !chatManager) return;
    if (chatManager.addMessage(data.message)) {
      session.eventBus.emit('chat:message-received', data.message);
      relay(data, sourceConn);
    }
  }, 'Session chat receive and relay');

  register('VOICE_STATE_UPDATE', (data, sourceConn) => {
    voiceManager?.updateParticipantState(data.peerId || sourceConn?.peer, {
      isSpeaking: data.isSpeaking,
      isMuted: data.isMuted,
      isDeafened: data.isDeafened
    });
    session.eventBus.emit('voice:state-updated', data);
    relay(data, sourceConn);
  }, 'Session voice state receive and relay');

  const activeVoiceCalls = new Map();
  const connectVoiceTo = (peerId) => {
    const localPeerId = getLocalPeerId();
    if (!peerId || !localPeerId || localPeerId.localeCompare(peerId) >= 0) return null;
    if (!voiceManager?.isInVoice || !voiceManager.localStream || activeVoiceCalls.has(peerId)) return null;
    const peer = getPeer();
    if (!peer || peer.destroyed) return null;
    const call = peer.call(peerId, voiceManager.localStream, {
      metadata: { type: 'VOICE_CHAT', name: voiceManager.myName, role: voiceManager.myRole }
    });
    bindVoiceCall(call);
    return call;
  };
  const removeVoicePeer = (peerId) => {
    const call = activeVoiceCalls.get(peerId);
    try { call?.close?.(); } catch (_) {}
    activeVoiceCalls.delete(peerId);
    voiceManager?.removeRemoteParticipant(peerId);
  };
  const bindVoiceCall = (call) => {
    if (!call || !voiceManager) return;
    const peerId = call.peer;
    activeVoiceCalls.set(peerId, call);
    call.on('stream', (stream) => {
      voiceManager.addRemoteParticipant(peerId, {
        name: call.metadata?.name || 'Jogador',
        role: call.metadata?.role || 'member',
        stream
      });
    });
    const cleanup = () => {
      voiceManager.removeRemoteParticipant(peerId);
      if (activeVoiceCalls.get(peerId) === call) activeVoiceCalls.delete(peerId);
    };
    call.on('close', cleanup);
    call.on('error', cleanup);
  };
  session.registerCleanup(() => {
    for (const peerId of activeVoiceCalls.keys()) removeVoicePeer(peerId);
    activeVoiceCalls.clear();
  });

  register('VOICE_SIGNAL', (data, sourceConn) => {
    const peerId = data.peerId || sourceConn?.peer;
    if (!peerId || (sourceConn?.peer && peerId !== sourceConn.peer)) return;
    if (data.action === 'LEAVE') {
      removeVoicePeer(peerId);
    } else if (data.action === 'HOST_VOICE_ACTIVE' || data.action === 'VOICE_JOINED') {
      if (peerId !== getLocalPeerId()) connectVoiceTo(peerId);
      showToast(data.action === 'HOST_VOICE_ACTIVE'
        ? 'O Streamer está na sala de voz!'
        : `${data.name || 'Um amigo'} entrou na sala de voz!`, 'info');
    }
    session.eventBus.emit('voice:signal', data);
    relay(data, sourceConn);
  }, 'Session voice signaling');

  const coopTypes = [
    'COOP_REQUEST', 'COOP_RESPONSE', 'COOP_CAPABILITIES', 'COOP_CONFIG',
    'COOP_SLOTS_UPDATE', 'COOP_RELEASE', 'COOP_REVOKE', 'COOP_INPUT',
    'COOP_PEER_DISCONNECTED', 'COOP_TARGET'
  ];
  for (const type of coopTypes) {
    register(type, (data, sourceConn) => {
      if (role === 'streamer' || role === 'room') {
        if (sourceConn?.peer) (coopController?.handleHostCoopMessage || handleHostCoopMessage)(sourceConn.peer, data, sourceConn);
      } else if (sourceConn?.peer) {
        (coopController?.handleViewerCoopMessage || handleViewerCoopMessage)(data, sourceConn.peer, getVideoCard(sourceConn.peer));
      }
      relay(data, sourceConn);
    }, `Session Co-op: ${type}`);
  }

  session.registerCleanup(() => unsubs.splice(0).forEach((unsubscribe) => unsubscribe()));

  return {
    bindVoiceCall,
    connectVoiceTo,
    answerVoiceCall(call) {
      if (!call || !voiceManager) return false;
      const stream = voiceManager.isInVoice ? voiceManager.localStream : null;
      call.answer(stream || undefined);
      bindVoiceCall(call);
      return true;
    },
    activeVoiceCalls,
    getDataConnections
  };
}
