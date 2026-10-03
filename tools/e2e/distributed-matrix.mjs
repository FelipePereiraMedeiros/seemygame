// Real two-machine matrix. SSH serves control only; media must establish its own ICE path.
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {readViewerControl,redactViewerSecrets} from './harness/remote-viewer.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const ssh='C:/Windows/System32/OpenSSH/ssh.exe',host=option('--host','notebook'),seconds=Number(option('--seconds','70'));
const senders=option('--senders','native,web').split(','),receivers=option('--receivers','chrome,tauri').split(','),presets=option('--presets','ultra,balanced').split(',');
const cases=option('--cases','').split(',').filter(Boolean);
const matchedResolution=args.includes('--matched-resolution');
const bitrateKbps=option('--bitrate-kbps',null);
if(bitrateKbps!==null&&(!Number.isInteger(Number(bitrateKbps))||Number(bitrateKbps)<256||Number(bitrateKbps)>50000))throw new Error('Invalid bitrate budget');
if(cases.some(c=>! /^(native|native-d3d12|web):(chrome|tauri):(ultra|balanced)$/.test(c)))throw new Error('Invalid matrix cases (sender:receiver:preset)');
if(!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(host)||!senders.length||senders.some(s=>!['native','native-d3d12','web'].includes(s))||!receivers.length||receivers.some(s=>!['chrome','tauri'].includes(s))||!presets.length||presets.some(s=>!['ultra','balanced'].includes(s))||!Number.isInteger(seconds)||seconds<5||seconds>180)throw new Error('Invalid matrix arguments');
const remoteRoot='C:/Users/Diogo/SeeMyGame',remoteExe=remoteRoot+'/output/remote-matrix/runtime-2026-10-02/receiver.exe';
const id='matrix-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex');
const output=path.join(root,'output/playwright',id);await mkdir(output,{recursive:true});
const report={id,status:'running',scope:'two machines, interactive notebook receiver, fresh receiver profile per case, synthetic window capture; not game stress or optical latency',seconds,presets,senders,receivers,cases,matchedResolution,bitrateKbps,runs:[],cleanup:[],helperHashes:{}};
for(const file of ['tools/e2e/distributed-matrix.mjs','tools/e2e/viewer-task.ps1','tools/e2e/viewer-agent.mjs','tools/e2e/harness/remote-viewer.mjs'])report.helperHashes[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const shellQuote=s=>"'"+s.replaceAll("'","''")+"'";
const sshBase=['-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=yes'];
const waitExit=child=>child.exitCode!==null?Promise.resolve(child.exitCode):new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
async function remoteTask(runtime,mode){
 const verify=mode==='start'?['tools/e2e/viewer-agent.mjs','tools/e2e/viewer-task.ps1'].map(file=>`if((Get-FileHash -LiteralPath ${shellQuote(remoteRoot+'/'+file)} -Algorithm SHA256).Hash -ne ${shellQuote(report.helperHashes[file])}){throw ${shellQuote('Receiver helper hash mismatch: '+file+'; synchronize the validated helper before benchmarking')}};`).join(' '):'';
 const ps=`$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; ${verify} & ${shellQuote(remoteRoot+'/tools/e2e/viewer-task.ps1')} -RunId ${shellQuote(id)} -Runtime ${runtime} -Mode ${mode} -Exe ${shellQuote(remoteExe)}`;
 const child=spawn(ssh,[...sshBase,host,'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand '+Buffer.from(ps,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',d=>out+=d.toString());child.stderr.on('data',d=>err+=d.toString());
 const exited=waitExit(child);let timer;const code=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill();reject(new Error('Receiver task SSH timeout'));},70000);})]).finally(()=>clearTimeout(timer));
 if(code!==0)throw new Error('Receiver task failed: '+err.slice(-3000));
 const messages=out.split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
 return mode==='start'?messages.find(m=>m.kind==='seemygame-e2e-viewer-ready'):messages.at(-1);
}
let ready,metadata,tunnel,currentRuntime,active;
const redact=s=>redactViewerSecrets(s,{controlEndpoint:ready?.controlEndpoint,wsEndpoint:metadata?.wsEndpoint});
try {
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
 for(const preset of presets)for(const receiver of receivers){
  const order=receiver==='chrome'?senders:[...senders].reverse();
  for(const sender of order){
  if(cases.length&&!cases.includes(`${sender}:${receiver}:${preset}`))continue;
  currentRuntime=receiver;ready=await remoteTask(receiver,'start');if(!ready)throw new Error('No receiver readiness message');
  tunnel=spawn(ssh,[...sshBase,'-N','-o','ExitOnForwardFailure=yes','-L','127.0.0.1:19333:127.0.0.1:19333','-L','127.0.0.1:19334:127.0.0.1:19334',host],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let tunnelErrors='';tunnel.stderr.on('data',d=>tunnelErrors+=d.toString());tunnel.on('error',e=>tunnelErrors+=e.message);
  metadata=null;for(let i=0;i<30;i++){try{metadata=await readViewerControl(ready.controlEndpoint,'metadata',{timeoutMs:1000});break;}catch{if(tunnel.exitCode!==null)throw new Error('SSH control forwarding failed: '+tunnelErrors);await delay(300);}}
  if(!metadata||metadata.session?.processSessionId===0||metadata.headless||metadata.runtime!==receiver)throw new Error('Expected the selected interactive notebook receiver');
  console.log(`Receiver ${receiver} in notebook session ${metadata.session.processSessionId}.`);
  // Reverse sender order for the other receiver; create a new GUI/profile for every case.
   console.log(`Matrix case ${sender} -> ${receiver}, ${preset}, ${seconds} intervals`);
   const backend=sender==='native-d3d12'?'d3d12':'d3d11';
   active=spawn(process.execPath,['tools/e2e/run.mjs','--sender',sender==='web'?'web':'native','--capture-backend',backend,...(sender==='web'?[]:['--encoder','nvenc']),...(matchedResolution?['--matched-resolution']:[]),...(bitrateKbps===null?[]:['--bitrate-kbps',bitrateKbps]),'--exe','src-tauri/target/release/seemygame.exe','--channel','chrome','--preset',preset,'--codec','h264','--seconds',String(seconds),'--viewer-endpoint',ready.controlEndpoint,'--viewer-ssh-host',host,'--source-position','30,30'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
   let log='';const onData=d=>{const s=d.toString();log+=s;process.stdout.write(redact(s));};active.stdout.on('data',onData);active.stderr.on('data',onData);
   const exited=waitExit(active);let timer;
   const code=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>{active.kill();reject(new Error('Matrix child bounded timeout'));},(seconds+150)*1000);})]).finally(()=>clearTimeout(timer));active=null;
   await writeFile(path.join(output,`${preset}-${sender}-${receiver}.log`),redact(log));
   const artifact=log.match(/E2E \w+: (.+report\.json)/)?.[1]?.trim();if(!artifact)throw new Error('No child E2E artifact');
   const result=JSON.parse(await readFile(artifact)),phase=sender==='web'?result.web:result.native;
   report.runs.push({sender,receiver,preset,artifact,exitCode:code,status:result.status,verdict:result.verdict,receiverConditions:result.receiverConditions,performance:phase?.performance?{medianDecodedFps:phase.performance.medianDecodedFps,p10DecodedFps:phase.performance.p10DecodedFps}:null,qualification:phase?.qualification,diagnostics:phase?.diagnostics,receiverResources:phase?.receiverResources?.summary,error:result.error});
   await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
   if(code!==0||result.receiverConditions?.sameMachine!==false||!(phase?.receiverResources?.summary.sampleCount>0)){
     report.caseFailures=(report.caseFailures||0)+1;
     console.log('Case failed; preserving evidence and continuing with a fresh receiver.');
   }
   await delay(1500);
  report.cleanup.push(await remoteTask(receiver,'stop'));currentRuntime=null;
  if(tunnel.exitCode===null){const exited=waitExit(tunnel);tunnel.kill();await exited;}tunnel=null;ready=null;metadata=null;
  }
 }
 if(!report.runs.length)throw new Error('Matrix selected no cases');
 report.status=report.caseFailures?'failed':'passed';
 if(report.caseFailures)process.exitCode=1;
}catch(error){report.status='failed';report.error=redact(error.message);process.exitCode=1;}
finally{
 if(active&&active.exitCode===null)active.kill();
 if(currentRuntime){try{report.cleanup.push(await remoteTask(currentRuntime,'stop'));}catch(e){report.cleanupError=redact(e.message);}}
 if(tunnel&&tunnel.exitCode===null){const exited=waitExit(tunnel);tunnel.kill();await exited;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
 console.log('Distributed matrix '+report.status+': '+output);
}
