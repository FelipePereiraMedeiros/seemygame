import os from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const finite = x => typeof x === 'number' && Number.isFinite(x);
const clamp = x => Math.max(0, Math.min(100, x));
const percentile = (xs, q) => { const a=xs.filter(finite).sort((a,b)=>a-b); return a.length ? a[Math.ceil(a.length*q)-1] : null; };
export function cpuInterval(before, after) {
  if (!before || before.length !== after.length) return { totalPercent:null, perCorePercent:[], busiestCorePercent:null };
  const deltas=after.map((cpu,i)=>{
    const total=Object.values(cpu.times).reduce((s,n)=>s+n,0)-Object.values(before[i].times).reduce((s,n)=>s+n,0);
    const idle=cpu.times.idle-before[i].times.idle;
    return {total,idle,percent:total>0 && idle>=0 && idle<=total ? clamp(100*(total-idle)/total) : null};
  });
  const valid=deltas.filter(d=>finite(d.percent));
  const total=valid.reduce((s,d)=>s+d.total,0), idle=valid.reduce((s,d)=>s+d.idle,0);
  return { totalPercent:valid.length===after.length && total>0 ? clamp(100*(total-idle)/total) : null,
    perCorePercent:deltas.map(d=>d.percent), busiestCorePercent:valid.length ? Math.max(...valid.map(d=>d.percent)) : null };
}
function processGroup(row, rows, runnerPid, collectorPid) {
  if(row.pid===collectorPid)return 'collector';
  const seen=new Set();let current=row;
  while(current && !seen.has(current.pid)) {
    if(current.pid===runnerPid) {
      const name=String(row.name).toLowerCase();
      return row.pid===runnerPid ? 'runner' : name.includes('gst-launch') ? 'native-worker' : name==='seemygame.exe' ? 'native-app' : name.includes('webview') ? 'webview' : /chrome|msedge/.test(name) ? 'browser-e2e' : 'other-owned';
    }
    seen.add(current.pid);const parent=rows.get(current.parentPid);
    if(parent?.startedAt && current.startedAt && parent.startedAt>current.startedAt)break; // PID reuse is not ancestry.
    current=parent;
  }
  return 'external';
}
/** Percent CPU is normalized to the whole machine: one busy core on six CPUs ~=16.7%. */
export function normalizeResourceSample(raw, previous, {runnerPid, logicalProcessors, cpu, freeMemoryBytes, totalMemoryBytes}) {
  const elapsed=previous ? raw.timestamp-previous.timestamp : 0;
  const rows=new Map((raw.processes||[]).map(p=>[p.pid,p]));
  const priors=new Map((previous?.processes||[]).map(p=>[p.pid,p]));
  const processes=[...rows.values()].map(p=>{
    const prior=priors.get(p.pid), delta=p.cpuTimeMs-prior?.cpuTimeMs;
    const hasMonotonic=finite(p.cpuSampleMonotonicMs)&&finite(prior?.cpuSampleMonotonicMs);
    const processElapsed=hasMonotonic?p.cpuSampleMonotonicMs-prior.cpuSampleMonotonicMs:elapsed;
    const valid=processElapsed>0 && logicalProcessors>0 && finite(p.cpuTimeMs) && finite(prior?.cpuTimeMs) && p.startedAt!=null && p.startedAt===prior.startedAt && delta>=0;
    const percent=valid?delta/processElapsed/logicalProcessors*100:null;
    return {pid:p.pid,name:p.name,group:processGroup(p,rows,runnerPid,raw.collectorPid),cpuPercent:finite(percent)&&percent<=100?percent:null,cpuInconsistent:finite(percent)&&percent>100,workingSetBytes:p.workingSetBytes??null};
  });
  const byPid=new Map(processes.map(p=>[p.pid,p])), engines=new Map(), processEngines=new Map();
  for(const counter of raw.gpuEngines||[]) {
    const match=counter.instance?.match(/^pid_(\d+)_(luid_.+_phys_\d+)_eng_(\d+)_engtype_(.+)$/);
    if(!match || !finite(counter.value) || counter.value<0)continue;
    const [,pid,adapter,index,type]=match, key=`${adapter}:${index}`;
    const entry=engines.get(key)||{adapter,index:Number(index),type,utilizationPercent:0};
    entry.utilizationPercent+=counter.value;engines.set(key,entry);
    const per=processEngines.get(Number(pid))||new Map();per.set(key,(per.get(key)||0)+counter.value);processEngines.set(Number(pid),per);
  }
  const engineRows=[...engines.values()].map(e=>({...e,utilizationPercent:clamp(e.utilizationPercent)}));
  const gpuProcesses=[...processEngines].map(([pid,usage])=>({pid,name:byPid.get(pid)?.name||'unavailable',group:byPid.get(pid)?.group||'external',busiestEnginePercent:clamp(Math.max(...usage.values()))}));
  const groups={};
  for(const p of processes) { const g=groups[p.group]||{cpuPercent:0,measuredProcesses:0,unavailableProcesses:0,workingSetBytes:0};
    if(finite(p.cpuPercent)){g.cpuPercent+=p.cpuPercent;g.measuredProcesses++;}else g.unavailableProcesses++;
    g.workingSetBytes+=p.workingSetBytes||0;groups[p.group]=g;
  }
  // Rates use different process read intervals; mark impossible sums unavailable instead of hiding them with clamping.
  let processCpuInconsistent=processes.some(p=>p.cpuInconsistent);
  for(const g of Object.values(groups)) {
    if(!g.measuredProcesses)g.cpuPercent=null;
    else if(g.cpuPercent>100){processCpuInconsistent=true;g.cpuPercent=null;}
  }
  return {timestamp:raw.timestamp,intervalMs:elapsed>0?elapsed:null,cpu,memory:{freeBytes:freeMemoryBytes,totalBytes:totalMemoryBytes},
    gpu:{available:raw.gpuAvailable && engineRows.length>0,status:raw.gpuStatus,busiestEnginePercent:raw.gpuAvailable && engineRows.length?Math.max(...engineRows.map(e=>e.utilizationPercent)):null,
      engines:engineRows,dedicatedMemory:(raw.gpuDedicatedMemory||[]).map(e=>({adapter:e.instance,usedBytes:e.value})),topProcesses:gpuProcesses.sort((a,b)=>b.busiestEnginePercent-a.busiestEnginePercent).slice(0,10)},
    processGroups:groups,ownedProcesses:processes.filter(p=>p.group!=='external').slice(0,64),externalTopCpu:processes.filter(p=>p.group==='external'&&finite(p.cpuPercent)&&p.cpuPercent>.1).sort((a,b)=>b.cpuPercent-a.cpuPercent).slice(0,10),
    collectionMs:raw.collectionMs??null,processCpuInconsistent};
}
export function summarizeResources(samples) {
  const cpu=samples.map(s=>s.cpu?.totalPercent), core=samples.map(s=>s.cpu?.busiestCorePercent), gpu=samples.map(s=>s.gpu?.busiestEnginePercent);
  const external=samples.map(s=>s.processGroups?.external?.cpuPercent);
  const warnings=[];
  if(percentile(cpu,.95)>=85)warnings.push('high-system-cpu');
  if(percentile(core,.95)>=95)warnings.push('busy-cpu-core');
  if(percentile(gpu,.95)>=95)warnings.push('busy-gpu-engine');
  if(samples.some(s=>finite(s.memory?.freeBytes)&&s.memory.freeBytes<1024**3))warnings.push('low-free-memory');
  if(!gpu.some(finite))warnings.push('gpu-metric-unavailable');
  if(samples.some(s=>s.processCpuInconsistent))warnings.push('process-cpu-inconsistent');
  if(samples.some(s=>finite(s.collectionMs)&&s.collectionMs>Math.max(100,(s.intervalMs||1000)*.25)))warnings.push('slow-resource-collection');
  const processGroups=Object.fromEntries([...new Set(samples.flatMap(s=>Object.keys(s.processGroups||{})))].map(group=>[group,{
    cpuP50Percent:percentile(samples.map(s=>s.processGroups?.[group]?.cpuPercent),.5),
    cpuP95Percent:percentile(samples.map(s=>s.processGroups?.[group]?.cpuPercent),.95),
    workingSetP95Bytes:percentile(samples.map(s=>s.processGroups?.[group]?.workingSetBytes),.95)
  }]));
  const gpuEngines=Object.fromEntries([...new Set(samples.flatMap(s=>(s.gpu?.engines||[]).map(e=>`${e.adapter}:${e.index}:${e.type}`)))].map(key=>[key,{
    utilizationP95Percent:percentile(samples.map(s=>s.gpu?.engines?.find(e=>`${e.adapter}:${e.index}:${e.type}`===key)?.utilizationPercent),.95)
  }]));
  return {sampleCount:samples.length,cpuP50Percent:percentile(cpu,.5),cpuP95Percent:percentile(cpu,.95),busiestCoreP95Percent:percentile(core,.95),gpuBusiestP95Percent:percentile(gpu,.95),externalCpuP95Percent:percentile(external,.95),collectionP95Ms:percentile(samples.map(s=>s.collectionMs),.95),collectorCpuP95Percent:percentile(samples.map(s=>s.processGroups?.collector?.cpuPercent),.95),warnings,
    processGroups,gpuEngines,intervalP95Ms:percentile(samples.map(s=>s.intervalMs),.95),
    interpretation:'Resource pressure is context, not proof of the cause. External process CPU is a lower bound when protected counters are unavailable. Working sets may share pages. GPU engines must not be summed across different engines.'};
}
export async function startResourceSampler({intervalMs=1000,maxSamples=4096,enabled=true}={}) {
  const samples=[];let previous=null,previousCpu=os.cpus(),timer,child,reader,droppedSamples=0,stopped=false;
  const metadata={status:enabled?'starting':'disabled',intervalMs,platform:process.platform,logicalProcessors:os.cpus().length,notes:['CPU normalized to whole machine','GPU busiest physical engine; encode/decode/3D/copy detailed','Process attribution covers descendants of the E2E runner; browser source/receiver may share the browser-e2e group','No command lines, paths, usernames or window titles collected','Collector and unknown/protected counters remain explicit']};
  const consume=raw=>{
    if(stopped)return;const currentCpu=os.cpus();
    const sample=normalizeResourceSample(raw,previous,{runnerPid:process.pid,logicalProcessors:metadata.logicalProcessors,cpu:cpuInterval(previousCpu,currentCpu),freeMemoryBytes:os.freemem(),totalMemoryBytes:os.totalmem()});
    previous=raw;previousCpu=currentCpu;samples.push(sample);if(samples.length>maxSamples){samples.shift();droppedSamples++;}
  };
  const startCpuFallback=()=>{
    if(stopped||timer)return;
    timer=setInterval(()=>consume({timestamp:Date.now(),processes:[],gpuAvailable:false,gpuStatus:'unsupported-or-collector-unavailable'}),intervalMs);
    timer.unref();
  };
  if(enabled&&process.platform==='win32') {
    await new Promise(resolve=>{
      let ready=false;const complete=()=>{if(!ready){ready=true;clearTimeout(timeout);resolve();}};
      const timeout=setTimeout(()=>{metadata.status='startup-timeout';child?.kill();complete();},20000);
      child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./resource-counters.ps1',import.meta.url)),'-RunnerPid',String(process.pid),'-IntervalMs',String(intervalMs)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      reader=createInterface({input:child.stdout});
      reader.on('line',line=>{try{const raw=JSON.parse(line);if(raw.kind==='ready'){metadata.status='available';metadata.gpuCounterInstalled=raw.gpuCounterInstalled;previousCpu=os.cpus();complete();}else if(raw.kind==='sample')consume(raw);}catch{metadata.parseErrors=(metadata.parseErrors||0)+1;}});
      child.stderr.on('data',()=>{metadata.collectorError=true;}); // Never export arbitrary shell output.
      child.on('error',()=>{metadata.status='collector-unavailable';complete();});
      child.on('exit',()=>{if(!stopped&&metadata.status==='available'){metadata.status='collector-exited';startCpuFallback();}else if(!ready)metadata.status='collector-unavailable';complete();});
    });
  } else if(enabled)metadata.status='cpu-only';
  if(enabled && metadata.status!=='available') {
    startCpuFallback();
  }
  const window=(start,end)=>samples.filter(s=>s.timestamp>=start&&s.timestamp<=end);
  return {metadata,latest:()=>samples.at(-1)||null,window:(start,end)=>{const rows=window(start,end);return {summary:summarizeResources(rows),samples:rows};},report:()=>({metadata:{...metadata,droppedSamples},summary:summarizeResources(samples),samples:[...samples]}),
    async stop(){if(stopped)return;stopped=true;clearInterval(timer);reader?.close();if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,2000))]);}}};
}
