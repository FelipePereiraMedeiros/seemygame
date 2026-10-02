import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'output/playwright', `historical-suite-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(output, { recursive: true });
const defaults = ['e2e-sessions', 'e2e-whiteboard-multi-client', 'e2e-green-room-audio', 'e2e-room-persistence-audit',
  'e2e-visual-audit', 'e2e-multi-stream-scenario', 'e2e-late-joiner-trios',
  'e2e-tree-relay-benchmark', 'e2e-720p-tree-benchmark', 'e2e-whiteboard', 'e2e-controller-lab', 'e2e-gamepad-visual'];
const names = process.argv.slice(2).length ? process.argv.slice(2) : defaults;
const report = { startedAt: new Date().toISOString(), source: 'current checkout', output, results: [],
  limitations: ['Synthetic screen/microphone sources; actual Chromium WebRTC and local PeerJS signaling.',
    'Desktop fixtures in historical web scenarios simulate Tauri; they do not exercise Rust/WGC/WASAPI.'] };
for (const name of names) {
  if (!/^e2e-[a-z0-9-]+$/.test(name)) throw new Error('Invalid scenario name');
  const started = Date.now();
  const logPath = path.join(output, `${name}.log`);
  const log = fs.createWriteStream(logPath);
  console.log(`[RUN] ${name}`);
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(root, 'tests', `${name}.mjs`)], {
      cwd: root, windowsHide: true, env: { ...process.env, SEEMYGAME_E2E_OUTPUT: output }
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGTERM');
    }, 180000);
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.on('error', error => log.write(error.stack + '\n'));
    child.on('close', async (exitCode, signal) => {
      clearTimeout(timer);
      await new Promise(done => log.end(done));
      resolve({ name, status: timedOut ? 'TIMEOUT' : exitCode === 0 ? 'PASS' : 'FAIL', exitCode, signal,
        durationMs: Date.now() - started, logPath });
    });
  });
  report.results.push(result);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[${result.status}] ${name} (${(result.durationMs / 1000).toFixed(1)}s)`);
  if (result.status !== 'PASS') console.log(fs.readFileSync(logPath, 'utf8').split(/\r?\n/).slice(-22).join('\n'));
}
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(`Report: ${path.join(output, 'report.json')}`);
process.exitCode = report.results.some(result => result.status !== 'PASS') ? 1 : 0;
