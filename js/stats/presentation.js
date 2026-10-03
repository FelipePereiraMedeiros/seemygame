const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(p*values.length)-1]:null;
/** Lightweight compositor metadata. No pixel reads and no claim of optical glass-to-glass. */
export function observePresentation(video,clock=()=>performance.now()) {
 let handle, stopped=false,lastDisplay=null,lastCount=null,lastCallback=null;
 let intervals=[],callbackIntervals=[],frames=0,missedCallbacks=0,skippedCallbackSpans=0,start=clock();
 function frame(now,metadata) {
  if(stopped)return;
  const display=metadata.expectedDisplayTime??metadata.presentationTime??now;
  const count=metadata.presentedFrames;
  const delta=Number.isFinite(count)&&Number.isFinite(lastCount)?count-lastCount:null;
  // A gap spanning multiple presented frames is a missed notification, not a measured frame interval.
  if(delta===1&&lastDisplay!==null&&display>lastDisplay)intervals.push(display-lastDisplay);
  if(lastCallback!==null&&now>=lastCallback)callbackIntervals.push(now-lastCallback);
  if(delta!==null&&delta>=0){frames+=delta;missedCallbacks+=Math.max(0,delta-1);if(delta>1)skippedCallbackSpans++;}else frames++;
  lastCount=count;lastDisplay=display;lastCallback=now;
  if(intervals.length>512)intervals.shift();
  if(callbackIntervals.length>512)callbackIntervals.shift();
  handle=video.requestVideoFrameCallback(frame);
 }
 if(video?.requestVideoFrameCallback)handle=video.requestVideoFrameCallback(frame);
 return {
  sample() {
   const now=clock(),elapsed=now-start;
   const callbackSilenceMs=lastCallback===null?null:Math.max(0,now-lastCallback);
   const result={presentedFps:handle===undefined||lastCallback===null||elapsed<=0?null:frames*1000/elapsed,frametimeP50Ms:percentile(intervals,.5),frametimeP95Ms:percentile(intervals,.95),maxPauseMs:intervals.length?Math.max(...intervals):null,callbackMaxGapMs:callbackSilenceMs===null?null:Math.max(callbackSilenceMs,...callbackIntervals),callbackSilenceMs,consecutiveFrameIntervals:intervals.length,skippedCallbackSpans,missedCallbacks,presentationEvidence:intervals.length?'consecutive-frame-metadata':lastCallback===null?'unavailable':'callback-only',visibility:globalThis.document?.visibilityState||'unknown'};
   start=now;frames=0;intervals=[];callbackIntervals=[];missedCallbacks=0;skippedCallbackSpans=0;return result;
  },
  dispose(){stopped=true;if(handle!==undefined)video.cancelVideoFrameCallback?.(handle);}
 };
}

