// Probe only a server started by this script. Never contacts a deployed service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
const reservation = net.createServer(); reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening'); const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const child = spawn(process.execPath, ['tools/serve.mjs'], { cwd: new URL('../', import.meta.url), windowsHide: true, env: { ...process.env, PORT: String(port) } });
let stderr = ''; child.stderr.on('data', data => { stderr += data; });
const exited = once(child, 'exit');
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Local server readiness timeout')), 5000);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
});
const request = path => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port, path }, res => { res.resume(); res.once('end', () => resolve({ status: res.statusCode, cors: res.headers['access-control-allow-origin'] })); });
  req.once('error', reject); req.setTimeout(3000, () => req.destroy(new Error('Request timeout')));
});
try {
  await ready;
  const metadata = await request('/.git/HEAD');
  assert.equal(metadata.status, 200); assert.equal(metadata.cors, '*');
  console.log('CONFIRMED repository-metadata-exposed', JSON.stringify(metadata));
  await request('/%ZZ').catch(() => {});
  const [code] = await exited;
  assert.equal(code, 1); assert.match(stderr, /URIError: URI malformed/);
  console.log('CONFIRMED malformed-path-crashes-server', JSON.stringify({ exitCode: code, URIError: true }));
} finally {
  if (child.exitCode === null) child.kill();
}
