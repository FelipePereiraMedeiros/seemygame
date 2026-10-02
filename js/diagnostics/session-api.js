let application = null;
/** Read-only access to the mounted production session for E2E diagnostics. */
export function exposePageSession(value) {
  application = value;
  return () => { if (application === value) application = null; };
}
export function getActiveSession() {
  if (!application) return null;
  return {
    get roomManager() { return application.state?.roomManager; },
    get localStream() { return application.state?.localStream; },
    get isStartingStream() { return application.state?.isStartingStream || false; },
    get session() { return application.session; },
    startLocalStream: options => application.startCapture?.(options),
    stopLocalStream: () => application.stopCapture?.()
  };
}
