import { createRoomSession } from '../session/room-session.js';
export { createRoomSession };
const defaultRuntime = createRoomSession();
export const isRoomPage = defaultRuntime.isRoomPage;
export const roomState = defaultRuntime.roomState;
export function getRoomInfoFromUrl(...args) { return defaultRuntime.getRoomInfoFromUrl(...args); }
export function initGreenRoomLobby(...args) { return defaultRuntime.initGreenRoomLobby(...args); }
export function setupRoomSession(...args) { return defaultRuntime.setupRoomSession(...args); }
export function initRoomPeer(...args) { return defaultRuntime.initRoomPeer(...args); }
export function setupTuningModal(...args) { return defaultRuntime.setupTuningModal(...args); }
export function initRoomApp(...args) { return defaultRuntime.initRoomApp(...args); }

