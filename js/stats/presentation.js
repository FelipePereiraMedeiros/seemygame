const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(p*values.length)-1]:null;
/** Lightweight compositor metadata. No pixel reads and no claim of optical glass-to-glass. */
export function observePresentation(video,clock=()=>performance.now()) {
 let handle, stopped=false,lastDisplay=null,lastCount=null,lastCallback=null;
 let intervals=[],frames=0,missedCallbacks=0,start=clock();
 function frame(now,metadata) {
  if(stopped)return;
  const display=metadata.expectedDisplayTime??metadata.presentationTime??now;
  if(lastDisplay!==null&&display>lastDisplay)intervals.push(display-lastDisplay);
  const count=metadata.presentedFrames;
  if(Number.isFinite(count)&&lastCount!==null&&count>=lastCount){frames+=count-lastCount;missedCallbacks+=Math.max(0,count-lastCount-1);}else frames++;
  lastCount=count;lastDisplay=display;lastCallback=now;
  if(intervals.length>512)intervals.shift();
  handle=video.requestVideoFrameCallback(frame);
 }
 if(video?.requestVideoFrameCallback)handle=video.requestVideoFrameCallback(frame);
 return {
  sample() {
   const now=clock(),elapsed=now-start;
   const result={presentedFps:handle===undefined||lastCallback===null||elapsed<=0?null:frames*1000/elapsed,frametimeP50Ms:percentile(intervals,.5),frametimeP95Ms:percentile(intervals,.95),maxPauseMs:lastCallback===null?null:Math.max(now-lastCallback,...intervals,0),missedCallbacks,visibility:globalThis.document?.visibilityState||'unknown'};
   start=now;frames=0;intervals=[];missedCallbacks=0;return result;
  },
  dispose(){stopped=true;if(handle!==undefined)video.cancelVideoFrameCallback?.(handle);}
 };
}

