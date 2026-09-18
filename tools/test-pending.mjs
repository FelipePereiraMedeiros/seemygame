import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const suites = [
  ['JavaScript + replay decodificado', process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
    'tests/pending-capture.test.js', 'tests/pending-turn.test.js',
    'tests/pending-replay.test.js', 'tests/pending-replay-streams.test.js']],
  ['Companion com input simulado', process.env.PYTHON_BIN || 'python',
    ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_pending_companion.py', '-v']],
  ['Disponibilidade do backend Rust real', 'cargo', ['test', '--manifest-path',
    'src-tauri/Cargo.toml', '--locked', '--offline', '--lib', 'capture::acceptance_tests']]
];
let failed = false;
for (const [name, command, args] of suites) {
  console.log(`\n${name}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true, timeout: 300000 });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) failed = true;
}
// Run every language even if an earlier suite fails. Never invert expected failures.
process.exitCode = failed ? 1 : 0;
