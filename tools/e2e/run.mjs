import { startAssetServer } from './harness/server.mjs';
import { startSignalingServer } from './harness/signaling.mjs';
import { bounded, createCleanupCollector } from './harness/lifecycle.mjs';
import { listFrontendFiles, listRustFiles } from './harness/provenance.mjs';
import { createMotionFixture } from './fixtures/motion.mjs';
import { chromium } from 'playwright';
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
import { QUALITY_PROFILES } from '../../js/config.js';
import { assessQuality } from '../../js/streaming/quality.js';
import { startResourceSampler } from './harness/resources.mjs';
import { evaluateStreamVerdict } from './harness/verdict.mjs';
import { readSourceStatsSummary } from './harness/source-summary.mjs';
import { createRequire } from 'node:module';
import { machineFingerprint, readViewerControl, prepareRemoteViewer, resourceWindow, redactViewerSecrets } from './harness/remote-viewer.mjs';
import { summarizeResources } from './harness/resources.mjs';
import { readDisplayModes, validateWindowPosition } from './harness/displays.mjs';

ensureDefaultDesktop();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const exe = path.resolve(option('--exe', path.join(root, 'src-tauri/target/debug/seemygame.exe')));
const duration = Number(option('--seconds', '30'));
if (!Number.isFinite(duration) || duration < 5 || duration > 1800) throw new Error('--seconds: intervalo permitido 5..1800');
const minFps = Number(option('--min-fps', '0'));
if (!Number.isFinite(minFps) || minFps < 0 || minFps > 240) throw new Error('--min-fps: intervalo permitido 0..240');
const remoteViewerEndpoint = option('--viewer-endpoint', null);
const opticalHz = Number(option('--optical-hz', remoteViewerEndpoint ? '0' : '8'));
if (!Number.isFinite(opticalHz) || opticalHz < 0 || opticalHz > 60) throw new Error('--optical-hz: 0 (desativado) ou 1..60');
if (opticalHz > 0 && opticalHz < 1) throw new Error('--optical-hz: 0 (desativado) ou 1..60');
const requireQuality = args.includes('--require-quality');
const channel = option('--channel', 'msedge');
const preset = option('--preset', 'balanced');
if (!QUALITY_PROFILES[preset]) throw new Error('Preset de transmissão inválido');
const requestedCodec = option('--codec', 'h264');
if (!['auto', 'h264', 'av1', 'hevc'].includes(requestedCodec)) throw new Error('Codec nativo inválido');
const isCompareMode = args.includes('--compare');
if(remoteViewerEndpoint&&isCompareMode)throw new Error('Remote receiver currently supports the native phase only; --compare reverses the local sender/receiver roles and is not valid across machines yet');
if(remoteViewerEndpoint&&opticalHz>0)throw new Error('Optical latency across independent clocks is disabled; use --optical-hz 0 until clock calibration is implemented');
const nativeReplay = args.includes('--native-replay');
const viewerReplay = args.includes('--viewer-replay');
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
  replayConditions: { nativePhase: { transmitter: nativeReplay, receiver: viewerReplay } },
  qualityConditions: { preset, requestedCodec, requestedFps: QUALITY_PROFILES[preset].fps, requestedWidth: QUALITY_PROFILES[preset].width, requestedHeight: QUALITY_PROFILES[preset].height },
  instrumentation: {opticalHz, systemMetrics:!args.includes('--no-system-metrics')},
  limitations: [
    'Transmitter, synthetic source and receiver share one physical CPU/GPU; performance does not isolate real two-machine usage.',
    'LAN/local test: not a two-network TURN test',
    'Dedicated synthetic window; requested canvas size does not prove compositor/capture dimensions. Delivered dimensions are qualified separately.'
  ]
};
let desktop, viewerBrowser, sourceBrowser, nativeBrowser, hostPage, viewerPage, server, remoteViewer;
const resources = await startResourceSampler({enabled:!args.includes('--no-system-metrics')});
let signaling;
let viewerContext = null;
let nativeLogSize = 0;
let hostId, viewerId;
const previous = new Map();
const serializeReport = () => JSON.stringify(report, (_,value)=>redactViewerSecrets(value,{controlEndpoint:remoteViewerEndpoint,wsEndpoint:remoteViewer?.wsEndpoint}), 2);
const checkpoint = () => writeFile(path.join(output, 'report.json'), serializeReport());
const cleanup = createCleanupCollector(report);
// Tauri rewrites HTML at build time (CSP/bootstrap); compare unmodified JS assets.
const frontendFiles = await listFrontendFiles(root);
let sourceStats = null;
const sampleBoth = async () => {
  const activeSourcePage = sourceBrowser && sourceBrowser.contexts().length > 0 && sourceBrowser.contexts()[0].pages()[0];
  if (activeSourcePage && !activeSourcePage.isClosed()) {
    sourceStats = await activeSourcePage.evaluate(readSourceStatsSummary).catch(() => null);
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
const watchErrors = (page, side) => {
  page.on('pageerror', error => {
    (report.pageErrors ||= []).push({ side, at: Date.now(), message: error.message });
  });
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type()) && (report.browserMessages ||= []).length < 200)
      report.browserMessages.push({ side, type: message.type(), message: message.text() });
  });
};
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
const fixture = createMotionFixture(syntheticTitle, sessionMagic, QUALITY_PROFILES[preset].fps, QUALITY_PROFILES[preset]);
const serve = async () => {
  const assets = await startAssetServer({ root, fixtures: { '/e2e-motion.html': fixture } });
  server = assets.server; return assets.origin;
};
const isolatedInit = async context => {
  await context.route('**/peerjs.min.js', route => route.fulfill({ path: path.join(root, 'node_modules/peerjs/dist/peerjs.min.js') }));
  await context.route('**/api/turn', route => route.fulfill({ status: 404, body: '{}' }));
  await context.addInitScript(config => { window.__SEEMYGAME_PEER_CONFIG__ = config; }, signaling.config);
  await context.addInitScript(installTelemetry, { expectedSessionMagic: sessionMagic, enableOptical:opticalHz>0, opticalSampleHz:opticalHz||8 });
  // Test fixture state in a fresh profile. No personal account/profile is used.
  await context.addInitScript(() => { localStorage.setItem('seemygame_terms_version', '1.1'); localStorage.setItem('seemygame_terms_accepted', 'true'); });
};
const join = async (page, url, name) => {
  await page.goto(url); await page.locator('#green-room-join-btn').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#green-room-user-name').fill(name);
  await page.locator('#green-room-join-btn').click();
  await waitApp(page, async () => { const app = (await import('/js/diagnostics/session-api.js')).getActiveSession(); return app.roomManager?.isInRoom === true && typeof app.roomManager?.myPeerId === 'string'; });
};
try {
  await record('preflight', async () => {
    if (process.platform !== 'win32') throw new Error('Desktop E2E requer Windows/WebView2');
    await stat(exe); report.executable = { path: exe, sha256: hash(await readFile(exe)) };
    report.displayModes=await readDisplayModes();
    report.sourceHashes = Object.fromEntries(await Promise.all([...frontendFiles, ...await listRustFiles(root),'tools/e2e/run.mjs','tools/e2e/fixtures/motion.mjs','tools/e2e/telemetry/installer.mjs','tools/e2e/harness/resources.mjs','tools/e2e/harness/resource-counters.cs','tools/e2e/harness/resource-counters.ps1','tools/e2e/harness/verdict.mjs','tools/e2e/harness/source-summary.mjs','tools/e2e/harness/remote-viewer.mjs','tools/e2e/harness/displays.mjs','tools/e2e/harness/display-info.ps1'].map(async p => [p, hash(await readFile(path.join(root, p)))])));
    if(remoteViewerEndpoint){
      const metadata=await readViewerControl(remoteViewerEndpoint,'metadata');
      remoteViewer=prepareRemoteViewer(metadata,remoteViewerEndpoint,{localPlaywrightVersion:createRequire(import.meta.url)('playwright/package.json').version,localFingerprint:machineFingerprint(),wsPort:option('--viewer-ws-port',undefined),allowSameMachine:args.includes('--allow-same-machine-remote')});
      report.receiverConditions=remoteViewer.conditions;
      report.limitations=report.limitations.filter(s=>!s.startsWith('Transmitter, synthetic source and receiver share'));
      report.limitations.push(remoteViewer.conditions.sameMachine?'Remote-browser harness self-test on one physical machine; not a two-machine performance result':'Receiver runs on a machine with a different hostname/platform/CPU fingerprint; transmitter and synthetic source still share their machine');
      report.limitations.push('Independent clocks: optical latency disabled. Receiver resource/quality windows use its own clock. HTTP/signaling use Playwright loopback forwarding; WebRTC media must establish its own ICE route.');
      if(remoteViewer.conditions.headless)report.limitations.push('Headless receiver: decode/network/callback cadence tested; physical display presentation is not certified.');
    }
  });
  if (args.includes('--check')) { report.status = 'preflight-only'; console.log('Preflight OK; no capture was started.'); }
  else {
    const localOrigin = await serve();
    signaling = await startSignalingServer();
    const webOrigin = customWebOrigin || localOrigin;
    report.webOrigin = webOrigin;
    const port = await freePort();
    const env = {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'webview-profile'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion --autoplay-policy=no-user-gesture-required`
    };
    if (args.includes('--cold-gstreamer-registry')) {
      env.GST_REGISTRY_1_0 = path.join(output, 'gst-registry.bin');
      report.gstreamerRegistry = { mode: 'isolated-cold', path: env.GST_REGISTRY_1_0 };
    }
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
      // The shipping CSP intentionally rejects arbitrary localhost signaling ports.
      // Scope the bypass to this isolated E2E WebView; do not relax application CSP.
      const cdp = await context.newCDPSession(hostPage);
      await cdp.send('Page.setBypassCSP', { enabled: true });
      report.limitations.push('Isolated desktop page bypasses CSP to use ephemeral local signaling; shipping CSP is not validated by this run.');
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
    sourceWindowPos=validateWindowPosition(option('--source-position',sourceWindowPos));
    viewerWindowPos=validateWindowPosition(option('--viewer-position',viewerWindowPos));
    report.windowPositions={source:sourceWindowPos,viewer:viewerWindowPos};

    sourceBrowser = await chromium.launch({
      channel,
      headless: false,
      args: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion',
        `--window-position=${sourceWindowPos}`,
        `--window-size=${QUALITY_PROFILES[preset].width},${QUALITY_PROFILES[preset].height}`
      ],
      timeout: 30000
    });
    const sourceContext = await sourceBrowser.newContext({ viewport: { width: QUALITY_PROFILES[preset].width, height: QUALITY_PROFILES[preset].height } });
    const source = (await sourceContext.pages())[0] || await sourceContext.newPage();
    if (source.url() !== `${localOrigin}/e2e-motion.html`) {
      await source.goto(`${localOrigin}/e2e-motion.html`);
    }
    await source.bringToFront();
    viewerBrowser = remoteViewer ? await chromium.connect(remoteViewer.wsEndpoint,{exposeNetwork:'<loopback>',timeout:30000}) : await chromium.launch({
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
    report.receiverBrowserVersion=viewerBrowser.version();
    viewerContext = await viewerBrowser.newContext();
    await viewerContext.grantPermissions(['camera', 'microphone']);
    await isolatedInit(viewerContext);
    viewerPage = await viewerContext.newPage();
    watchErrors(viewerPage, 'web');
    const room = `e2e-${randomBytes(6).toString('hex')}`, key = randomBytes(16).toString('hex');
    const fragment = `#room=${room}&key=${key}`;
    await record('desktop joins room', () => join(hostPage, `${nativeOrigin}/room.html${fragment}`, 'E2E Desktop'));
    await record('web joins same room', () => join(viewerPage, `${webOrigin}/room.html${fragment}`, 'E2E Web'));
    await viewerPage.evaluate(async enabled => {
      (await import('/js/entries/room-entry.js')).roomState.features.clipping.recorder.setPreferences({ enabled, recordLocal: false });
    }, viewerReplay);
    await record('verify mutual authenticated membership', async () => {
      await waitApp(hostPage, async () => (await import('/js/diagnostics/session-api.js')).getActiveSession().roomManager?.myPeerId != null);
      await waitApp(viewerPage, async () => (await import('/js/diagnostics/session-api.js')).getActiveSession().roomManager?.myPeerId != null);
      hostId = await hostPage.evaluate(async () => (await import('/js/diagnostics/session-api.js')).getActiveSession().roomManager?.myPeerId);
      viewerId = await viewerPage.evaluate(async () => (await import('/js/diagnostics/session-api.js')).getActiveSession().roomManager?.myPeerId);
      if (!hostId || !viewerId || hostId === viewerId) throw new Error('Identidades dos clientes inválidas');
      for (const [page, expected] of [[hostPage, viewerId], [viewerPage, hostId]]) await waitApp(page, async id => { const r = (await import('/js/diagnostics/session-api.js')).getActiveSession().roomManager; return r?.members.has(id) && r.isPeerAuthorized(id); }, expected);
    });
    const averageOf = (arr, fn) => {
      const vals = arr.map(fn).filter(n => Number.isFinite(n) && n !== null);
      return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
    };

    const sampleAndAnalyze = async ({ label, streamerSide, receiverSide, streamerPage, receiverPage, targetPeerId, durationSec, isNative = false }) => {
      const startIndex = report.measurements.length;
      const videoTimes = [];
      const timeline = [];
      const measurementStartedAt = Date.now();
      let steadyStartedAt = null, steadyEndedAt = null, receiverSteadyStart = null, receiverSteadyEnd = null;

      for (let i = 0; i < durationSec; i++) {
        const currentPhase = i < 5 ? 'warmup' : (i < durationSec - 2 ? 'steady' : 'cooldown');
        if(currentPhase==='steady'&&steadyStartedAt===null){steadyStartedAt=Date.now();receiverSteadyStart=await receiverPage.evaluate(()=>({perf:performance.now(),epoch:Date.now()}));}
        if(currentPhase==='cooldown'&&steadyEndedAt===null){steadyEndedAt=Date.now();receiverSteadyEnd=await receiverPage.evaluate(()=>({perf:performance.now(),epoch:Date.now()}));}
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
            rafFps: recentStreamer?.sourceStats?.rafFps ?? null,
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
            width: remoteInbound?.frameWidth ?? null,
            height: remoteInbound?.frameHeight ?? null,
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
            totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
            resourceSampleTimestamp:resources.latest()?.timestamp??null,
            resourceSampleAgeMs:resources.latest()?Date.now()-resources.latest().timestamp:null,
            cpu:resources.latest()?.cpu??null,
            gpuBusiestEnginePercent:resources.latest()?.gpu?.busiestEnginePercent??null,
            processGroups:resources.latest()?.processGroups??null
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
      const sourceEvidenceFile = `${label.replace(/[^a-z0-9]/gi, '-')}-source.json`;
      // Save the full provenance once, outside the hot measurement loop.
      await writeFile(path.join(output,sourceEvidenceFile),JSON.stringify(sourceStats));

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
      const measurementValid = opticalHz>0 ? validSamples >= 5 && isProvenanceValid : null;

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
        measurementReason: opticalHz===0 ? 'Medição óptica desativada; latência visual não avaliada' : measurementValid ? 'Proveniência óptica e CRC-16 validados' : 'Leituras ópticas insuficientes ou sequência ausente no log da fonte',
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
      const readProductionDiagnostic = page => page.evaluate(async () => {
        const runtime = (await import('/js/entries/room-entry.js')).roomState;
        const diagnostic=runtime.session?.services?.statsScope?.exportDiagnostic();
        return diagnostic ? {...diagnostic,clockTimeOrigin:performance.timeOrigin} : null;
      }).catch(() => null);
      const receiverDiagnostic = await readProductionDiagnostic(receiverPage);
      const senderDiagnostic = await readProductionDiagnostic(streamerPage);
      const qualitySamples=(receiverDiagnostic?.streams||[]).flatMap(s=>s.samples).filter(s=>s.timestamp>=(receiverSteadyStart?.perf??Infinity)&&s.timestamp<=(receiverSteadyEnd?.perf??Infinity));
      const qualification=assessQuality(qualitySamples,{...QUALITY_PROFILES[preset],codec:requestedCodec});
      await writeFile(path.join(output, `${label.replace(/[^a-z0-9]/gi, '-')}-diagnostic.json`), JSON.stringify({ receiver: receiverDiagnostic, sender: senderDiagnostic }, null, 2));
      let receiverResources=null;
      if(remoteViewer&&receiverPage===viewerPage){
        const remoteResources=await readViewerControl(remoteViewerEndpoint,'resources');
        const samples=resourceWindow(remoteResources,receiverSteadyStart?.epoch??Infinity,receiverSteadyEnd?.epoch??Infinity);
        receiverResources={metadata:remoteResources.metadata,clock:'receiver-epoch',summary:summarizeResources(samples),samples};
        await writeFile(path.join(output,`${label}-receiver-resources.json`),JSON.stringify(receiverResources,null,2));
      }

      return {
        sourceEvidenceFile,
        receiverResources,
        qualification,
        resources:resources.window(steadyStartedAt??measurementStartedAt,steadyEndedAt??Date.now()),
        deliveredResolutions: [...new Set(steadyTimeline.map(t => t.webInbound.width && t.webInbound.height
          ? `${t.webInbound.width}x${t.webInbound.height}` : null).filter(Boolean))],
        productionDiagnostic: { receiver: receiverDiagnostic, sender: senderDiagnostic },
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
      await hostPage.evaluate(async enabled => {
        (await import('/js/entries/room-entry.js')).roomState.features.clipping.recorder.setPreferences({ enabled, recordLocal: enabled });
      }, nativeReplay);
      await record('select native synthetic window and transmit', async () => {
        await hostPage.locator('#audio-mode-select').selectOption('none', { force: true });
        await hostPage.locator('#quality-preset').selectOption(preset, { force: true }).catch(() => {});
        await hostPage.locator('#video-codec-select').selectOption(requestedCodec, { force: true });
        await hostPage.locator('#dock-stream-btn').click({ force: true });
        await hostPage.locator('.window-item').first().waitFor({ state: 'visible', timeout: 45000 });

        let targetWindow = hostPage.locator('.window-item').filter({ hasText: syntheticTitle }).first();
        let hasTarget = (await targetWindow.count().catch(() => 0)) > 0;
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
        report.nativeTransport = await hostPage.evaluate(async () => {
          const state = (await import('/js/entries/room-entry.js')).roomState;
          return { browserMediaCalls: state.screenCalls.size, directNativePeers: state.features.nativeMedia.senders.size };
        });
        if (report.nativeTransport.browserMediaCalls !== 0 || report.nativeTransport.directNativePeers !== 1)
          throw new Error('A fase nativa deve usar envio direto GStreamer, sem recodificação no navegador');
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
      if (nativeReplay) report.nativeReplay = await record('export native replay and decode MP4', async () => hostPage.evaluate(async () => {
        const registry = (await import('/js/entries/room-entry.js')).roomState.features.clipping.recorder;
        const recorder = registry.getRecorder('local-me'); await recorder?.ready;
        if (!recorder?.sessionId || recorder.mediaRecorder) throw new Error('Replay must reuse native encoded data');
        const blob = await registry.exportClip(null, 'local-me');
        if (!blob?.size) throw new Error('Empty native clip');
        const url = URL.createObjectURL(blob), video = document.createElement('video');
        video.src = url; video.muted = true; video.style.cssText = 'position:fixed;bottom:0;left:0;width:320px;z-index:100000';
        document.body.appendChild(video);
        try {
          await Promise.race([new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('Native MP4 does not decode')); }), new Promise((_, reject) => setTimeout(() => reject(new Error('Native MP4 decode timeout')), 10000))]);
          await video.play(); await new Promise(resolve => setTimeout(resolve, 700));
          const decodedFrames = video.getVideoPlaybackQuality().totalVideoFrames;
          if (decodedFrames < 3) throw new Error('Native clip has no moving video');
          const dataBase64 = await new Promise(resolve => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result.slice(reader.result.lastIndexOf(',') + 1)); reader.readAsDataURL(blob);
          });
          return { bytes: blob.size, mime: blob.type, width: video.videoWidth, height: video.videoHeight, decodedFrames, mediaRecorder: false, dataBase64 };
        } finally { video.pause(); video.remove(); URL.revokeObjectURL(url); }
      }));
      if (report.nativeReplay?.dataBase64) {
        await writeFile(path.join(output, 'native-replay.mp4'), Buffer.from(report.nativeReplay.dataBase64, 'base64'));
        delete report.nativeReplay.dataBase64;
        report.nativeReplay.artifact = path.join(output, 'native-replay.mp4');
      }

      report.checks.push({ name: 'remote decoded frames progress', status: 'passed' });

      await hostPage.screenshot({ path: path.join(output, isCompareMode ? 'desktop-native.png' : 'desktop.png') });
      await viewerPage.screenshot({ path: path.join(output, isCompareMode ? 'viewer-native.png' : 'viewer.png') });

      await record('stop native capture via desktop UI and verify idle', async () => {
        await hostPage.locator('#dock-stream-btn').click({ force: true });
        await waitApp(hostPage, async () => (await (await import('/js/desktop.js')).getNativeCaptureState()).state === 'idle', null, 15000);
      });

      return res;
    };

    const executeWebPhase = async () => {
      console.log('\n--- Executando Fase: Web Capture (getDisplayMedia) ---');
      await record('start web capture transmission', async () => {
        await viewerPage.locator('#audio-mode-select').selectOption('none', { force: true }).catch(() => {});
        await viewerPage.locator('#quality-preset').selectOption(preset, { force: true }).catch(() => {});
        await viewerPage.locator('#video-codec-select').selectOption(requestedCodec, { force: true });
        await source.bringToFront().catch(() => {});
        await source.evaluate(() => window.focus()).catch(() => {});
        await sleep(500);
        await viewerPage.evaluate(async () => {
          const app = (await import('/js/diagnostics/session-api.js')).getActiveSession();
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
          const app = (await import('/js/diagnostics/session-api.js')).getActiveSession();
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
        captureMethodIsolated: false,
        declaredFactors: [
          'Streamer: WebView2 (Nativo) vs Chromium (Web)',
          'Receiver: Chromium (Nativo) vs WebView2 (Web)',
          'Fonte: Janela sintética idêntica SMG E2E Motion (1280x720)',
          'Superfície de Captura: Janela vs Janela (Direct3D 11/WGC vs getDisplayMedia)',
          'Fonte solicitada: 1280x720 @ 60 FPS; resolução entregue registrada separadamente',
          'Os receptores são diferentes; esta execução não isola apenas o método de captura'
        ],
        deliveredResolutions: { native: nativeResult.deliveredResolutions, web: webResult.deliveredResolutions },
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
          latencyEvaluation: 'Comparação exploratória: receptores distintos; deltas não isolam o método de captura',
          observedLatencyDifference: measurementValidBoth && natLat !== null && webLat !== null
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

      console.log('\n=== Comparação observada (Nativo vs Web; veja condições no relatório) ===');
      console.table({
        'Nativo (Direct3D 11)': {
          'FPS Mediano (Steady)': natFps?.toFixed(1),
          'Latência p50 Steady (ms)': natLat ?? 'Inconclusivo',
          'Latência p90 Steady (ms)': nativeResult.glassToGlassLatency?.p90Ms ?? 'N/A',
          'Latência p99 Steady (ms)': nativeResult.glassToGlassLatency?.p99Ms ?? 'N/A',
          'Encode Outbound (ms)': natEncodeMs ?? 'N/A (encoder nativo não medido)',
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
    const qualifications=[nativeResult.qualification,...(isCompareMode?[webResult.qualification]:[])];
    const qualificationStatus=qualifications.some(q=>q.status==='failed')?'failed':qualifications.every(q=>q.status==='passed')?'passed':'insufficient-evidence';
    const fpsResults=[nativeResult.performance.p10DecodedFps,...(isCompareMode?[webResult.performance.p10DecodedFps]:[])];
    report.verdict = evaluateStreamVerdict({functionalPassed,measurementRequested:opticalHz>0,measurementValid,qualificationStatus,requireQuality,minFps,p10Fps:fpsResults.every(Number.isFinite)?Math.min(...fpsResults):null});

    report.status = report.verdict.overallStatus;
  }
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally {
  await resources.stop();report.resources=resources.report();
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
  if(remoteViewer&&viewerContext)await cleanup('close owned remote viewer context',()=>viewerContext.close());
  for (const [name, browser] of [['viewer', viewerBrowser], ['source', sourceBrowser], ['desktop CDP', nativeBrowser]]) if (browser) await cleanup(`close ${name}`, () => browser.close());
  if (desktop && desktop.exitCode === null) { desktop.kill(); }
  if (desktop) {
    const log = await readFile(path.join(path.dirname(exe), 'native_debug.log')).catch(() => Buffer.alloc(0));
    if (log.length > nativeLogSize) await writeFile(path.join(output, 'native-debug.log'), log.subarray(nativeLogSize));
  }
  if (server) { server.closeAllConnections(); await cleanup('close HTTP server', () => new Promise(r => server.close(r))); }
  if (signaling) await cleanup('close local signaling', () => signaling.close());
  await writeFile(path.join(output, 'report.json'), serializeReport());
  console.log(`E2E ${report.status}: ${path.join(output, 'report.json')}`);
}
if(report.status==='failed')process.exitCode=1;else if(report.status==='inconclusive')process.exitCode=2;
