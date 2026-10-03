import {verifyDeliveredResolution} from './capture-geometry.mjs';
import {verifyNegotiatedCodec} from './capture-backend.mjs';

/** Collect failed gates; callers persist phase evidence before rejecting the run. */
export function inspectPhaseConditions({timeline,qualitySamples,width,height,codec,matchedResolution,matchedCodec}) {
 const validationErrors=[];
 const check=fn=>{try{return fn();}catch(error){const message=error.message??String(error);validationErrors.push(message);return {passed:false,error:message};}};
 return {
  resolutionValidation:matchedResolution?check(()=>verifyDeliveredResolution(timeline,width,height)):null,
  codecValidation:matchedCodec?check(()=>verifyNegotiatedCodec(qualitySamples,codec)):null,
  validationErrors
 };
}
