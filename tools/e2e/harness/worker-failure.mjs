import {spawnSync} from 'node:child_process';

/** Fault injection is restricted to the unique gst-launch child of this E2E's desktop. */
export function terminateOwnedMediaWorker(ownerPid) {
 if(process.platform!=='win32'||!Number.isInteger(ownerPid)||ownerPid<1)throw new Error('Invalid owned desktop PID');
 const script=`$ErrorActionPreference='Stop'
 $children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=${ownerPid}" | Where-Object { $_.Name -eq 'gst-launch-1.0.exe' })
 if($children.Count -ne 1){throw 'Expected exactly one owned GStreamer worker'}
 $candidate=$children[0]
 $verified=Get-CimInstance Win32_Process -Filter "ProcessId=$($candidate.ProcessId)"
 if($verified.ParentProcessId -ne ${ownerPid} -or $verified.ExecutablePath -ne $candidate.ExecutablePath){throw 'Worker ownership changed'}
 Stop-Process -Id $candidate.ProcessId -ErrorAction Stop
 @{parentPid=${ownerPid};workerPid=$candidate.ProcessId;executable=$candidate.ExecutablePath;killedAtMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json -Compress`;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:10000});
 if(result.error||result.status!==0)throw new Error('Owned worker fault injection failed: '+(result.error?.message||result.stderr));
 return JSON.parse(result.stdout.trim());
}
