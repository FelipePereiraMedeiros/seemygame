import {describe,it,expect} from 'vitest';
import {preferVideoCodecInSdp,createInitialCodecTransform} from '../js/streaming/codecs.js';
const offer=['v=0','m=audio 9 UDP/TLS/RTP/SAVPF 111','a=rtpmap:111 opus/48000/2','m=video 9 UDP/TLS/RTP/SAVPF 96 97 102 103 104','a=rtpmap:96 VP8/90000','a=rtpmap:97 rtx/90000','a=fmtp:97 apt=96','a=rtpmap:102 H264/90000','a=fmtp:102 packetization-mode=1;profile-level-id=42e01f','a=rtpmap:103 rtx/90000','a=fmtp:103 apt=102','a=rtpmap:104 red/90000','m=application 9 UDP/DTLS/SCTP webrtc-datachannel',''].join('\r\n');
describe('PeerJS initial codec negotiation',()=>{
 it('prefers H264 and its repair payload before the first offer is installed',()=>{
  const result=preferVideoCodecInSdp(offer,'h264');
  expect(result).toContain('m=video 9 UDP/TLS/RTP/SAVPF 102 103 96 97 104');
  expect(result.split('\r\n').filter(l=>!l.startsWith('m=video'))).toEqual(offer.split('\r\n').filter(l=>!l.startsWith('m=video')));
 });
 it('keeps unsupported codecs and payload attributes intact instead of fabricating support',()=>{
  expect(preferVideoCodecInSdp(offer,'hevc')).toBe(offer);
  expect(preferVideoCodecInSdp(offer,'vp8')).toBe(offer);
 });
 it('uses advertised fallback and supports fresh choices at negotiation time',()=>{
  const api={RTCRtpSender:{getCapabilities:()=>({codecs:[{mimeType:'video/VP8'},{mimeType:'video/H264'}]})}};
  let choice='hevc';const transform=createInitialCodecTransform(()=>choice,api);
  expect(transform(offer)).toContain('SAVPF 102 103 96 97 104');
  choice='vp8';expect(transform(offer)).toBe(offer);
 });
});
