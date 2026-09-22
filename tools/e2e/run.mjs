import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { spawn, execSync } from 'node:child_process';
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import os from 'node:os';
import { installTelemetry, deltaMetrics } from './telemetry.mjs';
import { computeSessionMagic, crc16, MARKER_CONFIG } from './optical.mjs';
import { waitForAsync } from './wait.mjs';
import { ensureDefaultDesktop } from './desktop-affinity.mjs';

ensureDefaultDesktop();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const exe = path.resolve(option('--exe', path.join(root, 'src-tauri/target/debug/seemygame.exe')));
const duration = Number(option('--seconds', '30'));
if (!Number.isFinite(duration) || duration < 5 || duration > 1800) throw new Error('--seconds: intervalo permitido 5..1800');
const minFps = Number(option('--min-fps', '0'));
if (!Number.isFinite(minFps) || minFps < 0 || minFps > 240) throw new Error('--min-fps: intervalo permitido 0..240');
const channel = option('--channel', 'msedge');
const preset = option('--preset', 'balanced');
const isCompareMode = args.includes('--compare');
const isWebFirst = args.includes('--web-first') || option('--order', 'native-first') === 'web-first';
const customWebOrigin = option('--web-url', option('--web-origin', null));
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
const sessionMagic = computeSessionMagic(runId);
const output = path.join(root, 'output/playwright', runId);
await mkdir(output, { recursive: true });
const report = {
  runId,
  sessionMagic,
  mode: isCompareMode ? 'compare' : 'single',
  status: 'running',
  steps: [],
  measurements: [],
  checks: [],
  limitations: [
    'LAN/local test: not a two-network TURN test',
    'Captura direcionada exclusivamente à janela sintética dedicada (1280x720) em ambos os testes'
  ]
};
let desktop, viewerBrowser, sourceBrowser, nativeBrowser, hostPage, viewerPage, server;
let viewerContext = null;
let nativeLogSize = 0;
let hostId, viewerId;
const previous = new Map();
const checkpoint = () => writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const bounded = async (name, action, ms = 15000) => {
  let timer;
  try {
    return await Promise.race([action(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name}: timeout ${ms}ms`)), ms); })]);
  } finally { clearTimeout(timer); }
};
const cleanup = async (name, action) => {
  try { await bounded(name, action); }
  catch (error) { (report.cleanupErrors ||= []).push(error.message); report.status = 'failed'; process.exitCode = 1; }
};
// Tauri rewrites HTML at build time (CSP/bootstrap); compare unmodified JS assets.
const frontendFiles = (await readdir(path.join(root, 'js'))).filter(p => p.endsWith('.js')).map(p => `js/${p}`);
let sourceStats = null;
const sampleBoth = async () => {
  const activeSourcePage = sourceBrowser && sourceBrowser.contexts().length > 0 && sourceBrowser.contexts()[0].pages()[0];
  if (activeSourcePage && !activeSourcePage.isClosed()) {
    sourceStats = await activeSourcePage.evaluate(() => window.__smgSourceStats).catch(() => null);
  }
  for (const [side, page] of [['desktop', hostPage], ['web', viewerPage]]) {
    if (!page || page.isClosed()) continue;
    const sample = await page.evaluate(() => window.__smgE2E?.sample()).catch(() => null);
    if (!sample) continue;
    for (const row of sample.rows) {
      const id = `${side}:${row.pcId}:${row.id}`;
      if (previous.has(id)) row.delta = deltaMetrics(previous.get(id), row);
      previous.set(id, row);
    }
    report.measurements.push({ side, sourceStats, ...sample });
  }
};
const watchErrors = (page, side) => page.on('pageerror', error => {
  (report.pageErrors ||= []).push({ side, at: Date.now(), message: error.message });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
// In this Playwright version, waitForFunction treats the returned Promise as
// truthy before inspecting its resolved value. Await every async observation.
const waitApp = async (page, predicate, argument, timeout = 45000) => {
  await waitForAsync(() => bounded('application state', () => page.evaluate(predicate, argument)), { timeout });
};
const record = async (name, action) => { const started = Date.now(); console.log(name); try { const value = await action(); report.steps.push({ name, status: 'passed', ms: Date.now() - started }); return value; } catch (error) { report.steps.push({ name, status: 'failed', error: error.message }); throw error; } };
const hash = data => createHash('sha256').update(data).digest('hex');
const freePort = async () => { const s = createTcpServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; };
const syntheticTitle = `SMG E2E Motion ${runId}`;
const fixture = `<!doctype html>
<title>${syntheticTitle}</title>
<style>
  html, body { background:#0a0f18; color:white; font:24px monospace; margin:0; padding:0; overflow:hidden; }
  canvas { display:block; width:1280px; height:720px; }
</style>
<canvas width="1280" height="720"></canvas>
<script>
const c = document.querySelector('canvas'), x = c.getContext('2d');
let frame = 0;
let lastSec = performance.now();
let framesThisSec = 0;
let instantFps = 60;
const runMagic = ${sessionMagic};

window.__smgSourceStats = {
  framesProduced: 0,
  fps: 60,
  lastTime: Date.now(),
  sessionMagic: runMagic,
  frameLog: []
};

function crc16(bytes) {
  let crc = 0xFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i] << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      else crc = (crc << 1) & 0xFFFF;
    }
  }
  return crc;
}

function encodeOptical(seq, timeMs) {
  const magic = runMagic & 0xFFFF;
  const s = seq & 0xFFFFFF;
  const t = (Math.floor(timeMs) >>> 0);
  const payload = [
    (magic >> 8) & 0xFF, magic & 0xFF,
    (s >> 16) & 0xFF, (s >> 8) & 0xFF, s & 0xFF,
    (t >>> 24) & 0xFF, (t >>> 16) & 0xFF, (t >>> 8) & 0xFF, t & 0xFF
  ];
  const checksum = crc16(payload);

  const bits = [1, 0, 1, 0, 1, 1, 0, 0];
  for (let i = 15; i >= 0; i--) bits.push((magic >> i) & 1);
  for (let i = 23; i >= 0; i--) bits.push((s >> i) & 1);
  for (let i = 31; i >= 0; i--) bits.push((t >>> i) & 1);
  for (let i = 15; i >= 0; i--) bits.push((checksum >> i) & 1);

  const blockW = 8;
  const blockH = 16;
  x.fillStyle = '#000000';
  x.fillRect(0, 0, bits.length * blockW + 4, blockH + 4);
  for (let i = 0; i < bits.length; i++) {
    x.fillStyle = bits[i] === 1 ? '#FFFFFF' : '#000000';
    x.fillRect(2 + i * blockW, 2, blockW, blockH);
  }
}

let lastFrameTime = 0;
const targetIntervalMs = 1000 / 60; // 16.666667 ms

function renderFrame(now) {
  if (!lastFrameTime) lastFrameTime = now;
  const elapsed = now - lastFrameTime;
  if (elapsed < targetIntervalMs - 1.0) {
    return;
  }
  const steps = Math.max(1, Math.floor((elapsed + 1.0) / targetIntervalMs));
  lastFrameTime += steps * targetIntervalMs;
  if (now - lastFrameTime > targetIntervalMs * 2) {
    lastFrameTime = now;
  }
  const nowMs = Date.now();
  framesThisSec++;
  if (now - lastSec >= 1000) {
    instantFps = Math.round((framesThisSec * 1000) / (now - lastSec));
    framesThisSec = 0;
    lastSec = now;
  }
  window.__smgSourceStats.framesProduced = frame;
  window.__smgSourceStats.fps = instantFps;
  window.__smgSourceStats.lastTime = nowMs;
  window.__smgSourceStats.frameLog.push({ seq: frame, timeMs: nowMs });
  if (window.__smgSourceStats.frameLog.length > 10000) {
    window.__smgSourceStats.frameLog.shift();
  }

  x.fillStyle = '#142033';
  x.fillRect(0, 0, 1280, 720);

  // Marcador óptico no topo esquerdo (772px de largura, 20px de altura)
  encodeOptical(frame, nowMs);

  // Bloco de movimento suave de alta visibilidade
  const posX = (now * 0.5) % 1100;
  const posY = 180 + Math.sin(now / 200) * 80;
  x.fillStyle = '#00e5bb';
  x.fillRect(posX, posY, 80, 80);

  // Segundo bloco em contra-fase para teste de judder
  x.fillStyle = '#ff4081';
  x.fillRect((1100 - posX), 320, 60, 60);

  // Informações de telemetria legíveis
  x.fillStyle = 'white';
  x.font = '36px monospace';
  x.fillText('SeeMyGame Glass-to-Glass Source', 380, 70);
  x.font = '28px monospace';
  x.fillText('Frame: ' + frame + '  |  FPS: ' + instantFps + '  |  Magic: ' + runMagic, 40, 130);

  frame++;
}

function onRaf(t) {
  requestAnimationFrame(onRaf);
  renderFrame(t);
}
requestAnimationFrame(onRaf);

// Heartbeat resiliente a backgrounding / oclusão do DWM
setInterval(() => {
  renderFrame(performance.now());
}, 8);
</script>`;
const serve = async () => {
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/e2e-motion.html') { res.setHeader('Content-Type', 'text/html'); return res.end(fixture); }
      // Never serve repository secrets, .git, profiles, reports or arbitrary files.
      if (!/^\/(room\.html|index\.html|(?:js|css)\/[a-zA-Z0-9_./-]+)$/.test(pathname) || pathname.includes('..')) { res.writeHead(404); return res.end(); }
      const filename = path.resolve(root, '.' + pathname);
      if (!filename.startsWith(root + path.sep)) throw new Error('invalid path');
      res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await readFile(filename));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
};
const isolatedInit = async context => {
  await context.addInitScript(installTelemetry, { expectedSessionMagic: sessionMagic });
  // Test fixture state in a fresh profile. No personal account/profile is used.
  await context.addInitScript(() => { localStorage.setItem('seemygame_terms_version', '1.1'); localStorage.setItem('seemygame_terms_accepted', 'true'); });
};
const join = async (page, url, name) => {
  await page.goto(url); await page.locator('#green-room-join-btn').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#green-room-user-name').fill(name);
  await page.locator('#green-room-join-btn').click();
  await waitApp(page, async () => { const app = await import('/js/app.js'); return app.roomManager?.isInRoom === true && typeof app.roomManager?.myPeerId === 'string'; });
};
try {
  await record('preflight', async () => {
    if (process.platform !== 'win32') throw new Error('Desktop E2E requer Windows/WebView2');
    await stat(exe); report.executable = { path: exe, sha256: hash(await readFile(exe)) };
    report.sourceHashes = Object.fromEntries(await Promise.all([...frontendFiles, 'src-tauri/src/media.rs', 'src-tauri/src/capture.rs'].map(async p => [p, hash(await readFile(path.join(root, p)))])));
  });
  if (args.includes('--check')) { report.status = 'preflight-only'; console.log('Preflight OK; no capture was started.'); }
  else {
    const localOrigin = await serve();
    const webOrigin = customWebOrigin || localOrigin;
    report.webOrigin = webOrigin;
    const port = await freePort();
    const env = {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'webview-profile'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion --autoplay-policy=no-user-gesture-required`
    };
    const logPath = path.join(path.dirname(exe), 'native_debug.log');
    nativeLogSize = await stat(logPath).then(s => s.size).catch(() => 0);
    desktop = spawn(exe, [], { cwd: path.dirname(exe), env, windowsHide: false, stdio: 'ignore' });
    let spawnError; desktop.on('error', e => { spawnError = e; });
    await record('attach isolated WebView2', async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (desktop.exitCode !== null) throw new Error(`Desktop exited: ${desktop.exitCode}`);
        try { nativeBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break; } catch { await sleep(400); }
      }
      if (!nativeBrowser) throw new Error('WebView2 CDP indisponível; confira runtime e executável');
      const context = nativeBrowser.contexts()[0]; await isolatedInit(context);
      hostPage = context.pages()[0] || await context.newPage();
      watchErrors(hostPage, 'desktop');
      if (!hostPage.url() || hostPage.url() === 'about:blank') {
        await hostPage.waitForURL(u => u && u.href !== 'about:blank', { timeout: 15000 });
      }
      await hostPage.evaluate(async () => {
        const t = window.__TAURI__;
        if (t && await t.core?.invoke('is_always_on_top')) {
          await t.core?.invoke('toggle_always_on_top');
        }
      }).catch(() => {});
    });
    console.log('hostPage URL:', hostPage.url());
    const nativeOrigin = new URL(hostPage.url()).origin;
    await record('check embedded frontend matches checkout', async () => {
      for (const p of frontendFiles) {
        const embedded = await hostPage.evaluate(async p => (await fetch('/' + p)).text(), p);
        if (hash(Buffer.from(embedded)) !== report.sourceHashes[p]) throw new Error(`Build desatualizado: ${p}. Execute npm run build:dist e cargo build --manifest-path src-tauri/Cargo.toml --locked --offline`);
      }
    });

    let sourceWindowPos = '50,50';
    let viewerWindowPos = '600,100';
    try {
      const stdout = execSync('powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | Select-Object -ExpandProperty Bounds | Select-Object -ExpandProperty X"', { timeout: 4000 }).toString();
      const xs = stdout.trim().split(/\r?\n/).map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
      if (xs.some(x => x < 0)) {
        sourceWindowPos = '-1900,50';
        viewerWindowPos = '50,50';
      }
    } catch {}

    sourceBrowser = await chromium.launch({
      channel,
      headless: false,
      args: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion',
        `--window-position=${sourceWindowPos}`,
        '--window-size=1280,720'
      ],
      timeout: 30000
    });
    const sourceContext = await sourceBrowser.newContext({ viewport: { width: 1280, height: 720 } });
    const source = (await sourceContext.pages())[0] || await sourceContext.newPage();
    if (source.url() !== `${localOrigin}/e2e-motion.html`) {
      await source.goto(`${localOrigin}/e2e-motion.html`);
    }
    await source.bringToFront();
    viewerBrowser = await chromium.launch({
      channel,
      headless: false,
      args: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion',
        '--autoplay-policy=no-user-gesture-required',
        `--window-position=${viewerWindowPos}`,
        '--window-size=1280,720',
        `--auto-select-desktop-capture-source=${syntheticTitle}`,
        '--enable-usermedia-screen-capturing',
        '--allow-http-screen-capture'
      ],
      timeout: 30000
    });
    viewerContext = await viewerBrowser.newContext();
    await viewerContext.grantPermissions(['camera', 'microphone']);
    await isolatedInit(viewerContext);
    viewerPage = await viewerContext.newPage();
    watchErrors(viewerPage, 'web');
    const room = `e2e-${randomBytes(6).toString('hex')}`, key = randomBytes(16).toString('hex');
    const fragment = `#room=${room}&key=${key}`;
    await record('desktop joins room', () => join(hostPage, `${nativeOrigin}/room.html${fragment}`, 'E2E Desktop'));
    await record('web joins same room', () => join(viewerPage, `${webOrigin}/room.html${fragment}`, 'E2E Web'));
    await record('verify mutual authenticated membership', async () => {
      await waitApp(hostPage, async () => (await import('/js/app.js')).roomManager?.myPeerId != null);
      await waitApp(viewerPage, async () => (await import('/js/app.js')).roomManager?.myPeerId != null);
      hostId = await hostPage.evaluate(async () => (await import('/js/app.js')).roomManager?.myPeerId);
      viewerId = await viewerPage.evaluate(async () => (await import('/js/app.js')).roomManager?.myPeerId);
      if (!hostId || !viewerId || hostId === viewerId) throw new Error('Identidades dos clientes inválidas');
      for (const [page, expected] of [[hostPage, viewerId], [viewerPage, hostId]]) await waitApp(page, async id => { const r = (await import('/js/app.js')).roomManager; return r?.members.has(id) && r.isPeerAuthorized(id); }, expected);
    });
    const averageOf = (arr, fn) => {
      const vals = arr.map(fn).filter(n => Number.isFinite(n) && n !== null);
      return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
    };

    const sampleAndAnalyze = async ({ label, streamerSide, receiverSide, streamerPage, receiverPage, targetPeerId, durationSec, isNative = false }) => {
      const startIndex = report.measurements.length;
      const videoTimes = [];
      const timeline = [];

      for (let i = 0; i < durationSec; i++) {
        const currentPhase = i < 5 ? 'warmup' : (i < durationSec - 2 ? 'steady' : 'cooldown');
        await bounded(`${label} stream telemetry`, sampleBoth);
        const receiverVid = await receiverPage.evaluate(({ id, phase }) => {
          const v = document.getElementById(`card-${id}`)?.querySelector('video');
          if (v?.__smgPresentation?.setPhase) {
            v.__smgPresentation.setPhase(phase);
          }
          return v && !v.paused && v.readyState >= 2 ? {
            currentTime: v.currentTime,
            presentation: v.__smgPresentation?.getStats({ reset: true })
          } : null;
        }, { id: targetPeerId, phase: currentPhase }).catch(() => null);

        videoTimes.push(receiverVid?.currentTime ?? null);

        const recentStreamer = report.measurements.filter(m => m.side === streamerSide).slice(-1)[0];
        const recentReceiver = report.measurements.filter(m => m.side === receiverSide).slice(-1)[0];

        // Resolução estrita: seleciona conexões conectadas com tráfego real de vídeo (D03)
        const bridgeInbound = isNative ? (recentStreamer?.rows?.find(r =>
          r.kind === 'video' && r.type === 'inbound-rtp' && r.connectionState === 'connected' &&
          (r.framesDecoded > 0 || r.bytesReceived > 0)
        ) || recentStreamer?.rows?.find(r => r.kind === 'video' && r.type === 'inbound-rtp')) : null;

        const outbound = recentStreamer?.rows?.find(r =>
          r.kind === 'video' && r.type === 'outbound-rtp' && r.connectionState === 'connected' &&
          (r.framesEncoded > 0 || r.bytesSent > 0)
        ) || recentStreamer?.rows?.find(r => r.kind === 'video' && r.type === 'outbound-rtp' && r.connectionState === 'connected') || null;

        const remoteInbound = recentReceiver?.rows?.find(r =>
          r.kind === 'video' && r.type === 'inbound-rtp' && r.connectionState === 'connected' &&
          (r.framesDecoded > 0 || r.bytesReceived > 0)
        ) || recentReceiver?.rows?.find(r => r.kind === 'video' && r.type === 'inbound-rtp' && r.connectionState === 'connected') || null;

        const presentation = receiverVid?.presentation;

        timeline.push({
          second: i + 1,
          phase: i < 5 ? 'warmup' : (i < durationSec - 2 ? 'steady' : 'cooldown'),
          source: {
            fps: recentStreamer?.sourceStats?.fps ?? null,
            framesProduced: recentStreamer?.sourceStats?.framesProduced ?? null
          },
          bridge: {
            decodedFps: bridgeInbound?.delta?.decodedFps ?? null,
            decodeTimeMs: bridgeInbound?.delta?.decodeTimeMs ?? null,
            jitterBufferMs: bridgeInbound?.delta?.jitterBufferMs ?? null,
            observableLatencyMs: bridgeInbound?.delta?.bridgeObservableMs ?? null,
            packetsLost: bridgeInbound?.packetsLost ?? 0
          },
          outbound: {
            sentFps: outbound?.framesPerSecond ?? outbound?.delta?.decodedFps ?? null,
            encodeTimeMs: outbound?.delta?.encodeTimeMs ?? null,
            sentMbps: outbound?.delta?.sentMbps ?? null,
            limitation: outbound?.qualityLimitationReason ?? 'none',
            encoderImplementation: outbound?.encoderImplementation ?? null
          },
          webInbound: {
            decodedFps: remoteInbound?.delta?.decodedFps ?? null,
            decodeTimeMs: remoteInbound?.delta?.decodeTimeMs ?? null,
            jitterBufferMs: remoteInbound?.delta?.jitterBufferMs ?? null,
            packetsLost: remoteInbound?.packetsLost ?? 0,
            decoderImplementation: remoteInbound?.decoderImplementation ?? null
          },
          presentation: {
            presentedFrames: presentation?.presentedFrames ?? null,
            duplicateFrames: presentation?.duplicateFrames ?? null,
            intervalMaxPauseMs: presentation?.intervalMaxPauseMs ?? 0,
            gapsCount: presentation?.gapsCount ?? 0,
            validSamplesCount: presentation?.validSamplesCount ?? 0,
            rejectedCandidatesCount: presentation?.rejectedCandidatesCount ?? 0,
            overheadP50Ms: presentation?.instrumentationOverheadMs?.p50 ?? null,
            latencyP50: presentation?.latency?.recentP50 ?? presentation?.latency?.p50 ?? null
          },
          system: {
            freeMemMb: Math.round(os.freemem() / (1024 * 1024)),
            totalMemMb: Math.round(os.totalmem() / (1024 * 1024))
          }
        });

        await checkpoint();
        await sleep(1000);
      }

      const decoded = report.measurements.slice(startIndex).filter(s => s.side === receiverSide).flatMap(s => s.rows).filter(r => r.kind === 'video' && r.type === 'inbound-rtp');
      const progressing = videoTimes.slice(1).filter((t, i) => t !== null && videoTimes[i] !== null && t > videoTimes[i]).length;
      if (progressing < Math.ceil((videoTimes.length - 1) * 0.7)) {
        throw new Error(`${label}: vídeo não progrediu satisfatoriamente nos intervalos de teste`);
      }
      const fps = decoded.map(r => r.delta?.decodedFps).filter(Number.isFinite).sort((a, b) => a - b);
      if (!fps.length || !fps.some(n => n > 0)) {
        throw new Error(`${label}: nenhum progresso de frames decodificados no receptor`);
      }

      const finalPresentation = await receiverPage.evaluate(id => {
        const v = document.getElementById(`card-${id}`)?.querySelector('video');
        return v?.__smgPresentation?.getStats() || null;
      }, targetPeerId).catch(() => null);

      const activeSourcePage = sourceBrowser && sourceBrowser.contexts().length > 0 && sourceBrowser.contexts()[0].pages()[0];
      if (activeSourcePage && !activeSourcePage.isClosed()) {
        const fresh = await activeSourcePage.evaluate(() => window.__smgSourceStats).catch(() => null);
        if (fresh) sourceStats = fresh;
      }

      // Isolamento de fases: métricas de performance calculadas exclusivamente no steady state
      const steadyTimeline = timeline.filter(t => t.phase === 'steady');
      const steadyFps = steadyTimeline.map(t => t.webInbound.decodedFps).filter(Number.isFinite).sort((a, b) => a - b);

      const perf = {
        totalSamples: fps.length,
        steadySamples: steadyFps.length,
        medianDecodedFps: steadyFps.length ? steadyFps[Math.floor(steadyFps.length / 2)] : (fps.length ? fps[Math.floor(fps.length / 2)] : null),
        p10DecodedFps: steadyFps.length ? steadyFps[Math.floor((steadyFps.length - 1) * 0.1)] : (fps.length ? fps[Math.floor((fps.length - 1) * 0.1)] : null),
        minFps,
        videoTimes,
        presentation: finalPresentation
      };

      // Validação rigorosa de proveniência óptica (D02)
      const sourceLog = sourceStats?.frameLog || [];
      const sourceSeqMap = new Map(sourceLog.map(f => [f.seq, f.timeMs]));
      const lastDecodedSeq = finalPresentation?.lastSeq;
      const recentDecodedSeqs = finalPresentation?.recentSeqs?.length ? finalPresentation.recentSeqs : (lastDecodedSeq != null && lastDecodedSeq > 0 ? [lastDecodedSeq] : []);
      const isProvenanceValid = recentDecodedSeqs.some(s => sourceSeqMap.has(s));
      const validSamples = finalPresentation?.validSamplesCount || 0;
      const measurementValid = validSamples >= 5 && isProvenanceValid;

      let glassToGlassLatency = null;
      // Prioridade metodológica estrita: steadyLatency isola o regime permanente sem contaminação do warmup
      const steadyLat = finalPresentation?.steadyLatency;
      const targetLatency = (steadyLat && steadyLat.samplesCount >= 3) ? steadyLat : finalPresentation?.latency;

      if (measurementValid && targetLatency?.p50 !== null && targetLatency?.p50 !== undefined) {
        glassToGlassLatency = {
          phase: (steadyLat && steadyLat.samplesCount >= 3) ? 'steady' : 'total',
          p50Ms: targetLatency.p50,
          p90Ms: targetLatency.p90,
          p99Ms: targetLatency.p99,
          minMs: targetLatency.min,
          maxMs: targetLatency.max,
          validSamplesCount: (steadyLat && steadyLat.samplesCount >= 3) ? steadyLat.samplesCount : validSamples
        };
      }

      const stutters = [];
      for (const entry of steadyTimeline) {
        const isPause = entry.presentation.intervalMaxPauseMs > 150;
        const isFpsDrop = entry.webInbound.decodedFps !== null && entry.webInbound.decodedFps < 30 && entry.presentation.intervalMaxPauseMs > 100;
        if (isPause || isFpsDrop) {
          let suspectedCause = 'COMPOSITOR_PRESENTATION';
          let confidence = 'medium';
          if (entry.webInbound.decodedFps === 0 && entry.presentation.intervalMaxPauseMs > 150) {
            suspectedCause = 'RECEIVER_STREAM_FREEZE';
            confidence = 'high';
          } else if (entry.source.fps && entry.source.fps < 30) {
            suspectedCause = 'SOURCE_WINDOW_THROTTLING';
            confidence = 'high';
          } else if (isNative && entry.bridge.decodedFps && entry.bridge.decodedFps < 30) {
            suspectedCause = 'NATIVE_CAPTURE_OR_BRIDGE_THROTTLING';
            confidence = 'high';
          } else if (entry.outbound.limitation === 'cpu') {
            suspectedCause = 'STREAMER_CPU_SATURATION';
            confidence = 'medium';
          } else if (entry.outbound.limitation === 'bandwidth') {
            suspectedCause = 'WEBRTC_BANDWIDTH_LIMITATION';
            confidence = 'medium';
          } else if (entry.webInbound.jitterBufferMs > 100) {
            suspectedCause = 'RECEIVER_JITTER_BUFFER_STALL';
            confidence = 'medium';
          }
          stutters.push({
            second: entry.second,
            pauseMs: entry.presentation.intervalMaxPauseMs,
            decodedFps: entry.webInbound.decodedFps,
            suspectedCause,
            confidence
          });
        }
      }

      const diagnostics = {
        steadyDurationSec: steadyTimeline.length,
        stuttersDetected: stutters.length,
        stutterEvents: stutters,
        measurementValid,
        measurementReason: measurementValid ? 'Proveniência óptica e CRC-16 validados' : 'Leituras ópticas insuficientes ou sequência ausente no log da fonte',
        provenance: {
          isProvenanceValid,
          lastDecodedSeq,
          validSamplesCount: validSamples,
          rejectedCandidatesCount: finalPresentation?.rejectedCandidatesCount || 0
        }
      };

      const startupDynamics = finalPresentation?.startupDynamics || null;
      const warmupLatency = finalPresentation?.warmupLatency || null;
      const cooldownLatency = finalPresentation?.cooldownLatency || null;

      return {
        timeline,
        performance: perf,
        glassToGlassLatency,
        startupDynamics,
        warmupLatency,
        cooldownLatency,
        diagnostics
      };
    };

    const cleanStageAndCards = async () => {
      await hostPage.evaluate(async () => {
        const ui = await import('/js/ui.js');
        document.querySelectorAll('.video-card').forEach(card => {
          const id = card.id?.replace(/^card-/, '');
          if (id) {
            ui.removeVideoCard?.(id);
          }
        });
        ui.removeVideoCard?.('local-me');
      }).catch(() => {});
      await viewerPage.evaluate(async () => {
        const ui = await import('/js/ui.js');
        document.querySelectorAll('.video-card').forEach(card => {
          const id = card.id?.replace(/^card-/, '');
          if (id) {
            ui.removeVideoCard?.(id);
          }
        });
        ui.removeVideoCard?.('local-me');
      }).catch(() => {});
      await sleep(1000);
    };

    const executeNativePhase = async () => {
      console.log('\n--- Executando Fase: Captura Nativa (Direct3D 11 / WGC) ---');
      await record('select native synthetic window and transmit', async () => {
        await hostPage.locator('#audio-mode-select').selectOption('none', { force: true });
        await hostPage.locator('#quality-preset').selectOption(preset, { force: true }).catch(() => {});
        await hostPage.locator('#dock-stream-btn').click();
        await hostPage.locator('.window-item').first().waitFor({ state: 'visible', timeout: 45000 });

        let targetWindow = hostPage.locator('.window-item').filter({ hasText: syntheticTitle }).first();
        let hasTarget = (await targetWindow.count().catch(() => 0)) > 0;
        if (!hasTarget) {
          targetWindow = hostPage.locator('.window-item').filter({ hasText: 'SMG E2E Motion' }).first();
          hasTarget = (await targetWindow.count().catch(() => 0)) > 0;
        }
        if (!hasTarget) {
          const availableItems = await hostPage.locator('.window-item .window-title').allInnerTexts().catch(() => []);
          throw new Error(`Janela sintética "${syntheticTitle}" não foi encontrada no seletor nativo. Janelas listadas: ${JSON.stringify(availableItems)}`);
        }
        console.log(`Picker selecionando janela sintética dedicada: ${syntheticTitle}`);
        await source.bringToFront().catch(() => {});
        await source.evaluate(() => window.focus()).catch(() => {});
        await sleep(400);
        await targetWindow.click();
        await source.bringToFront().catch(() => {});
        await source.evaluate(() => window.focus()).catch(() => {});

        const deadline = Date.now() + 45000;
        let ready = false;
        while (Date.now() < deadline) {
          ready = await viewerPage.evaluate(id => {
            const unmuteBtn = document.querySelector('.audio-unmute-overlay button');
            if (unmuteBtn) unmuteBtn.click();
            const v = document.getElementById(`card-${id}`)?.querySelector('video');
            if (v && v.paused) {
              v.muted = true;
              v.play().catch(() => {});
            }
            return !!v && v.videoWidth > 0 && v.readyState >= 2 && !v.paused;
          }, hostId).catch(() => false);
          if (ready) break;
          await sleep(1000);
        }
        if (!ready) throw new Error('Espectador não reproduziu vídeo do host em 45s; veja measurements e native-debug.log');
        report.nativeState = await hostPage.evaluate(async () => (await import('/js/desktop.js')).getNativeCaptureState());
        if (!report.nativeState.sessionId) throw new Error('Vídeo sem sessão nativa ativa');
      });

      const res = await record('sample native bridge, outbound and remote receiver', async () => {
        return await sampleAndAnalyze({
          label: 'native',
          streamerSide: 'desktop',
          receiverSide: 'web',
          streamerPage: hostPage,
          receiverPage: viewerPage,
          targetPeerId: hostId,
          durationSec: duration,
          isNative: true
        });
      });

      report.timeline = res.timeline;
      report.performance = res.performance;
      report.glassToGlassLatency = res.glassToGlassLatency;
      report.diagnostics = res.diagnostics;
      report.native = res;

      if (minFps && report.performance.p10DecodedFps < minFps) throw new Error(`FPS p10 abaixo da meta ${minFps}`);
      report.checks.push({ name: 'remote decoded frames progress', status: 'passed' });

      await hostPage.screenshot({ path: path.join(output, isCompareMode ? 'desktop-native.png' : 'desktop.png') });
      await viewerPage.screenshot({ path: path.join(output, isCompareMode ? 'viewer-native.png' : 'viewer.png') });

      await record('stop native capture via desktop UI and verify idle', async () => {
        await hostPage.locator('#dock-stream-btn').click();
        await waitApp(hostPage, async () => (await (await import('/js/desktop.js')).getNativeCaptureState()).state === 'idle', null, 15000);
      });

      return res;
    };

    const executeWebPhase = async () => {
      console.log('\n--- Executando Fase: Web Capture (getDisplayMedia) ---');
      await record('start web capture transmission', async () => {
        await viewerPage.locator('#audio-mode-select').selectOption('none', { force: true }).catch(() => {});
        await viewerPage.locator('#quality-preset').selectOption(preset, { force: true }).catch(() => {});
        await source.bringToFront().catch(() => {});
        await source.evaluate(() => window.focus()).catch(() => {});
        await sleep(500);
        await viewerPage.evaluate(async () => {
          const app = await import('/js/app.js');
          return app.startLocalStream({
            displaySurface: 'window'
          });
        });
        const deadline = Date.now() + 45000;
        let ready = false;
        while (Date.now() < deadline) {
          ready = await hostPage.evaluate(id => {
            const unmuteBtn = document.querySelector('.audio-unmute-overlay button');
            if (unmuteBtn) unmuteBtn.click();
            const v = document.getElementById(`card-${id}`)?.querySelector('video');
            if (v && v.paused) {
              v.muted = true;
              v.play().catch(() => {});
            }
            return !!v && v.videoWidth > 0 && v.readyState >= 2 && !v.paused;
          }, viewerId).catch(() => false);
          if (ready) break;
          await sleep(1000);
        }
        if (!ready) throw new Error('Host não reproduziu vídeo web em 45s');
      });

      const res = await record('sample web capture outbound and receiver', async () => {
        return await sampleAndAnalyze({
          label: 'web',
          streamerSide: 'web',
          receiverSide: 'desktop',
          streamerPage: viewerPage,
          receiverPage: hostPage,
          targetPeerId: viewerId,
          durationSec: duration,
          isNative: false
        });
      });

      report.web = res;
      await hostPage.screenshot({ path: path.join(output, 'desktop-web.png') });
      await viewerPage.screenshot({ path: path.join(output, 'viewer-web.png') });

      await record('stop web capture stream', async () => {
        await viewerPage.evaluate(async () => {
          const app = await import('/js/app.js');
          return app.stopLocalStream();
        }).catch(() => {});
        await sleep(1000);
      });

      return res;
    };

    let nativeResult = null;
    let webResult = null;

    if (isCompareMode && isWebFirst) {
      console.log('\n=== Ordem Solicitada: Web Capture Primeiro (--web-first) ===');
      webResult = await executeWebPhase();
      await cleanStageAndCards();
      await sleep(3000);
      nativeResult = await executeNativePhase();
      await cleanStageAndCards();
    } else {
      nativeResult = await executeNativePhase();
      await cleanStageAndCards();
      if (isCompareMode) {
        await sleep(3000);
        webResult = await executeWebPhase();
        await cleanStageAndCards();
      }
    }

    if (isCompareMode) {
      // Matriz Comparativa A/B Rigorosa
      const natLat = nativeResult.glassToGlassLatency?.p50Ms ?? null;
      const webLat = webResult.glassToGlassLatency?.p50Ms ?? null;
      const natFps = nativeResult.performance.medianDecodedFps;
      const webFps = webResult.performance.medianDecodedFps;
      const natEncodeMs = averageOf(nativeResult.timeline.filter(t => t.phase === 'steady'), t => t.outbound.encodeTimeMs);
      const webEncodeMs = averageOf(webResult.timeline.filter(t => t.phase === 'steady'), t => t.outbound.encodeTimeMs);
      const bridgeDecodeMs = averageOf(nativeResult.timeline.filter(t => t.phase === 'steady'), t => t.bridge.decodeTimeMs);
      const bridgeJitterMs = averageOf(nativeResult.timeline.filter(t => t.phase === 'steady'), t => t.bridge.jitterBufferMs);
      const bridgeObservableMs = (bridgeDecodeMs !== null || bridgeJitterMs !== null)
        ? Number(((bridgeDecodeMs ?? 0) + (bridgeJitterMs ?? 0)).toFixed(2))
        : null;

      const measurementValidBoth = nativeResult.diagnostics.measurementValid && webResult.diagnostics.measurementValid;

      report.comparison = {
        declaredFactors: [
          'Streamer: WebView2 (Nativo) vs Chromium (Web)',
          'Receiver: Chromium (Nativo) vs WebView2 (Web)',
          'Fonte: Janela sintética idêntica SMG E2E Motion (1280x720)',
          'Superfície de Captura: Janela vs Janela (Direct3D 11/WGC vs getDisplayMedia)',
          'Resolução e Cadência: 1280x720 @ 60 FPS'
        ],
        native: {
          medianDecodedFps: natFps,
          glassToGlassP50Ms: natLat,
          glassToGlassP90Ms: nativeResult.glassToGlassLatency?.p90Ms ?? null,
          glassToGlassP99Ms: nativeResult.glassToGlassLatency?.p99Ms ?? null,
          latencyPhase: nativeResult.glassToGlassLatency?.phase ?? 'total',
          startupDynamics: nativeResult.startupDynamics,
          warmupLatency: nativeResult.warmupLatency,
          cooldownLatency: nativeResult.cooldownLatency,
          outboundEncodeTimeMs: natEncodeMs,
          localPreviewDecodeTimeMs: bridgeDecodeMs,
          localPreviewJitterBufferMs: bridgeJitterMs,
          localPreviewObservableLatencyMs: bridgeObservableMs,
          measurementValid: nativeResult.diagnostics.measurementValid,
          stuttersDetected: nativeResult.diagnostics.stuttersDetected
        },
        web: {
          medianDecodedFps: webFps,
          glassToGlassP50Ms: webLat,
          glassToGlassP90Ms: webResult.glassToGlassLatency?.p90Ms ?? null,
          glassToGlassP99Ms: webResult.glassToGlassLatency?.p99Ms ?? null,
          latencyPhase: webResult.glassToGlassLatency?.phase ?? 'total',
          startupDynamics: webResult.startupDynamics,
          warmupLatency: webResult.warmupLatency,
          cooldownLatency: webResult.cooldownLatency,
          outboundEncodeTimeMs: webEncodeMs,
          localPreviewDecodeTimeMs: 0,
          localPreviewJitterBufferMs: 0,
          localPreviewObservableLatencyMs: 0,
          measurementValid: webResult.diagnostics.measurementValid,
          stuttersDetected: webResult.diagnostics.stuttersDetected
        },
        delta: {
          latencyOverheadMs: natLat !== null && webLat !== null ? (natLat - webLat) : null,
          fpsDelta: natFps !== null && webFps !== null ? Number((natFps - webFps).toFixed(2)) : null,
          encodeTimeDeltaMs: natEncodeMs !== null && webEncodeMs !== null ? Number((natEncodeMs - webEncodeMs).toFixed(2)) : null,
          stuttersDelta: nativeResult.diagnostics.stuttersDetected - webResult.diagnostics.stuttersDetected
        },
        verdict: {
          measurementValid: measurementValidBoth,
          localPreviewCostMs: bridgeObservableMs,
          latencyEvaluation: measurementValidBoth && natLat !== null && webLat !== null
            ? (natLat <= webLat
                ? `Envio nativo direto é ${(webLat - natLat).toFixed(0)}ms mais rápido que web capture`
                : (natLat <= webLat + 35
                    ? 'Latência nativa competitiva com o navegador'
                    : `Nativo adiciona ${(natLat - webLat).toFixed(0)}ms em relação ao navegador`))
            : 'Medição óptica inconclusiva para veredito comparativo',
          stutterComparison: nativeResult.diagnostics.stuttersDetected <= webResult.diagnostics.stuttersDetected
            ? 'Captura nativa apresentou estabilidade igual ou superior'
            : 'Web capture apresentou menos quedas transitórias'
        }
      };

      console.log('\n=== Matriz Comparativa Rigorosa (Nativo vs Web) ===');
      console.table({
        'Nativo (Direct3D 11)': {
          'FPS Mediano (Steady)': natFps?.toFixed(1),
          'Latência p50 Steady (ms)': natLat ?? 'Inconclusivo',
          'Latência p90 Steady (ms)': nativeResult.glassToGlassLatency?.p90Ms ?? 'N/A',
          'Latência p99 Steady (ms)': nativeResult.glassToGlassLatency?.p99Ms ?? 'N/A',
          'Encode Outbound (ms)': natEncodeMs ?? 'N/A (NVENC HW)',
          'Preview Local Obs. (ms)': bridgeObservableMs ?? 'N/A',
          'Pausa Warmup (ms)': nativeResult.startupDynamics?.startupMaxPauseMs ?? 0,
          'Stutters Steady': nativeResult.diagnostics.stuttersDetected,
          'Medição Válida': nativeResult.diagnostics.measurementValid ? 'SIM' : 'NÃO'
        },
        'Web (getDisplayMedia)': {
          'FPS Mediano (Steady)': webFps?.toFixed(1),
          'Latência p50 Steady (ms)': webLat ?? 'Inconclusivo',
          'Latência p90 Steady (ms)': webResult.glassToGlassLatency?.p90Ms ?? 'N/A',
          'Latência p99 Steady (ms)': webResult.glassToGlassLatency?.p99Ms ?? 'N/A',
          'Encode Outbound (ms)': webEncodeMs ?? 'N/A',
          'Preview Local Obs. (ms)': '0.00 (sem preview local)',
          'Pausa Warmup (ms)': webResult.startupDynamics?.startupMaxPauseMs ?? 0,
          'Stutters Steady': webResult.diagnostics.stuttersDetected,
          'Medição Válida': webResult.diagnostics.measurementValid ? 'SIM' : 'NÃO'
        }
      });
    }

    const functionalPassed = true;
    const measurementValid = isCompareMode
      ? (report.comparison?.verdict?.measurementValid ?? false)
      : (nativeResult.diagnostics.measurementValid);
    const performancePassed = (!minFps || report.performance.medianDecodedFps >= minFps);

    report.verdict = {
      functionalPassed,
      measurementValid,
      performancePassed,
      overallStatus: functionalPassed && measurementValid && performancePassed ? 'passed' : (measurementValid ? 'failed' : 'inconclusive')
    };

    report.status = report.verdict.overallStatus;
  }
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally {
  await checkpoint();
  if (report.status === 'failed') {
    for (const [side, page] of [['desktop', hostPage], ['viewer', viewerPage]]) {
      if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, `${side}-failure.png`), timeout: 3000 }).catch(() => {});
    }
  }
  if (hostPage) {
    // Stop only this isolated session; never taskkill processes by name.
    if (!hostPage.isClosed()) await cleanup('stop native capture', () => hostPage.evaluate(async () => (await import('/js/desktop.js')).stopNativeCapture()));
  }
  for (const [name, browser] of [['viewer', viewerBrowser], ['source', sourceBrowser], ['desktop CDP', nativeBrowser]]) if (browser) await cleanup(`close ${name}`, () => browser.close());
  if (desktop && desktop.exitCode === null) { desktop.kill(); }
  if (desktop) {
    const log = await readFile(path.join(path.dirname(exe), 'native_debug.log')).catch(() => Buffer.alloc(0));
    if (log.length > nativeLogSize) await writeFile(path.join(output, 'native-debug.log'), log.subarray(nativeLogSize));
  }
  if (server) { server.closeAllConnections(); await cleanup('close HTTP server', () => new Promise(r => server.close(r))); }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`E2E ${report.status}: ${path.join(output, 'report.json')}`);
}
