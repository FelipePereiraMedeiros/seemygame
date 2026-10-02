import { BasePlugin } from './base-plugin.js';
import { getPeerConfig } from '../config.js';
import { createNativeViewerPeer, closeNativeViewerPeer, addNativeViewerIceCandidate, listenNativeCaptureBridge, isDesktopApp } from '../desktop.js';
import { sendSessionMessage } from '../protocol/transport.js';
import { addOrUpdateVideoCard, removeVideoCard } from '../ui.js';
import { startStatsMonitor, stopStatsMonitor } from '../stats.js';
import { getNativeStreamStats } from '../desktop/webrtc.js';
import { applyTransceiverOptimizations } from '../webrtc.js';

/** Direct GStreamer transport. State belongs to this session, separate from PeerJS calls. */
export class NativeMediaPlugin extends BasePlugin {
  constructor({ session, getProvider, isAuthorized, onClip } = {}) {
    super('native-media');
    this.session = session; this.getProvider = getProvider; this.isAuthorized = isAuthorized; this.onClip = onClip;
    this.receivers = new Map(); this.senders = new Map(); this.negotiating = new Set();
  }
  setupListeners() {
    const handlers = {
      START_DIRECT_STREAM: (data, conn) => this.receive(data, conn),
      DIRECT_STREAM_OFFER: (data, conn) => this.answer(data, conn),
      DIRECT_STREAM_STOP: (_data, conn) => this.closeReceiver(conn.peer),
      DIRECT_STREAM_ANSWER: async (data, conn) => {
        const receiver = this.receivers.get(conn.peer);
        if (!receiver || typeof data.sdp !== 'string') return;
        await receiver.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        for (const candidate of receiver.pending.splice(0)) await receiver.pc.addIceCandidate(candidate);
      },
      DIRECT_STREAM_ICE_CANDIDATE: async (data, conn) => {
        if (typeof data.candidate !== 'string' || data.candidate.length > 8192) return;
        const sessionId = this.senders.get(conn.peer);
        if (sessionId) return addNativeViewerIceCandidate(sessionId, conn.peer, Number(data.mlineIndex || 0), data.candidate);
        const receiver = this.receivers.get(conn.peer);
        if (!receiver) return;
        const candidate = { candidate: data.candidate, sdpMLineIndex: Number(data.mlineIndex || 0) };
        if (receiver.pc.remoteDescription) await receiver.pc.addIceCandidate(candidate);
        else if (receiver.pending.length < 256) receiver.pending.push(candidate);
      }
    };
    for (const [type, handler] of Object.entries(handlers)) this.registerCleanup(this.context.dispatcher.register(type, (data, conn) => {
      if (this.session.isDisposed || !conn || !this.isAuthorized(conn.peer)) return;
      return handler(data, conn);
    }));
    this.registerCleanup(this.context.eventBus.on('stream:stopped', ({ sourceId } = {}) => {
      if (!sourceId || sourceId === 'local-me') return this.stopSending();
      this.closeReceiver(sourceId);
    }));
    for (const event of ['viewer:disconnected', 'room:memberLeft', 'streamer:viewerDisconnected']) {
      this.registerCleanup(this.context.eventBus.on(event, async data => {
        const id = data?.peerId || data?.streamerId;
        if (!id) return;
        this.session.services?.statsScope?.stopStatsMonitor(`native-send-${id}`);
        this.closeReceiver(id);
        const captureId = this.senders.get(id);
        this.senders.delete(id); this.negotiating.delete(id); this.connections?.delete(id);
        if (captureId) await closeNativeViewerPeer(captureId, id);
      }));
    }
    if (isDesktopApp()) {
      const pending = listenNativeCaptureBridge(event => {
        const id = event.peerId || event.peer_id;
        const sender = this.senders.get(id);
        if (!sender || event.event !== 'ice-candidate' || !event.candidate) return;
        const conn = this.connections?.get(id);
        sendSessionMessage(this.session, conn, { type: 'DIRECT_STREAM_ICE_CANDIDATE', candidate: event.candidate, mlineIndex: event.mlineIndex ?? event.mline_index ?? 0 });
      }).then(unlisten => this.session.registerCleanup(unlisten)).catch(error => {
        this.context?.eventBus.emit('system:error', { sourceEvent: 'native-media:listen', error });
      });
      this.session.registerCleanup(() => pending);
    }
  }
  broadcastTo(conn) {
    const provider = this.getProvider?.();
    const sessionId = provider?.session?.sessionId;
    if (!sessionId || provider.uiAudioMode === 'mic' || !this.isAuthorized(conn?.peer)) return false;
    this.connections ||= new Map(); this.connections.set(conn.peer, conn);
    if (this.negotiating.has(conn.peer) || this.senders.has(conn.peer)) return true;
    this.negotiating.add(conn.peer);
    if (!sendSessionMessage(this.session, conn, { type: 'START_DIRECT_STREAM', sessionId, quality: provider.requestedSettings, hasAudio: Boolean(provider.session.audioRtpPort || provider.session.audio_rtp_port) })) this.negotiating.delete(conn.peer);
    return true;
  }
  async answer(data, conn) {
    const sessionId = this.getProvider?.()?.session?.sessionId;
    if (!sessionId || data.sessionId !== sessionId || typeof data.sdp !== 'string' || data.sdp.length > 256 * 1024) return;
    this.senders.set(conn.peer, sessionId);
    try {
      const answer = await createNativeViewerPeer(sessionId, conn.peer, data.sdp, getPeerConfig().config.iceServers);
      if (this.session.isDisposed || this.getProvider?.()?.session?.sessionId !== sessionId) {
        await closeNativeViewerPeer(sessionId, conn.peer); return;
      }
      sendSessionMessage(this.session, conn, { type: 'DIRECT_STREAM_ANSWER', sdp: answer.sdp });
      this.session.services?.statsScope?.startStatsMonitor(`native-send-${conn.peer}`, { getStats: () => getNativeStreamStats(sessionId, conn.peer) }, true, null, { cardId: 'local-me', context: () => {
        const provider = this.getProvider?.(), codec = provider?.session?.videoCodec;
        return { requestedCodec: codec, requestedFps: provider?.requestedSettings?.fps, encoderImplementation: codec === 'av1' ? 'svtav1enc' : codec === 'hevc' ? 'mfh265enc' : provider?.session?.h264Encoder || null };
      } });
    } catch (error) { this.senders.delete(conn.peer); throw error; }
    finally { this.negotiating.delete(conn.peer); }
  }
  async receive(data, conn) {
    if (typeof data.sessionId !== 'string' || data.sessionId.length > 128) return;
    this.closeReceiver(conn.peer);
    const pc = new RTCPeerConnection(getPeerConfig().config);
    const stream = new MediaStream();
    this.receivers.set(conn.peer, { pc, stream, pending: [] });
    pc.addTransceiver('video', { direction: 'recvonly' });
    if (data.hasAudio) pc.addTransceiver('audio', { direction: 'recvonly' });
    applyTransceiverOptimizations(pc, 'ultra-low', 'auto');
    pc.ontrack = event => {
      if (this.session.isDisposed || this.receivers.get(conn.peer)?.pc !== pc) return;
      if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track);
      addOrUpdateVideoCard({ audioScope: this.session.audioScope, peerId: conn.peer, stream, label: `Ao Vivo: ${conn.peer.slice(0, 8)}`, onClipClick: this.onClip });
      this.context.eventBus.emit('stream:received', { hostId: conn.peer, stream });
      (this.session.services?.statsScope?.startStatsMonitor || startStatsMonitor)(conn.peer, pc, false, null, { context: () => ({ requestedFps: Number.isFinite(data.quality?.fps) && data.quality.fps > 0 && data.quality.fps <= 120 ? data.quality.fps : null }) });
    };
    pc.onicecandidate = event => {
      if (event.candidate) sendSessionMessage(this.session, conn, { type: 'DIRECT_STREAM_ICE_CANDIDATE', candidate: event.candidate.candidate, mlineIndex: event.candidate.sdpMLineIndex ?? 0 });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.closeReceiver(conn.peer);
    };
    try {
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      if (!this.session.isDisposed && this.receivers.get(conn.peer)?.pc === pc) sendSessionMessage(this.session, conn, { type: 'DIRECT_STREAM_OFFER', sessionId: data.sessionId, sdp: pc.localDescription?.sdp || offer.sdp });
    } catch (error) { this.closeReceiver(conn.peer); throw error; }
  }
  closeReceiver(id) {
    const receiver = this.receivers.get(id);
    if (!receiver) return;
    this.receivers.delete(id); receiver.pc.close(); receiver.stream.getTracks().forEach(track => track.stop());
    (this.session.services?.statsScope?.stopStatsMonitor || stopStatsMonitor)(id); removeVideoCard(id);
    this.context?.eventBus.emit('stream:stopped', { sourceId: id });
  }
  stopSending() {
    for (const id of this.senders.keys()) this.session.services?.statsScope?.stopStatsMonitor(`native-send-${id}`);
    for (const conn of this.connections?.values() || []) sendSessionMessage(this.session, conn, { type: 'DIRECT_STREAM_STOP' });
    const pending = [...this.senders].map(([id, sessionId]) => closeNativeViewerPeer(sessionId, id));
    this.senders.clear(); this.negotiating.clear(); this.connections?.clear();
    return Promise.allSettled(pending);
  }
  destroy() {
    for (const id of [...this.receivers.keys()]) this.closeReceiver(id);
    super.destroy();
    return this.stopSending();
  }
}
