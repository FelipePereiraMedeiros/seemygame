import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startAssetServer} from './harness/server.mjs';
import {startResourceSampler} from './harness/resources.mjs';
import {listRustFiles} from './harness/provenance.mjs';
import {createMotionFixture} from './fixtures/motion.mjs';
import {readSourceStatsSummary} from './harness/source-summary.mjs';
import {ensureDefaultDesktop} from './desktop-affinity.mjs';
import {readDisplayModes,validateWindowPosition} from './harness/displays.mjs';
ensureDefaultDesktop();
const root=fileURLToPath(new URL('../../',import.meta.url));
const option=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const seconds=Number(option('--seconds','12')),repeat=Number(option('--repeat','3')),fps=Number(option('--fps','60')),backend=option('--backend','nvenc'),capture=option('--capture','d3d11');
if(!Number.isInteger(seconds)||seconds<5||seconds>60||!Number.isInteger(repeat)||repeat<1||repeat>5||!Number.isInteger(fps)||fps<30||fps>120||!['nvenc','mf','cpu'].includes(backend)||!['d3d11','d3d12','both'].includes(capture)||(capture!=='d3d11'&&backend!=='nvenc'))throw new Error('Use --seconds 5..60 --repeat 1..5 --fps 30..120 --backend nvenc|mf|cpu --capture d3d11|d3d12|both (D3D12 requires nvenc)');
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex'),title=`SMG E2E Motion ${runId}`;
const output=path.join(root,'output/playwright',`capture-stages-${runId}`);await mkdir(output,{recursive:true});
const report={status:'running',runId,conditions:{seconds,repeat,fps,backend,capture,source:'visible dedicated Chrome canvas; real WGC pipeline to fakesink',topology:'one machine; no WebRTC/network/receiver/audio/replay'},runs:[],sourceHashes:{}};
let browser,server,resources;
try {
 for(const file of [...await listRustFiles(root),'tools/e2e/native-capture-stages.mjs','tools/e2e/fixtures/motion.mjs','tools/e2e/harness/source-summary.mjs','tools/e2e/harness/displays.mjs','tools/e2e/harness/display-info.ps1','tools/e2e/harness/resources.mjs','tools/e2e/harness/resource-counters.cs','tools/e2e/harness/resource-counters.ps1'])report.sourceHashes[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
 // Compile before opening the source or collecting resources. Resolve the exact test artifact.
 let executable,stderr='';
 const compile=spawn('cargo',['test','--manifest-path','src-tauri/Cargo.toml','--locked','--offline','--lib','--no-run','--message-format=json'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const lines=createInterface({input:compile.stdout});
 lines.on('line',line=>{try{const m=JSON.parse(line);if(m.reason==='compiler-artifact'&&m.target?.name==='app_lib'&&m.profile?.test&&m.executable)executable=m.executable;if(m.reason==='compiler-message'&&m.message?.rendered)stderr=(stderr+m.message.rendered).slice(-12000);}catch{}});
 compile.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-6000);});
 const compileCode=await new Promise((resolve,reject)=>{compile.once('error',reject);compile.once('exit',resolve);});
 report.compilation={exitCode:compileCode,messages:stderr};
 if(compileCode!==0||!executable)throw new Error('Could not compile/resolve the capture probe test executable');
 report.testExecutableSha256=createHash('sha256').update(await readFile(executable)).digest('hex');
 report.displayModes=await readDisplayModes();
 report.conditions.windowPosition=validateWindowPosition(option('--position','30,30'));
 resources=await startResourceSampler({enabled:!process.argv.includes('--no-system-metrics')});
 server=await startAssetServer({root,fixtures:{'/fixtures/capture-stage.html':createMotionFixture(title,42,fps)}});
 browser=await chromium.launch({channel:option('--channel','chrome'),headless:false,args:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-features=CalculateNativeWinOcclusion',`--window-position=${report.conditions.windowPosition}`,'--window-size=1340,840']});
 const context=await browser.newContext({viewport:{width:1280,height:720}}),page=await context.newPage();
 await page.goto(server.origin+'/fixtures/capture-stage.html');await page.bringToFront();
 report.browserVersion=browser.version();
 for(let repetition=1;repetition<=repeat;repetition++) {
  // Same visible source/profile; alternate order to reduce a systematic warmup/order advantage.
  const captureOrder=capture==='both'?(repetition%2?['d3d11','d3d12']:['d3d12','d3d11']):[capture];
  for(const selectedCapture of captureOrder) {
  await page.bringToFront();const sourceBefore=await page.evaluate(readSourceStatsSummary),startedAt=Date.now();
  console.log(`[Capture stages] ${repetition}/${repeat}, ${selectedCapture}, ${backend}, ${fps} FPS`);
  const child=spawn(executable,['benchmark_native_capture_stages','--ignored','--nocapture','--test-threads=1'],{cwd:root,env:{...process.env,SMG_PROBE_WINDOW_TITLE:title,SMG_PROBE_SECONDS:String(seconds),SMG_PROBE_FPS:String(fps),SMG_PROBE_BACKEND:backend,SMG_PROBE_CAPTURE:selectedCapture},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let result,log='';const reader=createInterface({input:child.stdout});
  reader.on('line',line=>{log+=line+'\n';const i=line.indexOf('SMG_CAPTURE_STAGE ');if(i>=0)result=JSON.parse(line.slice(i+18));});
  child.stderr.on('data',d=>{log+=d.toString();});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  const sourceAfter=await page.evaluate(readSourceStatsSummary),endedAt=Date.now();
  const logName=`probe-${repetition}-${selectedCapture}.log`;
  await writeFile(path.join(output,logName),log);
  const run={repetition,exitCode:code,...result,sourceBefore,sourceAfter,sourceAverageFps:(sourceAfter.framesProduced-sourceBefore.framesProduced)*1000/(endedAt-startedAt),resources:resources.window(result?.steadyStartedAt??startedAt,result?.steadyEndedAt??endedAt)};
  report.runs.push(run);
  if(code!==0||!result)throw new Error(`Capture probe failed; see ${logName}`);
  console.log(JSON.stringify({...run,resources:run.resources.summary,queueSamples:undefined}));
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  }
 }
 await page.screenshot({path:path.join(output,'source.png')});
 report.status='passed';report.observedCadenceTargetsMet=report.runs.every(r=>r.stages.encoded.fps>=fps*.9);
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{await resources?.stop();report.resources=resources?.report();await browser?.close();await server?.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(output);}
