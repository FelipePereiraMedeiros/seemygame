/** Diagnostic offer normalization for GStreamer's 96..127 video payloader templates.
 * Use only on the isolated receiver; preserve the requested codec/fmtp and RTX apt.
 */
export function installNativeReceiverPayloads({codec}) {
 const wanted=codec==='hevc'?'video/h265':`video/${codec}`;
 const original=RTCPeerConnection.prototype.createOffer;
 RTCPeerConnection.prototype.createOffer=async function(...args) {
  const capabilities=RTCRtpReceiver.getCapabilities('video')?.codecs||[];
  const primary=capabilities.filter(c=>c.mimeType.toLowerCase()===wanted);
  let video=false;
  for(const transceiver of this.getTransceivers()) {
   if(transceiver.direction==='recvonly'&&transceiver.receiver.track.kind==='video') {
    if(!primary.length)throw new Error('Requested native diagnostic codec is unsupported by receiver');
    transceiver.setCodecPreferences([...primary,...capabilities.filter(c=>c.mimeType.toLowerCase()==='video/rtx')]);video=true;
   }
  }
  const offer=await original.apply(this,args);
  if(!video)return offer;
  const lines=offer.sdp.split(/\r?\n/);
  const used=new Set(lines.filter(s=>s.startsWith('m=')).flatMap(s=>s.split(/\s+/).slice(3).map(Number)).filter(Number.isFinite));
  const remaps=[];
  for(let index=0;index<lines.length;index++) {
   if(!lines[index].startsWith('m=video '))continue;
   let end=index+1;while(end<lines.length&&!lines[end].startsWith('m='))end++;
   const header=lines[index].split(/\s+/),mapping=new Map();
   for(const payload of header.slice(3).map(Number))if(payload<96) {
    let target=96;while(target<=127&&used.has(target))target++;
    if(target>127)throw new Error('No free dynamic video payload type');
    used.add(target);mapping.set(payload,target);remaps.push({from:payload,to:target});
   }
   const mapped=value=>String(mapping.get(Number(value))??value);
   lines[index]=[...header.slice(0,3),...header.slice(3).map(mapped)].join(' ');
   for(let i=index+1;i<end;i++) {
    lines[i]=lines[i].replace(/^(a=(?:rtpmap|fmtp|rtcp-fb):)(\d+)/,(_,prefix,pt)=>prefix+mapped(pt))
      .replace(/\bapt=(\d+)\b/g,(_,pt)=>'apt='+mapped(pt));
   }
   index=end-1;
  }
  this.__smgPayloadRemaps=remaps;
  return {...offer,sdp:lines.join(offer.sdp.includes('\r\n')?'\r\n':'\n')};
 };
}
