// ==========================================
// MÓDULO DE CONTROLE REMOTO CO-OP (PLAYER 2)
// ==========================================

import { showToast } from './ui.js';
import {
  isNativeGamepadAvailable,
  plugVirtualGamepad,
  updateVirtualGamepad,
  unplugVirtualGamepad,
  unplugAllVirtualGamepads,
  checkVirtualGamepadDriver,
  installViGEmDriver
} from './desktop.js';

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
const pressedBrowserKeys = new Set();
let capabilityWarningShown = false;
let activeHostCapabilities = { keyboard: true, mouse: false, gamepad: false };
let controlVisibilityTarget = null;
let coopInputTargetRect = null;
let nextCoopSlotGeneration = 0;

function normalizeTargetRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const left = Number(rect.left);
  const top = Number(rect.top);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || width > 32768 || height > 32768) {
    return null;
  }
  return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
}

export function isTauriEnvironment() {
  return isNativeGamepadAvailable();
}

/**
 * Aplica filtro de deadzone radial (circular) aos eixos analógicos.
 * Evita aceleração distorcida nas diagonais e drift em sticks com folga mecânica.
 */
export function applyRadialDeadzone(x, y, deadzone = 0.08) {
  const clampedX = Math.max(-1, Math.min(1, Number(x) || 0));
  const clampedY = Math.max(-1, Math.min(1, Number(y) || 0));
  const magnitude = Math.hypot(clampedX, clampedY);
  if (magnitude <= deadzone) {
    return { x: 0, y: 0 };
  }
  const normalizedMagnitude = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  const factor = normalizedMagnitude / magnitude;
  return {
    x: Math.round(clampedX * factor * 1000) / 1000,
    y: Math.round(clampedY * factor * 1000) / 1000
  };
}

/**
 * Dispara vibração háptica (rumble) no controle físico do convidado
 */
export function triggerGamepadRumble(strongMagnitude = 0.5, weakMagnitude = 0.5, duration = 200, padIndex = 0) {
  try {
    const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[padIndex];
    if (gp?.vibrationActuator?.playEffect) {
      gp.vibrationActuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: Math.max(50, Math.min(2000, duration)),
        weakMagnitude: Math.max(0, Math.min(1, weakMagnitude)),
        strongMagnitude: Math.max(0, Math.min(1, strongMagnitude))
      }).catch(() => {});
      return true;
    }
  } catch (e) {}
  return false;
}

export function setCoopInputTarget(rect) {
  coopInputTargetRect = normalizeTargetRect(rect);
  if (isCompanionConnected && companionSocket?.readyState === WebSocket.OPEN) {
    try {
      companionSocket.send(JSON.stringify({ type: 'COOP_TARGET', targetRect: coopInputTargetRect }));
    } catch (e) {}
  }
}

/**
 * Inicializa a conexão com o Companion Agent local após pareamento explícito.
 */
export function initCompanionAgentConnection(token = null, isExplicit = false) {
  const authToken = token || (typeof localStorage !== 'undefined' ? localStorage.getItem('seemygame_coop_token') : null);
  if (!authToken) {
    if (isExplicit) {
      showToast('Informe o token de pareamento para ativar o Companion Agent.', 'info');
    }
    return false;
  }
  if (typeof WebSocket === 'undefined') return false;
  if (isCompanionConnected || companionSocket) return true;

  try {
    const ws = new WebSocket('ws://localhost:9876');
    ws.onopen = () => {
      companionSocket = ws;
      isCompanionConnected = false;
      ws.send(JSON.stringify({ type: 'AUTH', token: authToken }));
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'AUTH_OK') {
          isCompanionConnected = true;
          companionCapabilities = {
            keyboard: Boolean(data.keyboard),
            mouse: Boolean(data.mouse),
            gamepad: Boolean(data.gamepad),
            mouseCoordinateSpace: data.mouseCoordinateSpace || 'primary-screen'
          };
          console.log('[Co-op Companion] Agente nativo Windows autenticado.');
          showToast('⚡ Agente Co-op Windows conectado e pareado.', 'success', 5000);
          if (activeDataConn && activeDataConn.open !== false) {
            try {
              activeDataConn.send({
                type: 'COOP_CAPABILITIES',
                keyboard: true,
                mouse: Boolean(companionCapabilities.mouse),
                gamepad: Boolean(companionCapabilities.gamepad),
                browserKeyboardFallback: true,
                mouseCoordinateSpace: companionCapabilities.mouseCoordinateSpace
              });
            } catch (e) {}
          }
          try {
            ws.send(JSON.stringify({ type: 'COOP_TARGET', targetRect: coopInputTargetRect }));
          } catch (e) {}
          notifyStateChange();
        } else if (data.type === 'AGENT_CAPABILITIES') {
          companionCapabilities = {
            keyboard: Boolean(data.keyboard),
            mouse: Boolean(data.mouse),
            gamepad: Boolean(data.gamepad),
            mouseCoordinateSpace: data.mouseCoordinateSpace || 'primary-screen'
          };
          notifyStateChange();
        } else if (data.type === 'AUTH_FAILED') {
          showToast('O token do Companion Agent foi recusado.', 'error');
          try { ws.close(); } catch (e) {}
        }
      } catch (e) {}
    };
    ws.onclose = () => {
      if (companionSocket === ws) companionSocket = null;
      isCompanionConnected = false;
      companionCapabilities = { keyboard: false, mouse: false, gamepad: false, mouseCoordinateSpace: 'primary-screen' };
      notifyStateChange();
    };
    ws.onerror = () => {
      if (companionSocket === ws) companionSocket = null;
      isCompanionConnected = false;
      companionCapabilities = { keyboard: false, mouse: false, gamepad: false, mouseCoordinateSpace: 'primary-screen' };
      notifyStateChange();
    };
    return true;
  } catch (e) {}
  return false;
}

export function isCompanionAgentRunning() {
  return isCompanionConnected;
}

export function reconcileCoopSlots() {
  const allowedMaxSlots = maxCoopPlayers > 1 ? 4 : 2;
  for (const [slot, player] of Array.from(coopSlots.entries())) {
    // Se o modo party estiver desativado, o slot 0 não pode ser ocupado por jogador remoto (exclusivo do host)
    if (slot === 0 && !partyModeEnabled) {
      revokeCoopPlayer(0, true);
    } else if (slot >= allowedMaxSlots) {
      // Se maxCoopPlayers foi reduzido (ex: de 4 para 2), revoga slots além do limite
      revokeCoopPlayer(slot, true);
    }
  }
}

export function setMaxCoopPlayers(count) {
  maxCoopPlayers = Math.max(1, Math.min(4, Number(count) || 1));
  reconcileCoopSlots();
  notifyStateChange();
}

export function getMaxCoopPlayers() {
  return maxCoopPlayers;
}

export function setPartyModeEnabled(enabled) {
  partyModeEnabled = Boolean(enabled);
  reconcileCoopSlots();
  notifyStateChange();
}

export function isPartyModeEnabled() {
  return partyModeEnabled;
}

export function registerCoopBroadcastHandler(cb) {
  broadcastSlotsCallback = cb;
}

function broadcastSlotsUpdate() {
  if (broadcastSlotsCallback) {
    try {
      broadcastSlotsCallback({
        type: 'COOP_SLOTS_UPDATE',
        slots: getCoopSlots()
      });
    } catch (e) {}
  }
}

export function getCoopSlots() {
  const slots = [];
  const maxSlots = maxCoopPlayers > 1 ? 4 : 2;

  // Slot 0 (Player 1)
  slots.push({
    slot: 0,
    label: 'Player 1',
    occupied: coopSlots.has(0),
    peerId: coopSlots.get(0)?.peerId || (partyModeEnabled ? null : 'host-local'),
    name: coopSlots.get(0)?.name || (partyModeEnabled ? 'Vago' : 'Streamer (Local)'),
    isHost: !coopSlots.has(0) && !partyModeEnabled,
    color: '#3b82f6'
  });

  // Slot 1 (Player 2)
  slots.push({
    slot: 1,
    label: 'Player 2',
    occupied: coopSlots.has(1),
    peerId: coopSlots.get(1)?.peerId || null,
    name: coopSlots.get(1)?.name || 'Vago',
    isHost: false,
    color: '#10b981'
  });

  if (maxCoopPlayers > 1) {
    // Slot 2 (Player 3)
    slots.push({
      slot: 2,
      label: 'Player 3',
      occupied: coopSlots.has(2),
      peerId: coopSlots.get(2)?.peerId || null,
      name: coopSlots.get(2)?.name || 'Vago',
      isHost: false,
      color: '#f59e0b'
    });

    // Slot 3 (Player 4)
    slots.push({
      slot: 3,
      label: 'Player 4',
      occupied: coopSlots.has(3),
      peerId: coopSlots.get(3)?.peerId || null,
      name: coopSlots.get(3)?.name || 'Vago',
      isHost: false,
      color: '#a855f7'
    });
  }

  return slots;
}

export function getNextAvailableSlot(preferredSlot = null) {
  const candidateSlots = [];
  if (maxCoopPlayers > 1 && partyModeEnabled && !coopSlots.has(0)) {
    candidateSlots.push(0);
  }
  if (!coopSlots.has(1)) {
    candidateSlots.push(1);
  }
  if (maxCoopPlayers > 1) {
    if (!coopSlots.has(2)) candidateSlots.push(2);
    if (!coopSlots.has(3)) candidateSlots.push(3);
  }

  if (preferredSlot !== null && preferredSlot !== undefined) {
    const p = Number(preferredSlot);
    if (candidateSlots.includes(p)) return p;
  }

  return candidateSlots.length > 0 ? candidateSlots[0] : null;
}

export function registerCoopPromptHandler(cb) {
  onPromptCallback = cb;
}

export function registerCoopStateChangeHandler(cb) {
  onStateChangeCallback = cb;
}

function notifyStateChange() {
  if (onStateChangeCallback) {
    const p2PeerId = coopSlots.get(1)?.peerId || (coopSlots.size > 0 ? coopSlots.values().next().value?.peerId : null);
    onStateChangeCallback({
      isCoopEnabled,
      activePlayer2PeerId: p2PeerId,
      isPlayer2: myAssignedSlot !== null || isPlayer2,
      myAssignedSlot,
      maxCoopPlayers,
      partyModeEnabled,
      activeSlotsCount: coopSlots.size,
      slots: getCoopSlots(),
      activeHostPeerId,
      isCompanionConnected,
      companionCapabilities: { ...companionCapabilities },
      targetRect: coopInputTargetRect ? { ...coopInputTargetRect } : null
    });
  }
}

export function setCoopEnabled(enabled) {
  isCoopEnabled = enabled;
  if (!enabled && coopSlots.size > 0) {
    revokeAllCoopPlayers();
  }
  notifyStateChange();
}

export function getCoopState() {
  const p2PeerId = coopSlots.get(1)?.peerId || (coopSlots.size > 0 ? coopSlots.values().next().value?.peerId : null);
  return {
    isCoopEnabled,
    activePlayer2PeerId: p2PeerId,
    isPlayer2: myAssignedSlot !== null || isPlayer2,
    myAssignedSlot,
    maxCoopPlayers,
    partyModeEnabled,
    activeSlotsCount: coopSlots.size,
    slots: getCoopSlots(),
    activeHostPeerId,
    isCompanionConnected,
    companionCapabilities: { ...companionCapabilities },
    targetRect: coopInputTargetRect ? { ...coopInputTargetRect } : null
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

  // 1. Pedido de entrada no Co-op
  if (data.type === 'COOP_REQUEST') {
    if (!isCoopEnabled) {
      conn.send({ type: 'COOP_RESPONSE', approved: false, reason: 'O streamer desativou o modo Co-op.' });
      return;
    }

    // Se este peer já estiver alocado em um slot, reconfirma aprovação
    for (const [s, p] of coopSlots.entries()) {
      if (p.peerId === senderPeerId) {
        conn.send({ type: 'COOP_RESPONSE', approved: true, slot: s });
        return;
      }
    }

    // Verifica disponibilidade de slots
    const targetSlot = getNextAvailableSlot(data.preferredSlot);
    if (targetSlot === null) {
      const reason = maxCoopPlayers === 1
        ? 'Já existe um Player 2 conectado na sessão.'
        : 'Todos os 4 slots de Co-op estão ocupados no momento.';
      conn.send({ type: 'COOP_RESPONSE', approved: false, reason });
      return;
    }

    // Exibe modal de autorização para o streamer
    if (onPromptCallback) {
      onPromptCallback({
        peerId: senderPeerId,
        requestedSlot: targetSlot,
        approve: (approvedSlot = targetSlot) => {
          const finalSlot = approvedSlot !== undefined ? Number(approvedSlot) : targetSlot;
          const slotGeneration = ++nextCoopSlotGeneration;
          coopSlots.set(finalSlot, {
            slot: finalSlot,
            peerId: senderPeerId,
            conn,
            name: data.name || `Player ${finalSlot + 1}`,
            deviceType: 'gamepad',
            connectedAt: Date.now(),
            generation: slotGeneration
          });

          if (typeof localStorage !== 'undefined' && localStorage.getItem('seemygame_coop_token')) {
            initCompanionAgentConnection();
          }

          const isStillValid = () => {
            if (!isCoopEnabled) return false;
            const current = coopSlots.get(finalSlot);
            return current && current.peerId === senderPeerId && current.generation === slotGeneration;
          };

          const sendApproval = (nativeGamepadReady) => {
            if (!isStillValid()) return;
            conn.send({
              type: 'COOP_RESPONSE',
              approved: true
            });

            conn.send({
              type: 'COOP_CAPABILITIES',
              slot: finalSlot,
              keyboard: finalSlot === 1,
              mouse: Boolean(finalSlot === 1 && isCompanionConnected && companionCapabilities.mouse),
              gamepad: Boolean(nativeGamepadReady || (isCompanionConnected && companionCapabilities.gamepad)),
              browserKeyboardFallback: finalSlot === 1,
              mouseCoordinateSpace: companionCapabilities.mouseCoordinateSpace,
              targetRect: coopInputTargetRect
            });

            showToast(`🎮 Amigo (${senderPeerId.slice(0, 6)}) agora é o Player ${finalSlot + 1}!`, 'success');
            broadcastSlotsUpdate();
            notifyStateChange();
          };

          // A presença do global Tauri não prova que ViGEmBus está instalado.
          // A aprovação só é anunciada após o comando nativo resolver.
          if (isTauriEnvironment()) {
            plugVirtualGamepad(finalSlot)
              .then(() => {
                if (!isStillValid()) {
                  unplugVirtualGamepad(finalSlot).catch(() => {});
                  return;
                }
                sendApproval(true);
              })
              .catch((error) => {
                if (!isStillValid()) return;
                coopSlots.delete(finalSlot);
                conn.send({
                  type: 'COOP_RESPONSE',
                  approved: false,
                  reason: error?.message || 'Gamepad virtual indisponível neste desktop.'
                });
                showToast('Gamepad virtual indisponível: instale/ative o ViGEmBus.', 'error');
                broadcastSlotsUpdate();
                notifyStateChange();
              });
          } else {
            sendApproval(false);
          }
        },
        deny: (reason = 'Solicitação recusada pelo streamer.') => {
          conn.send({ type: 'COOP_RESPONSE', approved: false, reason });
          showToast(`Pedido de Co-op de (${senderPeerId.slice(0, 6)}) recusado.`, 'info');
        }
      });
    }
  }

  // 2. Convidado liberou o controle voluntariamente
  else if (data.type === 'COOP_RELEASE') {
    let slotToRelease = null;
    if (data.slot !== undefined && coopSlots.has(Number(data.slot)) && coopSlots.get(Number(data.slot)).peerId === senderPeerId) {
      slotToRelease = Number(data.slot);
    } else {
      for (const [s, p] of coopSlots.entries()) {
        if (p.peerId === senderPeerId) {
          slotToRelease = s;
          break;
        }
      }
    }
    if (slotToRelease !== null) {
      revokeCoopPlayer(slotToRelease, false);
      showToast(`🎮 Player ${slotToRelease + 1} (${senderPeerId.slice(0, 6)}) liberou os controles.`, 'info');
    }
  }

  // 3. Desconexão de peer
  else if (data.type === 'COOP_PEER_DISCONNECTED') {
    for (const [s, p] of Array.from(coopSlots.entries())) {
      if (p.peerId === senderPeerId) {
        revokeCoopPlayer(s, false);
      }
    }
  }

  // 4. Inputs dos Jogadores (Validação estrita de autorização por slot)
  else {
    const slot = Number(data.slot !== undefined ? data.slot : 1);
    const assignedPlayer = coopSlots.get(slot);

    const isSlotAllowed = (slot === 0 && partyModeEnabled) ||
      (slot === 1) ||
      (maxCoopPlayers > 1 && (slot === 2 || slot === 3));

    if (isSlotAllowed && assignedPlayer && assignedPlayer.peerId === senderPeerId) {
      if (data.type === 'INPUT_KEY') {
        dispatchHostKeyboardInput(data);
      } else if (data.type === 'INPUT_MOUSE') {
        dispatchHostMouseInput(data);
      } else if (data.type === 'INPUT_GAMEPAD') {
        dispatchHostGamepadInput(data);
      } else if (data.type === 'INPUT_RESET') {
        dispatchHostInputReset();
      }
    }
  }
}

/**
 * Revoga autorização de um jogador específico por slot
 */
export function revokeCoopPlayer(slot, notify = true) {
  const targetSlot = Number(slot);
  const player = coopSlots.get(targetSlot);
  if (!player) return;

  if (isTauriEnvironment()) {
    unplugVirtualGamepad(targetSlot).catch(() => {});
  }

  if (notify && player.conn && player.conn.open !== false) {
    try {
      player.conn.send({ type: 'COOP_REVOKE' });
    } catch (e) {}
  }

  coopSlots.delete(targetSlot);

  if (coopSlots.size === 0) {
    closeCompanionAgentConnection();
  }

  if (notify) {
    showToast(`🛑 Controle do Player ${targetSlot + 1} (${player.peerId.slice(0, 6)}) foi revogado.`, 'info');
  }
  broadcastSlotsUpdate();
  notifyStateChange();
}

/**
 * Revoga imediatamente a autorização de todos os jogadores (Botão de Pânico Geral)
 */
export function revokeAllCoopPlayers() {
  for (const slot of Array.from(coopSlots.keys())) {
    revokeCoopPlayer(slot, true);
  }
  if (isTauriEnvironment()) {
    unplugAllVirtualGamepads().catch(() => {});
  }
  dispatchHostInputReset();
  closeCompanionAgentConnection();
  showToast('🛑 Todos os controles de Co-op foram revogados.', 'warning');
}

/**
 * Compatibilidade com chamadas legado de Player 2
 */
export function revokePlayer2() {
  if (coopSlots.has(1)) {
    revokeCoopPlayer(1, true);
  } else {
    revokeAllCoopPlayers();
  }
}

function sendCompanionReset() {
  if (!isCompanionConnected || !companionSocket || companionSocket.readyState !== WebSocket.OPEN) return;
  try {
    companionSocket.send(JSON.stringify({ type: 'INPUT_RESET' }));
  } catch (e) {}
}

function closeCompanionAgentConnection() {
  sendCompanionReset();
  if (companionSocket) {
    try { companionSocket.close(1000, 'Co-op session ended'); } catch (e) {}
  }
  companionSocket = null;
  isCompanionConnected = false;
  notifyStateChange();
}

/**
 * Despacha evento de teclado no host (para jogos web ou agente nativo)
 */
function dispatchHostKeyboardInput(data) {
  // 1. Se o companion Windows estiver aberto, envia para jogos nativos do PC
  if (isCompanionConnected && companionSocket && companionSocket.readyState === WebSocket.OPEN) {
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
    if (data.code) {
      if (data.action === 'down') pressedBrowserKeys.add(data.code);
      else pressedBrowserKeys.delete(data.code);
    }
  } catch (e) {}
}

/**
 * Despacha evento de mouse no host
 */
function dispatchHostMouseInput(data) {
  if (isCompanionConnected && companionSocket && companionSocket.readyState === WebSocket.OPEN) {
    if (!companionCapabilities.mouse) return;
    companionSocket.send(JSON.stringify({ ...data, targetRect: coopInputTargetRect }));
  }
}

/**
 * Despacha estado de Gamepad no host
 */
function dispatchHostGamepadInput(data) {
  // 1. Desktop Tauri: despacha diretamente para o backend nativo ViGEmBus
  if (isTauriEnvironment()) {
    const slot = Number(data.slot) || 1;
    const report = {
      buttons: Array.isArray(data.state?.buttons) ? data.state.buttons : (Array.isArray(data.buttons) ? data.buttons : []),
      triggers: Array.isArray(data.state?.triggers) ? data.state.triggers : (Array.isArray(data.triggers) ? data.triggers : null),
      axes: Array.isArray(data.state?.axes) ? data.state.axes : (Array.isArray(data.axes) ? data.axes : [])
    };
    updateVirtualGamepad(slot, report).catch(() => {});
    return;
  }

  // 2. Companion Agent via WebSocket
  if (isCompanionConnected && companionSocket && companionSocket.readyState === WebSocket.OPEN) {
    if (!companionCapabilities.gamepad) {
      if (!capabilityWarningShown) {
        capabilityWarningShown = true;
        showToast('Este Companion Agent não possui suporte a gamepad virtual.', 'info', 5000);
      }
      return;
    }
    companionSocket.send(JSON.stringify(data));
  }
}

function dispatchHostInputReset() {
  if (isTauriEnvironment()) {
    unplugAllVirtualGamepads().catch(() => {});
  }
  if (isCompanionConnected && companionSocket && companionSocket.readyState === WebSocket.OPEN) {
    try { companionSocket.send(JSON.stringify({ type: 'INPUT_RESET' })); } catch (e) {}
  }
  if (typeof window !== 'undefined') {
    pressedBrowserKeys.forEach((code) => {
      try {
        window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
      } catch (e) {}
    });
  }
  pressedBrowserKeys.clear();
}

// ==========================================
// LADO DO ESPECTADOR (PLAYER 2)
// ==========================================

/**
 * Solicita ao streamer permissão para ser jogador no Co-op (Slot P1 a P4)
 * @param {string} hostPeerId
 * @param {Object} dataConn
 * @param {number|null} preferredSlot
 */
export function requestCoopControl(hostPeerId, dataConn, preferredSlot = null) {
  if (!dataConn || dataConn.open === false) {
    return showToast('Conexão de dados indisponível.', 'error');
  }

  activeHostPeerId = hostPeerId;
  activeDataConn = dataConn;

  const slotLabel = preferredSlot !== null && preferredSlot !== undefined ? `Player ${Number(preferredSlot) + 1}` : 'Co-op';
  showToast(`⏳ Solicitando vaga de ${slotLabel}...`, 'info');
  const payload = { type: 'COOP_REQUEST' };
  if (preferredSlot !== null && preferredSlot !== undefined) {
    payload.preferredSlot = Number(preferredSlot);
  }
  dataConn.send(payload);
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
      myAssignedSlot = Number(data.slot !== undefined ? data.slot : 1);
      isPlayer2 = true;
      activeHostPeerId = hostPeerId;
      showToast(`🎉 Você agora é o Player ${myAssignedSlot + 1}! Use controle ou teclado.`, 'success', 5000);
      attachPlayer2InputListeners(videoCard);
      notifyStateChange();
    } else {
      isPlayer2 = false;
      myAssignedSlot = null;
      showToast(`⚠ Pedido recusado: ${data.reason || 'O streamer não autorizou.'}`, 'error');
      notifyStateChange();
    }
  }

  else if (data.type === 'COOP_REVOKE') {
    if (isPlayer2 && (data.slot === undefined || Number(data.slot) === myAssignedSlot)) {
      releaseCoopControl(false);
      showToast('🛑 O streamer encerrou sua sessão de jogo.', 'info', 5000);
    }
  }

  else if (data.type === 'COOP_SLOTS_UPDATE') {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('coop:slots_update', { detail: data.slots }));
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
          releaseCoopControl(false);
          showToast('🔒 O streamer desativou o modo Co-op.', 'info');
        }
      } else {
        coopBtn.disabled = false;
        coopBtn.classList.remove('btn-disabled');
        coopBtn.title = 'Solicitar ao streamer para jogar no Co-op';
        showToast('🎮 O streamer ativou o modo Co-op!', 'info');
      }
    }
  }

  else if (data.type === 'COOP_CAPABILITIES') {
    if (data.slot !== undefined) {
      myAssignedSlot = Number(data.slot);
    }
    activeHostCapabilities = {
      keyboard: data.keyboard !== false,
      mouse: data.mouse === true,
      gamepad: data.gamepad === true
    };
    if (data.gamepad === false && isPlayer2) {
      showToast('Controle gamepad não disponível neste host; teclado continua disponível.', 'info', 5000);
    }
  }

  else if (data.type === 'GAMEPAD_RUMBLE') {
    if (data.slot === undefined || Number(data.slot) === myAssignedSlot) {
      triggerGamepadRumble(data.strongMagnitude ?? 0.5, data.weakMagnitude ?? 0.5, data.durationMs ?? 200);
    }
  }
}

/**
 * Libera o controle de Co-op voluntariamente
 */
export function releaseCoopControl(notifyHost = true) {
  if (isPlayer2 && activeDataConn && notifyHost) {
    try {
      activeDataConn.send({
        type: 'COOP_RELEASE',
        slot: myAssignedSlot !== null ? myAssignedSlot : 1
      });
    } catch (e) {}
  }
  const releasedSlot = myAssignedSlot;
  isPlayer2 = false;
  myAssignedSlot = null;
  detachPlayer2InputListeners();
  activeHostCapabilities = { keyboard: true, mouse: false, gamepad: false };
  if (releasedSlot !== null) {
    showToast(`Controle de Player ${releasedSlot + 1} liberado.`, 'info');
  } else {
    showToast('Controle liberado.', 'info');
  }
  notifyStateChange();
}

// ==========================================
// CAPTURA DE INPUTS NO ESPECTADOR (P2)
// ==========================================

let attachedCard = null;

function handleKeyDown(e) {
  if (!isPlayer2 || !activeDataConn || !attachedCard) return;

  // A13: Ignora captura de teclas se o usuário estiver digitando no chat ou em campos editáveis
  const target = e.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return;
  }

  // Previne rolagem de página em teclas de jogo comuns se o foco estiver na live
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }

  activeDataConn.send({
    type: 'INPUT_KEY',
    slot: myAssignedSlot !== null ? myAssignedSlot : 1,
    action: 'down',
    key: e.key,
    code: e.code,
    keyCode: e.keyCode
  });
}

function handleKeyUp(e) {
  if (!isPlayer2 || !activeDataConn || !attachedCard) return;
  const target = e.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return;
  }

  activeDataConn.send({
    type: 'INPUT_KEY',
    slot: myAssignedSlot !== null ? myAssignedSlot : 1,
    action: 'up',
    key: e.key,
    code: e.code,
    keyCode: e.keyCode
  });
}

function focusControlWrapper(e) {
  e.currentTarget?.focus?.();
}

function handleControlVisibilityChange() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && isPlayer2 && activeDataConn) {
    try { activeDataConn.send({ type: 'INPUT_RESET' }); } catch (e) {}
  }
}

function handleMouseMove(e) {
  if (!isPlayer2 || !activeDataConn || !attachedCard || activeHostCapabilities.mouse === false) return;

  const video = attachedCard.querySelector('video');
  if (!video) return;

  const rect = video.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  // Coordenadas normalizadas (0.0 a 1.0)
  const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

  activeDataConn.send({
    type: 'INPUT_MOUSE',
    slot: myAssignedSlot !== null ? myAssignedSlot : 1,
    action: 'move',
    x: normX,
    y: normY
  });
}

function handleMouseDown(e) {
  if (!isPlayer2 || !activeDataConn || activeHostCapabilities.mouse === false) return;
  activeDataConn.send({
    type: 'INPUT_MOUSE',
    slot: myAssignedSlot !== null ? myAssignedSlot : 1,
    action: 'down',
    button: e.button
  });
}

function handleMouseUp(e) {
  if (!isPlayer2 || !activeDataConn || activeHostCapabilities.mouse === false) return;
  activeDataConn.send({
    type: 'INPUT_MOUSE',
    slot: myAssignedSlot !== null ? myAssignedSlot : 1,
    action: 'up',
    button: e.button
  });
}

// ==========================================
// REMAPEAMENTO DE BOTÕES DE GAMEPAD
// ==========================================
const DEFAULT_BUTTON_MAP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const NINTENDO_BUTTON_MAP = [1, 0, 3, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

let currentGamepadMapping = [...DEFAULT_BUTTON_MAP];
let currentMappingPreset = 'xbox';

export function loadGamepadMappingFromStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem('seemygame_gamepad_mapping');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.map) && parsed.map.length === 17) {
        currentGamepadMapping = [...parsed.map];
        currentMappingPreset = parsed.preset || 'custom';
      }
    }
  } catch (e) {}
}

export function saveGamepadMappingToStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem('seemygame_gamepad_mapping', JSON.stringify({
      preset: currentMappingPreset,
      map: currentGamepadMapping
    }));
  } catch (e) {}
}

export function getGamepadMapping() {
  return {
    preset: currentMappingPreset,
    map: [...currentGamepadMapping]
  };
}

export function setGamepadMappingPreset(preset) {
  if (preset === 'nintendo') {
    currentGamepadMapping = [...NINTENDO_BUTTON_MAP];
    currentMappingPreset = 'nintendo';
  } else if (preset === 'xbox') {
    currentGamepadMapping = [...DEFAULT_BUTTON_MAP];
    currentMappingPreset = 'xbox';
  } else {
    currentMappingPreset = 'custom';
  }
  saveGamepadMappingToStorage();
  return getGamepadMapping();
}

export function swapGamepadButtons(btnA, btnB) {
  const tmp = currentGamepadMapping[btnA];
  currentGamepadMapping[btnA] = currentGamepadMapping[btnB];
  currentGamepadMapping[btnB] = tmp;
  currentMappingPreset = 'custom';
  saveGamepadMappingToStorage();
  return getGamepadMapping();
}

export function resetGamepadMapping() {
  return setGamepadMappingPreset('xbox');
}

export function applyButtonMapping(rawButtons) {
  if (!Array.isArray(rawButtons)) return [];
  const result = new Array(rawButtons.length).fill(false);
  for (let i = 0; i < rawButtons.length; i++) {
    const mappedTarget = currentGamepadMapping[i] !== undefined ? currentGamepadMapping[i] : i;
    if (rawButtons[i]) {
      result[mappedTarget] = true;
    }
  }
  return result;
}

// Carrega preferências salvas
loadGamepadMappingFromStorage();

function pollGamepads() {
  if (!isPlayer2 || !activeDataConn || activeHostCapabilities.gamepad === false) return;

  try {
    const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[0]; // Captura o primeiro controle conectado

    if (gp && gp.connected) {
      const rawButtons = gp.buttons.map(b => (typeof b === 'object' ? Boolean(b.pressed) : b === 1.0));
      const buttons = applyButtonMapping(rawButtons);
      const leftTrigger = typeof gp.buttons[6] === 'object' ? (gp.buttons[6].value ?? (gp.buttons[6].pressed ? 1.0 : 0.0)) : (buttons[6] ? 1.0 : 0.0);
      const rightTrigger = typeof gp.buttons[7] === 'object' ? (gp.buttons[7].value ?? (gp.buttons[7].pressed ? 1.0 : 0.0)) : (buttons[7] ? 1.0 : 0.0);

      const leftStick = applyRadialDeadzone(gp.axes[0] || 0, gp.axes[1] || 0);
      const rightStick = applyRadialDeadzone(gp.axes[2] || 0, gp.axes[3] || 0);

      const currentState = {
        buttons,
        triggers: [Math.round(leftTrigger * 100) / 100, Math.round(rightTrigger * 100) / 100],
        axes: [leftStick.x, leftStick.y, rightStick.x, rightStick.y]
      };

      // Envia apenas se houver mudanças para economizar canal
      const serialized = JSON.stringify(currentState);
      if (serialized !== lastGamepadState) {
        lastGamepadState = serialized;
        activeDataConn.send({
          type: 'INPUT_GAMEPAD',
          slot: myAssignedSlot !== null ? myAssignedSlot : 1,
          state: currentState
        });
      }
    }
  } catch (e) {}

  gamepadLoopId = requestAnimationFrame(pollGamepads);
}

function attachPlayer2InputListeners(videoCard) {
  if (!videoCard) return;
  detachPlayer2InputListeners();
  attachedCard = videoCard;
  const wrapper = videoCard.querySelector?.('.video-wrapper') || videoCard;
  if (wrapper?.addEventListener) {
    // Input is scoped to the explicitly selected/focused video card. This
    // prevents a chat field or another browser tab control from being
    // captured while the user is Player 2.
    if (typeof wrapper.tabIndex !== 'number' || wrapper.tabIndex < 0) wrapper.tabIndex = 0;
    wrapper.setAttribute?.('aria-label', 'Área de controle do Player 2');
    wrapper.addEventListener('keydown', handleKeyDown);
    wrapper.addEventListener('keyup', handleKeyUp);
    wrapper.addEventListener('mousemove', handleMouseMove);
    wrapper.addEventListener('mousedown', handleMouseDown);
    wrapper.addEventListener('mouseup', handleMouseUp);
    wrapper.addEventListener('pointerdown', focusControlWrapper);
  }

  controlVisibilityTarget = typeof document !== 'undefined' ? document : null;
  controlVisibilityTarget?.addEventListener('visibilitychange', handleControlVisibilityChange);
  window.addEventListener('pagehide', handleControlVisibilityChange);

  // Inicia loop do Gamepad
  cancelAnimationFrame(gamepadLoopId);
  gamepadLoopId = requestAnimationFrame(pollGamepads);
}

function detachPlayer2InputListeners() {
  if (attachedCard) {
    const wrapper = attachedCard.querySelector?.('.video-wrapper') || attachedCard;
    wrapper.removeEventListener?.('keydown', handleKeyDown);
    wrapper.removeEventListener?.('keyup', handleKeyUp);
    wrapper.removeEventListener?.('mousemove', handleMouseMove);
    wrapper.removeEventListener?.('mousedown', handleMouseDown);
    wrapper.removeEventListener?.('mouseup', handleMouseUp);
    wrapper.removeEventListener?.('pointerdown', focusControlWrapper);
    attachedCard = null;
  }

  controlVisibilityTarget?.removeEventListener?.('visibilitychange', handleControlVisibilityChange);
  window.removeEventListener('pagehide', handleControlVisibilityChange);
  controlVisibilityTarget = null;

  dispatchHostInputReset();
  cancelAnimationFrame(gamepadLoopId);
  gamepadLoopId = null;
  lastGamepadState = null;
}

/**
 * Inicializa os controles e HUD interativo do Modal de Calibração de Gamepad
 */
export function setupGamepadTesterModal() {
  if (typeof document === 'undefined') return;

  const openBtn = document.getElementById('open-gamepad-tester-btn');
  const modal = document.getElementById('gamepad-tester-modal');
  const closeBtn = document.getElementById('close-gamepad-tester-btn');
  const doneBtn = document.getElementById('done-gamepad-tester-btn');
  const testRumbleBtn = document.getElementById('test-rumble-btn');
  const select = document.getElementById('gamepad-select');
  const sticksLabel = document.getElementById('gamepad-sticks-label');
  const triggersLabel = document.getElementById('gamepad-triggers-label');
  const buttonsLabel = document.getElementById('gamepad-buttons-label');
  const statusBox = document.getElementById('gamepad-driver-status-box');
  const statusText = document.getElementById('gamepad-driver-status-text');
  const presetSelect = document.getElementById('gamepad-mapping-preset');
  const swapAbBtn = document.getElementById('swap-ab-btn');
  const swapXyBtn = document.getElementById('swap-xy-btn');
  const resetMappingBtn = document.getElementById('reset-mapping-btn');
  const mappingStatus = document.getElementById('gamepad-mapping-status');

  if (!modal) return;

  let animId = null;

  const updateMappingUI = () => {
    if (presetSelect) presetSelect.value = currentMappingPreset;
    if (mappingStatus) {
      const label = currentMappingPreset === 'xbox' ? 'Padrão Xbox / PC'
        : currentMappingPreset === 'nintendo' ? 'Nintendo Switch (A↔B, X↔Y)'
        : 'Personalizado';
      mappingStatus.textContent = `Layout ativo: ${label}`;
    }
  };

  presetSelect?.addEventListener('change', (e) => {
    setGamepadMappingPreset(e.target.value);
    updateMappingUI();
  });

  swapAbBtn?.addEventListener('click', () => {
    swapGamepadButtons(0, 1);
    updateMappingUI();
    showToast('🔄 Botões A e B invertidos!', 'info');
  });

  swapXyBtn?.addEventListener('click', () => {
    swapGamepadButtons(2, 3);
    updateMappingUI();
    showToast('🔄 Botões X e Y invertidos!', 'info');
  });

  resetMappingBtn?.addEventListener('click', () => {
    resetGamepadMapping();
    updateMappingUI();
    showToast('Layout de botões restaurado para o padrão Xbox.', 'info');
  });

  const updateDriverStatus = async () => {
    if (!statusText || !statusBox) return;
    if (isTauriEnvironment()) {
      try {
        const status = await checkVirtualGamepadDriver();
        if (status?.vigem_available) {
          statusText.textContent = '🟢 Driver ViGEmBus: Ativo e pronto no Windows';
          statusBox.style.background = 'rgba(16, 185, 129, 0.1)';
          statusBox.style.color = '#10b981';
        } else {
          statusText.innerHTML = '🟡 Driver ViGEmBus não detectado. <button id="install-vigem-btn" style="margin-left: 8px; padding: 2px 8px; font-size: 11px; background: #eab308; color: #000; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Instalar com 1 Clique</button>';
          statusBox.style.background = 'rgba(234, 179, 8, 0.1)';
          statusBox.style.color = '#eab308';

          const btn = document.getElementById('install-vigem-btn');
          if (btn) {
            btn.onclick = async () => {
              btn.disabled = true;
              btn.textContent = 'Instalando...';
              showToast('Iniciando instalação oficial do ViGEmBus... Confirme a janela UAC do Windows.', 'info', 6000);
              try {
                const res = await installViGEmDriver();
                showToast(res || 'Instalação concluída com sucesso!', 'success');
              } catch (err) {
                showToast(`Falha na instalação: ${err?.message || err}`, 'error');
              } finally {
                await updateDriverStatus();
              }
            };
          }
        }
      } catch (e) {
        statusText.textContent = '⚪ Modo Web P2P (Companion Agent opcional)';
      }
    } else {
      statusText.textContent = isCompanionConnected && companionCapabilities.gamepad
        ? '🟢 Companion Agent: Suporte a gamepad virtual ativo'
        : '⚪ Modo Web Convidado / Companion Agent opcional para host';
    }
  };

  const updateHud = () => {
    const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const connectedPads = Array.from(gamepads).filter(Boolean);

    if (select) {
      const currentVal = select.value;
      select.innerHTML = '';
      if (connectedPads.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Nenhum controle detectado (pressione qualquer botão)';
        select.appendChild(opt);
      } else {
        connectedPads.forEach((gp) => {
          const opt = document.createElement('option');
          opt.value = String(gp.index);
          opt.textContent = `#${gp.index}: ${gp.id}`;
          if (String(gp.index) === currentVal) opt.selected = true;
          select.appendChild(opt);
        });
      }
    }

    const selectedIdx = select && select.value !== '' ? Number(select.value) : 0;
    const gp = gamepads[selectedIdx];

    if (gp && gp.connected) {
      const lx = (gp.axes[0] || 0).toFixed(2);
      const ly = (gp.axes[1] || 0).toFixed(2);
      const rx = (gp.axes[2] || 0).toFixed(2);
      const ry = (gp.axes[3] || 0).toFixed(2);
      if (sticksLabel) sticksLabel.textContent = `L: (${lx}, ${ly}) | R: (${rx}, ${ry})`;

      const ltVal = typeof gp.buttons[6] === 'object' ? Math.round((gp.buttons[6].value || 0) * 100) : (gp.buttons[6] ? 100 : 0);
      const rtVal = typeof gp.buttons[7] === 'object' ? Math.round((gp.buttons[7].value || 0) * 100) : (gp.buttons[7] ? 100 : 0);
      if (triggersLabel) triggersLabel.textContent = `LT: ${ltVal}% | RT: ${rtVal}%`;

      const pressed = [];
      const btnNames = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right', 'Guide'];
      const rawButtons = gp.buttons.map(b => (typeof b === 'object' ? Boolean(b.pressed) : b === 1.0));
      const mappedButtons = applyButtonMapping(rawButtons);
      mappedButtons.forEach((isPressed, i) => {
        if (isPressed) {
          const physicalIdx = currentGamepadMapping.indexOf(i);
          if (physicalIdx !== -1 && physicalIdx !== i) {
            pressed.push(`${btnNames[i] || `B${i}`} (Físico: ${btnNames[physicalIdx] || `B${physicalIdx}`})`);
          } else {
            pressed.push(btnNames[i] || `B${i}`);
          }
        }
      });
      if (buttonsLabel) buttonsLabel.textContent = pressed.length > 0 ? pressed.join(', ') : 'Nenhum';
    }

    if (modal.style.display !== 'none') {
      animId = requestAnimationFrame(updateHud);
    }
  };

  const openModal = () => {
    modal.style.display = 'flex';
    updateDriverStatus();
    updateMappingUI();
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animId);
    if (typeof requestAnimationFrame !== 'undefined') animId = requestAnimationFrame(updateHud);
  };

  const closeModal = () => {
    modal.style.display = 'none';
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animId);
  };

  openBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  doneBtn?.addEventListener('click', closeModal);

  testRumbleBtn?.addEventListener('click', () => {
    const selectedIdx = select && select.value !== '' ? Number(select.value) : 0;
    const ok = triggerGamepadRumble(0.8, 0.8, 300, selectedIdx);
    if (!ok) {
      showToast('Seu controle ou navegador não possui suporte a vibração.', 'info');
    } else {
      showToast('📳 Sinal de vibração enviado ao controle!', 'success');
    }
  });
}
