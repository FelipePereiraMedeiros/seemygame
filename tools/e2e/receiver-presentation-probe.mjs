/** Local notebook canvas -> MediaStream -> video. Isolates scheduling/composition, not decode/network. */
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {startAssetServer} from './harness/server.mjs';
import {startReverseTunnel} from './harness/ssh-reverse.mjs';
import {readViewerControl,prepareRemoteViewer,machineFingerprint,resourceWindow} from './harness/remote-viewer.mjs';
import {summarizeResources} from './harness/resources.mjs';
import {createMotionFixture} from './fixtures/motion.mjs';
import {startBrowserTrace} from './harness/browser-trace.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const seconds=Number(option('--seconds','70')),runtimes=option('--receivers','chrome,tauri').split(','),host=option('--host','notebook');
const mode=option('--mode','canvas-video');
const fps=Number(option('--fps','60'));
if(!Number.isInteger(fps)||fps<1||fps>120)throw Error('Invalid source FPS (1..120)');
const browserConfig=option('--browser-config','harness'),traceSeconds=Number(option('--trace-seconds','0'));
const keepDisplayAwake=args.includes('--keep-display-awake');
const windowPosition=option('--window-position','30,30').split(',').map(Number);
if(!['harness','standard'].includes(browserConfig)||!Number.isInteger(traceSeconds)||traceSeconds<0||traceSeconds>seconds-5||windowPosition.length!==2||windowPosition.some(v=>!Number.isInteger(v)||Math.abs(v)>20000))throw Error('Invalid browser/trace/position arguments');
if(!Number.isInteger(seconds)||seconds<20||seconds>180||!['canvas-video','raf-only'].includes(mode)||!runtimes.length||runtimes.some(r=>!['chrome','tauri'].includes(r))||!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(host))throw Error('Invalid receiver probe arguments');
const id='matrix-probe-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex');
const output=path.join(root,'output/playwright',id);await mkdir(output,{recursive:true});
const remoteRoot='C:/Users/Diogo/SeeMyGame',remoteExe=remoteRoot+'/output/remote-matrix/runtime-2026-10-02/receiver.exe';
const ssh='C:/Windows/System32/OpenSSH/ssh.exe',sshBase=['-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=yes'];
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const waitExit=child=>child.exitCode!==null?Promise.resolve(child.exitCode):new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
const report={id,status:'running',seconds,mode,browserConfig,traceSeconds,windowPosition,conditions:{requestedFps:fps,width:1920,height:1080,videoCssWidth:1024,scope:mode==='raf-only'?'blank page rAF scheduling; no canvas, video, network media or product UI':'source and video on notebook; no network media, encoding, decoding, audio, replay or product room UI; source shares receiver CPU/GPU'},runs:[],cleanup:[],sourceHashes:{}};
report.keepDisplayAwake=keepDisplayAwake;
for(const file of ['tools/e2e/receiver-presentation-probe.mjs','tools/e2e/harness/browser-trace.mjs','tools/e2e/fixtures/motion.mjs','js/stats/presentation.js','tools/e2e/viewer-agent.mjs','tools/e2e/viewer-task.ps1'])report.sourceHashes[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
async function task(runtime,mode){
 const verify=mode==='start'?['tools/e2e/viewer-agent.mjs','tools/e2e/viewer-task.ps1'].map(f=>`if((Get-FileHash -LiteralPath ${quote(remoteRoot+'/'+f)} -Algorithm SHA256).Hash -ne ${quote(report.sourceHashes[f])}){throw 'Receiver helper hash mismatch'};`).join(' '):'';
 const ps=`$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; ${verify} & ${quote(remoteRoot+'/tools/e2e/viewer-task.ps1')} -RunId ${quote(id)} -Runtime ${runtime} -Mode ${mode} -BrowserConfig ${browserConfig} ${keepDisplayAwake?'-KeepDisplayAwake':''} -Exe ${quote(remoteExe)}`;
 const child=spawn(ssh,[...sshBase,host,'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand '+Buffer.from(ps,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',d=>out+=d.toString());child.stderr.on('data',d=>err+=d.toString());let timer;
 const code=await Promise.race([waitExit(child),new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill();reject(Error('Receiver task timeout'));},70000);})]).finally(()=>clearTimeout(timer));
 if(code!==0)throw Error('Receiver task failed: '+err.slice(-1000));
 const rows=out.split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
 return mode==='start'?rows.find(r=>r.kind==='seemygame-e2e-viewer-ready'):rows.at(-1);
}
const save=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
let server,reverse,tunnel,browser,context,ownedContext=false,currentRuntime,activeTrace;
try{
 // The only fixture modification requests a capture exactly after an actual produced frame.
 const fixture=mode==='raf-only'?`<!doctype html><title>SMG rAF Probe ${id}</title><style>body{background:#142033;color:white;font:24px monospace}</style><p>SeeMyGame: teste de cadência, sem vídeo.</p>`:createMotionFixture('SMG Receiver Presentation Probe '+id,42,fps,{width:1920,height:1080}).replace('  frame++;','  window.__smgOnSourceFrame?.();\n  frame++;');
 server=await startAssetServer({root,fixtures:{'/fixtures/receiver-probe.html':fixture}});
 reverse=await startReverseTunnel({host,ports:[Number(new URL(server.origin).port)]});
 for(const runtime of runtimes){
  currentRuntime=runtime;const ready=await task(runtime,'start');if(!ready)throw Error('No viewer readiness');
  tunnel=spawn(ssh,[...sshBase,'-N','-o','ExitOnForwardFailure=yes','-L','127.0.0.1:19333:127.0.0.1:19333','-L','127.0.0.1:19334:127.0.0.1:19334',host],{windowsHide:true,stdio:'ignore'});
  let metadata;for(let i=0;i<30;i++){try{metadata=await readViewerControl(ready.controlEndpoint,'metadata',{timeoutMs:1000});break;}catch{await new Promise(r=>setTimeout(r,300));}}
  const remote=prepareRemoteViewer(metadata,ready.controlEndpoint,{localPlaywrightVersion:require('playwright/package.json').version,localFingerprint:machineFingerprint(),wsPort:19333});
  if(remote.conditions.headless||metadata.session?.processSessionId===0)throw Error('Expected interactive notebook receiver');
  browser=remote.connectionType==='cdp'?await chromium.connectOverCDP(remote.wsEndpoint):await chromium.connect(remote.wsEndpoint);
  ownedContext=remote.connectionType!=='cdp';context=ownedContext?await browser.newContext({viewport:{width:1280,height:720}}):browser.contexts()[0];
  const page=ownedContext?await context.newPage():context.pages()[0];
  await page.goto(server.origin+'/fixtures/receiver-probe.html');await page.bringToFront();
  if(runtime==='chrome')await page.setViewportSize({width:1280,height:720});
  const windowCdp=await context.newCDPSession(page);
  const windowInfo=await windowCdp.send('Browser.getWindowForTarget');
  await windowCdp.send('Browser.setWindowBounds',{windowId:windowInfo.windowId,bounds:{windowState:'normal'}});
  await windowCdp.send('Browser.setWindowBounds',{windowId:windowInfo.windowId,bounds:{left:windowPosition[0],top:windowPosition[1]}});
  const actualWindowBounds=await windowCdp.send('Browser.getWindowBounds',{windowId:windowInfo.windowId});await windowCdp.detach();
  let gpuInfo=null;
  try{const cdp=await browser.newBrowserCDPSession();gpuInfo=await cdp.send('SystemInfo.getInfo');await cdp.detach();}catch{}
  await page.evaluate(async(mode)=>{
   const screenInfo=()=>({width:screen.width,height:screen.height,availableWidth:screen.availWidth,availableHeight:screen.availHeight,screenX,screenY});
   if(mode==='raf-only'){
    const raw=[],rafIntervals=[];let previous=null;
    const raf=now=>{if(previous!==null)rafIntervals.push(now-previous);raw.push({now,epoch:Date.now()});previous=now;requestAnimationFrame(raf);};requestAnimationFrame(raf);
    window.__smgProbe={sample:()=>({perf:performance.now(),epoch:Date.now(),sourceFrames:0,rafFrames:raw.length,presentedFps:null,missedCallbacks:0}),finish:()=>({raw,rafIntervals,video:null,screen:screenInfo(),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},visibility:document.visibilityState,userAgent:navigator.userAgent})};return;
   }
   const {observePresentation}=await import('/js/stats/presentation.js');
   const canvas=document.querySelector('canvas');canvas.style.cssText='position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
   const video=document.createElement('video');video.muted=true;video.autoplay=true;video.playsInline=true;video.style.cssText='display:block;width:1024px;height:576px;object-fit:contain;background:black';document.body.append(video);
   const stream=canvas.captureStream(0),track=stream.getVideoTracks()[0];
   if(typeof track.requestFrame!=='function')throw Error('Canvas requestFrame unavailable');
   window.__smgOnSourceFrame=()=>track.requestFrame();video.srcObject=stream;await video.play();
   const production=observePresentation(video),raw=[],rafIntervals=[];let previousCount=null,lastCallback=null,lastDisplay=null,lastRaf=null;
   const callback=(now,metadata)=>{const count=metadata.presentedFrames,display=metadata.expectedDisplayTime??metadata.presentationTime??now;raw.push({now,count,display,mediaTime:metadata.mediaTime,callbackGapMs:lastCallback===null?null:now-lastCallback,displayGapMs:lastDisplay===null?null:display-lastDisplay,callbackLagMs:now-display,framesDelta:previousCount===null?null:count-previousCount});lastCallback=now;lastDisplay=display;previousCount=count;video.requestVideoFrameCallback(callback);};video.requestVideoFrameCallback(callback);
   const raf=now=>{if(lastRaf!==null)rafIntervals.push(now-lastRaf);lastRaf=now;requestAnimationFrame(raf);};requestAnimationFrame(raf);
   window.__smgProbe={sample:()=>({perf:performance.now(),epoch:Date.now(),sourceFrames:window.__smgSourceStats.framesProduced,sourceFps:window.__smgSourceStats.fps,...production.sample(),playback:video.getVideoPlaybackQuality?.().toJSON?.()??(()=>{const q=video.getVideoPlaybackQuality?.();return q?{totalVideoFrames:q.totalVideoFrames,droppedVideoFrames:q.droppedVideoFrames}:null;})()}),finish:()=>({raw,rafIntervals,video:{width:video.videoWidth,height:video.videoHeight,rect:video.getBoundingClientRect().toJSON()},screen:screenInfo(),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},visibility:document.visibilityState,userAgent:navigator.userAgent})};
  },mode);
  await page.waitForTimeout(5000);
  const start=await page.evaluate(()=>window.__smgProbe.sample()),samples=[];
  report.partialRun={runtime,start,samples};await save();
  let trace=null;
  console.log(`Receiver local probe ${runtime}: ${seconds}s`);
  for(let i=0;i<seconds;i++){
   if(traceSeconds&&i===3)activeTrace=await startBrowserTrace(browser,page,{label:`${runtime}-${mode}-${browserConfig}`,file:path.join(output,runtime+'-trace.json')});
   if(activeTrace&&i===3+traceSeconds){trace=await activeTrace.stop();activeTrace=null;}
   await new Promise(r=>setTimeout(r,1000));samples.push(await page.evaluate(()=>window.__smgProbe.sample()));
   if(i%10===0)await save();
  }
  const end=samples.at(-1),evidence=await page.evaluate(()=>window.__smgProbe.finish());
  const remoteResources=await readViewerControl(ready.controlEndpoint,'resources');
  const resources=summarizeResources(resourceWindow(remoteResources,start.epoch,end.epoch));
  const rows=evidence.raw.filter(r=>r.now>=start.perf&&r.now<=end.perf);
  const percentile=(v,p)=>{v=v.filter(Number.isFinite).sort((a,b)=>a-b);return v.length?v[Math.ceil(v.length*p)-1]:null;};
  const delivered=(mode==='raf-only'||evidence.video?.width===1920&&evidence.video?.height===1080)&&evidence.visibility==='visible'&&rows.length>0;
  const summary={sourceFps:mode==='raf-only'?null:(end.sourceFrames-start.sourceFrames)*1000/(end.perf-start.perf),rafFps:mode==='raf-only'?(end.rafFrames-start.rafFrames)*1000/(end.perf-start.perf):null,rafWallFps:mode==='raf-only'?(end.rafFrames-start.rafFrames)*1000/(end.epoch-start.epoch):null,presentationP50:percentile(samples.map(s=>s.presentedFps),.5),presentationP10:percentile(samples.map(s=>s.presentedFps),.1),displayGapP95Ms:percentile(rows.map(s=>s.displayGapMs),.95),callbackGapP95Ms:percentile(rows.map(s=>s.callbackGapMs),.95),maxDisplayGapMs:percentile(rows.map(s=>s.displayGapMs),1),callbackLagP95Ms:percentile(rows.map(s=>s.callbackLagMs),.95),missedCallbacks:samples.reduce((n,s)=>n+s.missedCallbacks,0),rafIntervalP50Ms:percentile(evidence.rafIntervals,.5),resources};
  report.runs.push({runtime,status:delivered?'passed':'failed',conditions:remote.conditions,start,end,samples,summary,...evidence,gpuInfo,trace,actualWindowBounds});await save();
  delete report.partialRun;
  await page.screenshot({path:path.join(output,runtime+'.png')});
  if(ownedContext)await context.close();await browser.close();browser=null;context=null;
  report.cleanup.push(await task(runtime,'stop'));currentRuntime=null;
  const exited=waitExit(tunnel);tunnel.kill();await exited;tunnel=null;
 }
 report.status=report.runs.every(r=>r.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{
 await save();
 await activeTrace?.abort().catch(()=>{});
 if(ownedContext&&context)await context.close().catch(()=>{});await browser?.close().catch(()=>{});
 if(currentRuntime)try{report.cleanup.push(await task(currentRuntime,'stop'));}catch(e){report.cleanupError=e.message;}
 if(tunnel&&tunnel.exitCode===null){const exited=waitExit(tunnel);tunnel.kill();await exited;}
 await reverse?.stop().catch(e=>{report.cleanupError=(report.cleanupError??'')+' '+e.message;});await server?.close();await save();console.log('Receiver presentation probe '+report.status+': '+output);
}
if(report.status!=='passed')process.exitCode=1;
