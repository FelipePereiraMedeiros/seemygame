import { chromium } from 'playwright';
import { startAssetServer } from './harness/server.mjs';
import { listFrontendFiles } from './harness/provenance.mjs';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { startResourceSampler } from './harness/resources.mjs';
import { summarizeQualityRuns } from './harness/verdict.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const option=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const seconds=Number(option('--seconds','10')),repeat=Number(option('--repeat','1'));
const requireQuality=process.argv.includes('--require-quality');
const scene=option('--scene','motion');
if(!['simple','motion'].includes(scene))throw new Error('Use --scene simple ou motion');
if(!Number.isInteger(seconds)||seconds<5||seconds>180||!Number.isInteger(repeat)||repeat<1||repeat>10)throw new Error('Use --seconds 5..180 e --repeat 1..10');
const profiles={hd60:{width:1280,height:720,fps:60,bitrateKbps:4500},fhd60:{width:1920,height:1080,fps:60,bitrateKbps:7500},hd120:{width:1280,height:720,fps:120,bitrateKbps:9000},fhd120:{width:1920,height:1080,fps:120,bitrateKbps:15000}};
const profileNames=option('--profiles','hd60,hd120,fhd60').split(','),codecs=option('--codecs','h264,vp8,vp9,av1,hevc').split(',');
if(profileNames.some(p=>!profiles[p])||codecs.some(c=>!['auto','h264','vp8','vp9','av1','hevc'].includes(c)))throw new Error('Perfil/codec inválido');
const output=path.join(root,'output/playwright',`quality-${new Date().toISOString().replace(/[:.]/g,'-')}`);await mkdir(output,{recursive:true});
const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>SeeMyGame · Laboratório de transmissão</title><link rel="stylesheet" href="/css/theme-tokens.css"><link rel="stylesheet" href="/css/components/hud-telemetry.css">
<style>body{margin:0;background:#172236;color:#eff4fb;font:16px system-ui;padding:32px}h1{font-size:26px}p{color:#acbbcc}.video-card{position:relative;max-width:1100px;margin:auto}.video-wrapper{position:relative;aspect-ratio:16/9;background:#08111e}video{width:100%;height:100%;object-fit:contain}.stats-hud{display:flex}button{cursor:pointer}@media(max-width:480px){body{padding:10px}h1{font-size:21px}}</style>
<h1>Laboratório de transmissão</h1><p>Codec negociado · FPS entregues · Cadência de apresentação</p><div id="card-viewer" class="video-card"><div class="video-wrapper"><video muted autoplay playsinline></video></div></div></html>`;
const server=await startAssetServer({root,fixtures:{'/fixtures/quality.html':html}});
let browser;const report={schemaVersion:1,status:'running',conditions:{platform:os.platform(),cpu:os.cpus()[0]?.model,logicalProcessors:os.cpus().length,totalMemoryBytes:os.totalmem(),seconds,repeat,scene,source:'timer-driven canvas captureStream; not getDisplayMedia/WGC',topology:'two real WebRTC peers sharing one page/physical CPU and GPU',limitations:['No optical glass-to-glass measurement','Headless compositor/refresh may limit presentation FPS','Capability availability does not prove hardware acceleration','Certification requires >=60 seconds plus matching delivered dimensions/FPS; applies only to these run conditions']},sourceHashes:{},runs:[]};
for(const file of [...await listFrontendFiles(root),'tools/e2e/quality-benchmark.mjs','tools/e2e/harness/provenance.mjs','tools/e2e/harness/resources.mjs','tools/e2e/harness/resource-counters.cs','tools/e2e/harness/resource-counters.ps1','tools/e2e/harness/verdict.mjs'])report.sourceHashes[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
const checkpoint=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
const resources=await startResourceSampler({enabled:!process.argv.includes('--no-system-metrics')});
try {
 browser=await chromium.launch({channel:option('--channel','chrome'),headless:!process.argv.includes('--headed')});
 report.conditions.browserVersion=browser.version();
 for(let n=0;n<repeat;n++)for(const name of n%2?[...profileNames].reverse():profileNames)for(const requested of n%2?[...codecs].reverse():codecs) {
  console.log(`[Quality] repetition ${n+1}: ${name} / ${requested}`);
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.origin+'/fixtures/quality.html');
  const preflight=await page.evaluate(async requested=>{const {selectCodec,getVideoCapabilities}=await import('/js/streaming/codecs.js');return selectCodec(requested,getVideoCapabilities());},requested);
  if(preflight.selected!==requested&&requested!=='auto') {report.runs.push({profile:name,requested,status:'unsupported',preflight});await page.close();await checkpoint();continue;}
  try {
   await page.evaluate(async({settings,requested,scene})=>{
    const {createStatsMonitorScope}=await import('/js/stats/monitor.js'),{createStatsHud}=await import('/js/stats/hud.js'),{applyTransceiverOptimizations,applySenderOptimizationsWhenReady}=await import('/js/webrtc.js');
    const canvas=document.createElement('canvas');canvas.width=settings.width;canvas.height=settings.height;
    const ctx=canvas.getContext('2d',{alpha:false});let frames=0,last=performance.now(),timer;
    const tile=document.createElement('canvas');tile.width=256;tile.height=256;const tileContext=tile.getContext('2d');
    for(let y=0;y<256;y+=16)for(let x=0;x<256;x+=16){tileContext.fillStyle=['#143951','#216886','#517397','#203e5d'][(x/16+y/16)%4];tileContext.fillRect(x,y,15,15);}
    const pattern=ctx.createPattern(tile,'repeat');
    function draw(){const now=performance.now();if(now-last<1000/settings.fps)return;last+=Math.floor((now-last)/(1000/settings.fps))*(1000/settings.fps);frames++;ctx.fillStyle='#102641';ctx.fillRect(0,0,canvas.width,canvas.height);if(scene==='motion'){ctx.save();ctx.translate(-(frames*3)%256,-(frames*2)%256);ctx.fillStyle=pattern;ctx.fillRect(0,0,canvas.width+256,canvas.height+256);ctx.restore();}ctx.fillStyle='#3ebfe6';ctx.fillRect((frames*12)%canvas.width,canvas.height*.4,160,160);ctx.fillStyle='#eef4ff';ctx.font='42px system-ui';ctx.fillText('SeeMyGame / '+settings.height+'p / '+settings.fps+' FPS',36,80);}
    timer=setInterval(draw,2);draw();const stream=canvas.captureStream(settings.fps);
    const send=new RTCPeerConnection({iceServers:[]}),receive=new RTCPeerConnection({iceServers:[]}),video=document.querySelector('video');
    const scope=createStatsMonitorScope();document.querySelector('.video-wrapper').append(createStatsHud('viewer'));
    send.onicecandidate=e=>{if(e.candidate)receive.addIceCandidate(e.candidate).catch(()=>{});};receive.onicecandidate=e=>{if(e.candidate)send.addIceCandidate(e.candidate).catch(()=>{});};
    receive.ontrack=e=>{video.srcObject=e.streams[0];video.play().catch(()=>{});};
    send.addTrack(stream.getVideoTracks()[0],stream);applyTransceiverOptimizations(send,'ultra-low',requested);
    const cancel=applySenderOptimizationsWhenReady(send,settings.bitrateKbps*1000,settings.fps);
    await send.setLocalDescription(await send.createOffer());await receive.setRemoteDescription(send.localDescription);applyTransceiverOptimizations(receive,'ultra-low',requested);
    await receive.setLocalDescription(await receive.createAnswer());await send.setRemoteDescription(receive.localDescription);
    window.lab={send,receive,scope,video,stream,settings,requested,get frames(){return frames;},reset(){scope.stopStatsMonitor('viewer');scope.stopStatsMonitor('sender');scope.startStatsMonitor('viewer',receive,false,null,{context:()=>({requestedFps:settings.fps,requestedCodec:requested})});scope.startStatsMonitor('sender',send,true);this.baseline={time:performance.now(),frames};},dispose(){cancel();clearInterval(timer);scope.dispose();send.close();receive.close();stream.getTracks().forEach(t=>t.stop());}};
   },{settings:profiles[name],requested,scene});
   await page.waitForFunction(()=>window.lab.video.videoWidth>0,null,{timeout:15000});await page.waitForTimeout(3000);
   const measurementStartedAt=Date.now();await page.evaluate(()=>window.lab.reset());await page.waitForTimeout((seconds+1)*1000);
   const result=await page.evaluate(async()=>{
    const {assessQuality}=await import('/js/streaming/quality.js'),l=window.lab;
    const history=l.scope.getHistory('viewer'),sender=l.scope.getHistory('sender');
    const effective=l.scope.getLastMetrics('viewer'),parameters=l.send.getSenders()[0].getParameters();
    return {history,sender,effective,parameters,diagnostic:l.scope.exportDiagnostic(),sourceFps:(l.frames-l.baseline.frames)*1000/(performance.now()-l.baseline.time),assessment:assessQuality(history,{...l.settings,codec:l.requested})};
   });
   const run={profile:name,requested,preflight,repetition:n+1,status:result.effective.codec?'delivered':'failed',...result,errors,resources:resources.window(measurementStartedAt,Date.now())};
   const percentile=(values,q)=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return sorted.length?sorted[Math.ceil(q*sorted.length)-1]:null;};
   run.summary={sourceFps:result.sourceFps,decodedFpsP50:percentile(result.history.map(s=>s.measuredFps),.5),decodedFpsP10:percentile(result.history.map(s=>s.measuredFps),.1),presentedFpsP10:percentile(result.history.map(s=>s.presentedFps),.1),encodeMsP50:percentile(result.sender.map(s=>s.encodeTimeMs),.5),decodeMsP50:percentile(result.history.map(s=>s.decodeTimeMs),.5),maxPauseMs:percentile(result.history.map(s=>s.maxPauseMs),1),deliveredResolutions:[...new Set(result.history.filter(s=>s.width&&s.height).map(s=>`${s.width}x${s.height}`))],activeCodecs:[...new Set(result.history.map(s=>s.codec).filter(Boolean))],qualification:result.assessment.status};
   // Demonstrate the actual export button/download rather than only serializing test data.
   const downloadEvent=page.waitForEvent('download');await page.locator('.stats-export').click();const download=await downloadEvent;await download.saveAs(path.join(output,`diagnostic-${name}-${requested}-${n}.json`));
   await page.screenshot({path:path.join(output,`hud-${name}-${requested}-${n}.png`)});
   if(n===0&&name===profileNames[0]&&requested===codecs[0]){await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'hud-mobile.png')});}
   if(errors.length)throw new Error(errors.join('\n'));
   report.runs.push(run);await page.evaluate(()=>window.lab.dispose());
  }catch(error){report.runs.push({profile:name,requested,status:'failed',error:error.message});}
  finally{await page.close();await checkpoint();}
 }
 report.verdict=summarizeQualityRuns(report.runs,{requireQuality});report.status=report.verdict.status;
}catch(error){report.status='failed';report.error=error.message;}
finally{await resources.stop();report.resources=resources.report();await browser?.close();await server.close();await checkpoint();}
console.log(output);if(report.status==='failed')process.exitCode=1;else if(report.status==='inconclusive')process.exitCode=2;

