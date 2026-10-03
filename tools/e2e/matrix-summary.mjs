import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const file=process.argv[2];if(!file)throw new Error('Pass the distributed matrix report.json');
const matrix=JSON.parse(await readFile(file));
const p=(values,q=.5)=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.ceil(q*a.length)-1]:null;};
const rows=[];
for(const run of matrix.runs){
 const r=JSON.parse(await readFile(run.artifact)),phase=run.sender==='web'?r.web:r.native;if(!phase)continue;
 const steady=phase.timeline.filter(s=>s.phase==='steady');
 const remote=r.measurements.filter(m=>m.side==='web');
 const videos=remote.map(m=>m.rows.find(s=>s.type==='inbound-rtp'&&s.kind==='video'&&s.framesDecoded>0)).filter(Boolean);
 const routes=remote.map(m=>{
  const video=m.rows.find(s=>s.type==='inbound-rtp'&&s.kind==='video'&&s.framesDecoded>0);if(!video)return null;
  const stats=m.rows.filter(s=>s.pcId===video.pcId),transport=stats.find(s=>s.type==='transport'&&s.selectedCandidatePairId),pair=stats.find(s=>s.id===transport?.selectedCandidatePairId);
  if(!pair)return null;return {protocol:stats.find(s=>s.id===pair.localCandidateId)?.protocol,localType:stats.find(s=>s.id===pair.localCandidateId)?.candidateType,remoteType:stats.find(s=>s.id===pair.remoteCandidateId)?.candidateType,rttMs:pair.currentRoundTripTime*1000};
 }).filter(Boolean);
 const allSamples=(phase.productionDiagnostic.receiver?.streams||[]).flatMap(s=>s.samples),sender=(phase.productionDiagnostic.sender?.streams||[]).flatMap(s=>s.samples);
 const samples=phase.steadyWindow?allSamples.filter(s=>s.timestamp>=phase.steadyWindow.receiverStart?.perf&&s.timestamp<=phase.steadyWindow.receiverEnd?.perf):allSamples;
 const host=phase.resources?.summary,receiver=phase.receiverResources?.summary,last=videos.at(-1);
 rows.push({sender:run.sender,receiver:run.receiver,preset:run.preset,requestedCodec:run.codec??r.qualityConditions?.requestedCodec,requestedEncoder:run.encoder??r.senderConditions?.requestedEncoder,workerEncoder:[...new Set((r.backendEvidence?.pipelineLines||[]).flatMap(line=>line.match(/\b(?:nvd3d11h264enc|mfh264enc|mfh265enc|x264enc|svtav1enc)\b/g)||[]))],nativeState:r.nativeState,artifact:run.artifact,functionalStatus:r.status,qualification:phase.qualification,
  senderBrowserVersion:r.senderBrowserVersion,receiverBrowserVersion:r.receiverBrowserVersion,receiverConditions:r.receiverConditions,senderConditions:r.senderConditions,resolutionValidation:phase.resolutionValidation,codecValidation:phase.codecValidation,backendEvidence:r.backendEvidence,
  label:run.label,repetition:run.repetition,
  sourceFpsP50:p(steady.map(s=>s.source.fps)),decodedFpsP50:phase.performance.medianDecodedFps,decodedFpsP10:phase.performance.p10DecodedFps,
  presentedFpsP50:p(samples.map(s=>s.presentedFps)),decodeMsP95:p(steady.map(s=>s.webInbound.decodeTimeMs),.95),jitterBufferMsP95:p(steady.map(s=>s.webInbound.jitterBufferMs),.95),
  encoderImplementation:[...new Set(steady.map(s=>s.outbound.encoderImplementation).filter(Boolean))],decoderImplementation:[...new Set(samples.map(s=>s.decoderImplementation).filter(Boolean))],
  encodeMsP50:p(steady.map(s=>s.outbound.encodeTimeMs)),decodeMsP50:p(steady.map(s=>s.webInbound.decodeTimeMs)),jitterBufferMsP50:p(steady.map(s=>s.webInbound.jitterBufferMs)),
  nativeRtpFpsP50:p(sender.map(s=>s.producedFps)),nativePreviewFpsP50:p(steady.map(s=>s.bridge.decodedFps)),codec:[...new Set(samples.map(s=>s.codec).filter(Boolean))],deliveredResolutions:phase.deliveredResolutions,
  receivedMbpsP50:p(samples.map(s=>s.bitrateMbps)),rttMsP50:p(routes.map(s=>s.rttMs)),rttMsP95:p(routes.map(s=>s.rttMs),.95),routes:[...new Set(routes.map(s=>`${s.protocol}:${s.localType}->${s.remoteType}`))],
  finalCounters:{packetsLost:last?.packetsLost,nackCount:last?.nackCount,pliCount:last?.pliCount,framesDropped:last?.framesDropped,freezeCount:last?.freezeCount,totalFreezesDuration:last?.totalFreezesDuration},
  steadyStutters:phase.diagnostics.stutterEvents,steadyMaxCallbackPauseMs:p(steady.map(s=>s.presentation.intervalMaxPauseMs),1),opticalLatency:phase.glassToGlassLatency,
  webCapture:r.webCapture,hostResources:host,receiverResources:receiver,cleanupErrors:r.cleanupErrors||[],pageErrors:r.pageErrors||[]});
}
const result={matrix:file,status:matrix.status,scope:matrix.scope,runs:rows};
await writeFile(path.join(path.dirname(file),'summary.json'),JSON.stringify(result,null,2));
console.table(rows.map(r=>({sender:r.sender,receiver:r.receiver,preset:r.preset,fps:r.decodedFpsP50?.toFixed(2),p10:r.decodedFpsP10?.toFixed(2),presentationP10:r.qualification.presentationP10?.toFixed(2),freezes:r.finalCounters.freezeCount,lost:r.finalCounters.packetsLost,maxPause:r.steadyMaxCallbackPauseMs,quality:r.qualification.status})));
