import { BasePlugin } from './base-plugin.js';
import { getPeerConfig } from '../config.js';
import { createNativeViewerPeer, closeNativeViewerPeer, addNativeViewerIceCandidate, listenNativeCaptureBridge, isDesktopApp } from '../desktop.js';
import { sendSessionMessage } from '../protocol/transport.js';
import { addOrUpdateVideoCard, removeVideoCard } from '../ui.js';
import { startStatsMonitor, stopStatsMonitor } from '../stats.js';

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
    if (isDesktopApp()) {
      const pending = listenNativeCaptureBridge(event => {
        const id = event.peerId || event.peer_id;
        const sender = this.senders.get(id);
        if (!sender || event.event !== 'ice-candidate' || !event.candidate) return;
        const conn = this.connections?.get(id);
        sendSessionMessage(this.session, conn, { type: 'DIRECT_STREAM_ICE_CANDIDATE', candidate: event.candidate, mlineIndex: event.mlineIndex ?? event.mline_index ?? 0 });
      }).then(unlisten => this.session.registerCleanup(unlisten));
      this.session.registerCleanup(() => pending);
    }
  }
  broadcastTo(conn) {
    const provider = this.getProvider?.();
    const sessionId = provider?.session?.sessionId;
    if (!sessionId || !this.isAuthorized(conn?.peer)) return false;
    this.connections ||= new Map(); this.connections.set(conn.peer, conn);
    if (this.negotiating.has(conn.peer) || this.senders.has(conn.peer)) return true;
    this.negotiating.add(conn.peer);
    if (!sendSessionMessage(this.session, conn, { type: 'START_DIRECT_STREAM', sessionId, hasAudio: Boolean(provider.session.audioRtpPort || provider.session.audio_rtp_port) })) this.negotiating.delete(conn.peer);
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
    } catch (error) { this.senders.delete(conn.peer); throw error; }
    finally { this.negotiating.delete(conn.peer); }
  }
  async receive(data, conn) {
    this.closeReceiver(conn.peer);
    const pc = new RTCPeerConnection(getPeerConfig().config);
    const stream = new MediaStream();
    this.receivers.set(conn.peer, { pc, stream, pending: [] });
    pc.addTransceiver('video', { direction: 'recvonly' });
    if (data.hasAudio) pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = event => {
      if (this.session.isDisposed || this.receivers.get(conn.peer)?.pc !== pc) return;
      if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track);
      addOrUpdateVideoCard({ peerId: conn.peer, stream, label: `Ao Vivo: ${conn.peer.slice(0, 8)}`, onClipClick: this.onClip });
      this.context.eventBus.emit('stream:received', { hostId: conn.peer, stream });
      startStatsMonitor(conn.peer, pc, false);
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
    this.receivers.delete(id); receiver.pc.close(); stopStatsMonitor(id); removeVideoCard(id);
    this.context?.eventBus.emit('stream:stopped', { sourceId: id });
  }
  stopSending() {
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
