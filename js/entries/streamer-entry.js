import { createStreamerSession } from '../session/streamer-session.js';
export { createStreamerSession };
const defaultRuntime = createStreamerSession();
export const isStreamerPage = defaultRuntime.isStreamerPage;
export const isHost = defaultRuntime.isHost;
export const streamerState = defaultRuntime.streamerState;
export const connectedViewers = defaultRuntime.connectedViewers;
export function setStreamerPin(...args) { return defaultRuntime.setStreamerPin(...args); }
export function getStreamerPin(...args) { return defaultRuntime.getStreamerPin(...args); }
export function initStreamerPeer(...args) { return defaultRuntime.initStreamerPeer(...args); }
export function callViewerWithStream(...args) { return defaultRuntime.callViewerWithStream(...args); }
export function startCapture(...args) { return defaultRuntime.startCapture(...args); }
export function stopCapture(...args) { return defaultRuntime.stopCapture(...args); }
export function setQualityProfile(...args) { return defaultRuntime.setQualityProfile(...args); }
export function initStreamerApp(...args) { return defaultRuntime.initStreamerApp(...args); }

