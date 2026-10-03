/** Capability probes do not prove which source actually produced frames. */
export function readCaptureBackendEvidence(log,requested){
 if(!['d3d11','d3d12'].includes(requested))throw new Error('Invalid capture backend');
 const pipelineLines=log.split(/\r?\n/).filter(line=>line.includes('[GStreamer Pipeline]')&&/d3d1[12]screencapturesrc\b/.test(line));
 const actual=[...new Set(pipelineLines.map(line=>line.match(/(d3d1[12])screencapturesrc\b/)[1]))];
 return {requested,actual,pipelineLines,matched:actual.length===1&&actual[0]===requested};
}
