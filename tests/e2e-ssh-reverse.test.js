import {EventEmitter} from 'node:events';
import {describe,it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({default:{spawn:mocks.spawn},spawn:mocks.spawn}));
import {startReverseTunnel} from '../tools/e2e/harness/ssh-reverse.mjs';

function fakeChild() {
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 child.stdin={end:vi.fn(()=>queueMicrotask(()=>child.emit('exit',0)))};
 child.kill=vi.fn(()=>child.emit('exit',null));return child;
}
describe('Receiver fixture SSH forwarding lifecycle',()=>{
 beforeEach(()=>mocks.spawn.mockReset());
 it('restricts destinations and ports before starting SSH',async()=>{
  for(const host of ['-oProxyCommand=x','notebook;whoami','ssh://notebook',''])await expect(startReverseTunnel({host,ports:[20001]})).rejects.toThrow('alias');
  for(const ports of [[],[80],[20001,20001],[NaN]])await expect(startReverseTunnel({host:'notebook',ports})).rejects.toThrow('ports');
  expect(mocks.spawn).not.toHaveBeenCalled();
 });
 it('waits for remote confirmation, forwards only loopback, and closes its owned process',async()=>{
  const child=fakeChild();mocks.spawn.mockReturnValue(child);
  let ready=false;const promise=startReverseTunnel({host:'notebook',ports:[20001,20002]}).then(result=>{ready=true;return result;});
  await Promise.resolve();expect(ready).toBe(false);
  child.stdout.emit('data',Buffer.from('SMG_E2E_TUNNEL_'));expect(ready).toBe(false);
  child.stdout.emit('data',Buffer.from('READY\r\n'));
  const tunnel=await promise;const [,args,options]=mocks.spawn.mock.calls[0];
  expect(args).toContain('127.0.0.1:20001:127.0.0.1:20001');expect(args).toContain('127.0.0.1:20002:127.0.0.1:20002');
  expect(args).toContain('StrictHostKeyChecking=yes');expect(args).toContain('ExitOnForwardFailure=yes');expect(options.windowsHide).toBe(true);
  await tunnel.stop();expect(child.stdin.end).toHaveBeenCalledOnce();expect(child.kill).not.toHaveBeenCalled();
 });
 it('does not accept a tunnel that exits before readiness',async()=>{
  const child=fakeChild();mocks.spawn.mockReturnValue(child);
  const promise=startReverseTunnel({host:'notebook',ports:[20001]});
  child.stderr.emit('data',Buffer.from('remote port forwarding failed'));child.emit('exit',255);
  await expect(promise).rejects.toThrow('remote port forwarding failed');expect(child.stdin.end).toHaveBeenCalledOnce();
 });
 it('bounds readiness and cleans up on timeout',async()=>{
  const child=fakeChild();mocks.spawn.mockReturnValue(child);
  await expect(startReverseTunnel({host:'notebook',ports:[20001],timeoutMs:10})).rejects.toThrow('readiness timeout');
  expect(child.stdin.end).toHaveBeenCalledOnce();
 });
});
