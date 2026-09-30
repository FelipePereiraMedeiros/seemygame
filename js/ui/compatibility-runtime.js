import { initAudioAnalyser, stopAudioAnalyser } from ".././audio.js";
import { stopStatsMonitor } from ".././stats.js";
import { TERMS_VERSION } from ".././config.js";

export { isValidPeerId } from ".././shared/peer-id.js";
import { isValidPeerId } from ".././shared/peer-id.js";
import { showToast as showToastImpl } from './toasts.js';
import { initTermsModal as initTermsModalImpl } from './terms.js';
import { resolveCardDisplayStream as resolveCardDisplayStreamImpl, updateGridEmptyState as updateGridEmptyStateImpl, createPlaceholderCard as createPlaceholderCardImpl, updateCardStatus as updateCardStatusImpl, hideCardLoading as hideCardLoadingImpl, setCardStreamPaused as setCardStreamPausedImpl, removeVideoCard as removeVideoCardImpl, addOrUpdateVideoCard as addOrUpdateVideoCardImpl } from './video-cards.js';
import { showCoopPromptModal as showCoopPromptModalImpl, updateCoopUI as updateCoopUIImpl, renderCoopLobbyDock as renderCoopLobbyDockImpl } from './coop-controls.js';
const compatibilityPorts = Object.defineProperties({}, {
"initAudioAnalyser": { get: () => initAudioAnalyser },
"stopAudioAnalyser": { get: () => stopAudioAnalyser },
"stopStatsMonitor": { get: () => stopStatsMonitor },
"TERMS_VERSION": { get: () => TERMS_VERSION },
"isValidPeerId": { get: () => isValidPeerId },
"resolveCardDisplayStream": { get: () => resolveCardDisplayStream },
"showToast": { get: () => showToast },
"initTermsModal": { get: () => initTermsModal },
"updateGridEmptyState": { get: () => updateGridEmptyState },
"createPlaceholderCard": { get: () => createPlaceholderCard },
"updateCardStatus": { get: () => updateCardStatus },
"hideCardLoading": { get: () => hideCardLoading },
"setCardStreamPaused": { get: () => setCardStreamPaused },
"removeVideoCard": { get: () => removeVideoCard },
"addOrUpdateVideoCard": { get: () => addOrUpdateVideoCard },
"showCoopPromptModal": { get: () => showCoopPromptModal },
"updateCoopUI": { get: () => updateCoopUI },
"renderCoopLobbyDock": { get: () => renderCoopLobbyDock }
});


/**
 * Retorna o MediaStream adequado para o elemento <video>.
 * Para a visualização local (preview), se o stream possuir áudio e vídeo juntos,
 * isola apenas a trilha de vídeo para exibição na tela. O áudio já é escutado pelo jogador
 * diretamente pelo sistema operacional. Ao evitar trilhas de áudio no elemento <video> de preview,
 * o Chromium não ativa o mecanismo de sincronização de relógio A/V (AudioRenderer master clock)
 * nem sofre engasgos/congelamentos periódicos de 1 segundo causados por RTCP Sender Reports.
 * @param {MediaStream|null} stream
 * @param {boolean} isLocal
 * @returns {MediaStream|null}
 */
export function resolveCardDisplayStream(...args) { return resolveCardDisplayStreamImpl(compatibilityPorts, ...args); }

/**
 * Exibe notificações toast flutuantes na tela (Seguro contra XSS)
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 * @param {number} [duration=4000]
 */
export function showToast(...args) { return showToastImpl(compatibilityPorts, ...args); }

/**
 * Inicializa o modal de termos de uso e verificação de maioridade
 * @param {Function} [onAcceptCallback]
 */
export function initTermsModal(...args) { return initTermsModalImpl(compatibilityPorts, ...args); }

/**
 * Atualiza a visibilidade do estado vazio da grade de vídeos
 */
export function updateGridEmptyState(...args) { return updateGridEmptyStateImpl(compatibilityPorts, ...args); }

/**
 * Cria um cartão temporário com animação de carregamento enquanto conecta (Seguro contra XSS)
 * @param {string} peerId
 * @param {string} initialText
 * @param {Function} onDisconnect
 */
export function createPlaceholderCard(...args) { return createPlaceholderCardImpl(compatibilityPorts, ...args); }

/**
 * Atualiza o texto do overlay de status de um cartão
 * @param {string} peerId
 * @param {string} message
 */
export function updateCardStatus(...args) { return updateCardStatusImpl(compatibilityPorts, ...args); }

/**
 * Oculta o overlay de carregamento quando o stream é recebido
 * @param {string} peerId
 */
export function hideCardLoading(...args) { return hideCardLoadingImpl(compatibilityPorts, ...args); }

/**
 * Altera visualmente o overlay de status de pausa da transmissão
 * @param {string} peerId
 * @param {boolean} isPaused
 * @param {string} [message='Transmissão pausada pelo streamer.']
 */
export function setCardStreamPaused(...args) { return setCardStreamPausedImpl(compatibilityPorts, ...args); }

/**
 * Remove o cartão de vídeo e interrompe monitorias associadas
 * @param {string} peerId
 */
export function removeVideoCard(...args) { return removeVideoCardImpl(compatibilityPorts, ...args); }

/**
 * Adiciona ou atualiza o player de vídeo na grade com controles de stats, som, PiP e tela cheia
 * @param {Object|string} optionsOrPeerId
 * @param {MediaStream} [streamArg]
 * @param {Object} [extraOptions={}]
 */
export function addOrUpdateVideoCard(...args) { return addOrUpdateVideoCardImpl(compatibilityPorts, ...args); }

/**
 * Exibe o modal de solicitação de controle do Player 2 para o streamer
 * @param {string} requesterId
 * @param {Function} onApprove
 * @param {Function} onDeny
 */
export function showCoopPromptModal(...args) { return showCoopPromptModalImpl(compatibilityPorts, ...args); }

/**
 * Atualiza visualmente o estado de Co-op nos cards (Host e Espectador)
 * @param {Object} state
 */
export function updateCoopUI(...args) { return updateCoopUIImpl(compatibilityPorts, ...args); }

/**
 * Renderiza ou atualiza o dock de slots de jogadores Co-op
 */
export function renderCoopLobbyDock(...args) { return renderCoopLobbyDockImpl(compatibilityPorts, ...args); }
