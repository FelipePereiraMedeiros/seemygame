/** Correlations narrow an investigation; callback pauses alone cannot identify the compositor. */
export function classifyStutter(entry,isNative=false){
 const inbound=entry.webInbound||{},outbound=entry.outbound||{};
 if(entry.source?.fps&&entry.source.fps<30)return {suspectedCause:'SOURCE_WINDOW_THROTTLING',confidence:'high'};
 if(isNative&&entry.bridge?.decodedFps!=null&&entry.bridge.decodedFps<30)return {suspectedCause:'NATIVE_CAPTURE_OR_BRIDGE_THROTTLING',confidence:'medium'};
 if(inbound.packetsLostDelta>0||inbound.nackDelta>0||inbound.pliDelta>0)return {suspectedCause:'RTP_LOSS_OR_RECOVERY',confidence:'medium'};
 if(outbound.limitation==='cpu')return {suspectedCause:'STREAMER_CPU_SATURATION',confidence:'medium'};
 if(outbound.limitation==='bandwidth')return {suspectedCause:'WEBRTC_BANDWIDTH_LIMITATION',confidence:'medium'};
 if(inbound.jitterBufferMs>100)return {suspectedCause:'RECEIVER_JITTER_BUFFER_STALL',confidence:'medium'};
 if(inbound.decodedFps===0)return {suspectedCause:'RECEIVER_STREAM_FREEZE',confidence:'low'};
 return {suspectedCause:'UNRESOLVED_PRESENTATION_STALL',confidence:'low'};
}
