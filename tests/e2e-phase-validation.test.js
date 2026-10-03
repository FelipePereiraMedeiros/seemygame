import {describe,it,expect} from 'vitest';
import {inspectPhaseConditions} from '../tools/e2e/harness/phase-validation.mjs';
const base={timeline:[{phase:'steady',webInbound:{width:1920,height:1080}}],qualitySamples:[{codec:'video/H264'}],width:1920,height:1080,codec:'h264',matchedResolution:true,matchedCodec:true};
describe('phase evidence before rejection',()=>{
 it('retains a resolution failure alongside successful codec evidence instead of aborting collection',()=>{
  const result=inspectPhaseConditions({...base,timeline:[{phase:'steady',webInbound:{width:1280,height:720}}]});
  expect(result.resolutionValidation.passed).toBe(false);expect(result.codecValidation.passed).toBe(true);expect(result.validationErrors).toHaveLength(1);
 });
 it('collects both failed gates so neither condition is silently hidden',()=>{
  const result=inspectPhaseConditions({...base,timeline:[],qualitySamples:[{codec:'video/VP8'}]});
  expect(result.validationErrors).toHaveLength(2);expect(result.codecValidation.passed).toBe(false);
 });
 it('accepts matched observations and leaves unrequested gates unchecked',()=>{
  expect(inspectPhaseConditions(base).validationErrors).toEqual([]);
  expect(inspectPhaseConditions({...base,timeline:[],qualitySamples:[],matchedResolution:false,matchedCodec:false})).toEqual({resolutionValidation:null,codecValidation:null,validationErrors:[]});
 });
});
