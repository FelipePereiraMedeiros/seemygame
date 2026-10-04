import {describe,it,expect} from 'vitest';
import {summarizeClockSamples,validateClockCheckpoints,correctedVisualLatency,calibrateBrowserClocks} from '../tools/e2e/harness/clock-calibration.mjs';
import {frontendSourceMatches} from '../tools/e2e/harness/provenance.mjs';
const exchange=(offset=4000,forward=3,back=7,processing=1,start=100000)=>({localSend:start,remoteReceive:start+forward+offset,remoteSend:start+forward+offset+processing,localReceive:start+forward+processing+back,localMonoSend:start-100,localMonoReceive:start+forward+processing+back-100,sourceTimeOrigin:1,receiverTimeOrigin:2});
const estimate=(offset=4000)=>summarizeClockSamples(Array.from({length:8},(_,i)=>exchange(offset,3,7,1,100000+i*20)));
describe('cross-machine optical clock calibration',()=>{
 it('accepts LF/CRLF checkout differences but still rejects a changed embedded frontend',()=>{
  expect(frontendSourceMatches('export const a=1;\r\nexport const b=2;\n','export const a=1;\nexport const b=2;\r\n')).toBe(true);
  expect(frontendSourceMatches('export const a=2;\r\n','export const a=1;\n')).toBe(false);
  expect(frontendSourceMatches('export const a=1; \n','export const a=1;\n')).toBe(false);
  expect(frontendSourceMatches(null,null)).toBe(false);
 });
 it('keeps asymmetric delay inside the uncertainty interval, without claiming exact offset',()=>{
  const r=estimate();expect(r.status).toBe('valid');expect(r.offsetMs).toBe(3998);expect(r.lowerMs).toBeLessThanOrEqual(4000);expect(r.upperMs).toBeGreaterThanOrEqual(4000);expect(r.uncertaintyMs).toBe(7);expect(r.roundTripMs).toBe(11);
 });
 it('selects the smallest-delay exchange rather than averaging Wi-Fi outliers',()=>{
  const r=summarizeClockSamples([...Array.from({length:7},()=>exchange(4000,30,100)),exchange(4000,1,1)]);expect(r.status).toBe('valid');expect(r.offsetMs).toBe(4000);expect(r.uncertaintyMs).toBe(3);
 });
 it('does not claim calibrated time with too few samples or excessive delay',()=>{
  expect(summarizeClockSamples([exchange()]).status).toBe('insufficient-evidence');expect(summarizeClockSamples(Array(6).fill(exchange(4000,50,50))).status).toBe('too-uncertain');
 });
 it('rejects wall-clock steps and invalid or non-finite timestamps',()=>{
  const bad=[{...exchange(),localReceive:99999},{...exchange(),remoteReceive:NaN},{...exchange(),localReceive:100111},{...exchange(),remoteSend:104002}];const r=summarizeClockSamples(bad);expect(r.acceptedCount).toBe(0);expect(r.rejectedCount).toBe(4);
 });
 it('rejects conflicting intervals and changed browser origins',()=>{
  expect(summarizeClockSamples([...Array(5).fill(exchange()),exchange(4500)]).status).toBe('unstable');expect(summarizeClockSamples([...Array(5).fill(exchange()),{...exchange(),receiverTimeOrigin:3}]).status).toBe('unstable');
 });
 it('rejects a source navigation during a single exchange',()=>{
  const r=summarizeClockSamples(Array(5).fill({...exchange(),sourceTimeOriginAfter:9}));expect(r.acceptedCount).toBe(0);
 });
 it('does not accept an exchange without a browser origin identity',()=>{
  const r=summarizeClockSamples(Array(5).fill({...exchange(),receiverTimeOrigin:undefined}));expect(r.status).toBe('insufficient-evidence');expect(r.acceptedCount).toBe(0);
 });
 it('accepts small observed drift only while the offset envelope fits the error budget',()=>{
  expect(validateClockCheckpoints(estimate(),[estimate(4001)])).toMatchObject({status:'valid',uncertaintyMs:9});expect(validateClockCheckpoints(estimate(),[estimate(4005)])).toMatchObject({status:'invalid',reason:'offset-envelope-exceeds-budget'});
 });
 it('invalidates a source clock step or origin change at later checkpoints',()=>{
  const reference=estimate();expect(validateClockCheckpoints(reference,[{...reference,sourceAnchorMs:reference.sourceAnchorMs+10}]).status).toBe('invalid');expect(validateClockCheckpoints(reference,[{...reference,receiverTimeOrigin:55}]).status).toBe('invalid');
 });
 it('subtracts positive and negative offsets and preserves uint32 rollover',()=>{
  expect(correctedVisualLatency(104100,100000,4000)).toBe(100);expect(correctedVisualLatency(96100,100000,-4000)).toBe(100);const source=2**32-20;expect(correctedVisualLatency(2**32+4080,source,4000)).toBe(100);expect(correctedVisualLatency(NaN,0,0)).toBeNull();
 });
 it('samples the actual source wall clock and receiver performance epoch',async()=>{
  const source={evaluate:async()=>({epoch:100000,mono:99900,timeOrigin:1})},receiver={evaluate:async()=>({receive:104000,send:104000,timeOrigin:2})};const r=await calibrateBrowserClocks(source,receiver,{samples:5});expect(r.status).toBe('valid');expect(r.offsetMs).toBe(4000);expect(r.acceptedCount).toBe(5);
 });
 it('validates calibration budgets and sample counts',async()=>{
  expect(()=>summarizeClockSamples([],{maxErrorMs:0})).toThrow();await expect(calibrateBrowserClocks(null,null,{samples:2})).rejects.toThrow();expect(validateClockCheckpoints(null,[]).status).toBe('invalid');
 });
});
