import {spawn} from 'node:child_process';

/** Explicitly forward only the fixture HTTP/signaling ports to receiver loopback. */
export async function startReverseTunnel({host,ports,timeoutMs=15000}) {
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(host||''))throw new Error('Invalid SSH receiver alias');
  if(!Array.isArray(ports)||!ports.length||ports.some(p=>!Number.isInteger(p)||p<1024||p>65535)||new Set(ports).size!==ports.length)throw new Error('Invalid reverse forwarding ports');
  const command="$ProgressPreference='SilentlyContinue'; Write-Output 'SMG_E2E_TUNNEL_READY'; while ($null -ne [Console]::ReadLine()) {}";
  const args=['-T','-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes',...ports.flatMap(p=>['-R',`127.0.0.1:${p}:127.0.0.1:${p}`]),host,`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(command,'utf16le').toString('base64')}`];
  const child=spawn(process.platform==='win32'?'C:/Windows/System32/OpenSSH/ssh.exe':'ssh',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',errors='';
  child.stderr.on('data',d=>errors=(errors+d.toString()).slice(-3000));
  child.stdin.on('error',e=>{errors=(errors+' '+e.message).slice(-3000);});
  const exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',()=>resolve(null));});
  const stop=async()=>{child.stdin.end();let timer;await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>{child.kill();resolve();},3000);})]);clearTimeout(timer);};
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('SSH reverse forwarding readiness timeout')),timeoutMs);
      const fail=e=>{clearTimeout(timer);reject(new Error('SSH reverse forwarding failed: '+(e?.message||errors)));};
      child.once('error',fail);child.once('exit',fail);
      child.stdout.on('data',d=>{out+=d.toString();if(out.includes('SMG_E2E_TUNNEL_READY')){clearTimeout(timer);child.off('error',fail);child.off('exit',fail);resolve();}});
    });
    return {ports:[...ports],stop};
  }catch(error){await stop();throw error;}
}
