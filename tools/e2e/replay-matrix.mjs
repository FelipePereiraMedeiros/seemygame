import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const repetitions = Number(option('--repeats', '2'));
const profile = option('--profile', 'source');
const codec = option('--codec', 'vp9');
const viewers = Number(option('--viewers', '3'));
const history = Number(option('--history', '8'));
assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 5);
assert.ok(Number.isInteger(viewers) && viewers >= 1 && viewers <= 3);
assert.ok(history >= 5 && history <= 120);
const output = path.resolve('output/playwright', `replay-matrix-${new Date().toISOString().replace(/[:.]/g, '-')}-${profile}-${codec}`);
fs.mkdirSync(output, { recursive: true });
const runs = [];
for (let repeat = 0; repeat < repetitions; repeat++) {
  const cases = repeat % 2 ? ['both', 'viewers', 'host', 'none'] : ['none', 'host', 'viewers', 'both'];
  for (const scenario of cases) {
    const args = ['tests/e2e-720p-tree-benchmark.mjs', '--delivery-only', '--viewers', String(viewers), '--replay-case', scenario,
      '--replay-profile', profile, '--replay-codec', codec, '--replay-history', String(history), '--sample-seconds', '12', '--warmup-seconds', '8', '--clip-check'];
    const log = path.join(output, `${repeat + 1}-${scenario}.log`);
    console.log(`[Replay matrix] ${repeat + 1}/${repetitions}: ${scenario}, ${profile}/${codec}`);
    const stream = fs.createWriteStream(log);
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let text = '';
    child.stdout.on('data', chunk => { stream.write(chunk); text += chunk; });
    child.stderr.on('data', chunk => stream.write(chunk));
    const timer = setTimeout(() => child.kill(), 180000);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    clearTimeout(timer); await new Promise(resolve => stream.end(resolve));
    const artifact = [...text.matchAll(/"evidence": "([^"]+)"/g)].at(-1)?.[1];
    const filename = artifact && JSON.parse(`"${artifact}"`);
    const report = filename && fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : null;
    const row = { repeat: repeat + 1, scenario, exitCode: code, log, report: filename || null,
      fps: report?.delivered.map(v => v.presentationFps), sourceFps: report?.senderObservation.sourceFps,
      presentation: report?.delivered,
      recorders: report?.replayRecorders, clips: report?.clipResults };
    runs.push(row); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ profile, codec, repetitions, viewers, history, runs,
      limitations: ['Sequential synthetic local tests; all participants share one machine.', 'No measured CPU/GPU utilization or optical latency.'] }, null, 2));
    console.log(`[Replay matrix] ${scenario}: code=${code}, fps=${JSON.stringify(row.fps)}`);
    if (code !== 0) { process.exitCode = 1; throw new Error(`Failed replay scenario; inspect ${log}`); }
  }
}
console.log(`[Replay matrix] Report: ${path.join(output, 'report.json')}`);
