/** Capability probes do not prove which source actually produced frames. */
import {codecName} from '../../../js/streaming/codecs.js';
export function verifyNegotiatedCodec(samples,requested){
 const codecs=[...new Set(samples.map(s=>s.codec).filter(Boolean).map(codecName))];
 if(!codecs.length||codecs.some(c=>c!==codecName(requested)))throw new Error(`Matched codec failed: requested ${requested}, negotiated ${codecs.join(',')||'unknown'}`);
 return {passed:true,requested,actual:codecs};
}
export function readCaptureBackendEvidence(log,requested){
 if(!['auto','d3d11','d3d12'].includes(requested))throw new Error('Invalid capture backend');
 const pipelineLines=log.split(/\r?\n/).filter(line=>line.includes('[GStreamer Pipeline]')&&/d3d1[12]screencapturesrc\b/.test(line));
 const actual=[...new Set(pipelineLines.map(line=>line.match(/(d3d1[12])screencapturesrc\b/)[1]))];
 const active=pipelineLines.at(-1)?.match(/(d3d1[12])screencapturesrc\b/)?.[1]??null;
 return {requested,actual,active,pipelineLines,matched:requested==='auto'?active!==null:actual.length===1&&actual[0]===requested};
}
