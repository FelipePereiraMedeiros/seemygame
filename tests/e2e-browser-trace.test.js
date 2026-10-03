import {describe,it,expect} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {summarizeTrace,startBrowserTrace} from '../tools/e2e/harness/browser-trace.mjs';
describe('browser trace evidence',()=>{
 it('keeps different processes and threads separate, ignoring zero and duplicate gaps',()=>{
  const trace={traceEvents:[{ph:'M',pid:1,tid:2,name:'thread_name',args:{name:'CrRendererMain'}},...[0,16667,16667,33334].map(ts=>({ph:'I',pid:1,tid:2,name:'BeginFrame',ts})),{ph:'I',pid:9,tid:2,name:'BeginFrame',ts:1000000}]};
  const result=summarizeTrace(trace),row=result.cadence.find(r=>r.pid===1);
  expect(result.cadence).toHaveLength(2);expect(row.thread).toBe('CrRendererMain');expect(row.positiveIntervals).toBe(2);expect(row.gapP50Ms).toBe(16.667);
 });
 it('does not pretend asynchronous spans are main-thread CPU time',()=>{
  const result=summarizeTrace({traceEvents:[{ph:'b',pid:1,tid:1,name:'Decode',ts:0,dur:1000000},{ph:'X',pid:1,tid:1,name:'RunTask',ts:1,dur:60000},{ph:'X',pid:1,tid:1,name:'RunTask',ts:60001,dur:1000}]});
  expect(result.longSlices).toHaveLength(1);expect(result.longSlices[0].longSlices).toBe(1);expect(result.longSlices[0].totalDurationMs).toBe(61);
 });
 it('preserves synchronization marks and empty evidence',()=>{
  expect(summarizeTrace({}).eventCount).toBe(0);
  expect(summarizeTrace({traceEvents:[{name:'smg-trace-start',ts:120,ph:'I'}]}).markers[0].ts).toBe(120);
 });
 it('defers trace transfer until the measurement window has closed',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'smg-trace-test-'));
  const calls=[],cdp=new EventEmitter();let clock=1,deliverCompletion;
  cdp.detach=async()=>calls.push('detach');
  cdp.send=async(method)=>{calls.push(method);if(method==='Tracing.end')deliverCompletion=()=>cdp.emit('Tracing.tracingComplete',{stream:'owned-trace',dataLossOccurred:false});if(method==='IO.read')return {data:'{"traceEvents":[]}',eof:true};return {};};
  const browser={newBrowserCDPSession:async()=>cdp},page={evaluate:async()=>({perf:clock++,epoch:1000+clock})};
  try{
   const recording=await startBrowserTrace(browser,page,{file:path.join(directory,'trace.json')});
   const pending=await recording.stop({deferRead:true});expect(pending.pending).toBe(true);expect(calls).not.toContain('IO.read');
   deliverCompletion();
   const result=await pending.collect();expect(result.summary.eventCount).toBe(0);expect(calls).toContain('IO.close');expect(calls.at(-1)).toBe('detach');expect(JSON.parse(await readFile(result.file,'utf8')).traceEvents).toEqual([]);
   await expect(pending.collect()).rejects.toThrow('closed');
  }finally{if(!directory.startsWith(path.join(os.tmpdir(),'smg-trace-test-')))throw Error('Unexpected temp directory');await rm(directory,{recursive:true,force:true});}
 });
});
