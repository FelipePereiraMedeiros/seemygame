import {describe,it,expect} from 'vitest';
import {prepareRemoteViewer,validateViewerEndpoint,resourceWindow,redactViewerSecrets} from '../tools/e2e/harness/remote-viewer.mjs';
import {validateWindowPosition} from '../tools/e2e/harness/displays.mjs';
const endpoint='http://127.0.0.1:9334/smg-viewer/token';
const metadata={kind:'seemygame-e2e-viewer',schemaVersion:1,machineFingerprint:'remote',headless:false,playwrightVersion:'1.63.1',wsEndpoint:'ws://127.0.0.1:9333/unguessable'};
const options={localPlaywrightVersion:'1.63.0',localFingerprint:'local'};
describe('Two-machine receiver policy',()=>{
 it('accepts explicit monitor coordinates and rejects malformed browser arguments',()=>{
  expect(validateWindowPosition('-1900, 50')).toBe('-1900,50');
  for(const value of ['10','a,30','1,2,3','1,2 --remote-debugging-port=9','999999,0'])expect(()=>validateWindowPosition(value)).toThrow();
 });
 it('uses only a tunneled loopback endpoint',()=>{
  expect(validateViewerEndpoint(endpoint).hostname).toBe('127.0.0.1');
  for(const value of ['http://192.168.1.20:9334/x','https://127.0.0.1/x','http://u:p@127.0.0.1/x','http://127.0.0.1/x?q=1'])expect(()=>validateViewerEndpoint(value)).toThrow();
 });
 it('rewrites only the forwarded websocket host/port and preserves its opaque path',()=>{
  const result=prepareRemoteViewer(metadata,endpoint,{...options,wsPort:19333});
  expect(result.wsEndpoint).toBe('ws://127.0.0.1:19333/unguessable');expect(result.conditions.sameMachine).toBe(false);
 });
 it('rejects protocol version mismatch and invalid metadata',()=>{
  expect(()=>prepareRemoteViewer({...metadata,playwrightVersion:'1.62.9'},endpoint,options)).toThrow();
  expect(()=>prepareRemoteViewer({...metadata,kind:'other'},endpoint,options)).toThrow();
  expect(()=>prepareRemoteViewer({...metadata,wsEndpoint:'ws://0.0.0.0:9333/x'},endpoint,options)).toThrow();
 });
 it('does not silently label loopback self-tests as two physical machines',()=>{
  expect(()=>prepareRemoteViewer({...metadata,machineFingerprint:'local'},endpoint,options)).toThrow();
  expect(prepareRemoteViewer({...metadata,machineFingerprint:'local'},endpoint,{...options,allowSameMachine:true}).conditions.sameMachine).toBe(true);
 });
 it('marks independent clocks and headless presentation limits explicitly',()=>{
  const result=prepareRemoteViewer({...metadata,headless:true},endpoint,options);
  expect(result.conditions.physicalPresentation).toBe(false);expect(result.conditions.clockPolicy).toContain('disabled');
  const headed=prepareRemoteViewer(metadata,endpoint,options);
  expect(headed.conditions.headedPresentationRequested).toBe(true);expect(headed.conditions.physicalPresentation).toBe(false);
 });
 it('redacts temporary control capabilities from connection errors and paths',()=>{
  const value=`Timeout ${endpoint} ws://127.0.0.1:9333/unguessable and path /unguessable`;
  const redacted=redactViewerSecrets(value,{controlEndpoint:endpoint,wsEndpoint:metadata.wsEndpoint});
  expect(redacted).not.toContain('token');expect(redacted).not.toContain('unguessable');
  expect(redactViewerSecrets(10,{controlEndpoint:endpoint})).toBe(10);
 });
 it('filters resources in the receiver clock without subtracting the transmitter clock',()=>{
  expect(resourceWindow({samples:[{timestamp:100},{timestamp:200},{timestamp:300}]},180,250)).toEqual([{timestamp:200}]);
 });
});
