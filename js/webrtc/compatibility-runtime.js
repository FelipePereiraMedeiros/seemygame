
import { tuneSdpForGaming as tuneSdpForGamingImpl, hookPeerConnectionSdp as hookPeerConnectionSdpImpl } from './sdp.js';
import { applyTransceiverOptimizations as applyTransceiverOptimizationsImpl, applySenderOptimizations as applySenderOptimizationsImpl, applySenderOptimizationsWhenReady as applySenderOptimizationsWhenReadyImpl, updateSenderBitrate as updateSenderBitrateImpl, swapStreamAudioTrack as swapStreamAudioTrackImpl } from './sender.js';
const compatibilityPorts = Object.defineProperties({}, {
"tuneSdpForGaming": { get: () => tuneSdpForGaming },
"hookPeerConnectionSdp": { get: () => hookPeerConnectionSdp },
"applyTransceiverOptimizations": { get: () => applyTransceiverOptimizations },
"applySenderOptimizations": { get: () => applySenderOptimizations },
"applySenderOptimizationsWhenReady": { get: () => applySenderOptimizationsWhenReady },
"updateSenderBitrate": { get: () => updateSenderBitrate },
"swapStreamAudioTrack": { get: () => swapStreamAudioTrack }
});
// ==========================================
// MOTOR DE PRIORIDADE DE FPS & BAIXA LATÊNCIA
// ==========================================

/**
 * Injeta parâmetros no SDP de forma segura e conforme com a RFC 8866
 * (b=AS e b=TIAS posicionados após c= e sem duplicação de atributos)
 * @param {string} sdp
 * @param {number} bitrateBps
 * @returns {string}
 */
export function tuneSdpForGaming(...args) { return tuneSdpForGamingImpl(compatibilityPorts, ...args); }

/**
 * Intercepta setLocalDescription para injetar o SDP customizado
 * @param {RTCPeerConnection} pc
 * @param {Function|number} getBitrateBps
 */
export function hookPeerConnectionSdp(...args) { return hookPeerConnectionSdpImpl(compatibilityPorts, ...args); }

/**
 * Otimiza Transceivers, prioriza H.264 no vídeo e ajusta Jitter Buffer por modo
 * @param {RTCPeerConnection} pc
 * @param {'ultra-low'|'stable'} [latencyMode='ultra-low']
 */
export function applyTransceiverOptimizations(...args) { return applyTransceiverOptimizationsImpl(compatibilityPorts, ...args); }

/**
 * Configurações de prioridade de framerate no Sender (Alvo de 60 FPS) e escala de resolução
 * @param {RTCPeerConnection} pc
 * @param {number} bitrateBps
 * @param {number} [fps=60]
 * @param {number} [scaleResolutionDownBy=1]
 * @returns {Promise<boolean>} Retorna true se os parâmetros foram aplicados com sucesso
 */
export function applySenderOptimizations(...args) { return applySenderOptimizationsImpl(compatibilityPorts, ...args); }

/**
 * Aplica parâmetros de alta fluidez no RTCRtpSender assim que a conexão WebRTC estiver negociada e estável
 * @param {RTCPeerConnection} pc
 * @param {Function|number} getBitrateBps
 * @param {Function|number} [getFps=60]
 * @param {Function|number} [getScaleFactor=1]
 * @returns {Function} Função de cancelamento / cleanup
 */
export function applySenderOptimizationsWhenReady(...args) { return applySenderOptimizationsWhenReadyImpl(compatibilityPorts, ...args); }

/**
 * Atualiza o bitrate máximo do sender de vídeo dinamicamente sem interromper a transmissão
 * @param {RTCPeerConnection} pc
 * @param {number} bitrateBps
 * @returns {Promise<boolean>}
 */
export function updateSenderBitrate(...args) { return updateSenderBitrateImpl(compatibilityPorts, ...args); }

/**
 * Substitui ou remove a trilha de áudio em tempo real sem renegociação SDP
 * @param {RTCPeerConnection} pc
 * @param {MediaStreamTrack|null} newTrack
 * @returns {Promise<boolean>}
 */
export function swapStreamAudioTrack(...args) { return swapStreamAudioTrackImpl(compatibilityPorts, ...args); }
