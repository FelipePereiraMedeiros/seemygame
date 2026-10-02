import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function validateWindowPosition(value) {
 const parts=String(value).split(',');
 if(parts.length!==2||parts.some(p=>!/^\s*-?\d+\s*$/.test(p)||Math.abs(Number(p))>100000))throw new Error('Window position must be x,y integers');
 return parts.map(Number).join(',');
}
export async function readDisplayModes() {
 if(process.platform!=='win32')return {status:'unsupported',displays:[]};
 let child,timer,output='';try {
  child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./display-info.ps1',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  child.stdout.on('data',d=>output+=d.toString());
  const code=await Promise.race([new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}),new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill();reject(new Error('Display preflight timeout'));},10000);})]);
  if(code!==0)return {status:'unavailable',displays:[]};return {status:'available',...JSON.parse(output.trim())};
 }catch{return {status:'unavailable',displays:[]};}finally{clearTimeout(timer);}
}
