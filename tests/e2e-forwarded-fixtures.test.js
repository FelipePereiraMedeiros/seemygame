import {describe,it,expect,vi} from 'vitest';
import {startForwardedFixtures} from '../tools/e2e/harness/forwarded-fixtures.mjs';
function fixtures(){let port=20000;const assets=[],signaling=[];return {assets,signaling,startAssets:async()=>{const value={origin:`http://127.0.0.1:${++port}`,close:vi.fn()};assets.push(value);return value;},startSignaling:async()=>{const value={config:{port:++port},close:vi.fn()};signaling.push(value);return value;}};}
describe('remote fixture port collision',()=>{
 it('recreates only owned servers with new ports before retrying a collision',async()=>{
  const f=fixtures(),startTunnel=vi.fn().mockRejectedValueOnce(Error('remote port forwarding failed for listen port 20001')).mockResolvedValue({stop:vi.fn()});
  const result=await startForwardedFixtures({host:'notebook',...f,startTunnel});
  expect(result.attempts.map(a=>a.ports)).toEqual([[20001,20002],[20003,20004]]);expect(f.assets[0].close).toHaveBeenCalledOnce();expect(f.signaling[0].close).toHaveBeenCalledOnce();expect(result.assets.close).not.toHaveBeenCalled();
 });
 it('does not retry authentication and transport failures',async()=>{
  const f=fixtures(),startTunnel=vi.fn().mockRejectedValue(Error('SSH authentication denied'));
  await expect(startForwardedFixtures({host:'notebook',...f,startTunnel})).rejects.toThrow('authentication');expect(startTunnel).toHaveBeenCalledOnce();expect(f.assets[0].close).toHaveBeenCalledOnce();
 });
 it('bounds persistent collisions and preserves every failed attempt',async()=>{
  const f=fixtures(),startTunnel=vi.fn().mockRejectedValue(Error('remote port forwarding failed for listen port 20001'));
  let failure;try{await startForwardedFixtures({host:'notebook',...f,startTunnel});}catch(e){failure=e;}
  expect(failure.forwardingAttempts).toHaveLength(3);expect(startTunnel).toHaveBeenCalledTimes(3);expect(f.assets.every(a=>a.close.mock.calls.length===1)).toBe(true);
 });
});
