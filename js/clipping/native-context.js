export function nativeReplayContext(sourceId, provider) {
  if (sourceId !== 'local-me' || provider?.session?.provider !== 'native' || provider.uiAudioMode === 'mic') return null;
  return provider.session.sessionId ? { sessionId: provider.session.sessionId } : null;
}
