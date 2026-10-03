import {describe,it,expect} from 'vitest';
import {readCaptureBackendEvidence} from '../tools/e2e/harness/capture-backend.mjs';
describe('Actual native backend proof',()=>{
 it('ignores available D3D11 plugins when the actual worker runs D3D12',()=>{
  const result=readCaptureBackendEvidence('[Media probe] d3d11screencapturesrc: available\n[GStreamer Pipeline] gst-launch-1.0 d3d12screencapturesrc ! d3d12convert ! d3d12download ! nvd3d11h264enc','d3d12');
  expect(result.matched).toBe(true);expect(result.actual).toEqual(['d3d12']);
 });
 it('rejects silent fallback, missing worker evidence and mixed backends',()=>{
  expect(readCaptureBackendEvidence('[GStreamer Pipeline] d3d11screencapturesrc','d3d12').matched).toBe(false);
  expect(readCaptureBackendEvidence('[Media probe] d3d12screencapturesrc: available','d3d12').matched).toBe(false);
  expect(readCaptureBackendEvidence('[GStreamer Pipeline] d3d12screencapturesrc\n[GStreamer Pipeline] d3d11screencapturesrc','d3d12').matched).toBe(false);
 });
});
