import {writeFile} from 'node:fs/promises';

export const TRACE_CATEGORIES=['toplevel','benchmark','cc','viz','gpu','media','webrtc','devtools.timeline','blink.user_timing'];
const percentile=(values,p)=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]:null;};

/** Duration slices and per-thread cadence are evidence, not a causal classifier. */
export function summarizeTrace(trace){
 const events=trace.traceEvents??[],names=new Map(),threads=new Map(),cadence=new Map();
 for(const e of events){
  if(e.ph==='M'&&e.name==='thread_name')threads.set(`${e.pid}:${e.tid}`,e.args?.name);
  const key=`${e.pid}:${e.tid}:${e.name}`;
  let row=names.get(key);if(!row){row={pid:e.pid,tid:e.tid,name:e.name,category:e.cat,count:0,totalDurationMs:0,maxDurationMs:0,longSlices:0};names.set(key,row);}
  row.count++;
  if(e.ph==='X'&&Number.isFinite(e.dur)){const ms=e.dur/1000;row.totalDurationMs+=ms;row.maxDurationMs=Math.max(row.maxDurationMs,ms);if(ms>=50)row.longSlices++;}
  if(/BeginFrame|FireAnimationFrame|DrawAndSwap|SwapBuffers|VideoFrame|Decode|ReceivePacket|OnFrame/i.test(e.name)&&Number.isFinite(e.ts)){
   const timestamps=cadence.get(key)??[];timestamps.push(e.ts);cadence.set(key,timestamps);
  }
 }
 const rows=[...names.values()].map(r=>({...r,thread:threads.get(`${r.pid}:${r.tid}`)??null}));
 const cadenceRows=[...cadence.entries()].map(([key,ts])=>{
  ts.sort((a,b)=>a-b);const gaps=ts.slice(1).map((t,i)=>(t-ts[i])/1000).filter(g=>g>0);
  return {...names.get(key),thread:threads.get(`${names.get(key).pid}:${names.get(key).tid}`)??null,positiveIntervals:gaps.length,gapP50Ms:percentile(gaps,.5),gapP95Ms:percentile(gaps,.95),gapMaxMs:percentile(gaps,1)};
 });
 return {eventCount:events.length,threads:[...threads.entries()].map(([key,name])=>({key,name})),longSlices:rows.filter(r=>r.longSlices).sort((a,b)=>b.maxDurationMs-a.maxDurationMs),largestDurationGroups:rows.filter(r=>r.totalDurationMs).sort((a,b)=>b.totalDurationMs-a.totalDurationMs).slice(0,100),cadence:cadenceRows,markers:events.filter(e=>e.name.startsWith('smg-trace-')),scope:'Thread-local trace cadence and durations; async/begin-end spans not reconstructed; no physical scanout or automatic causal proof'};
}

export async function startBrowserTrace(browser,page,{label='receiver',file,maxBytes=256*1024*1024,ringBufferKb=0}={}){
 if(!Number.isInteger(ringBufferKb)||ringBufferKb<0||ringBufferKb>65536)throw Error('Invalid trace buffer');
 const cdp=await browser.newBrowserCDPSession();
 let closed=false,started=false,finished=false,timer,handle;
 const complete=new Promise((resolve,reject)=>{cdp.once('Tracing.tracingComplete',resolve);timer=setTimeout(()=>reject(Error('Trace completion timeout')),180000);});
 // Completion is awaited at stop, attach a handler immediately to avoid orphan rejections.
 complete.catch(()=>{});
 try{
  await cdp.send('Tracing.start',{...(ringBufferKb?{traceConfig:{recordMode:'recordContinuously',traceBufferSizeInKb:ringBufferKb,includedCategories:TRACE_CATEGORIES}}:{categories:TRACE_CATEGORIES.join(','),options:'record-until-full'}),transferMode:'ReturnAsStream',streamFormat:'json',bufferUsageReportingInterval:1000});started=true;
  const bufferUsage=[];cdp.on('Tracing.bufferUsage',e=>bufferUsage.push(e));
  const start=await page.evaluate(label=>{const value={label,perf:performance.now(),epoch:Date.now()};performance.mark('smg-trace-start',{detail:value});return value;},label);
  const stop=async({deferRead=false}={})=>{
   if(finished)throw Error('Trace already finished');finished=true;
   try{
    const end=await page.evaluate(label=>{const value={label,perf:performance.now(),epoch:Date.now()};performance.mark('smg-trace-end',{detail:value});return value;},label);
    const endRequest=cdp.send('Tracing.end');endRequest.catch(()=>{});
    const collect=async()=>{
    if(closed)throw Error('Trace stream already closed');
    try{
    // Ending a large trace can flush for seconds. Await it only after measurement.
    await endRequest;const completion=await complete;handle=completion.stream;
    if(!handle)throw Error('Trace returned no stream');clearTimeout(timer);
    const chunks=[];let bytes=0;
    for(;;){const row=await cdp.send('IO.read',{handle,size:1024*1024});const chunk=Buffer.from(row.data,row.base64Encoded?'base64':'utf8');bytes+=chunk.length;if(bytes>maxBytes)throw Error('Trace exceeded bounded size');chunks.push(chunk);if(row.eof)break;}
    const payload=Buffer.concat(chunks);await writeFile(file,payload);
    const summary=summarizeTrace(JSON.parse(payload.toString('utf8')));
    const result={file,label,start,end,bytes,bufferUsage,ringBufferKb,recordMode:ringBufferKb?'recordContinuously':'record-until-full',dataLossOccurred:completion.dataLossOccurred??false,categories:TRACE_CATEGORIES,summary};
    await writeFile(file.replace(/\.json$/,'.summary.json'),JSON.stringify(result,null,2));return result;
    }finally{if(handle)await cdp.send('IO.close',{handle}).catch(()=>{});await cdp.detach().catch(()=>{});closed=true;}
    };
    if(deferRead)return {file,label,start,end,pending:true,collect};
    return await collect();
   }catch(error){clearTimeout(timer);if(handle)await cdp.send('IO.close',{handle}).catch(()=>{});await cdp.detach().catch(()=>{});closed=true;throw error;}
  };
  const abort=async()=>{if(closed)return;clearTimeout(timer);if(started&&!finished)await cdp.send('Tracing.end').catch(()=>{});if(handle)await cdp.send('IO.close',{handle}).catch(()=>{});await cdp.detach().catch(()=>{});closed=true;};
  return {start,stop,abort};
 }catch(error){clearTimeout(timer);await cdp.detach().catch(()=>{});throw error;}
}

/** Lightweight observers can also run without tracing, so trace overhead is measurable. */
export async function installFrameEvidence(page){
 await page.evaluate(()=>{
  const state={start:{epoch:Date.now(),perf:performance.now()},raf:[],video:[],longTasks:[],visibility:[{perf:performance.now(),state:document.visibilityState}],screen:{width:screen.width,height:screen.height,screenX:screenX,screenY:screenY,dpr:devicePixelRatio},previousVideoCount:null};
  let running=true,videoHandle=null,videoElement=null,rafHandle;
  const raf=now=>{if(!running)return;state.raf.push(now);rafHandle=requestAnimationFrame(raf);};rafHandle=requestAnimationFrame(raf);
  const attach=()=>{
   const v=[...document.querySelectorAll('video')].find(v=>!v.paused&&v.videoWidth>0);
   if(!v||videoElement===v)return;videoElement=v;
   const callback=(now,m)=>{if(!running)return;state.video.push({now,count:m.presentedFrames,display:m.expectedDisplayTime??m.presentationTime,mediaTime:m.mediaTime,processingDuration:m.processingDuration??null,width:m.width,height:m.height});videoHandle=v.requestVideoFrameCallback(callback);};videoHandle=v.requestVideoFrameCallback(callback);
  };
  attach();const interval=setInterval(attach,500);
  let longTaskObserver;
  try{longTaskObserver=new PerformanceObserver(list=>state.longTasks.push(...list.getEntries().map(e=>({startTime:e.startTime,duration:e.duration,name:e.name}))));longTaskObserver.observe({type:'longtask',buffered:false});}catch{}
  const visibility=()=>state.visibility.push({perf:performance.now(),state:document.visibilityState});document.addEventListener('visibilitychange',visibility);
  window.__smgFrameEvidence={finish:()=>{running=false;cancelAnimationFrame(rafHandle);if(videoHandle!==null)videoElement?.cancelVideoFrameCallback(videoHandle);clearInterval(interval);longTaskObserver?.disconnect();document.removeEventListener('visibilitychange',visibility);state.end={epoch:Date.now(),perf:performance.now()};return state;}};
 });
}
