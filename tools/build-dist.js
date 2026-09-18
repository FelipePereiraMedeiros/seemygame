import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Libera trava de arquivo no Windows apenas se explicitamente solicitado (--kill ou KILL_DESKTOP=true)
const shouldKill = process.env.KILL_DESKTOP === 'true' || process.argv.includes('--kill');
if (process.platform === 'win32' && shouldKill) {
  try {
    // Não encerra qualquer SeeMyGame.exe do computador. Só finaliza um
    // processo cujo caminho esteja dentro do target do checkout atual.
    const targetRoot = path.resolve('src-tauri', 'target').replace(/[\\/]$/, '').replace(/'/g, "''");
    const repoRoot = path.resolve('.').replace(/[\\/]$/, '').replace(/'/g, "''");
    const command = [
      `$root = '${targetRoot}'`,
      `$repo = '${repoRoot}'`,
      "$rootPrefix = $root.TrimEnd('\\') + '\\'",
      "$repoPrefix = $repo.TrimEnd('\\') + '\\'",
      "$processes = Get-Process -Name 'seemygame','gst-launch-1.0' -ErrorAction SilentlyContinue",
      "$processes | ForEach-Object { try { $processPath = $_.Path } catch { $processPath = $null }; if ($processPath -and ($processPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or $processPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or $processPath.Equals($root, [System.StringComparison]::OrdinalIgnoreCase))) { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } }"
    ].join('; ');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'ignore' });
  } catch {}
}

const root = path.resolve('.');
const dist = path.join(root, 'dist');

if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true, force: true });
}
fs.mkdirSync(dist, { recursive: true });

const itemsToCopy = ['index.html', 'room.html', 'streamer.html', 'viewer.html', 'css', 'js'];

for (const item of itemsToCopy) {
  const src = path.join(root, item);
  const dest = path.join(dist, item);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
  }
}
console.log('Dist build complete in:', dist);
