// ==========================================
// MÓDULO DE CONTROLE REMOTO CO-OP (PLAYER 2)
// ==========================================

import { showToast } from ".././ui.js";
import {
  isNativeGamepadAvailable,
  plugVirtualGamepad,
  updateVirtualGamepad,
  unplugVirtualGamepad,
  unplugAllVirtualGamepads,
  checkVirtualGamepadDriver,
  installViGEmDriver,
  testGamepadVibration,
  getXInputGamepads
} from ".././desktop.js";
import { isTauriEnvironment as isTauriEnvironmentImpl, triggerGamepadRumble as triggerGamepadRumbleImpl, setCoopInputTarget as setCoopInputTargetImpl, initCompanionAgentConnection as initCompanionAgentConnectionImpl, isCompanionAgentRunning as isCompanionAgentRunningImpl, sendCompanionReset as sendCompanionResetImpl, closeCompanionAgentConnection as closeCompanionAgentConnectionImpl, dispatchHostKeyboardInput as dispatchHostKeyboardInputImpl, dispatchHostMouseInput as dispatchHostMouseInputImpl, dispatchHostGamepadInput as dispatchHostGamepadInputImpl, dispatchHostInputReset as dispatchHostInputResetImpl } from './transport.js';
import { reconcileCoopSlots as reconcileCoopSlotsImpl, setMaxCoopPlayers as setMaxCoopPlayersImpl, getMaxCoopPlayers as getMaxCoopPlayersImpl, setPartyModeEnabled as setPartyModeEnabledImpl, isPartyModeEnabled as isPartyModeEnabledImpl, registerCoopBroadcastHandler as registerCoopBroadcastHandlerImpl, broadcastSlotsUpdate as broadcastSlotsUpdateImpl, getCoopSlots as getCoopSlotsImpl, getNextAvailableSlot as getNextAvailableSlotImpl, registerCoopPromptHandler as registerCoopPromptHandlerImpl, registerCoopStateChangeHandler as registerCoopStateChangeHandlerImpl, notifyStateChange as notifyStateChangeImpl, setCoopEnabled as setCoopEnabledImpl, getCoopState as getCoopStateImpl } from './slots.js';
import { handleHostCoopMessage as handleHostCoopMessageImpl, revokeCoopPlayer as revokeCoopPlayerImpl, revokeAllCoopPlayers as revokeAllCoopPlayersImpl, revokePlayer2 as revokePlayer2Impl } from './host.js';
import { requestCoopControl as requestCoopControlImpl, handleViewerCoopMessage as handleViewerCoopMessageImpl, releaseCoopControl as releaseCoopControlImpl } from './viewer.js';
import { handleKeyDown as handleKeyDownImpl, handleKeyUp as handleKeyUpImpl, focusControlWrapper as focusControlWrapperImpl, handleControlVisibilityChange as handleControlVisibilityChangeImpl, handleMouseMove as handleMouseMoveImpl, handleMouseDown as handleMouseDownImpl, handleMouseUp as handleMouseUpImpl, loadGamepadMappingFromStorage as loadGamepadMappingFromStorageImpl, saveGamepadMappingToStorage as saveGamepadMappingToStorageImpl, getGamepadMapping as getGamepadMappingImpl, setGamepadMappingPreset as setGamepadMappingPresetImpl, swapGamepadButtons as swapGamepadButtonsImpl, resetGamepadMapping as resetGamepadMappingImpl, applyButtonMapping as applyButtonMappingImpl, pollGamepads as pollGamepadsImpl, attachPlayer2InputListeners as attachPlayer2InputListenersImpl, detachPlayer2InputListeners as detachPlayer2InputListenersImpl } from './input.js';
import { normalizeTargetRect as normalizeTargetRectImpl, applyRadialDeadzone as applyRadialDeadzoneImpl } from './mapping.js';
import { setupGamepadTesterModal as setupGamepadTesterModalImpl } from './tester-controller.js';
const compatibilityPorts = Object.defineProperties({}, {
"showToast": { get: () => showToast },
"isNativeGamepadAvailable": { get: () => isNativeGamepadAvailable },
"plugVirtualGamepad": { get: () => plugVirtualGamepad },
"updateVirtualGamepad": { get: () => updateVirtualGamepad },
"unplugVirtualGamepad": { get: () => unplugVirtualGamepad },
"unplugAllVirtualGamepads": { get: () => unplugAllVirtualGamepads },
"checkVirtualGamepadDriver": { get: () => checkVirtualGamepadDriver },
"installViGEmDriver": { get: () => installViGEmDriver },
"testGamepadVibration": { get: () => testGamepadVibration },
"getXInputGamepads": { get: () => getXInputGamepads },
"isCoopEnabled": { get: () => isCoopEnabled, set: value => { isCoopEnabled = value; } },
"maxCoopPlayers": { get: () => maxCoopPlayers, set: value => { maxCoopPlayers = value; } },
"partyModeEnabled": { get: () => partyModeEnabled, set: value => { partyModeEnabled = value; } },
"coopSlots": { get: () => coopSlots },
"activePlayer2PeerId": { get: () => activePlayer2PeerId, set: value => { activePlayer2PeerId = value; } },
"isPlayer2": { get: () => isPlayer2, set: value => { isPlayer2 = value; } },
"myAssignedSlot": { get: () => myAssignedSlot, set: value => { myAssignedSlot = value; } },
"activeHostPeerId": { get: () => activeHostPeerId, set: value => { activeHostPeerId = value; } },
"activeDataConn": { get: () => activeDataConn, set: value => { activeDataConn = value; } },
"companionSocket": { get: () => companionSocket, set: value => { companionSocket = value; } },
"isCompanionConnected": { get: () => isCompanionConnected, set: value => { isCompanionConnected = value; } },
"companionCapabilities": { get: () => companionCapabilities, set: value => { companionCapabilities = value; } },
"onPromptCallback": { get: () => onPromptCallback, set: value => { onPromptCallback = value; } },
"onStateChangeCallback": { get: () => onStateChangeCallback, set: value => { onStateChangeCallback = value; } },
"broadcastSlotsCallback": { get: () => broadcastSlotsCallback, set: value => { broadcastSlotsCallback = value; } },
"gamepadLoopId": { get: () => gamepadLoopId, set: value => { gamepadLoopId = value; } },
"lastGamepadState": { get: () => lastGamepadState, set: value => { lastGamepadState = value; } },
"pressedBrowserKeys": { get: () => pressedBrowserKeys },
"slotPressedKeys": { get: () => slotPressedKeys },
"capabilityWarningShown": { get: () => capabilityWarningShown, set: value => { capabilityWarningShown = value; } },
"activeHostCapabilities": { get: () => activeHostCapabilities, set: value => { activeHostCapabilities = value; } },
"controlVisibilityTarget": { get: () => controlVisibilityTarget, set: value => { controlVisibilityTarget = value; } },
"coopInputTargetRect": { get: () => coopInputTargetRect, set: value => { coopInputTargetRect = value; } },
"nextCoopSlotGeneration": { get: () => nextCoopSlotGeneration, set: value => { nextCoopSlotGeneration = value; } },
"normalizeTargetRect": { get: () => normalizeTargetRect },
"isTauriEnvironment": { get: () => isTauriEnvironment },
"applyRadialDeadzone": { get: () => applyRadialDeadzone },
"triggerGamepadRumble": { get: () => triggerGamepadRumble },
"setCoopInputTarget": { get: () => setCoopInputTarget },
"initCompanionAgentConnection": { get: () => initCompanionAgentConnection },
"isCompanionAgentRunning": { get: () => isCompanionAgentRunning },
"reconcileCoopSlots": { get: () => reconcileCoopSlots },
"setMaxCoopPlayers": { get: () => setMaxCoopPlayers },
"getMaxCoopPlayers": { get: () => getMaxCoopPlayers },
"setPartyModeEnabled": { get: () => setPartyModeEnabled },
"isPartyModeEnabled": { get: () => isPartyModeEnabled },
"registerCoopBroadcastHandler": { get: () => registerCoopBroadcastHandler },
"broadcastSlotsUpdate": { get: () => broadcastSlotsUpdate },
"getCoopSlots": { get: () => getCoopSlots },
"getNextAvailableSlot": { get: () => getNextAvailableSlot },
"registerCoopPromptHandler": { get: () => registerCoopPromptHandler },
"registerCoopStateChangeHandler": { get: () => registerCoopStateChangeHandler },
"notifyStateChange": { get: () => notifyStateChange },
"setCoopEnabled": { get: () => setCoopEnabled },
"getCoopState": { get: () => getCoopState },
"handleHostCoopMessage": { get: () => handleHostCoopMessage },
"revokeCoopPlayer": { get: () => revokeCoopPlayer },
"revokeAllCoopPlayers": { get: () => revokeAllCoopPlayers },
"revokePlayer2": { get: () => revokePlayer2 },
"sendCompanionReset": { get: () => sendCompanionReset },
"closeCompanionAgentConnection": { get: () => closeCompanionAgentConnection },
"dispatchHostKeyboardInput": { get: () => dispatchHostKeyboardInput },
"dispatchHostMouseInput": { get: () => dispatchHostMouseInput },
"dispatchHostGamepadInput": { get: () => dispatchHostGamepadInput },
"dispatchHostInputReset": { get: () => dispatchHostInputReset },
"requestCoopControl": { get: () => requestCoopControl },
"handleViewerCoopMessage": { get: () => handleViewerCoopMessage },
"releaseCoopControl": { get: () => releaseCoopControl },
"attachedCard": { get: () => attachedCard, set: value => { attachedCard = value; } },
"handleKeyDown": { get: () => handleKeyDown },
"handleKeyUp": { get: () => handleKeyUp },
"focusControlWrapper": { get: () => focusControlWrapper },
"handleControlVisibilityChange": { get: () => handleControlVisibilityChange },
"handleMouseMove": { get: () => handleMouseMove },
"handleMouseDown": { get: () => handleMouseDown },
"handleMouseUp": { get: () => handleMouseUp },
"DEFAULT_BUTTON_MAP": { get: () => DEFAULT_BUTTON_MAP },
"NINTENDO_BUTTON_MAP": { get: () => NINTENDO_BUTTON_MAP },
"currentGamepadMapping": { get: () => currentGamepadMapping, set: value => { currentGamepadMapping = value; } },
"currentMappingPreset": { get: () => currentMappingPreset, set: value => { currentMappingPreset = value; } },
"loadGamepadMappingFromStorage": { get: () => loadGamepadMappingFromStorage },
"saveGamepadMappingToStorage": { get: () => saveGamepadMappingToStorage },
"getGamepadMapping": { get: () => getGamepadMapping },
"setGamepadMappingPreset": { get: () => setGamepadMappingPreset },
"swapGamepadButtons": { get: () => swapGamepadButtons },
"resetGamepadMapping": { get: () => resetGamepadMapping },
"applyButtonMapping": { get: () => applyButtonMapping },
"pollGamepads": { get: () => pollGamepads },
"attachPlayer2InputListeners": { get: () => attachPlayer2InputListeners },
"detachPlayer2InputListeners": { get: () => detachPlayer2InputListeners },
"setupGamepadTesterModal": { get: () => setupGamepadTesterModal }
});


// Estado do Co-op (Multi-Slot 1 a 4 Players)
let isCoopEnabled = true;
let maxCoopPlayers = 1; // Padrão 1 para 1-on-1 streamer; configurado para 4 em modo sala
let partyModeEnabled = false; // Se true, o slot 0 (Player 1) também é liberado para amigos remotos
export const coopSlots = new Map(); // slot (0..3) -> { slot, peerId, conn, name, deviceType, connectedAt }

// Lado do espectador
let activePlayer2PeerId = null; // backward-compat: peerId do Player 2 ativo
let isPlayer2 = false; // backward-compat: true se tiver qualquer slot atribuído
let myAssignedSlot = null; // 0, 1, 2 ou 3
let activeHostPeerId = null;
let activeDataConn = null;

// Conexão opcional com agente nativo Windows (tools/coop-agent.py)
let companionSocket = null;
let isCompanionConnected = false;
let companionCapabilities = {
  keyboard: false,
  mouse: false,
  gamepad: false,
  mouseCoordinateSpace: 'primary-screen'
};

// Callbacks de interface registrados
let onPromptCallback = null;
let onStateChangeCallback = null;
let broadcastSlotsCallback = null;

// Loop de captura de Gamepad no Player 2
let gamepadLoopId = null;
let lastGamepadState = null;
export const pressedBrowserKeys = new Set();
export const slotPressedKeys = new Map(); // slot (0..3) -> Set of codes
let capabilityWarningShown = false;
let activeHostCapabilities = { keyboard: true, mouse: false, gamepad: false };
let controlVisibilityTarget = null;
let coopInputTargetRect = null;
let nextCoopSlotGeneration = 0;

function normalizeTargetRect(...args) { return normalizeTargetRectImpl(compatibilityPorts, ...args); }

export function isTauriEnvironment(...args) { return isTauriEnvironmentImpl(compatibilityPorts, ...args); }

/**
 * Aplica filtro de deadzone radial (circular) aos eixos analógicos.
 * Evita aceleração distorcida nas diagonais e drift em sticks com folga mecânica.
 */
export function applyRadialDeadzone(...args) { return applyRadialDeadzoneImpl(compatibilityPorts, ...args); }

/**
 * Dispara vibração háptica (rumble) no controle físico do convidado
 */
export function triggerGamepadRumble(...args) { return triggerGamepadRumbleImpl(compatibilityPorts, ...args); }

export function setCoopInputTarget(...args) { return setCoopInputTargetImpl(compatibilityPorts, ...args); }

/**
 * Inicializa a conexão com o Companion Agent local após pareamento explícito.
 */
export function initCompanionAgentConnection(...args) { return initCompanionAgentConnectionImpl(compatibilityPorts, ...args); }

export function isCompanionAgentRunning(...args) { return isCompanionAgentRunningImpl(compatibilityPorts, ...args); }

export function reconcileCoopSlots(...args) { return reconcileCoopSlotsImpl(compatibilityPorts, ...args); }

export function setMaxCoopPlayers(...args) { return setMaxCoopPlayersImpl(compatibilityPorts, ...args); }

export function getMaxCoopPlayers(...args) { return getMaxCoopPlayersImpl(compatibilityPorts, ...args); }

export function setPartyModeEnabled(...args) { return setPartyModeEnabledImpl(compatibilityPorts, ...args); }

export function isPartyModeEnabled(...args) { return isPartyModeEnabledImpl(compatibilityPorts, ...args); }

export function registerCoopBroadcastHandler(...args) { return registerCoopBroadcastHandlerImpl(compatibilityPorts, ...args); }

function broadcastSlotsUpdate(...args) { return broadcastSlotsUpdateImpl(compatibilityPorts, ...args); }

export function getCoopSlots(...args) { return getCoopSlotsImpl(compatibilityPorts, ...args); }

export function getNextAvailableSlot(...args) { return getNextAvailableSlotImpl(compatibilityPorts, ...args); }

export function registerCoopPromptHandler(...args) { return registerCoopPromptHandlerImpl(compatibilityPorts, ...args); }

export function registerCoopStateChangeHandler(...args) { return registerCoopStateChangeHandlerImpl(compatibilityPorts, ...args); }

function notifyStateChange(...args) { return notifyStateChangeImpl(compatibilityPorts, ...args); }

export function setCoopEnabled(...args) { return setCoopEnabledImpl(compatibilityPorts, ...args); }

export function getCoopState(...args) { return getCoopStateImpl(compatibilityPorts, ...args); }

// ==========================================
// LADO DO HOST / TRANSMISSOR
// ==========================================

/**
 * Processa mensagens recebidas pelo streamer via DataConnection
 * @param {string} senderPeerId
 * @param {Object} data
 * @param {Object} conn
 */
export function handleHostCoopMessage(...args) { return handleHostCoopMessageImpl(compatibilityPorts, ...args); }

/**
 * Revoga autorização de um jogador específico por slot
 */
export function revokeCoopPlayer(...args) { return revokeCoopPlayerImpl(compatibilityPorts, ...args); }

/**
 * Revoga imediatamente a autorização de todos os jogadores (Botão de Pânico Geral)
 */
export function revokeAllCoopPlayers(...args) { return revokeAllCoopPlayersImpl(compatibilityPorts, ...args); }

/**
 * Compatibilidade com chamadas legado de Player 2
 */
export function revokePlayer2(...args) { return revokePlayer2Impl(compatibilityPorts, ...args); }

function sendCompanionReset(...args) { return sendCompanionResetImpl(compatibilityPorts, ...args); }

function closeCompanionAgentConnection(...args) { return closeCompanionAgentConnectionImpl(compatibilityPorts, ...args); }

/**
 * Despacha evento de teclado no host (para jogos web ou agente nativo)
 */
function dispatchHostKeyboardInput(...args) { return dispatchHostKeyboardInputImpl(compatibilityPorts, ...args); }

/**
 * Despacha evento de mouse no host
 */
function dispatchHostMouseInput(...args) { return dispatchHostMouseInputImpl(compatibilityPorts, ...args); }

/**
 * Despacha estado de Gamepad no host
 */
function dispatchHostGamepadInput(...args) { return dispatchHostGamepadInputImpl(compatibilityPorts, ...args); }

function dispatchHostInputReset(...args) { return dispatchHostInputResetImpl(compatibilityPorts, ...args); }

// ==========================================
// LADO DO ESPECTADOR (PLAYER 2)
// ==========================================

/**
 * Solicita ao streamer permissão para ser jogador no Co-op (Slot P1 a P4)
 * @param {string} hostPeerId
 * @param {Object} dataConn
 * @param {number|null} preferredSlot
 */
export function requestCoopControl(...args) { return requestCoopControlImpl(compatibilityPorts, ...args); }

/**
 * Processa resposta ou revogação recebida pelo espectador
 * @param {Object} data
 * @param {string} hostPeerId
 * @param {HTMLElement} videoCard
 */
export function handleViewerCoopMessage(...args) { return handleViewerCoopMessageImpl(compatibilityPorts, ...args); }

/**
 * Libera o controle de Co-op voluntariamente
 */
export function releaseCoopControl(...args) { return releaseCoopControlImpl(compatibilityPorts, ...args); }

// ==========================================
// CAPTURA DE INPUTS NO ESPECTADOR (P2)
// ==========================================

let attachedCard = null;

function handleKeyDown(...args) { return handleKeyDownImpl(compatibilityPorts, ...args); }

function handleKeyUp(...args) { return handleKeyUpImpl(compatibilityPorts, ...args); }

function focusControlWrapper(...args) { return focusControlWrapperImpl(compatibilityPorts, ...args); }

function handleControlVisibilityChange(...args) { return handleControlVisibilityChangeImpl(compatibilityPorts, ...args); }

function handleMouseMove(...args) { return handleMouseMoveImpl(compatibilityPorts, ...args); }

function handleMouseDown(...args) { return handleMouseDownImpl(compatibilityPorts, ...args); }

function handleMouseUp(...args) { return handleMouseUpImpl(compatibilityPorts, ...args); }

// ==========================================
// REMAPEAMENTO DE BOTÕES DE GAMEPAD
// ==========================================
const DEFAULT_BUTTON_MAP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const NINTENDO_BUTTON_MAP = [1, 0, 3, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

let currentGamepadMapping = [...DEFAULT_BUTTON_MAP];
let currentMappingPreset = 'xbox';

export function loadGamepadMappingFromStorage(...args) { return loadGamepadMappingFromStorageImpl(compatibilityPorts, ...args); }

export function saveGamepadMappingToStorage(...args) { return saveGamepadMappingToStorageImpl(compatibilityPorts, ...args); }

export function getGamepadMapping(...args) { return getGamepadMappingImpl(compatibilityPorts, ...args); }

export function setGamepadMappingPreset(...args) { return setGamepadMappingPresetImpl(compatibilityPorts, ...args); }

export function swapGamepadButtons(...args) { return swapGamepadButtonsImpl(compatibilityPorts, ...args); }

export function resetGamepadMapping(...args) { return resetGamepadMappingImpl(compatibilityPorts, ...args); }

export function applyButtonMapping(...args) { return applyButtonMappingImpl(compatibilityPorts, ...args); }

// Carrega preferências salvas
loadGamepadMappingFromStorage();

function pollGamepads(...args) { return pollGamepadsImpl(compatibilityPorts, ...args); }

function attachPlayer2InputListeners(...args) { return attachPlayer2InputListenersImpl(compatibilityPorts, ...args); }

function detachPlayer2InputListeners(...args) { return detachPlayer2InputListenersImpl(compatibilityPorts, ...args); }

/**
 * Inicializa os controles e HUD interativo do Modal de Calibração de Gamepad
 */
export let testerCleanup = null;
function setupGamepadTesterModal(...args) {
  if (!testerCleanup) testerCleanup = setupGamepadTesterModalImpl(compatibilityPorts, ...args);
  return testerCleanup;
}
