/** subscriptions: commands receive explicit compatibility ports; no page initialization. */
export function watchFriend(compatibilityContext, rawTargetId) {
  let targetId = rawTargetId ? String(rawTargetId).trim() : '';
  
  if (targetId.includes('#watch=')) {
    targetId = targetId.split('#watch=')[1].split('&')[0];
  } else if (targetId.includes('watch=')) {
    const urlParams = new URLSearchParams(targetId.split('?')[1] || targetId);
    targetId = urlParams.get('watch') || targetId;
  }

  // Validação estrita de formato e tamanho
  if (!compatibilityContext.isValidPeerId(targetId)) {
    return compatibilityContext.showToast('Por favor, insira um ID válido.', 'error');
  }

  if (targetId === compatibilityContext.myId) {
    return compatibilityContext.showToast('Você não pode assistir ao seu próprio ID.', 'error');
  }

  // Bloqueio contra conexão repetida
  const existingHost = compatibilityContext.watchingHosts.get(targetId);
  if (existingHost && (existingHost.state === 'CONNECTING' || existingHost.state === 'CONNECTED')) {
    return compatibilityContext.showToast(`Você já está conectado ou conectando a ${targetId.slice(0, 6)}.`, 'info');
  }

  compatibilityContext.showToast(`Conectando a ${targetId.slice(0, 6)}...`, 'info');
  compatibilityContext.createPlaceholderCard(targetId, `Conectando a ${targetId.slice(0, 6)}...`, () => compatibilityContext.disconnectHost(targetId));

  const hostEntry = {
    state: 'CONNECTING',
    conn: null,
    call: null,
    timeoutTimer: null
  };
  compatibilityContext.watchingHosts.set(targetId, hostEntry);

  if (!compatibilityContext.peer) {
    compatibilityContext.initPeer();
  }

  const existingConn = (compatibilityContext.roomManager && (compatibilityContext.roomManager.meshConnections.get(targetId) || compatibilityContext.roomManager.pendingConnections.get(targetId))) || compatibilityContext.connectedViewers.get(targetId);
  const conn = (existingConn && !existingConn.destroyed) ? existingConn : compatibilityContext.peer.connect(targetId, { reliable: true });
  hostEntry.conn = conn;

  // Timeout de conexão pendente (15s)
  hostEntry.timeoutTimer = setTimeout(() => {
    if (hostEntry.state === 'CONNECTING') {
      compatibilityContext.showToast(`Tempo de conexão esgotado ao tentar conectar com ${targetId.slice(0, 6)}.`, 'error');
      compatibilityContext.disconnectHost(targetId);
    }
  }, 15000);

  const handleOpen = () => {
    // Se foi cancelado antes do open, aborta imediatamente
    if (hostEntry.state === 'CANCELLED') {
      conn.close();
      return;
    }

    hostEntry.state = 'CONNECTED';
    if (hostEntry.timeoutTimer) {
      clearTimeout(hostEntry.timeoutTimer);
      hostEntry.timeoutTimer = null;
    }

    try {
      conn.send({ type: 'REQUEST_STREAM' });
      compatibilityContext.showToast(`Conectado a ${targetId.slice(0, 6)}! Aguardando stream...`, 'info');
    } catch (e) {
      console.warn(`[watchFriend] Falha ao enviar REQUEST_STREAM para ${targetId}:`, e);
    }
  };

  if (conn.open) {
    handleOpen();
  } else {
    conn.on('open', handleOpen);
  }

  if (conn._smg_watch_bound) {
    return;
  }
  conn._smg_watch_bound = true;

  conn.on('data', (data) => {
    if (!data || typeof data !== 'object') return;

    if (!conn._smg_direct_signaling_bound && compatibilityContext.handleDirectStreamSignaling(data, conn)) {
      return;
    }

    if (data.type === 'PIN_REQUIRED') {
      compatibilityContext.promptViewerPin(targetId, data.error);
      return;
    }

    if (data.type === 'PIN_ACCEPTED') {
      compatibilityContext.hideViewerPinModal();
      compatibilityContext.showToast('PIN correto! Conectando à transmissão...', 'success');
      return;
    }

    if (data.type === 'CHAT_MESSAGE' || data.type === 'VOICE_STATE_UPDATE' || data.type === 'VOICE_SIGNAL' ||
        data.type === 'TACTICAL_PING' || data.type === 'TACTICAL_LASER' || data.type === 'EMOJI_REACTION' || data.type === 'SOUNDBOARD_PLAY' ||
        (data.type && data.type.startsWith('WHITEBOARD_'))) {
      compatibilityContext.handleIncomingP2PMessage(data, conn);
      return;
    }

    if (data.type === 'STREAM_STATUS') {
      if (!data.isStreaming) {
        compatibilityContext.updateCardStatus(targetId, 'Amigo conectado! Aguardando ele iniciar o jogo...');
        compatibilityContext.showToast('Amigo está online, aguardando início da transmissão.', 'info');
      } else {
        compatibilityContext.updateCardStatus(targetId, 'Sincronizando stream em tempo real...');
      }
    } else if (data.type === 'STREAM_STOPPED') {
      if (compatibilityContext.isRoomMode()) {
        compatibilityContext.disconnectHost(targetId);
        return;
      }
      compatibilityContext.showToast('O amigo pausou a transmissão.', 'info');
      compatibilityContext.setCardStreamPaused(targetId, true, 'Transmissão pausada pelo streamer.');
      const directPc = compatibilityContext.directViewerPeerConnections.get(targetId);
      if (directPc) {
        try { directPc.close(); } catch (e) {}
        compatibilityContext.directViewerPeerConnections.delete(targetId);
        compatibilityContext.directPendingCandidates.delete(targetId);
      }
      compatibilityContext.stopStatsMonitor(targetId);
    } else if (data.type === 'STREAM_REJECTED') {
      compatibilityContext.showToast(`Conexão recusada: ${data.reason || 'Sala cheia'}`, 'error');
      compatibilityContext.disconnectHost(targetId);
    } else if (data.type && data.type.startsWith('COOP_')) {
      const card = document.getElementById(`card-${targetId}`);
      compatibilityContext.handleViewerCoopMessage(data, targetId, card);
    } else if (data.type === 'STREAM_CONFIG_UPDATED') {
      if (data.audioMode) {
        const audioLabels = {
          system: 'Áudio do Jogo',
          mic: 'Microfone do Transmissor',
          none: 'Apenas Vídeo (Mudo)'
        };
        const label = audioLabels[data.audioMode] || data.audioMode;
        compatibilityContext.showToast(`Fonte de áudio da transmissão: ${label}`, 'info');
      }
      // Ajustes automáticos do ABR são transparentes e não devem floodar o espectador com toasts
      if (!data.isAutomatic && (data.preset || data.bitrate)) {
        const mbps = data.bitrate ? `${(data.bitrate / 1000000).toFixed(1)} Mbps` : '';
        const res = data.height ? `${data.height}p` : '';
        const info = [res, mbps].filter(Boolean).join(' • ');
        const prevInfo = compatibilityContext.lastShownQualityPerHost.get(targetId);
        if (info && info !== prevInfo) {
          compatibilityContext.lastShownQualityPerHost.set(targetId, info);
          compatibilityContext.showToast(`Qualidade ajustada pelo streamer: ${info}`, 'info');
        }
      }
    }
  });

  conn.on('close', () => {
    const directPc = compatibilityContext.directViewerPeerConnections.get(targetId);
    if (directPc) {
      try { directPc.close(); } catch (e) {}
      compatibilityContext.directViewerPeerConnections.delete(targetId);
      compatibilityContext.directPendingCandidates.delete(targetId);
    }
    const coopState = compatibilityContext.getCoopState();
    if (coopState.isPlayer2 && coopState.activeHostPeerId === targetId) {
      compatibilityContext.releaseCoopControl();
    }
    compatibilityContext.showToast(`Conexão com ${targetId.slice(0, 6)} encerrada.`, 'info');
    compatibilityContext.removeVideoCard(targetId);
    compatibilityContext.watchingHosts.delete(targetId);
    compatibilityContext.stopStatsMonitor(targetId);
  });

  conn.on('error', (err) => {
    console.error(`Erro de conexão com host ${targetId}:`, err);
    compatibilityContext.showToast(`Falha ao conectar: ${err.message || 'Amigo indisponível'}`, 'error');
    compatibilityContext.disconnectHost(targetId);
  });
}

export function disconnectHost(compatibilityContext, peerId) {
  if (compatibilityContext.currentPinTargetId === peerId) {
    compatibilityContext.hideViewerPinModal();
  }

  // Se o espectador era Player 2 deste host, libera os controles
  const coopState = compatibilityContext.getCoopState();
  if (coopState.isPlayer2 && coopState.activeHostPeerId === peerId) {
    compatibilityContext.releaseCoopControl();
  }

  const hostData = compatibilityContext.watchingHosts.get(peerId);
  if (hostData) {
    hostData.state = 'CANCELLED';
    if (hostData.timeoutTimer) {
      clearTimeout(hostData.timeoutTimer);
      hostData.timeoutTimer = null;
    }
    if (hostData.conn && !(compatibilityContext.isRoomMode() && compatibilityContext.roomManager && compatibilityContext.roomManager.meshConnections.get(peerId) === hostData.conn)) {
      try {
        hostData.conn.close();
      } catch (e) {}
    }
  }

  const directPc = compatibilityContext.directViewerPeerConnections.get(peerId);
  if (directPc) {
    try {
      directPc.close();
    } catch (e) {}
    compatibilityContext.directViewerPeerConnections.delete(peerId);
    compatibilityContext.directPendingCandidates.delete(peerId);
  }

  const mediaCall = compatibilityContext.activeMediaCalls.get(peerId);
  if (mediaCall) {
    try {
      mediaCall.close();
    } catch (e) {}
    compatibilityContext.activeMediaCalls.delete(peerId);
  }

  compatibilityContext.watchingHosts.delete(peerId);
  compatibilityContext.clipRecorder.stop(peerId);
  compatibilityContext.removeVideoCard(peerId);
  compatibilityContext.stopStatsMonitor(peerId);
  compatibilityContext.showToast(`Desconectado de ${peerId.slice(0, 6)}.`, 'info');
}
