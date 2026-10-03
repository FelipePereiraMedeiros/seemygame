import {startReverseTunnel} from './ssh-reverse.mjs';
/** Retry only an occupied remote port, before any capture or room is started. */
export async function startForwardedFixtures({host,startAssets,startSignaling,startTunnel=startReverseTunnel,maxAttempts=3}){
 if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw Error('Invalid fixture retry budget');
 const attempts=[];
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  let assets,signaling;
  try{
   assets=await startAssets();signaling=await startSignaling();
   const ports=[Number(new URL(assets.origin).port),signaling.config.port];
   try{const tunnel=await startTunnel({host,ports});attempts.push({attempt,ports,status:'ready'});return {assets,signaling,tunnel,attempts};}
   catch(error){attempts.push({attempt,ports,status:'failed',error:error.message});throw error;}
  }catch(error){
   await signaling?.close();await assets?.close();
   if(!/remote port forwarding failed for listen port \d+/.test(error.message)||attempt===maxAttempts){error.forwardingAttempts=attempts;throw error;}
  }
 }
}
