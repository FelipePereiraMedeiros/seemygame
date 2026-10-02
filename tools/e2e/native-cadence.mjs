import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startResourceSampler} from './harness/resources.mjs';
import {listRustFiles} from './harness/provenance.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.join(root,'output/playwright',`native-cadence-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(output,{recursive:true});
const resources=await startResourceSampler({enabled:!process.argv.includes('--no-system-metrics')});
const report={status:'running',runs:[],limitations:['Run cargo test --no-run first; do not benchmark concurrently with compilation','Short synthetic moving ball is an encoder capacity probe, not screen capture/game/120 FPS certification','GPU upload adds work; source timings do not prove WGC cadence']};
report.sourceHashes=Object.fromEntries(await Promise.all([...await listRustFiles(root),'src-tauri/Cargo.toml','src-tauri/Cargo.lock','tools/e2e/native-cadence.mjs','tools/e2e/harness/resources.mjs','tools/e2e/harness/resource-counters.cs','tools/e2e/harness/resource-counters.ps1'].map(async file=>[file,createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')])));
try {
 const child=spawn('cargo',['test','--manifest-path','src-tauri/Cargo.toml','--locked','--offline','--lib','benchmark_native_encoder_cadence','--','--ignored','--nocapture'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let compiling=false;const stderr=[];
 child.stderr.on('data',data=>{const text=data.toString();if(/Compiling /.test(text))compiling=true;if(stderr.length<20)stderr.push(text);});
 const lines=createInterface({input:child.stdout});
 lines.on('line',line=>{const at=line.indexOf('SMG_CADENCE ');if(at>=0){const row=JSON.parse(line.slice(at+12));row.observedAt=Date.now();if(Number.isFinite(row.steadySeconds)){row.resources=resources.window(row.observedAt-row.steadySeconds*1000,row.observedAt);row.resourceWindowNote='Approximate steady window, aligned to receipt of the result; includes drain/stop timing and only 1Hz samples';}report.runs.push(row);console.log(JSON.stringify({...row,resources:row.resources?.summary}));}});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 report.compilationObserved=compiling;report.cargoExitCode=code;
 report.observedCadenceTargetsMet=report.runs.filter(r=>r.status==='delivered').every(r=>r.cadenceTargetMet===true)&&report.runs.some(r=>r.status==='delivered');
 report.resourceSummaryIncludesStartup=true;
 report.status=code!==0||report.runs.some(r=>r.status==='failed')?'failed':report.runs.some(r=>r.status==='delivered')?'passed':'inconclusive';
 report.cargoMessages=stderr.join('').slice(-6000);
}catch(error){report.status='failed';report.error=error.message;}
finally{await resources.stop();report.resources=resources.report();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
console.log(output);if(report.status==='failed')process.exitCode=1;else if(report.status==='inconclusive')process.exitCode=2;
