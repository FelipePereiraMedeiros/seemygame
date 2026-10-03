import {afterEach,expect,it,vi} from 'vitest';
import {installNativeReceiverPayloads} from '../tools/e2e/harness/receiver-payloads.mjs';
afterEach(()=>vi.unstubAllGlobals());
function setup(sdp,codecs=[{mimeType:'video/H265',sdpFmtpLine:'profile-id=1'},{mimeType:'video/rtx'},{mimeType:'video/H264'}],video=true){
 const transceiver={direction:'recvonly',receiver:{track:{kind:video?'video':'audio'}},setCodecPreferences:vi.fn()};
 class Peer {getTransceivers(){return [transceiver];}async createOffer(){return {type:'offer',sdp};}}
 vi.stubGlobal('RTCPeerConnection',Peer);vi.stubGlobal('RTCRtpReceiver',{getCapabilities:()=>({codecs})});
 installNativeReceiverPayloads({codec:'hevc'});return {peer:new Peer(),transceiver};
}
it('normaliza HEVC e RTX, preservando fmtp, feedback, áudio e dados',async()=>{
 const audio='m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10';
 const data='m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=sctp-port:5000\r\n';
 const {peer,transceiver}=setup(audio+'\r\nm=video 9 UDP/TLS/RTP/SAVPF 49 50\r\na=rtpmap:49 H265/90000\r\na=fmtp:49 profile-id=1;tier-flag=0;level-id=180\r\na=rtcp-fb:49 nack pli\r\na=rtpmap:50 rtx/90000\r\na=fmtp:50 apt=49\r\n'+data);
 const offer=await peer.createOffer();
 expect(offer.type).toBe('offer');expect(offer.sdp).toContain(audio);expect(offer.sdp).toContain(data);
 expect(offer.sdp).toContain('m=video 9 UDP/TLS/RTP/SAVPF 96 97');
 expect(offer.sdp).toContain('a=fmtp:96 profile-id=1;tier-flag=0;level-id=180');
 expect(offer.sdp).toContain('a=rtcp-fb:96 nack pli');expect(offer.sdp).toContain('a=fmtp:97 apt=96');
 expect(transceiver.setCodecPreferences.mock.calls[0][0].map(c=>c.mimeType)).toEqual(['video/H265','video/rtx']);
});
it('evita colisões com payloads existentes, inclusive de áudio',async()=>{
 const high=Array.from({length:15},(_,i)=>96+i).join(' ');
 const {peer}=setup(`m=audio 9 UDP/TLS/RTP/SAVPF 111\nm=video 9 UDP/TLS/RTP/SAVPF ${high} 49\na=rtpmap:49 H265/90000\n`);
 const offer=await peer.createOffer();expect(offer.sdp).toContain(`m=video 9 UDP/TLS/RTP/SAVPF ${high} 112`);
 expect(offer.sdp).toContain('a=rtpmap:112 H265/90000');
});
it('não modifica ofertas somente de áudio e rejeita vídeo sem HEVC anunciado',async()=>{
 const audio='m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n';
 const voice=setup(audio,[],false);expect((await voice.peer.createOffer()).sdp).toBe(audio);
 const video=setup('m=video 9 UDP/TLS/RTP/SAVPF 96\r\n',[]);await expect(video.peer.createOffer()).rejects.toThrow('unsupported');
});
