import os from 'node:os';
import {createHash} from 'node:crypto';

export function machineFingerprint() {
  return createHash('sha256').update(`${os.hostname()}|${os.platform()}|${os.arch()}|${os.cpus()[0]?.model}`).digest('hex');
}
export function validateViewerEndpoint(value) {
  const url=new URL(value);
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw new Error('Viewer control must use HTTP loopback through an SSH tunnel, without URL credentials/query/fragment');
  return url;
}
export async function readViewerControl(endpoint,route,{timeoutMs=5000}={}) {
  const url=validateViewerEndpoint(endpoint);url.pathname=url.pathname.replace(/\/$/,'')+'/'+route;
  const response=await fetch(url,{signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
  if(!response.ok)throw new Error(`Viewer control ${route}: HTTP ${response.status}`);
  return response.json();
}
export function prepareRemoteViewer(metadata,endpoint,{localPlaywrightVersion,localFingerprint,wsPort,allowSameMachine=false}={}) {
  if(metadata?.kind!=='seemygame-e2e-viewer'||metadata.schemaVersion!==1||typeof metadata.machineFingerprint!=='string'||typeof metadata.headless!=='boolean')throw new Error('Invalid remote viewer metadata');
  const version=v=>String(v||'').split('.').slice(0,2).join('.');
  if(version(metadata.playwrightVersion)!==version(localPlaywrightVersion))throw new Error('Remote/local Playwright major.minor versions must match');
  const connectionType=metadata.connectionType||'playwright';
  if(!['playwright','cdp'].includes(connectionType))throw new Error('Invalid receiver connection type');
  const control=validateViewerEndpoint(endpoint),ws=new URL(connectionType==='cdp'?metadata.cdpEndpoint:metadata.wsEndpoint);
  if(ws.protocol!==(connectionType==='cdp'?'http:':'ws:')||!['localhost','127.0.0.1','[::1]'].includes(ws.hostname)||ws.username||ws.password||ws.search||ws.hash||(connectionType==='playwright'&&ws.pathname==='/')||(connectionType==='cdp'&&ws.pathname!=='/'))throw new Error('Invalid loopback receiver endpoint');
  const port=Number(wsPort??ws.port);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid forwarded browser port');
  const sameMachine=metadata.machineFingerprint===localFingerprint;
  if(sameMachine&&!allowSameMachine)throw new Error('Remote viewer is on the same machine; use --allow-same-machine-remote only for harness validation');
  ws.hostname=control.hostname;ws.port=String(port);
  return {connectionType,wsEndpoint:ws.toString(),conditions:{sameMachine,runtime:metadata.runtime||'chrome',connectionType,headless:metadata.headless,physicalPresentation:false,headedPresentationRequested:!metadata.headless,playwrightVersion:metadata.playwrightVersion,machineFingerprint:metadata.machineFingerprint,platform:metadata.platform,cpuModel:metadata.cpuModel,logicalProcessors:metadata.logicalProcessors,session:metadata.session,clockPolicy:'Independent clocks: optical glass-to-glass disabled; receiver quality/resource windows use receiver clock'}};
}
export function resourceWindow(report,start,end) {
  return (report?.samples||[]).filter(s=>s.timestamp>=start&&s.timestamp<=end);
}
export function redactViewerSecrets(value,{controlEndpoint,wsEndpoint}={}) {
  if(typeof value!=='string')return value;
  for(const endpoint of [controlEndpoint,wsEndpoint]) {
    if(!endpoint)continue;
    const pathname=new URL(endpoint).pathname;
    value=value.replaceAll(endpoint,'[viewer-endpoint]');
    if(pathname!=='/')value=value.replaceAll(pathname,'[viewer-capability]');
  }
  return value;
}
