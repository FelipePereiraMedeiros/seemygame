/** native-signaling: commands receive explicit compatibility ports; no page initialization. */
export function waitForDirectIceGathering(compatibilityContext, peerConnection, timeoutMs = 1500) {
  if (!peerConnection || peerConnection.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peerConnection.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (peerConnection.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    peerConnection.addEventListener('icegatheringstatechange', onChange);
  });
}

export async function handleStartDirectStream(compatibilityContext, data, conn) {
  const hostId = conn.peer;
  console.log(`[DirectStream] Recebido START_DIRECT_STREAM de ${hostId}`);

  // Limpa chamadas ou conexões anteriores com esse host
  const prevDirect = compatibilityContext.directViewerPeerConnections.get(hostId);
  if (prevDirect) {
    const isAlive = ['new', 'connecting', 'connected'].includes(prevDirect.connectionState) && prevDirect.signalingState !== 'closed';
    if (isAlive) {
      console.log(`[DirectStream] RTCPeerConnection já ativa para ${hostId} (state=${prevDirect.connectionState}), ignorando START_DIRECT_STREAM duplicado.`);
      return;
    }
    try { prevDirect.close(); } catch (e) {}
    compatibilityContext.directViewerPeerConnections.delete(hostId);
  }
  const prevCall = compatibilityContext.activeMediaCalls.get(hostId);
  if (prevCall) {
    try { prevCall.close(); } catch (e) {}
    compatibilityContext.activeMediaCalls.delete(hostId);
  }
  const hostCall = compatibilityContext.watchingHosts.get(hostId)?.call;
  if (hostCall) {
    try { hostCall.close(); } catch (e) {}
    if (compatibilityContext.watchingHosts.get(hostId)) compatibilityContext.watchingHosts.get(hostId).call = null;
  }

  const hostData = compatibilityContext.watchingHosts.get(hostId);
  if (hostData) {
    hostData.state = 'CONNECTED';
    if (hostData.timeoutTimer) {
      clearTimeout(hostData.timeoutTimer);
      hostData.timeoutTimer = null;
    }
  } else {
    compatibilityContext.watchingHosts.set(hostId, {
      state: 'CONNECTED',
      conn: conn || (compatibilityContext.roomManager && compatibilityContext.roomManager.meshConnections.get(hostId)) || null,
      call: null,
      timeoutTimer: null
    });
  }

  const peerConfig = compatibilityContext.getPeerConfig();
  const iceServers = peerConfig?.config?.iceServers || [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  const pc = new RTCPeerConnection({ iceServers });
  compatibilityContext.directViewerPeerConnections.set(hostId, pc);
  compatibilityContext.directPendingCandidates.set(hostId, []);

  const videoTargetMs = 25;
  const videoTargetSec = 0;
  const videoTransceiver = pc.addTransceiver('video', { direction: 'recvonly' });
  if (videoTransceiver?.receiver) {
    if ('jitterBufferTarget' in videoTransceiver.receiver) videoTransceiver.receiver.jitterBufferTarget = videoTargetMs;
    if ('playoutDelayHint' in videoTransceiver.receiver) videoTransceiver.receiver.playoutDelayHint = videoTargetSec;
  }
  if (data.hasAudio) {
    const audioTransceiver = pc.addTransceiver('audio', { direction: 'recvonly' });
    if (audioTransceiver?.receiver) {
      if ('jitterBufferTarget' in audioTransceiver.receiver) audioTransceiver.receiver.jitterBufferTarget = 20;
      if ('playoutDelayHint' in audioTransceiver.receiver) audioTransceiver.receiver.playoutDelayHint = 0;
    }
  }

  const remoteStream = new MediaStream();
  let cardInitialized = false;

  pc.ontrack = (event) => {
    console.log(`[DirectStream] Trilha recebida de ${hostId}: kind=${event.track?.kind}`);
    const track = event.track;
    if (track) {
      if (track.kind === 'video') {
        track.contentHint = 'motion';
      }
      if (!remoteStream.getTracks().includes(track)) {
        remoteStream.addTrack(track);
      }
    }
    if (event.receiver) {
      try {
        const target = event.track?.kind === 'video' ? 25 : 20;
        if ('jitterBufferTarget' in event.receiver) event.receiver.jitterBufferTarget = target;
        if ('playoutDelayHint' in event.receiver) event.receiver.playoutDelayHint = 0;
      } catch (_) {}
    }

    compatibilityContext.hideCardLoading(hostId);
    compatibilityContext.setCardStreamPaused(hostId, false);

    if (compatibilityContext.discordUI) {
      compatibilityContext.discordUI.syncStageView(true);
    }

    if (compatibilityContext.directClipStartTimers.has(hostId)) {
      clearTimeout(compatibilityContext.directClipStartTimers.get(hostId));
    }
    const clipTimer = setTimeout(() => {
      compatibilityContext.directClipStartTimers.delete(hostId);
      if (!compatibilityContext.clipRecorder.isRecordingFor(hostId)) {
        compatibilityContext.clipRecorder.start(remoteStream, hostId);
      }
    }, 150);
    compatibilityContext.directClipStartTimers.set(hostId, clipTimer);

    const reactionsDock = document.getElementById('reactions-dock');
    if (reactionsDock) reactionsDock.style.display = 'flex';

    if (!cardInitialized) {
      cardInitialized = true;
      compatibilityContext.addOrUpdateVideoCard({
        stream: remoteStream,
        peerId: hostId,
        label: `🎮 Tela de ${hostId.slice(0, 6)}`,
        isLocal: false,
        onDisconnect: () => compatibilityContext.disconnectHost(hostId),
        onCoopClick: (hId) => {
          const state = compatibilityContext.getCoopState();
          if (state.isPlayer2) {
            compatibilityContext.releaseCoopControl();
          } else {
            compatibilityContext.requestCoopControl(hId, conn || compatibilityContext.watchingHosts.get(hId)?.conn);
          }
        }
      });

      compatibilityContext.applyTransceiverOptimizations(pc, 'smooth');
      compatibilityContext.startStatsMonitor(hostId, pc, false);
      compatibilityContext.showToast(`Transmissão direta de ${hostId.slice(0, 6)} conectada em alta fluidez!`, 'success');
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && event.candidate.candidate) {
      try {
        conn.send({
          type: 'DIRECT_STREAM_ICE_CANDIDATE',
          candidate: event.candidate.candidate,
          mlineIndex: event.candidate.sdpMLineIndex ?? 0
        });
      } catch (e) {}
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[DirectStream] ConnectionState com ${hostId}: ${pc.connectionState}`);
    if (['failed', 'closed'].includes(pc.connectionState)) {
      compatibilityContext.stopStatsMonitor(hostId);
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await compatibilityContext.waitForDirectIceGathering(pc, 1500);

    const localSdp = pc.localDescription?.sdp || offer.sdp;
    conn.send({
      type: 'DIRECT_STREAM_OFFER',
      sessionId: data.sessionId,
      sdp: localSdp
    });
  } catch (err) {
    console.error('[DirectStream] Falha ao gerar oferta SDP do espectador:', err);
    compatibilityContext.showToast('Erro ao iniciar recepção do stream direto', 'error');
  }
}

export async function handleDirectStreamOffer(compatibilityContext, data, conn) {
  const viewerId = conn.peer;
  console.log(`[DirectStream] Recebido DIRECT_STREAM_OFFER de ${viewerId} (${data.sdp?.length} bytes)`);
  if (!compatibilityContext.activeNativeCaptureProvider?.session?.sessionId) {
    console.warn('[DirectStream] Host não possui sessão nativa ativa para responder oferta.');
    compatibilityContext.activeDirectSignaling.delete(viewerId);
    return;
  }
  if (compatibilityContext.processingDirectOffers.has(viewerId)) {
    console.warn(`[DirectStream] Ignorando oferta duplicada já em processamento para espectador: ${viewerId}`);
    return;
  }
  compatibilityContext.processingDirectOffers.add(viewerId);
  const sessionId = compatibilityContext.activeNativeCaptureProvider.session.sessionId;
  try {
    const peerConfig = compatibilityContext.getPeerConfig();
    const iceServers = peerConfig?.config?.iceServers || [];
    const iceUris = [];
    for (const s of iceServers) {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls || s.url];
      for (const u of urls) {
        if (!u) continue;
        if (u.startsWith('turn:') || u.startsWith('turns:')) {
          if (s.username && s.credential) {
            const proto = u.startsWith('turns:') ? 'turns' : 'turn';
            const hostPort = u.replace(/^turns?:/, '').replace(/^\/\//, '');
            iceUris.push(`${proto}://${encodeURIComponent(s.username)}:${encodeURIComponent(s.credential)}@${hostPort}`);
          } else {
            iceUris.push(u);
          }
        } else {
          iceUris.push(u);
        }
      }
    }
    const answer = await compatibilityContext.createNativeViewerPeer(sessionId, viewerId, data.sdp, iceUris.length ? iceUris : null);
    compatibilityContext.activeNativeViewerPeers.add(viewerId);
    compatibilityContext.activeDirectSignaling.delete(viewerId);
    console.log(`[DirectStream] Resposta SDP gerada para ${viewerId} (${answer?.sdp?.length} bytes)`);
    conn.send({
      type: 'DIRECT_STREAM_ANSWER',
      sdp: answer.sdp
    });
  } catch (err) {
    compatibilityContext.activeDirectSignaling.delete(viewerId);
    console.error(`[DirectStream] Erro ao criar peer nativo para espectador ${viewerId}:`, err);
  } finally {
    compatibilityContext.processingDirectOffers.delete(viewerId);
  }
}

export async function handleDirectStreamAnswer(compatibilityContext, data, conn) {
  const hostId = conn.peer;
  console.log(`[DirectStream] Recebido DIRECT_STREAM_ANSWER de ${hostId} (${data.sdp?.length} bytes)`);
  const pc = compatibilityContext.directViewerPeerConnections.get(hostId);
  if (!pc) {
    console.warn(`[DirectStream] Nenhuma RTCPeerConnection encontrada para host ${hostId}`);
    return;
  }
  if (pc.signalingState !== 'have-local-offer') {
    console.log(`[DirectStream] Ignorando DIRECT_STREAM_ANSWER para ${hostId} (signalingState atual: ${pc.signalingState})`);
    return;
  }
  try {
    await pc.setRemoteDescription({
      type: 'answer',
      sdp: data.sdp
    });

    try {
      const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
      const hasAudio = transceivers.some(t => 
        (t.receiver?.track?.kind === 'audio') || 
        (t.sender?.track?.kind === 'audio') || 
        (t.mid && t.mid.toLowerCase().includes('audio'))
      );
      for (const t of transceivers) {
        if (t?.receiver) {
          const isAudio = (t.receiver?.track?.kind === 'audio') || (t.sender?.track?.kind === 'audio') || (t.mid && t.mid.toLowerCase().includes('audio'));
          const targetMs = 0;
          const targetSec = 0;
          if ('jitterBufferTarget' in t.receiver) t.receiver.jitterBufferTarget = targetMs;
          if ('playoutDelayHint' in t.receiver) t.receiver.playoutDelayHint = targetSec;
        }
      }
    } catch (_) {}

    const pending = compatibilityContext.directPendingCandidates.get(hostId) || [];
    compatibilityContext.directPendingCandidates.delete(hostId);
    for (const cand of pending) {
      try {
        await pc.addIceCandidate(cand);
      } catch (e) {
        console.warn('[DirectStream] Erro ao aplicar candidato ICE retido:', e);
      }
    }
  } catch (err) {
    console.error(`[DirectStream] Falha ao aplicar remoteDescription da resposta de ${hostId}:`, err);
  }
}

export async function handleDirectStreamIceCandidate(compatibilityContext, data, conn) {
  const peerId = conn.peer;
  if (compatibilityContext.isDesktopApp() && compatibilityContext.activeNativeCaptureProvider?.session?.sessionId) {
    // No Host: repassa candidato do espectador para a ponte Rust
    const sessionId = compatibilityContext.activeNativeCaptureProvider.session.sessionId;
    try {
      await compatibilityContext.addNativeViewerIceCandidate(sessionId, peerId, data.mlineIndex, data.candidate);
    } catch (err) {
      console.warn(`[DirectStream] Falha ao adicionar candidato ICE do espectador ${peerId}:`, err);
    }
  } else {
    // No Espectador: repassa candidato recebido do Host para RTCPeerConnection
    const pc = compatibilityContext.directViewerPeerConnections.get(peerId);
    if (!pc) return;
    const candidateInit = {
      candidate: data.candidate,
      sdpMid: null,
      sdpMLineIndex: Number(data.mlineIndex ?? 0)
    };
    if (pc.remoteDescription && pc.remoteDescription.type) {
      try {
        await pc.addIceCandidate(candidateInit);
      } catch (e) {
        console.warn('[DirectStream] Erro ao adicionar candidato ICE do host:', e);
      }
    } else {
      const pending = compatibilityContext.directPendingCandidates.get(peerId);
      if (pending) {
        pending.push(candidateInit);
      }
    }
  }
}

export function handleDirectStreamSignaling(compatibilityContext, data, conn) {
  if (!data || typeof data !== 'object') return false;
  switch (data.type) {
    case 'START_DIRECT_STREAM':
      compatibilityContext.handleStartDirectStream(data, conn);
      return true;
    case 'DIRECT_STREAM_OFFER':
      compatibilityContext.handleDirectStreamOffer(data, conn);
      return true;
    case 'DIRECT_STREAM_ANSWER':
      compatibilityContext.handleDirectStreamAnswer(data, conn);
      return true;
    case 'DIRECT_STREAM_ICE_CANDIDATE':
      compatibilityContext.handleDirectStreamIceCandidate(data, conn);
      return true;
    default:
      return false;
  }
}

export async function setupNativeBridgeListener(compatibilityContext) {
  if (!compatibilityContext.isDesktopApp() || compatibilityContext.unlistenNativeBridge) return;
  compatibilityContext.unlistenNativeBridge = await compatibilityContext.listenNativeCaptureBridge((event) => {
    if (!event) return;
    const viewerId = event.peerId || event.peer_id;
    if (!viewerId) return; // ignora candidatos da ponte local
    if (event.event !== 'ice-candidate' || !event.candidate) return;
    console.log(`[DirectStream Bridge] Candidato ICE para espectador ${viewerId}: ${event.candidate}`);
    const conn = compatibilityContext.connectedViewers.get(viewerId) || (compatibilityContext.roomManager && compatibilityContext.roomManager.meshConnections.get(viewerId));
    if (conn && conn.open) {
      try {
        conn.send({
          type: 'DIRECT_STREAM_ICE_CANDIDATE',
          candidate: event.candidate,
          mlineIndex: Number(event.mlineIndex ?? event.mline_index ?? 0)
        });
      } catch (e) {}
    }
  });
}
