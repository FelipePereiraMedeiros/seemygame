/** One-off interactive scheduled task for read-only DWM/monitor timing. */
import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const hostIndex=process.argv.indexOf('--host');
const probeIndex=process.argv.indexOf('--probe'),probe=probeIndex>=0?process.argv[probeIndex+1]:'dwm';
if(!['dwm','dxgi'].includes(probe))throw Error('Invalid environment probe');
const target=hostIndex>=0?process.argv[hostIndex+1]:'notebook';
if(typeof target!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(target))throw Error('Invalid SSH alias');
const id=(probe==='dxgi'?'dxgi-vblank-environment-':'presentation-environment-')+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex');
const output=path.join(root,'output/playwright',id);await mkdir(output,{recursive:true});
const file=probe==='dxgi'?'tools/e2e/harness/dxgi-vblank-probe.ps1':'tools/e2e/harness/presentation-environment.ps1',source=await readFile(path.join(root,file));
const hash=createHash('sha256').update(source).digest('hex');
// Copy the reader into its test artifact directory; do not change notebook project sources.
const stage=`C:/Users/Diogo/SeeMyGame/output/remote-matrix/${id}`;
const taskName='SeeMyGame-E2E-'+id;
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const readerScript=source.toString().replace("(Join-Path $PSScriptRoot 'display-info.ps1')","'C:/Users/Diogo/SeeMyGame/tools/e2e/harness/display-info.ps1'");
const readerBase64=Buffer.from(readerScript).toString('base64');
const ps=`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';
$stage=${quote(stage)};New-Item -ItemType Directory -Path $stage -Force | Out-Null;
$reader=Join-Path $stage 'reader.ps1';$runner=Join-Path $stage 'run.ps1';$result=Join-Path $stage 'result.json';
[IO.File]::WriteAllBytes($reader,[Convert]::FromBase64String(${quote(readerBase64)}));
$runText="& '$reader' | Set-Content -LiteralPath '$result' -Encoding UTF8";[IO.File]::WriteAllText($runner,$runText);
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$runner+'"');
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name;
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited;
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;
try{Register-ScheduledTask -TaskName ${quote(taskName)} -Action $action -Principal $principal -Settings $settings | Out-Null;Start-ScheduledTask -TaskName ${quote(taskName)};
$deadline=[DateTime]::UtcNow.AddSeconds(40);while([DateTime]::UtcNow -lt $deadline){if(Test-Path -LiteralPath $result){Get-Content -LiteralPath $result -Raw;exit};Start-Sleep -Milliseconds 500};throw 'Interactive timing reader timeout';}
finally{$job=Get-ScheduledTask -TaskName ${quote(taskName)} -ErrorAction SilentlyContinue;if($job){Stop-ScheduledTask -TaskName ${quote(taskName)} -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName ${quote(taskName)} -Confirm:$false;}}`;
// Avoid Windows' command-line size limit: stdin carries this locally authored script.
const bootstrap='& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))';
const child=spawn('C:/Windows/System32/OpenSSH/ssh.exe',['-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=yes',target,'powershell.exe -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(bootstrap,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
child.stdin.on('error',()=>{});child.stdin.end(ps);
let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);let timer;
try{
 const code=await Promise.race([new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);}),new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill();reject(Error('SSH observation timed out'));},60000);})]);
 if(code!==0)throw Error(stderr.slice(-2000));
 const result=JSON.parse(stdout.trim().replace(/^\uFEFF/,''));
 await writeFile(path.join(output,'report.json'),JSON.stringify({...result,sourceSha256:hash,remoteStage:stage,taskName},null,2));
 await writeFile(path.join(output,'reader.ps1'),readerScript);
 console.log(JSON.stringify({artifact:output,status:result.status,sessionId:result.sessionId,display:result.display,outputs:result.outputs?.map(o=>({adapter:o.adapter,device:o.device,attached:o.attached,samples:o.samples.length})),observedDwmRefreshCounterHz:result.observedDwmRefreshCounterHz,qpcPeriodMs:result.samples?.[0]?.qpcRefreshPeriodMs},null,2));
}catch(error){await writeFile(path.join(output,'report.json'),JSON.stringify({status:'failed',error:error.message,stderr},null,2));process.exitCode=1;console.error(error.message);}
finally{clearTimeout(timer);}
