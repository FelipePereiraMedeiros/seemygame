import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {summarizeQualityRuns} from './harness/verdict.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const option=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const repeat=Number(option('--repeat','3')),seconds=Number(option('--seconds','60'));
if(!Number.isInteger(repeat)||repeat<1||repeat>5||!Number.isInteger(seconds)||seconds<10||seconds>180)throw new Error('Use --repeat 1..5 e --seconds 10..180');
const exe=option('--exe','src-tauri/target/release/seemygame.exe');
const output=path.join(root,'output/playwright',`instrumentation-${new Date().toISOString().replace(/[:.]/g,'-')}`);await mkdir(output,{recursive:true});
const report={status:'running',repeat,seconds,runs:[],conditions:{preset:option('--preset','ultra'),codec:'h264',opticalHz:[0,8],systemMetrics:!process.argv.includes('--no-system-metrics'),notes:['Alternating order, release recommended, same machine','Optical off cannot measure glass-to-glass','Resource pressure is recorded, not controlled; cohorts are descriptive, not a causal guarantee']}};
const checkpoint=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
try {
 for(let repetition=1;repetition<=repeat;repetition++)for(const hz of repetition%2?[0,8]:[8,0]) {
  console.log(`[Instrumentation] repetition ${repetition}/${repeat}, optical=${hz}Hz`);
  const argv=['tools/e2e/run.mjs','--exe',exe,'--channel',option('--channel','chrome'),'--preset',report.conditions.preset,'--codec','h264','--seconds',String(seconds),'--optical-hz',String(hz)];
  if(!report.conditions.systemMetrics)argv.push('--no-system-metrics');
  const child=spawn(process.execPath,argv,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',data=>{log+=data.toString();});child.stderr.on('data',data=>{log+=data.toString();});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  await writeFile(path.join(output,`run-${repetition}-${hz}hz.log`),log);
  const match=log.match(/E2E \w+: (.+report\.json)/);
  if(!match)throw new Error(`No report for repetition ${repetition}/${hz}Hz, exit ${code}`);
  const artifact=match[1].trim(),r=JSON.parse(await readFile(artifact));
  const summary={repetition,opticalHz:hz,artifact,status:r.status,exitCode:code,functionalPassed:r.verdict?.functionalPassed,
   decodedFpsP50:r.native?.performance.medianDecodedFps,decodedFpsP10:r.native?.performance.p10DecodedFps,
   opticalLatency:r.native?.glassToGlassLatency,qualification:r.native?.qualification,resources:r.native?.resources?.summary,
   opticalOverhead:r.native?.performance.presentation?.instrumentationOverheadMs,codec:r.nativeState?.videoCodec};
  report.runs.push(summary);console.log(JSON.stringify(summary));await checkpoint();
  if(code!==0)throw new Error(`E2E ${r.status}: ${artifact}`);
 }
 const median=values=>{const v=values.filter(Number.isFinite).sort((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:null;};
 report.cohorts=report.conditions.opticalHz.map(hz=>{const runs=report.runs.filter(r=>r.opticalHz===hz);return {opticalHz:hz,runs:runs.length,medianDecodedFps:median(runs.map(r=>r.decodedFpsP50)),medianFpsP10:median(runs.map(r=>r.decodedFpsP10)),medianCpuP95Percent:median(runs.map(r=>r.resources?.cpuP95Percent)),medianGpuP95Percent:median(runs.map(r=>r.resources?.gpuBusiestP95Percent)),medianExternalCpuP95Percent:median(runs.map(r=>r.resources?.externalCpuP95Percent)),medianCollectorCpuP95Percent:median(runs.map(r=>r.resources?.collectorCpuP95Percent))};});
 report.verdict=summarizeQualityRuns(report.runs.map(r=>({status:r.functionalPassed?'delivered':'failed',assessment:r.qualification})),{requireQuality:process.argv.includes('--require-quality')});
 report.status=report.verdict.status;
 if(report.status==='failed')process.exitCode=1;else if(report.status==='inconclusive')process.exitCode=2;
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{await checkpoint();console.log(output);}
