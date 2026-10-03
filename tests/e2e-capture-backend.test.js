import {describe,it,expect} from 'vitest';
import {readCaptureBackendEvidence,verifyNegotiatedCodec} from '../tools/e2e/harness/capture-backend.mjs';
describe('Actual native backend proof',()=>{
 it('registra o backend ativo quando a preferência automática retorna ao D3D11',()=>{
  const log='[GStreamer Pipeline] d3d12screencapturesrc\n[GStreamer Pipeline] d3d11screencapturesrc';
  const result=readCaptureBackendEvidence(log,'auto');
  expect(result.matched).toBe(true);
  expect(result.active).toBe('d3d11');
  expect(result.actual).toEqual(['d3d12','d3d11']);
  expect(readCaptureBackendEvidence('[Media probe] d3d12screencapturesrc: available','auto').matched).toBe(false);
 });
 it('rejects a benchmark that selects H264 but negotiates VP8, and rejects absent evidence',()=>{
  expect(()=>verifyNegotiatedCodec([{codec:'video/VP8'}],'h264')).toThrow('negotiated vp8');
  expect(()=>verifyNegotiatedCodec([],'h264')).toThrow('unknown');
  expect(verifyNegotiatedCodec([{codec:'video/H264'}],'h264').passed).toBe(true);
 });
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
