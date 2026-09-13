// ==========================================
// MÓDULO DE CONTROLE REMOTO CO-OP (PLAYER 2)
// ==========================================

import { showToast } from './ui.js';

// Estado do Co-op
let isCoopEnabled = true;
let activePlayer2PeerId = null;
let isPlayer2 = false;
let activeHostPeerId = null;
let activeDataConn = null;

// Conexão opcional com agente nativo Windows (tools/coop-agent.py)
let companionSocket = null;
let isCompanionConnected = false;

// Callbacks de interface registrados
let onPromptCallback = null;
let onStateChangeCallback = null;

// Loop de captura de Gamepad no Player 2
let gamepadLoopId = null;
let lastGamepadState = null;

/**
 * Inicializa a escuta para o Companion Agent local (opcional para jogos Windows)
 */
export function initCompanionAgentConnection() {
  try {
    const ws = new WebSocket('ws://localhost:9876');
    ws.onopen = () => {
      companionSocket = ws;
      isCompanionConnected = true;
      console.log('[Co-op Companion] Conectado ao agente nativo Windows (ws://localhost:9876)');
      showToast('⚡ Agente Co-op Windows conectado! Inputs serão injetados em jogos nativos do PC.', 'success', 5000);
      notifyStateChange();
    };
    ws.onclose = () => {
      companionSocket = null;
      isCompanionConnected = false;
    };
    ws.onerror = () => {
      companionSocket = null;
      isCompanionConnected = false;
    };
  } catch (e) {}
}

export function isCompanionAgentRunning() {
  return isCompanionConnected;
}

export function registerCoopPromptHandler(cb) {
  onPromptCallback = cb;
}

export function registerCoopStateChangeHandler(cb) {
  onStateChangeCallback = cb;
}

function notifyStateChange() {
  if (onStateChangeCallback) {
    onStateChangeCallback({
      isCoopEnabled,
      activePlayer2PeerId,
      isPlayer2,
      activeHostPeerId,
      isCompanionConnected
    });
  }
}

export function setCoopEnabled(enabled) {
  isCoopEnabled = enabled;
  if (!enabled && activePlayer2PeerId) {
    revokePlayer2();
  }
  notifyStateChange();
}

export function getCoopState() {
  return {
    isCoopEnabled,
    activePlayer2PeerId,
    isPlayer2,
    activeHostPeerId,
    isCompanionConnected
  };
}

// ==========================================
// LADO DO HOST / TRANSMISSOR
// ==========================================

/**
 * Processa mensagens recebidas pelo streamer via DataConnection
 * @param {string} senderPeerId
 * @param {Object} data
 * @param {Object} conn
 */
export function handleHostCoopMessage(senderPeerId, data, conn) {
  if (!data || typeof data !== 'object') return;

  // 1. Pedido de entrada como Player 2
  if (data.type === 'COOP_REQUEST') {
    if (!isCoopEnabled) {
      conn.send({ type: 'COOP_RESPONSE', approved: false, reason: 'O streamer desativou o modo Co-op.' });
      return;
    }

    if (activePlayer2PeerId && activePlayer2PeerId !== senderPeerId) {
      conn.send({ type: 'COOP_RESPONSE', approved: false, reason: 'Já existe um Player 2 conectado na sessão.' });
      return;
    }

    // Exibe modal de autorização para o streamer
    if (onPromptCallback) {
      onPromptCallback({
        peerId: senderPeerId,
        approve: () => {
          activePlayer2PeerId = senderPeerId;
          activeDataConn = conn;
          conn.send({ type: 'COOP_RESPONSE', approved: true });
          showToast(`🎮 Amigo (${senderPeerId.slice(0, 6)}) agora é o Player 2!`, 'success');
          notifyStateChange();
        },
        deny: (reason = 'Solicitação recusada pelo streamer.') => {
          conn.send({ type: 'COOP_RESPONSE', approved: false, reason });
          showToast(`Pedido de Player 2 de (${senderPeerId.slice(0, 6)}) recusado.`, 'info');
        }
      });
    }
  }

  // 2. Player 2 liberou o controle voluntariamente
  else if (data.type === 'COOP_RELEASE' && senderPeerId === activePlayer2PeerId) {
    activePlayer2PeerId = null;
    activeDataConn = null;
    showToast(`🎮 Player 2 (${senderPeerId.slice(0, 6)}) liberou os controles.`, 'info');
    notifyStateChange();
  }

  // 3. Inputs do Player 2 (Validação estrita de autorização)
  else if (senderPeerId === activePlayer2PeerId) {
    if (data.type === 'INPUT_KEY') {
      dispatchHostKeyboardInput(data);
    } else if (data.type === 'INPUT_MOUSE') {
      dispatchHostMouseInput(data);
    } else if (data.type === 'INPUT_GAMEPAD') {
      dispatchHostGamepadInput(data);
    }
  }
}

/**
 * Revoga imediatamente a autorização do Player 2 (Botão de Pânico / Killswitch)
 */
export function revokePlayer2() {
  if (activePlayer2PeerId && activeDataConn) {
    try {
      activeDataConn.send({ type: 'COOP_REVOKE' });
    } catch (e) {}
  }
  const prevId = activePlayer2PeerId;
  activePlayer2PeerId = null;
  activeDataConn = null;
  if (prevId) {
    showToast(`🛑 Controle do Player 2 (${prevId.slice(0, 6)}) foi revogado.`, 'info');
  }
  notifyStateChange();
}

/**
 * Despacha evento de teclado no host (para jogos web ou agente nativo)
 */
function dispatchHostKeyboardInput(data) {
  // 1. Se o companion Windows estiver aberto, envia para jogos nativos do PC
  if (companionSocket && companionSocket.readyState === WebSocket.OPEN) {
    companionSocket.send(JSON.stringify(data));
    return;
  }

  // 2. Fallback: Despacha evento no navegador (jogos web, emuladores HTML5)
  try {
    const eventType = data.action === 'down' ? 'keydown' : 'keyup';
    const evt = new KeyboardEvent(eventType, {
      key: data.key,
      code: data.code,
      keyCode: data.keyCode,
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(evt);
  } catch (e) {}
}

/**
 * Despacha evento de mouse no host
 */
function dispatchHostMouseInput(data) {
  if (companionSocket && companionSocket.readyState === WebSocket.OPEN) {
    companionSocket.send(JSON.stringify(data));
  }
}

/**
 * Despacha estado de Gamepad no host
 */
function dispatchHostGamepadInput(data) {
  if (companionSocket && companionSocket.readyState === WebSocket.OPEN) {
    companionSocket.send(JSON.stringify(data));
  }
}

// ==========================================
// LADO DO ESPECTADOR (PLAYER 2)
// ==========================================

/**
 * Solicita ao streamer permissão para ser Player 2
 * @param {string} hostPeerId
 * @param {Object} dataConn
 */
export function requestCoopControl(hostPeerId, dataConn) {
  if (!dataConn) {
    return showToast('Conexão de dados indisponível.', 'error');
  }

  activeHostPeerId = hostPeerId;
  activeDataConn = dataConn;

  showToast('⏳ Solicitando permissão para ser Player 2...', 'info');
  dataConn.send({ type: 'COOP_REQUEST' });
}

/**
 * Processa resposta ou revogação recebida pelo espectador
 * @param {Object} data
 * @param {string} hostPeerId
 * @param {HTMLElement} videoCard
 */
export function handleViewerCoopMessage(data, hostPeerId, videoCard) {
  if (!data || typeof data !== 'object') return;

  if (data.type === 'COOP_RESPONSE') {
    if (data.approved) {
      isPlayer2 = true;
      showToast('🎉 Você agora é o Player 2! Use teclado, mouse ou controle.', 'success', 5000);
      attachPlayer2InputListeners(videoCard);
      notifyStateChange();
    } else {
      isPlayer2 = false;
      showToast(`⚠ Pedido recusado: ${data.reason || 'O streamer não autorizou.'}`, 'error');
      notifyStateChange();
    }
  }

  else if (data.type === 'COOP_REVOKE') {
    if (isPlayer2) {
      isPlayer2 = false;
      detachPlayer2InputListeners();
      showToast('🛑 O streamer encerrou sua sessão de Player 2.', 'info', 5000);
      notifyStateChange();
    }
  }

  else if (data.type === 'COOP_CONFIG') {
    const coopBtn = (videoCard && videoCard.querySelector) ? (videoCard.querySelector(`#btn-coop-${hostPeerId}`) || videoCard.querySelector('.card-btn-coop')) : document.getElementById(`btn-coop-${hostPeerId}`);
    if (coopBtn) {
      if (data.enabled === false) {
        coopBtn.disabled = true;
        coopBtn.classList.add('btn-disabled');
        coopBtn.title = 'O streamer desativou o modo Co-op nesta sessão';
        if (isPlayer2) {
          isPlayer2 = false;
          detachPlayer2InputListeners();
          showToast('🔒 O streamer desativou o modo Co-op.', 'info');
          notifyStateChange();
        }
      } else {
        coopBtn.disabled = false;
        coopBtn.classList.remove('btn-disabled');
        coopBtn.title = 'Solicitar ao streamer para jogar como Player 2';
        showToast('🎮 O streamer ativou o modo Co-op!', 'info');
      }
    }
  }
}

/**
 * Libera o controle de Player 2 voluntariamente
 */
export function releaseCoopControl() {
  if (isPlayer2 && activeDataConn) {
    try {
      activeDataConn.send({ type: 'COOP_RELEASE' });
    } catch (e) {}
  }
  isPlayer2 = false;
  detachPlayer2InputListeners();
  showToast('Controle de Player 2 liberado.', 'info');
  notifyStateChange();
}

// ==========================================
// CAPTURA DE INPUTS NO ESPECTADOR (P2)
// ==========================================

let attachedCard = null;

function handleKeyDown(e) {
  if (!isPlayer2 || !activeDataConn) return;

  // Previne rolagem de página em teclas de jogo comuns se o foco estiver na live
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }

  activeDataConn.send({
    type: 'INPUT_KEY',
    action: 'down',
    key: e.key,
    code: e.code,
    keyCode: e.keyCode
  });
}

function handleKeyUp(e) {
  if (!isPlayer2 || !activeDataConn) return;

  activeDataConn.send({
    type: 'INPUT_KEY',
    action: 'up',
    key: e.key,
    code: e.code,
    keyCode: e.keyCode
  });
}

function handleMouseMove(e) {
  if (!isPlayer2 || !activeDataConn || !attachedCard) return;

  const video = attachedCard.querySelector('video');
  if (!video) return;

  const rect = video.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  // Coordenadas normalizadas (0.0 a 1.0)
  const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

  activeDataConn.send({
    type: 'INPUT_MOUSE',
    action: 'move',
    x: normX,
    y: normY
  });
}

function handleMouseDown(e) {
  if (!isPlayer2 || !activeDataConn) return;
  activeDataConn.send({
    type: 'INPUT_MOUSE',
    action: 'down',
    button: e.button
  });
}

function handleMouseUp(e) {
  if (!isPlayer2 || !activeDataConn) return;
  activeDataConn.send({
    type: 'INPUT_MOUSE',
    action: 'up',
    button: e.button
  });
}

function pollGamepads() {
  if (!isPlayer2 || !activeDataConn) return;

  try {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[0]; // Captura o primeiro controle conectado

    if (gp && gp.connected) {
      const currentState = {
        buttons: gp.buttons.map(b => (typeof b === 'object' ? b.pressed : b === 1.0)),
        axes: gp.axes.map(a => Math.round(a * 100) / 100)
      };

      // Envia apenas se houver mudanças para economizar canal
      const serialized = JSON.stringify(currentState);
      if (serialized !== lastGamepadState) {
        lastGamepadState = serialized;
        activeDataConn.send({
          type: 'INPUT_GAMEPAD',
          state: currentState
        });
      }
    }
  } catch (e) {}

  gamepadLoopId = requestAnimationFrame(pollGamepads);
}

function attachPlayer2InputListeners(videoCard) {
  attachedCard = videoCard;
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  if (videoCard) {
    const wrapper = videoCard.querySelector('.video-wrapper') || videoCard;
    wrapper.addEventListener('mousemove', handleMouseMove);
    wrapper.addEventListener('mousedown', handleMouseDown);
    wrapper.addEventListener('mouseup', handleMouseUp);
  }

  // Inicia loop do Gamepad
  cancelAnimationFrame(gamepadLoopId);
  gamepadLoopId = requestAnimationFrame(pollGamepads);
}

function detachPlayer2InputListeners() {
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('keyup', handleKeyUp);

  if (attachedCard) {
    const wrapper = attachedCard.querySelector('.video-wrapper') || attachedCard;
    wrapper.removeEventListener('mousemove', handleMouseMove);
    wrapper.removeEventListener('mousedown', handleMouseDown);
    wrapper.removeEventListener('mouseup', handleMouseUp);
    attachedCard = null;
  }

  cancelAnimationFrame(gamepadLoopId);
  gamepadLoopId = null;
  lastGamepadState = null;
}
