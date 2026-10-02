import {describe,it,expect} from 'vitest';
import {cpuInterval,normalizeResourceSample,summarizeResources} from '../tools/e2e/harness/resources.mjs';
import {summarizeQualityRuns,evaluateStreamVerdict} from '../tools/e2e/harness/verdict.mjs';
import {assessQuality} from '../js/streaming/quality.js';
import {createMotionFixture} from '../tools/e2e/fixtures/motion.mjs';
import {readSourceStatsSummary} from '../tools/e2e/harness/source-summary.mjs';
const core=(user,idle)=>({times:{user,idle,sys:0,nice:0,irq:0}});
const options={runnerPid:10,logicalProcessors:4,cpu:{totalPercent:30,busiestCorePercent:80},freeMemoryBytes:2*1024**3,totalMemoryBytes:8*1024**3};
describe('System resource measurement',()=>{
 it('weights CPU intervals and exposes single-core saturation',()=>{
  const value=cpuInterval([core(0,0),core(0,0)],[core(100,0),core(0,100)]);
  expect(value.totalPercent).toBe(50);expect(value.busiestCorePercent).toBe(100);
  expect(cpuInterval(null,[]).totalPercent).toBeNull();
 });
 it('marks a reset/topology change unavailable instead of idle',()=>{
  expect(cpuInterval([core(100,100)],[core(0,0)]).totalPercent).toBeNull();
  expect(cpuInterval([core(0,0)],[core(0,0),core(0,0)]).totalPercent).toBeNull();
 });
 it('normalizes CPU to machine capacity and attributes descendants, not unrelated browsers',()=>{
  const processes=[{pid:10,parentPid:1,name:'node.exe',startedAt:1,cpuTimeMs:0},{pid:20,parentPid:10,name:'seemygame.exe',startedAt:2,cpuTimeMs:0},{pid:30,parentPid:20,name:'gst-launch-1.0.exe',startedAt:3,cpuTimeMs:0},{pid:40,parentPid:1,name:'chrome.exe',startedAt:4,cpuTimeMs:0}];
  const previous={timestamp:1000,processes},raw={timestamp:2000,processes:processes.map(p=>({...p,cpuTimeMs:1000})),gpuAvailable:false};
  const value=normalizeResourceSample(raw,previous,options);
  expect(value.processGroups['native-worker'].cpuPercent).toBe(25);expect(value.externalTopCpu[0].pid).toBe(40);
 });
 it('does not reuse CPU counters or ancestry after PID reuse',()=>{
  const previous={timestamp:1000,processes:[{pid:20,cpuTimeMs:100,startedAt:1}]};
  const raw={timestamp:2000,processes:[{pid:20,parentPid:10,cpuTimeMs:200,startedAt:2},{pid:10,parentPid:1,name:'node.exe',startedAt:3}]};
  const value=normalizeResourceSample(raw,previous,options);expect(value.processGroups.external.cpuPercent).toBeNull();expect(value.ownedProcesses).not.toContainEqual(expect.objectContaining({pid:20}));
 });
 it('times each process reading with a monotonic clock despite a slow snapshot or wall-clock adjustment',()=>{
  const prior={pid:40,parentPid:1,name:'chrome.exe',startedAt:1,cpuTimeMs:0,cpuSampleMonotonicMs:100};
  const raw={timestamp:1100,processes:[{...prior,cpuTimeMs:2000,cpuSampleMonotonicMs:1100}]};
  const previous={timestamp:1000,processes:[prior]};
  expect(normalizeResourceSample(raw,previous,options).processGroups.external.cpuPercent).toBe(50);
  expect(normalizeResourceSample({...raw,timestamp:500},previous,options).processGroups.external.cpuPercent).toBe(50);
 });
 it('marks impossible process/group CPU unavailable rather than clamping it to a plausible value',()=>{
  const processes=[40,41,42].map(pid=>({pid,parentPid:1,name:'external.exe',startedAt:pid,cpuTimeMs:0}));
  const previous={timestamp:1000,processes};
  const value=normalizeResourceSample({timestamp:2000,processes:processes.map(p=>({...p,cpuTimeMs:2000}))},previous,options);
  expect(value.processGroups.external.cpuPercent).toBeNull();expect(value.processCpuInconsistent).toBe(true);
  expect(summarizeResources([value]).warnings).toContain('process-cpu-inconsistent');
  const impossible=normalizeResourceSample({timestamp:2000,processes:[{...processes[0],cpuTimeMs:4500}]},previous,options);
  expect(impossible.externalTopCpu).toHaveLength(0);expect(impossible.processCpuInconsistent).toBe(true);
 });
 it('flags a delayed resource collection without attributing a streaming failure to it',()=>{
  expect(summarizeResources([{intervalMs:1000,collectionMs:500}]).warnings).toContain('slow-resource-collection');
 });
 it('adds processes on the same physical GPU engine, not different engines',()=>{
  const prefix=pid=>'pid_'+pid+'_luid_0x0_0x1_phys_0_eng_';
  const value=normalizeResourceSample({timestamp:1000,gpuAvailable:true,gpuEngines:[{instance:prefix(10)+'0_engtype_3D',value:40},{instance:prefix(20)+'0_engtype_3D',value:20},{instance:prefix(10)+'1_engtype_VideoEncode',value:50}],processes:[]},null,options);
  expect(value.gpu.busiestEnginePercent).toBe(60);expect(value.gpu.engines).toHaveLength(2);expect(value.gpu.topProcesses[0].busiestEnginePercent).toBe(50);
 });
 it('keeps unavailable GPU and protected CPU readings null',()=>{
  const value=normalizeResourceSample({timestamp:1000,gpuAvailable:false,processes:[{pid:99,cpuTimeMs:null}]},null,options);
  expect(value.gpu.busiestEnginePercent).toBeNull();expect(value.processGroups.external.cpuPercent).toBeNull();expect(summarizeResources([value]).warnings).toContain('gpu-metric-unavailable');
 });
 it('flags pressure without claiming it caused the stutter',()=>{
  const result=summarizeResources([{cpu:{totalPercent:90,busiestCorePercent:99},gpu:{busiestEnginePercent:99},collectionMs:3}]);
  expect(result.warnings).toContain('busy-gpu-engine');expect(result.interpretation).toContain('not proof');
 });
});
describe('E2E truthful acceptance',()=>{
 it('reads only source counters during sampling and preserves the full provenance log',()=>{
  const frameLog=Array.from({length:10000},(_,seq)=>({seq,timeMs:seq}));
  const stats={framesProduced:10000,fps:60,sessionMagic:42,width:1280,height:720,frameLog};
  const summary=readSourceStatsSummary(stats);
  expect(summary.frameLogLength).toBe(10000);expect(summary).not.toHaveProperty('frameLog');
  expect(JSON.stringify(summary).length).toBeLessThan(200);expect(stats.frameLog).toBe(frameLog);
  expect(readSourceStatsSummary(null)).toBeNull();
 });
 it('produces a source matching the requested 1080p profile',()=>{
  const html=createMotionFixture('test',10,60,{width:1920,height:1080});expect(html).toContain('<canvas width="1920" height="1080">');expect(html).toContain('width:1920,height:1080');
 });
 it('never passes an empty or entirely unsupported codec suite',()=>{
  expect(summarizeQualityRuns([]).status).toBe('inconclusive');expect(summarizeQualityRuns([{status:'unsupported'}]).functionalPassed).toBe(false);
 });
 it('separates successful delivery from insufficient duration',()=>{
  const runs=[{status:'delivered',assessment:{status:'insufficient-evidence'}}];
  expect(summarizeQualityRuns(runs).status).toBe('passed');expect(summarizeQualityRuns(runs,{requireQuality:true}).status).toBe('inconclusive');
 });
 it('fails a requested qualification despite functional delivery',()=>{
  expect(summarizeQualityRuns([{status:'delivered',assessment:{status:'failed'}}],{requireQuality:true}).status).toBe('failed');
 });
 it('does not report performance passed with no FPS requirement',()=>{
  const verdict=evaluateStreamVerdict({functionalPassed:true,measurementRequested:false});
  expect(verdict.performancePassed).toBeNull();expect(verdict.measurementValid).toBeNull();expect(verdict.overallStatus).toBe('passed');
 });
 it('uses FPS p10 and requires an actual value',()=>{
  expect(evaluateStreamVerdict({functionalPassed:true,measurementRequested:false,minFps:54,p10Fps:50}).overallStatus).toBe('failed');
  expect(evaluateStreamVerdict({functionalPassed:true,measurementRequested:false,minFps:54,p10Fps:null}).overallStatus).toBe('inconclusive');
 });
 it('cannot qualify an explicitly requested codec that fell back',()=>{
  const rows=Array.from({length:60},()=>({measuredFps:60,presentedFps:60,intervalMs:1000,width:1280,height:720,codec:'video/H264',visibility:'visible',maxPauseMs:17}));
  expect(assessQuality(rows,{fps:60,width:1280,height:720,codec:'hevc'}).status).toBe('failed');
  expect(assessQuality(rows,{fps:60,width:1280,height:720,codec:'auto'}).status).toBe('passed');
 });
});
