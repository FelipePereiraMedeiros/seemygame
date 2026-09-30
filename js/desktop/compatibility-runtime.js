
import { isDesktopApp as isDesktopAppImpl, invokeDesktopCommand as invokeDesktopCommandImpl } from './ipc.js';
import { isNativeGamepadAvailable as isNativeGamepadAvailableImpl, plugVirtualGamepad as plugVirtualGamepadImpl, updateVirtualGamepad as updateVirtualGamepadImpl, unplugVirtualGamepad as unplugVirtualGamepadImpl, unplugAllVirtualGamepads as unplugAllVirtualGamepadsImpl, testGamepadVibration as testGamepadVibrationImpl, getXInputGamepads as getXInputGamepadsImpl, checkVirtualGamepadDriver as checkVirtualGamepadDriverImpl, installViGEmDriver as installViGEmDriverImpl } from './gamepad.js';
import { normalizeCaptureSource as normalizeCaptureSourceImpl, normalizeNativeCaptureState as normalizeNativeCaptureStateImpl, requireSourceId as requireSourceIdImpl, getCapturableWindows as getCapturableWindowsImpl, getCapturableSources as getCapturableSourcesImpl, getNativeCaptureCapabilities as getNativeCaptureCapabilitiesImpl, getNativeCaptureState as getNativeCaptureStateImpl, getAudioExclusionCandidates as getAudioExclusionCandidatesImpl, startNativeCapture as startNativeCaptureImpl, reconfigureNativeCapture as reconfigureNativeCaptureImpl, setNativeCaptureAudioMode as setNativeCaptureAudioModeImpl, stopNativeCapture as stopNativeCaptureImpl, addNativeCaptureIceCandidate as addNativeCaptureIceCandidateImpl, listenNativeCapture as listenNativeCaptureImpl, listenNativeCaptureBridge as listenNativeCaptureBridgeImpl } from './capture.js';
import { createNativeCapturePeer as createNativeCapturePeerImpl, closeNativeCapturePeer as closeNativeCapturePeerImpl, createNativeViewerPeer as createNativeViewerPeerImpl, addNativeViewerIceCandidate as addNativeViewerIceCandidateImpl, closeNativeViewerPeer as closeNativeViewerPeerImpl, startNativeViewer as startNativeViewerImpl, addNativeViewerCandidate as addNativeViewerCandidateImpl, stopNativeViewer as stopNativeViewerImpl, listenNativeViewerEvents as listenNativeViewerEventsImpl } from './webrtc.js';
import { setHighPriority as setHighPriorityImpl, toggleAlwaysOnTop as toggleAlwaysOnTopImpl, isAlwaysOnTop as isAlwaysOnTopImpl, logDiagnostic as logDiagnosticImpl } from './window.js';
const compatibilityPorts = Object.defineProperties({}, {
"isDesktopApp": { get: () => isDesktopApp },
"invokeDesktopCommand": { get: () => invokeDesktopCommand },
"isNativeGamepadAvailable": { get: () => isNativeGamepadAvailable },
"plugVirtualGamepad": { get: () => plugVirtualGamepad },
"updateVirtualGamepad": { get: () => updateVirtualGamepad },
"unplugVirtualGamepad": { get: () => unplugVirtualGamepad },
"unplugAllVirtualGamepads": { get: () => unplugAllVirtualGamepads },
"testGamepadVibration": { get: () => testGamepadVibration },
"getXInputGamepads": { get: () => getXInputGamepads },
"checkVirtualGamepadDriver": { get: () => checkVirtualGamepadDriver },
"installViGEmDriver": { get: () => installViGEmDriver },
"normalizeCaptureSource": { get: () => normalizeCaptureSource },
"normalizeNativeCaptureState": { get: () => normalizeNativeCaptureState },
"requireSourceId": { get: () => requireSourceId },
"getCapturableWindows": { get: () => getCapturableWindows },
"getCapturableSources": { get: () => getCapturableSources },
"getNativeCaptureCapabilities": { get: () => getNativeCaptureCapabilities },
"getNativeCaptureState": { get: () => getNativeCaptureState },
"getAudioExclusionCandidates": { get: () => getAudioExclusionCandidates },
"startNativeCapture": { get: () => startNativeCapture },
"reconfigureNativeCapture": { get: () => reconfigureNativeCapture },
"setNativeCaptureAudioMode": { get: () => setNativeCaptureAudioMode },
"stopNativeCapture": { get: () => stopNativeCapture },
"createNativeCapturePeer": { get: () => createNativeCapturePeer },
"addNativeCaptureIceCandidate": { get: () => addNativeCaptureIceCandidate },
"closeNativeCapturePeer": { get: () => closeNativeCapturePeer },
"createNativeViewerPeer": { get: () => createNativeViewerPeer },
"addNativeViewerIceCandidate": { get: () => addNativeViewerIceCandidate },
"closeNativeViewerPeer": { get: () => closeNativeViewerPeer },
"startNativeViewer": { get: () => startNativeViewer },
"addNativeViewerCandidate": { get: () => addNativeViewerCandidate },
"stopNativeViewer": { get: () => stopNativeViewer },
"listenNativeViewerEvents": { get: () => listenNativeViewerEvents },
"listenNativeCapture": { get: () => listenNativeCapture },
"listenNativeCaptureBridge": { get: () => listenNativeCaptureBridge },
"setHighPriority": { get: () => setHighPriority },
"toggleAlwaysOnTop": { get: () => toggleAlwaysOnTop },
"isAlwaysOnTop": { get: () => isAlwaysOnTop },
"logDiagnostic": { get: () => logDiagnostic }
});
/**
 * SeeMyGame - Módulo de Integração com o App Desktop Nativo (Tauri v2 / Rust)
 */

export function isDesktopApp(...args) { return isDesktopAppImpl(compatibilityPorts, ...args); }

export function invokeDesktopCommand(...args) { return invokeDesktopCommandImpl(compatibilityPorts, ...args); }

/**
 * Comandos de gamepad usam o mesmo adaptador do restante do desktop. O
 * retorno da Promise é importante: a UI só deve anunciar um dispositivo
 * virtual depois que o backend confirmou a criação.
 */
export function isNativeGamepadAvailable(...args) { return isNativeGamepadAvailableImpl(compatibilityPorts, ...args); }

export function plugVirtualGamepad(...args) { return plugVirtualGamepadImpl(compatibilityPorts, ...args); }

export function updateVirtualGamepad(...args) { return updateVirtualGamepadImpl(compatibilityPorts, ...args); }

export function unplugVirtualGamepad(...args) { return unplugVirtualGamepadImpl(compatibilityPorts, ...args); }

export function unplugAllVirtualGamepads(...args) { return unplugAllVirtualGamepadsImpl(compatibilityPorts, ...args); }

export function testGamepadVibration(...args) { return testGamepadVibrationImpl(compatibilityPorts, ...args); }

export function getXInputGamepads(...args) { return getXInputGamepadsImpl(compatibilityPorts, ...args); }

export function checkVirtualGamepadDriver(...args) { return checkVirtualGamepadDriverImpl(compatibilityPorts, ...args); }

export function installViGEmDriver(...args) { return installViGEmDriverImpl(compatibilityPorts, ...args); }

/**
 * Normaliza o contrato enviado pelo Rust. IDs são opacos: o frontend apenas
 * os repassa ao comando de captura e nunca tenta convertê-los em HWND/HMONITOR.
 */
export function normalizeCaptureSource(...args) { return normalizeCaptureSourceImpl(compatibilityPorts, ...args); }

export function normalizeNativeCaptureState(...args) { return normalizeNativeCaptureStateImpl(compatibilityPorts, ...args); }

function requireSourceId(...args) { return requireSourceIdImpl(compatibilityPorts, ...args); }

/**
 * Obtém lista de janelas e jogos ativos enumerados pela API Win32 em Rust
 * @returns {Promise<Array<{id: string, title: string, process_name: string, is_minimized: boolean}>>}
 */
export function getCapturableWindows(...args) { return getCapturableWindowsImpl(compatibilityPorts, ...args); }

/**
 * Enumera janelas e monitores. A enumeração cria IDs opacos no Rust e também
 * invalida IDs de enumerações anteriores.
 */
export function getCapturableSources(...args) { return getCapturableSourcesImpl(compatibilityPorts, ...args); }

export function getNativeCaptureCapabilities(...args) { return getNativeCaptureCapabilitiesImpl(compatibilityPorts, ...args); }

export function getNativeCaptureState(...args) { return getNativeCaptureStateImpl(compatibilityPorts, ...args); }

export function getAudioExclusionCandidates(...args) { return getAudioExclusionCandidatesImpl(compatibilityPorts, ...args); }

export function startNativeCapture(...args) { return startNativeCaptureImpl(compatibilityPorts, ...args); }

export function reconfigureNativeCapture(...args) { return reconfigureNativeCaptureImpl(compatibilityPorts, ...args); }

export function setNativeCaptureAudioMode(...args) { return setNativeCaptureAudioModeImpl(compatibilityPorts, ...args); }

export function stopNativeCapture(...args) { return stopNativeCaptureImpl(compatibilityPorts, ...args); }

export function createNativeCapturePeer(...args) { return createNativeCapturePeerImpl(compatibilityPorts, ...args); }

export function addNativeCaptureIceCandidate(...args) { return addNativeCaptureIceCandidateImpl(compatibilityPorts, ...args); }

export function closeNativeCapturePeer(...args) { return closeNativeCapturePeerImpl(compatibilityPorts, ...args); }

export function createNativeViewerPeer(...args) { return createNativeViewerPeerImpl(compatibilityPorts, ...args); }

export function addNativeViewerIceCandidate(...args) { return addNativeViewerIceCandidateImpl(compatibilityPorts, ...args); }

export function closeNativeViewerPeer(...args) { return closeNativeViewerPeerImpl(compatibilityPorts, ...args); }

/**
 * Visualizador Nativo Direct3D 11 (Ultra Baixa Latência sem passar pelo WebView2)
 */
export function startNativeViewer(...args) { return startNativeViewerImpl(compatibilityPorts, ...args); }

export function addNativeViewerCandidate(...args) { return addNativeViewerCandidateImpl(compatibilityPorts, ...args); }

export function stopNativeViewer(...args) { return stopNativeViewerImpl(compatibilityPorts, ...args); }

export function listenNativeViewerEvents(...args) { return listenNativeViewerEventsImpl(compatibilityPorts, ...args); }


/**
 * Escuta transições do worker nativo quando o runtime de mídia estiver
 * disponível. O import é tardio para manter o bundle web independente do
 * plugin de eventos do Tauri.
 */
export function listenNativeCapture(...args) { return listenNativeCaptureImpl(compatibilityPorts, ...args); }

export function listenNativeCaptureBridge(...args) { return listenNativeCaptureBridgeImpl(compatibilityPorts, ...args); }

/**
 * Solicita ao Rust elevar a prioridade de processo para HIGH_PRIORITY_CLASS
 * @returns {Promise<boolean>}
 */
export function setHighPriority(...args) { return setHighPriorityImpl(compatibilityPorts, ...args); }

/**
 * Alterna dinamicamente se a janela do SeeMyGame deve ficar fixada no topo (always-on-top)
 * @returns {Promise<boolean>} Retorna o novo estado
 */
export function toggleAlwaysOnTop(...args) { return toggleAlwaysOnTopImpl(compatibilityPorts, ...args); }


/**
 * Consulta se a janela está fixada no topo
 * @returns {Promise<boolean>}
 */
export function isAlwaysOnTop(...args) { return isAlwaysOnTopImpl(compatibilityPorts, ...args); }

/**
 * Envia log de diagnóstico para o arquivo native_debug.log gerenciado pelo Rust
 * @param {string} message
 */
export function logDiagnostic(...args) { return logDiagnosticImpl(compatibilityPorts, ...args); }
