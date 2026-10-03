/** Paired screening of optical instrumentation. Uses the existing two-machine harness. */
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';

const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2);
const option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const hzList=option('--hz-list','0,1,4,4,1,0').split(',').map(Number);
const seconds=Number(option('--seconds','70'));
const label=option('--label','baseline');
const clockBudgetMs=Number(option('--clock-max-error-ms','10'));
if(!Number.isFinite(clockBudgetMs)||clockBudgetMs<=0||clockBudgetMs>100)throw Error('Invalid clock budget');
const receiver=option('--receiver','chrome');
const readerModes=option('--reader-modes',hzList.map(()=>'gpu-roi').join(',')).split(',');
const exe=path.resolve(root,option('--exe','output/playwright/d3d12-hevc-experiment-build/release/seemygame.exe'));
if(!hzList.length||hzList.some(h=>!Number.isFinite(h)||h<0||h>30||h>0&&h<1)||!Number.isInteger(seconds)||seconds<60||seconds>180||!['chrome','tauri'].includes(receiver)||!/^[a-z0-9-]+$/.test(label))throw Error('Invalid instrumentation comparison arguments');
if(readerModes.length!==hzList.length||readerModes.some(m=>!['legacy','roi','gpu-roi'].includes(m)))throw Error('One valid reader mode is required per case');
const id=`instrumentation-${label}-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(3).toString('hex')}`;
const output=path.join(root,'output/playwright',id);await mkdir(output,{recursive:true});
const report={id,status:'running',label,receiver,seconds,hzList,readerModes,conditions:{sender:'native-d3d12',codec:'h264',encoder:'nvenc',bitrateKbps:4500,resolution:'1920x1080',requestedFps:60,audio:false,replay:false,nativePreview:false,directH264:false,clockBudgetMs,scope:'paired screening, independent fresh sessions; Wi-Fi and external load not controlled'},sourceHashes:{},runs:[]};
for(const file of ['tools/e2e/instrumentation-compare.mjs','tools/e2e/run.mjs','tools/e2e/telemetry/installer.mjs','tools/e2e/harness/clock-calibration.mjs','tools/e2e/harness/provenance.mjs','tools/e2e/distributed-matrix.mjs','js/stats/presentation.js']){
 const bytes=await readFile(path.join(root,file));report.sourceHashes[file]=createHash('sha256').update(bytes).digest('hex');
 const dest=path.join(output,'source',file);await mkdir(path.dirname(dest),{recursive:true});await copyFile(path.join(root,file),dest);
}
report.executableSha256=createHash('sha256').update(await readFile(exe)).digest('hex');
const save=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
await save();
let active;
try{
 for(const [index,hz] of hzList.entries()){
  console.log(`Instrumentation ${label}: case ${index+1}/${hzList.length}, ${hz} Hz, ${receiver}`);
  const command=['tools/e2e/distributed-matrix.mjs','--senders','native-d3d12','--receivers',receiver,'--presets','balanced','--seconds',String(seconds),'--codec','h264','--encoder','nvenc','--bitrate-kbps','4500','--exe',exe,'--matched-resolution','--matched-codec','--native-without-preview','--calibrate-clocks','--optical-hz',String(hz),'--optical-reader',readerModes[index],'--clock-max-error-ms',String(clockBudgetMs)];
  let log='';active=spawn(process.execPath,command,{cwd:root,windowsHide:true,env:{...process.env,SMG_EXPERIMENT_DIRECT_H264:'0',SEEMYGAME_GSTREAMER_ROOT:path.join(root,'native-media/gstreamer')},stdio:['ignore','pipe','pipe']});
  const emit=d=>{log+=d.toString();process.stdout.write(d);};active.stdout.on('data',emit);active.stderr.on('data',emit);
  let timer;const exit=new Promise((resolve,reject)=>{active.once('exit',resolve);active.once('error',reject);});
  const exitCode=await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>{active.kill();reject(Error('Comparison case timed out'));},(seconds+200)*1000);})]).finally(()=>clearTimeout(timer));active=null;
  await writeFile(path.join(output,`${index+1}-${hz}hz.log`),log);
  const matrixPath=log.match(/Distributed matrix \w+: (.+)/)?.[1]?.trim();
  const matrix=matrixPath?JSON.parse(await readFile(path.join(matrixPath,'report.json'),'utf8')):null;
  const childPath=matrix?.runs?.[0]?.artifact;
  const child=childPath?JSON.parse(await readFile(childPath,'utf8')):null;
  const phase=child?.native;
  report.runs.push({index:index+1,hz,readerMode:readerModes[index],exitCode,matrixPath,childPath,status:child?.status??matrix?.status??'failed',error:child?.error??matrix?.error??null,verdict:child?.verdict,clockValidation:phase?.clockCalibration?.validation,latency:phase?.glassToGlassLatency,presentation:phase?.performance?.presentation,medianDecodedFps:phase?.performance?.medianDecodedFps,qualification:phase?.qualification,receiverResources:phase?.receiverResources?.summary,senderResources:phase?.resources?.summary,diagnostics:phase?.diagnostics});
  await save();
 }
 report.status=report.runs.every(r=>r.exitCode===0&&r.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{if(active&&active.exitCode===null)active.kill();await save();console.log(`Instrumentation comparison ${report.status}: ${output}`);}
if(report.status!=='passed')process.exitCode=1;
