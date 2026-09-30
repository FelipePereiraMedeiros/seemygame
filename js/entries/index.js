/**
 * SeeMyGame - Barrel Export for Page Entrypoints
 */

// Viewer entrypoint
export {
  initViewerApp,
  isViewerPage,
  viewerState,
  watchingHosts,
  getTargetStreamerId,
  connectToStreamer,
  initViewerPeer
} from './viewer-entry.js';

// Streamer entrypoint
export {
  initStreamerApp,
  isStreamerPage,
  streamerState,
  startCapture,
  stopCapture,
  setQualityProfile,
  initStreamerPeer
} from './streamer-entry.js';

// Room entrypoint
export {
  initRoomApp,
  isRoomPage,
  roomState,
  getRoomInfoFromUrl,
  initGreenRoomLobby,
  setupRoomSession,
  initRoomPeer
} from './room-entry.js';

// Lobby entrypoint
export {
  initLobbyApp,
  isLobbyPage,
  initGreenRoomPreflight,
  initDesktopAlwaysOnTop
} from './lobby-entry.js';
