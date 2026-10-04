/** Synchronize voice controls and presence using the managers owned by this Room. */
export function bindRoomVoiceState(session, { roomManager, voiceManager }) {
  const fields = ['isMuted', 'isDeafened', 'isSpeaking'];
  const publish = () => {
    if (session.isDisposed) return;
    const member = roomManager.members.get(roomManager.myPeerId);
    if (!member) return;
    const state = voiceManager.getLocalVoiceState();
    const next = { isMuted: state.isMuted, isDeafened: state.isDeafened,
      isSpeaking: Boolean(voiceManager.localVad.isSpeaking && !state.isMuted && state.isInVoice) };
    if (fields.some(key => member[key] !== next[key])) roomManager.setLocalVoiceState(next);
  };
  const receive = () => {
    if (session.isDisposed) return;
    for (const [peerId, participant] of voiceManager.participants) {
      if (participant.isLocal) continue;
      const member = roomManager.members.get(peerId);
      if (member && fields.some(key => typeof member[key] === 'boolean' && participant[key] !== member[key])) {
        voiceManager.updateParticipantState(peerId, member);
      }
    }
  };
  const onMembers = () => { receive(); publish(); };
  const onSpeaking = ({ peerId }) => { if (peerId === voiceManager.myPeerId) publish(); };
  const bindings = [
    [roomManager, 'membersUpdated', onMembers],
    [voiceManager, 'participantUpdate', receive],
    [voiceManager, 'voiceStateChange', publish],
    [voiceManager, 'speakingChange', onSpeaking],
  ];
  for (const [manager, event, handler] of bindings) manager.on(event, handler);
  session.registerCleanup(() => { for (const [manager, event, handler] of bindings) manager.off(event, handler); });
  onMembers();
}
