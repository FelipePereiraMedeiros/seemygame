const aliases={h265:'hevc',avc:'h264'};
export const codecName=value=>aliases[String(value||'').toLowerCase().replace(/^video\//,'')]||String(value||'').toLowerCase().replace(/^video\//,'');
const repair=c=>['rtx','red','ulpfec','flexfec-03'].includes(codecName(c.mimeType));
export function getVideoCapabilities(api=globalThis) {
 const read=ctor=>{try{return ctor?.getCapabilities?.('video')?.codecs||[];}catch(_){return [];}};
 return {send:read(api.RTCRtpSender),receive:read(api.RTCRtpReceiver)};
}
/** Preserve original capabilities/fmtp and all repair codecs. SDP decides remote intersection. */
export function selectCodec(requested='auto',capabilities=getVideoCapabilities(),direction='send',native=null) {
 const available=capabilities[direction]||[];
 const nativeSupport={h264:native?.supports_h264??native?.h264Available??native?.h264_available,hevc:native?.supports_hevc??native?.hevcAvailable??native?.hevc_available,av1:native?.supports_av1??native?.av1Available??native?.av1_available};
 if(native)nativeSupport.h264 = Boolean(nativeSupport.h264 || native.nvencH264Available || native.nvenc_h264_available || native.x264Available || native.x264_available);
 const names=[...new Set(available.filter(c=>!repair(c)).map(c=>codecName(c.mimeType)))].filter(n=>!native||nativeSupport[n]);
 const wanted=codecName(requested)||'auto';
 const selected=(wanted!=='auto'&&names.includes(wanted)?wanted:['h264','vp8','vp9','av1','hevc'].find(n=>names.includes(n)))||null;
 const preferred=available.filter(c=>codecName(c.mimeType)===selected);
 return {requested:wanted,selected,fallback:wanted!=='auto'&&wanted!==selected,supported:names,
  reason:selected?wanted!=='auto'&&wanted!==selected?`${wanted.toUpperCase()} indisponível neste caminho; usando ${selected.toUpperCase()}.`:null:'Nenhum codec compatível anunciado.',
  codecs:[...preferred,...available.filter(c=>!preferred.includes(c))]};
}
export function configureVideoCodecs(transceiver,requested='auto',api=globalThis) {
 const caps=getVideoCapabilities(api);
 const direction=transceiver.receiver?.track?.kind==='video' && !transceiver.sender?.track ? 'receive' : 'send';
 const result=selectCodec(requested,caps,direction);
 if(!result.selected||!transceiver.setCodecPreferences)return {...result,applied:false};
 // Receiver-only transceivers use decoder capabilities, not encoder capabilities.
 try{transceiver.setCodecPreferences(result.codecs);return {...result,applied:true};}
 catch(error){try{transceiver.setCodecPreferences([]);}catch(_){}return {...result,applied:false,reason:error.name||'codec-preference-rejected'};}
}

/** PeerJS starts createOffer inside call(); later transceiver preferences can miss that offer. */
export function preferVideoCodecInSdp(sdp,requested='auto') {
 if(!sdp)return sdp;
 const wanted=codecName(requested)==='auto'?'h264':codecName(requested);
 const lines=sdp.split(/\r?\n/);
 for(let i=0;i<lines.length;i++) {
  if(!lines[i].startsWith('m=video '))continue;
  let end=i+1;while(end<lines.length&&!lines[end].startsWith('m='))end++;
  const header=lines[i].split(/\s+/),payloads=header.slice(3),preferred=new Set(),repairs=new Map();
  for(const line of lines.slice(i+1,end)) {
   const map=line.match(/^a=rtpmap:(\d+)\s+([^/]+)\//i);
   if(map&&codecName(map[2])===wanted)preferred.add(map[1]);
   const apt=line.match(/^a=fmtp:(\d+)\s+.*\bapt=(\d+)\b/i);
   if(apt)repairs.set(apt[1],apt[2]);
  }
  const first=payloads.filter(pt=>preferred.has(pt)||preferred.has(repairs.get(pt)));
  if(first.length)lines[i]=[...header.slice(0,3),...first,...payloads.filter(pt=>!first.includes(pt))].join(' ');
  i=end-1;
 }
 return lines.join(sdp.includes('\r\n')?'\r\n':'\n');
}
export function createInitialCodecTransform(getRequested,api=globalThis) {
 return sdp=>{
  const requested=typeof getRequested==='function'?getRequested():getRequested||'auto';
  const result=selectCodec(requested,getVideoCapabilities(api));
  return preferVideoCodecInSdp(sdp,result.selected||requested);
 };
}

