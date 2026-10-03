// Paired diagnostic comparison: product default vs matched capture/encoder family.
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2);
const option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const seconds=Number(option('--seconds','70')),repeat=Number(option('--repeat','2'));
const presets=option('--presets','balanced').split(','),bitrate=Number(option('--bitrate-kbps','4500'));
if(!Number.isInteger(seconds)||seconds<10||seconds>180||!Number.isInteger(repeat)||repeat<1||repeat>5||presets.some(p=>!['ultra','balanced'].includes(p))||!Number.isInteger(bitrate)||bitrate<256||bitrate>50000)throw new Error('Invalid codec comparison arguments');
const exe=path.resolve(root,option('--exe','src-tauri/target/release/seemygame.exe'));
const sha=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const definitions=[{label:'h264-default',codec:'h264',encoder:'auto'},{label:'h264-mf-control',codec:'h264',encoder:'mf'},{label:'hevc-mf',codec:'hevc',encoder:'auto'}];
const output=path.join(root,'output/playwright','codec-comparison-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex'));
await mkdir(output,{recursive:true});
const report={status:'running',seconds,repeat,presets,bitrateKbps:bitrate,executable:{path:exe,sha256:await sha(exe)},
 scope:'two machines; real WGC capture, native encode, direct WebRTC and notebook Chrome decode/presentation; no audio/replay; identical diagnostic no-preview adapter and 96..127 receiver payload normalization for every codec; synthetic scene, no game stress or optical latency; HEVC is not the current production preview path',
 definitions,runs:[],cleanup:[]};
report.diagnosticHelperHashes=Object.fromEntries(await Promise.all(['tools/e2e/codec-comparison.mjs','tools/e2e/harness/no-preview.mjs','tools/e2e/harness/receiver-payloads.mjs'].map(async file=>[file,await sha(path.join(root,file))])));
const save=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
let active;
try {
 await save();
 for(let repetition=1;repetition<=repeat;repetition++)for(const preset of presets)for(const definition of repetition%2?definitions:[...definitions].reverse()) {
  if(await sha(exe)!==report.executable.sha256)throw new Error('Sender executable changed during comparison');
  for(const [file,expected] of Object.entries(report.diagnosticHelperHashes))if(await sha(path.join(root,file))!==expected)throw new Error('Diagnostic helper changed during comparison: '+file);
  console.log(`Codec comparison: repetition ${repetition}, ${preset}, ${definition.label}`);
  active=spawn(process.execPath,['tools/e2e/distributed-matrix.mjs','--senders','native-auto','--receivers','chrome','--presets',preset,'--seconds',String(seconds),'--codec',definition.codec,'--encoder',definition.encoder,'--bitrate-kbps',String(bitrate),'--exe',exe,'--matched-resolution','--matched-codec','--native-without-preview'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';for(const pipe of [active.stdout,active.stderr])pipe.on('data',d=>{const text=d.toString();log+=text;process.stdout.write(text);});
  const code=await new Promise((resolve,reject)=>{active.once('error',reject);active.once('exit',resolve);});active=null;
  await writeFile(path.join(output,`${repetition}-${preset}-${definition.label}.log`),log);
  const artifact=log.match(/Distributed matrix \w+: (.+)/)?.[1]?.trim();
  if(!artifact)throw new Error('Matrix did not emit an artifact');
  const matrix=JSON.parse(await readFile(path.join(artifact,'report.json')));
  report.runs.push(...matrix.runs.map(run=>({...run,repetition,label:definition.label,matrixArtifact:path.join(artifact,'report.json')})));
  report.cleanup.push(...matrix.cleanup);
  await save();
  if(code!==0)throw new Error('Codec comparison case failed; preserve evidence before comparing performance');
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{if(active&&active.exitCode===null)active.kill();await save();console.log('Codec comparison '+report.status+': '+output);}
