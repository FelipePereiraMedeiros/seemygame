// Run on the receiving computer. Browser and resource control bind only to loopback.
import {chromium} from 'playwright';
import http from 'node:http';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {startResourceSampler} from './harness/resources.mjs';
import {machineFingerprint} from './harness/remote-viewer.mjs';
const require=createRequire(import.meta.url),option=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const port=Number(option('--browser-port','9333')),controlPort=Number(option('--control-port','9334')),minutes=Number(option('--max-minutes','30')),headless=process.argv.includes('--headless');
if(![port,controlPort].every(p=>Number.isInteger(p)&&p>=1024&&p<=65535)||port===controlPort||!Number.isInteger(minutes)||minutes<1||minutes>180)throw new Error('Invalid ports/lifetime');
let browserServer,control,resources,timer,stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;clearTimeout(timer);await resources?.stop();await browserServer?.close();if(control){control.closeAllConnections();await new Promise(resolve=>control.close(resolve));}};
try {
 let session=null;
 if(process.platform==='win32') {
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command','(Get-Process -Id $pid).SessionId'],{windowsHide:true,stdio:['ignore','pipe','ignore']});let text='';child.stdout.on('data',d=>text+=d.toString());
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  session={processSessionId:code===0&&/^\d+$/.test(text.trim())?Number(text.trim()):null};
  if(!headless&&(session.processSessionId===null||session.processSessionId===0))throw new Error('Headed viewer requires an interactive Windows session. Open this helper in the notebook desktop terminal, or use --headless for decoder/network testing.');
 }
 resources=await startResourceSampler({enabled:!process.argv.includes('--no-system-metrics')});
 browserServer=await chromium.launchServer({channel:option('--channel','chrome'),host:'127.0.0.1',port,headless,args:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-features=CalculateNativeWinOcclusion','--autoplay-policy=no-user-gesture-required','--window-position=30,30','--window-size=1280,800']});
 const token=randomUUID(),base=`/smg-viewer/${token}`,expiresAt=Date.now()+minutes*60000;
 const metadata={schemaVersion:1,kind:'seemygame-e2e-viewer',machineFingerprint:machineFingerprint(),platform:os.platform(),cpuModel:os.cpus()[0]?.model,logicalProcessors:os.cpus().length,headless,session,wsEndpoint:browserServer.wsEndpoint(),playwrightVersion:require('playwright/package.json').version,expiresAt};
 control=http.createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type','application/json');
  if(request.method==='POST'&&request.url===base+'/shutdown'&&!request.headers.origin){response.end('{"stopping":true}');setImmediate(()=>void stop());return;}
  if(request.method!=='GET'){response.writeHead(405);response.end('{}');return;}
  if(request.url===base+'/metadata')response.end(JSON.stringify(metadata));
  else if(request.url===base+'/resources')response.end(JSON.stringify(resources.report()));
  else {response.writeHead(404);response.end('{}');}
 });
 await new Promise((resolve,reject)=>{control.once('error',reject);control.listen(controlPort,'127.0.0.1',resolve);});
 timer=setTimeout(()=>void stop(),minutes*60000);timer.unref();
 process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
 browserServer.on('close',()=>void stop());
 console.log(JSON.stringify({kind:'seemygame-e2e-viewer-ready',controlEndpoint:`http://127.0.0.1:${controlPort}${base}`,browserPort:port,headless,expiresAt}));
}catch(error){console.error(error.message);process.exitCode=1;await stop();}
