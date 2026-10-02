// Validate the distributed control/resource path locally. Never label this as two machines.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),option=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const output=path.join(root,'output/playwright',`remote-viewer-smoke-${new Date().toISOString().replace(/[:.]/g,'-')}`);await mkdir(output,{recursive:true});
const report={status:'running',scope:'same-machine remote receiver control/resource smoke; not a two-machine performance result'};
let agent,ready;
const exit=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
try {
 agent=spawn(process.execPath,['tools/e2e/viewer-agent.mjs','--headless','--channel',option('--channel','chrome'),'--browser-port',option('--browser-port','19333'),'--control-port',option('--control-port','19334'),'--max-minutes','5'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let agentErrors='';agent.stderr.on('data',d=>agentErrors+=d.toString());
 const reader=createInterface({input:agent.stdout});
 ready=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Viewer agent did not become ready')),30000);
  const fail=()=>{clearTimeout(timeout);reject(new Error('Viewer agent failed: '+agentErrors.slice(-2000)));};agent.once('error',fail);agent.once('exit',fail);
  reader.on('line',line=>{try{const m=JSON.parse(line);if(m.kind==='seemygame-e2e-viewer-ready'){clearTimeout(timeout);agent.off('error',fail);agent.off('exit',fail);resolve(m);}}catch{}});
 });
 report.agentReady={headless:ready.headless,browserPort:ready.browserPort};
 const child=spawn(process.execPath,['tools/e2e/run.mjs','--exe',option('--exe','src-tauri/target/release/seemygame.exe'),'--channel',option('--channel','chrome'),'--preset','ultra','--seconds','15','--codec','h264','--viewer-endpoint',ready.controlEndpoint,'--allow-same-machine-remote','--source-position','30,30'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',d=>log+=d.toString());child.stderr.on('data',d=>log+=d.toString());
 const code=await exit(child);await writeFile(path.join(output,'e2e.log'),log);
 const artifact=log.match(/E2E \w+: (.+report\.json)/)?.[1].trim();if(!artifact)throw new Error('No E2E report');
 const e2e=JSON.parse(await readFile(artifact));
 report.e2e={artifact,status:e2e.status,exitCode:code,conditions:e2e.receiverConditions,verdict:e2e.verdict,receiverResources:e2e.native?.receiverResources?.summary};
 if(code!==0||!e2e.receiverConditions?.sameMachine||e2e.native?.receiverResources?.summary.sampleCount<1||e2e.glassToGlassLatency!==null)throw new Error('Distributed receiver smoke requirements not met');
 report.status='passed';
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{
 if(agent&&ready&&agent.exitCode===null){
  const exited=exit(agent);
  await fetch(ready.controlEndpoint+'/shutdown',{method:'POST',signal:AbortSignal.timeout(10000),redirect:'error'}).catch(()=>{});
  let timer;await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>{report.cleanupError='Agent shutdown timeout';agent.kill();resolve();},10000);})]);clearTimeout(timer);
 }else if(agent&&agent.exitCode===null)agent.kill();
 if(report.cleanupError){report.status='failed';process.exitCode=1;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(output);
}
