import {afterEach,describe,expect,it,vi} from 'vitest';
import {installTelemetry} from '../tools/e2e/telemetry/installer.mjs';
import {encodeOpticalMarker,MARKER_CONFIG} from '../tools/e2e/optical.mjs';

afterEach(()=>{vi.restoreAllMocks();document.body.replaceChildren();delete window.__smgE2E;delete window.__smgClockCalibration;});

async function setupReader(width,blockWidth,options={}){
 let time=1000,callback,sequence=1,magic=0x1234;
 vi.spyOn(performance,'now').mockImplementation(()=>time);
 window.RTCPeerConnection=class {};
 const reads=[];
 const pixels=()=>{
  const data=new Uint8ClampedArray(width*200*4);
  const ctx={fillStyle:'#000000',fillRect(x,y,w,h){
   const value=this.fillStyle==='#FFFFFF'?255:0;
   for(let row=Math.floor(y);row<Math.ceil(y+h);row++)for(let col=Math.floor(x);col<Math.ceil(x+w);col++){
    const index=(row*width+col)*4;data[index]=value;data[index+1]=value;data[index+2]=value;data[index+3]=255;
   }
  }};
  encodeOpticalMarker(ctx,sequence,performance.timeOrigin+time,magic,{...MARKER_CONFIG,blockWidth});return data;
 };
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(){
  let crop;const thisCanvas=this;
  return {drawImage(_video,x,y,w,h){crop={x,y,w,h};},getImageData(_x,_y,w,h){
   // A real browser clips reads to canvas dimensions; do not let an undersized canvas pass.
   expect(w).toBeLessThanOrEqual(thisCanvas.width);expect(h).toBeLessThanOrEqual(thisCanvas.height);
   reads.push({...crop,w,h});const source=pixels(),data=new Uint8ClampedArray(w*h*4);
   for(let row=0;row<h;row++)data.set(source.subarray(((row+crop.y)*width+crop.x)*4,((row+crop.y)*width+crop.x+w)*4),row*w*4);
   return {data};
  }};
 });
 const video=document.createElement('video');
 Object.defineProperties(video,{videoWidth:{get:()=>width},videoHeight:{value:1080},readyState:{value:4}});
 video.requestVideoFrameCallback=fn=>{callback=fn;return 1;};document.body.append(video);
 installTelemetry({expectedSessionMagic:0x1234,opticalSampleHz:4,...options});await window.__smgE2E.sample();
 return {reads,video,resize(w,bw){width=w;blockWidth=bw;},setMagic(value){magic=value;},frame(metadata={}){time+=250;sequence++;callback(time,{presentedFrames:sequence,expectedDisplayTime:time,...metadata});return video.__smgPresentation.getStats();}};
}

describe('optical reader cached ROI',()=>{
 it.each([[1280,8],[1920,12],[3840,24]])('uses the cached region after detection at width %i',async(width,blockWidth)=>{
  const reader=await setupReader(width,blockWidth);expect(reader.frame().validSamplesCount).toBe(1);
  expect(reader.frame().validSamplesCount).toBe(2);
  expect(reader.reads[0].h).toBe(200);
  expect(reader.reads[1].h).toBeLessThanOrEqual(10);
  expect(reader.reads[1].w).toBeLessThan(width);
 });
 it('keeps an explicit legacy control for the instrumentation A/B experiment',async()=>{
  const reader=await setupReader(1920,12,{opticalReaderMode:'legacy'});reader.frame();reader.frame();expect(reader.reads[1].h).toBe(200);
 });
 it('performs no canvas reads when the optical instrument is disabled',async()=>{
  const reader=await setupReader(1920,12,{enableOptical:false});reader.frame();expect(reader.reads).toHaveLength(0);
 });
 it('reacquires a resized marker and returns to the cached region',async()=>{
  const reader=await setupReader(1280,8);reader.frame();reader.resize(1920,12);
  expect(reader.frame().validSamplesCount).toBe(2);expect(reader.reads.at(-1).h).toBe(200);
  expect(reader.frame().validSamplesCount).toBe(3);expect(reader.reads.at(-1).h).toBeLessThanOrEqual(10);
 });
 it('continues rejecting markers from another session in the fast path',async()=>{
  const reader=await setupReader(1920,12);reader.frame();reader.setMagic(0x4321);
  const stats=reader.frame();expect(stats.validSamplesCount).toBe(1);expect(stats.rejectedCandidatesCount).toBe(1);
 });
 it('can request a GPU-friendly canvas while preserving pixels, CRC and cached ROI',async()=>{
  const reader=await setupReader(1920,12,{opticalReaderMode:'gpu-roi'});reader.frame();
  const stats=reader.frame();expect(stats.validSamplesCount).toBe(2);expect(stats.opticalReader.fastSuccesses).toBe(1);
  expect(reader.reads[1].h).toBe(8);
  const calls=HTMLCanvasElement.prototype.getContext.mock.calls;
  expect(calls).toHaveLength(2);expect(calls.every(c=>c[1].willReadFrequently===false)).toBe(true);
 });
 it('separates missed callbacks from gaps between consecutive presented frames',async()=>{
  const reader=await setupReader(1920,12,{enableOptical:false});reader.frame({presentedFrames:100});
  const skipped=reader.frame({presentedFrames:106});expect(skipped.callbackCadence.missedCallbacks).toBe(5);
  expect(skipped.callbackCadence.consecutiveFrameDisplayGapMs).toBeNull();
  expect(skipped.intervalMaxPauseMs).toBe(0);expect(skipped.intervalCallbackMaxGapMs).toBe(250);
  expect(skipped.intervalSkippedCallbackSpans).toBe(1);
  const consecutive=reader.frame({presentedFrames:107});expect(consecutive.callbackCadence.consecutiveFrameDisplayGapMs.max).toBe(250);
  expect(consecutive.intervalMaxPauseMs).toBe(250);
  const consumed=reader.video.__smgPresentation.getStats({reset:true});expect(consumed.intervalMaxPauseMs).toBe(250);
  expect(reader.video.__smgPresentation.getStats().intervalMaxPauseMs).toBe(0);
  expect(consecutive.callbackCadence.callbackCount).toBe(3);
 });
 it('clears reader and callback evidence on a new measurement session',async()=>{
  const reader=await setupReader(1920,12);reader.frame();reader.frame();reader.video.__smgPresentation.resetSession();
  const stats=reader.video.__smgPresentation.getStats();expect(stats.validSamplesCount).toBe(0);
  expect(stats.opticalReader.fullSearches).toBe(0);expect(stats.callbackCadence.callbackCount).toBe(0);
  expect(reader.frame().opticalReader.fullSearches).toBe(1);
 });
});
