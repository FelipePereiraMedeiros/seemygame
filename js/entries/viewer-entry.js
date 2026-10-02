import { createViewerSession } from '../session/viewer-session.js';
export { createViewerSession };
const defaultRuntime = createViewerSession();
export const isViewerPage = defaultRuntime.isViewerPage;
export const isHost = defaultRuntime.isHost;
export const viewerState = defaultRuntime.viewerState;
export const watchingHosts = defaultRuntime.watchingHosts;
export function promptViewerPin(...args) { return defaultRuntime.promptViewerPin(...args); }
export function hideViewerPinModal(...args) { return defaultRuntime.hideViewerPinModal(...args); }
export function submitViewerPin(...args) { return defaultRuntime.submitViewerPin(...args); }
export function getTargetStreamerId(...args) { return defaultRuntime.getTargetStreamerId(...args); }
export function connectToStreamer(...args) { return defaultRuntime.connectToStreamer(...args); }
export function initViewerPeer(...args) { return defaultRuntime.initViewerPeer(...args); }
export function initViewerApp(...args) { return defaultRuntime.initViewerApp(...args); }

