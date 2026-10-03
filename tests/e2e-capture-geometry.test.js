import {describe,it,expect} from 'vitest';
import {windowCorrection,verifyDeliveredResolution} from '../tools/e2e/harness/capture-geometry.mjs';
describe('Physical capture window correction',()=>{
 it('corrects decorated capture pixels rather than emulated canvas dimensions',()=>{
  expect(windowCorrection({width:1296,height:808},{width:1280,height:800},{width:1280,height:720})).toEqual({width:1296,height:728});
 });
 it('converts physical pixel errors to window coordinates using the source pixel ratio',()=>{
  expect(windowCorrection({width:1000,height:600},{width:1480,height:880},{width:1500,height:900},1.5)).toEqual({width:1013,height:613});
 });
 it('rejects absent or unbounded observations instead of resizing arbitrary windows',()=>{
  expect(()=>windowCorrection({width:0,height:600},{width:1280,height:720},{width:1280,height:720})).toThrow();
  expect(()=>windowCorrection({width:1280,height:720},{width:1,height:1},{width:9000,height:720})).toThrow();
 });
 it('rejects steady resolution mismatch even if startup initially had the target size',()=>{
  expect(()=>verifyDeliveredResolution([{phase:'warmup',webInbound:{width:1280,height:720}},{phase:'steady',webInbound:{width:1152,height:720}}],1280,720)).toThrow('1152x720');
  expect(()=>verifyDeliveredResolution([],1280,720)).toThrow('no steady frames');
  expect(verifyDeliveredResolution([{phase:'steady',webInbound:{width:1920,height:1080}}],1920,1080).passed).toBe(true);
 });
});
