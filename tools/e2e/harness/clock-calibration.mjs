/** Receiver performance epoch minus source Date.now epoch. No OS clock changes.
 * Four timestamps; causal bounds do not assume symmetric network/control delay.
 * Reference: RFC 5905 section 8. Browser callbacks use HR-Time's monotonic epoch.
 */
export function summarizeClockSamples(samples,{maxErrorMs=10,minSamples=5,timestampSafetyMs=2}={}) {
  if(!Number.isFinite(maxErrorMs)||maxErrorMs<=0||!Number.isFinite(timestampSafetyMs)||timestampSafetyMs<0||!Number.isInteger(minSamples)||minSamples<1)throw Error('Invalid clock calibration budget');
  const accepted=[],rejected=[];
  for(const s of samples){
    const values=[s.localSend,s.remoteReceive,s.remoteSend,s.localReceive,s.localMonoSend,s.localMonoReceive,s.sourceTimeOrigin,s.receiverTimeOrigin];
    const roundTripMs=s.localReceive-s.localSend,processingMs=s.remoteSend-s.remoteReceive;
    const elapsedMismatchMs=Math.abs(roundTripMs-(s.localMonoReceive-s.localMonoSend));
    if(!values.every(Number.isFinite)||roundTripMs<0||processingMs<0||roundTripMs-processingMs < -timestampSafetyMs||elapsedMismatchMs>timestampSafetyMs+1||s.sourceTimeOriginAfter!==undefined&&s.sourceTimeOriginAfter!==s.sourceTimeOrigin){rejected.push({...s,reason:'invalid-order-or-source-clock-step'});continue;}
    const lowerMs=s.remoteSend-s.localReceive-timestampSafetyMs;
    const upperMs=s.remoteReceive-s.localSend+timestampSafetyMs;
    accepted.push({...s,roundTripMs,processingMs,elapsedMismatchMs,lowerMs,upperMs,offsetMs:(lowerMs+upperMs)/2,uncertaintyMs:(upperMs-lowerMs)/2});
  }
  accepted.sort((a,b)=>a.uncertaintyMs-b.uncertaintyMs);
  const best=accepted[0];
  const sourceAnchors=accepted.flatMap(s=>[s.localSend-s.localMonoSend,s.localReceive-s.localMonoReceive]);
  const sourceAnchorRangeMs=sourceAnchors.length?Math.max(...sourceAnchors)-Math.min(...sourceAnchors):null;
  const intervalsConsistent=best?Math.max(...accepted.map(s=>s.lowerMs))<=Math.min(...accepted.map(s=>s.upperMs)):false;
  const sameOrigin=accepted.every(s=>s.sourceTimeOrigin===best?.sourceTimeOrigin&&s.receiverTimeOrigin===best?.receiverTimeOrigin);
  const stable=intervalsConsistent&&sameOrigin&&sourceAnchorRangeMs<=timestampSafetyMs+1;
  const status=accepted.length<minSamples?'insufficient-evidence':!stable?'unstable':best.uncertaintyMs>maxErrorMs?'too-uncertain':'valid';
  return {schemaVersion:1,status,method:'four-browser-timestamps-min-delay-causal-bounds',offsetConvention:'receiverPerformanceEpoch - sourceDateEpoch; subtract offset from receiver presentation time',offsetMs:best?.offsetMs??null,uncertaintyMs:best?.uncertaintyMs??null,lowerMs:best?.lowerMs??null,upperMs:best?.upperMs??null,roundTripMs:best?.roundTripMs??null,sourceTimeOrigin:best?.sourceTimeOrigin??null,receiverTimeOrigin:best?.receiverTimeOrigin??null,sourceAnchorMs:best?best.localSend-best.localMonoSend:null,sourceAnchorRangeMs,intervalsConsistent,sampleCount:samples.length,acceptedCount:accepted.length,rejectedCount:rejected.length,maxErrorMs,timestampSafetyMs,samples:accepted,rejected,limitations:['Control-path delay bounds include browser IPC and SSH scheduling, not media transport delay.','Minimum-delay midpoint is an estimate; one-way asymmetry remains inside the reported causal interval.','Timestamp safety margin and checkpoint stability are assumptions, not hardware clock certification.']};
}

export async function calibrateBrowserClocks(sourcePage,receiverPage,{samples=25,maxErrorMs=10}={}) {
  if(!Number.isInteger(samples)||samples<5||samples>100)throw Error('Clock samples must be 5..100');
  const rows=[];
  const local=()=>sourcePage.evaluate(()=>({epoch:Date.now(),mono:performance.timeOrigin+performance.now(),timeOrigin:performance.timeOrigin}));
  for(let i=0;i<samples;i++){
    const before=await local();
    const remote=await receiverPage.evaluate(()=>{
      const receive=performance.timeOrigin+performance.now();
      return {receive,send:performance.timeOrigin+performance.now(),timeOrigin:performance.timeOrigin};
    });
    const after=await local();
    rows.push({localSend:before.epoch,remoteReceive:remote.receive,remoteSend:remote.send,localReceive:after.epoch,localMonoSend:before.mono,localMonoReceive:after.mono,sourceTimeOrigin:before.timeOrigin,sourceTimeOriginAfter:after.timeOrigin,receiverTimeOrigin:remote.timeOrigin});
  }
  return {...summarizeClockSamples(rows,{maxErrorMs}),collectedAtSourceEpoch:rows.at(-1)?.localReceive};
}

export function validateClockCheckpoints(reference,checkpoints,{maxErrorMs=10,opticalQuantizationMs=1}={}) {
  if(!reference||reference.status!=='valid'||!Number.isFinite(reference.offsetMs))return {status:'invalid',reason:'invalid-reference',uncertaintyMs:null};
  const points=[reference,...checkpoints];
  if(points.some(p=>p.status!=='valid'||p.sourceTimeOrigin!==reference.sourceTimeOrigin||p.receiverTimeOrigin!==reference.receiverTimeOrigin||Math.abs(p.sourceAnchorMs-reference.sourceAnchorMs)>3))return {status:'invalid',reason:'clock-step-origin-change-or-uncertain-checkpoint',uncertaintyMs:null};
  const uncertaintyMs=Math.max(...points.map(p=>Math.abs(p.offsetMs-reference.offsetMs)+p.uncertaintyMs))+opticalQuantizationMs;
  return {status:uncertaintyMs<=maxErrorMs?'valid':'invalid',reason:uncertaintyMs<=maxErrorMs?null:'offset-envelope-exceeds-budget',uncertaintyMs,offsetMs:reference.offsetMs,observedOffsetRangeMs:Math.max(...points.map(p=>p.offsetMs))-Math.min(...points.map(p=>p.offsetMs)),checkpointCount:points.length,maxErrorMs,scope:'offset envelope at sampled checkpoints; unobserved transients cannot be certified'};
}

export function correctedVisualLatency(receiverEpoch,sourceTime32,offsetMs) {
  if(!Number.isFinite(receiverEpoch)||!Number.isFinite(sourceTime32)||!Number.isFinite(offsetMs))return null;
  return (((Math.floor(receiverEpoch-offsetMs)>>>0)-(sourceTime32>>>0))|0);
}
