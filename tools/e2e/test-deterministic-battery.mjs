import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { spawn, execSync } from 'node:child_process';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ensureDefaultDesktop } from './desktop-affinity.mjs';
import { installTelemetry, deltaMetrics, evaluateQualityBudget, computeSteadyQuality } from './telemetry.mjs';

ensureDefaultDesktop();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const exe = path.join(root, 'src-tauri/target/release/seemygame.exe');
const channel = 'msedge';
const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.join(root, 'output/isolation-battery', runTimestamp);
await mkdir(outputDir, { recursive: true });

// Suporte a filtro de cenários via CLI (--scenario, --focus, -s) ou variável de ambiente (SCENARIOS, SCENARIO)
const args = process.argv.slice(2);
let scenarioFilter = process.env.SCENARIOS || process.env.SCENARIO || null;
let encoderOverride = process.env.SEEMYGAME_NATIVE_H264_ENCODER || null;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--scenario=') || arg.startsWith('--focus=')) {
    scenarioFilter = arg.split('=')[1];
  } else if (arg === '--scenario' || arg === '--focus' || arg === '-s') {
    scenarioFilter = args[i + 1];
    i++;
  } else if (arg.startsWith('--encoder=')) {
    encoderOverride = arg.split('=')[1];
  } else if (arg === '--encoder') {
    encoderOverride = args[i + 1];
    i++;
  }
}

if (encoderOverride) {
  process.env.SEEMYGAME_NATIVE_H264_ENCODER = encoderOverride;
  console.log(`[Encoder Ativo] Forçando backend H.264: ${encoderOverride}`);
}

const targetScenarios = scenarioFilter
  ? scenarioFilter.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  : null;

const shouldRunScenario = (key, id) => {
  if (!targetScenarios || targetScenarios.length === 0) return true;
  const k = key.toLowerCase();
  const i = id.toLowerCase();
  return targetScenarios.some(t => k.includes(t) || i === t || k === t);
};

if (targetScenarios) {
  console.log(`[Filtro Ativo] Executando apenas cenários correspondentes a: ${targetScenarios.join(', ')}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = async () => {
  const s = createTcpServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  await new Promise(r => s.close(r));
  return port;
};

const hashFile = async filepath => {
  try {
    const bytes = await readFile(filepath);
    return createHash('sha256').update(bytes).digest('hex');
  } catch {
    return null;
  }
};

// Coleta de proveniência expandida com auditoria completa de artefatos
const getProvenance = async (samplePage = null, nativeCaps = null, viewerLaunchArgs = []) => {
  let gitCommit = 'unknown';
  let gitBranch = 'unknown';
  let gitDirty = false;
  let gitStatus = '';
  try {
    gitCommit = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
    gitBranch = execSync('git branch --show-current', { cwd: root }).toString().trim();
    gitStatus = execSync('git status --porcelain', { cwd: root }).toString().trim();
    gitDirty = gitStatus.length > 0;
  } catch {}

  let exeSha256 = null;
  let exeMtime = null;
  let exeSizeBytes = null;
  try {
    exeSha256 = await hashFile(exe);
    const fileStat = await stat(exe);
    exeMtime = fileStat.mtime.toISOString();
    exeSizeBytes = fileStat.size;
  } catch {}

  const fixtureSha256 = await hashFile(path.join(root, 'fixtures/deterministic-60fps.html'));
  const telemetrySha256 = await hashFile(path.join(root, 'tools/e2e/telemetry.mjs'));
  const testScriptSha256 = await hashFile(path.join(root, 'tools/e2e/test-deterministic-battery.mjs'));
  const uiJsSha256 = await hashFile(path.join(root, 'js/ui.js'));
  const appJsSha256 = await hashFile(path.join(root, 'js/app.js'));
  const webrtcJsSha256 = await hashFile(path.join(root, 'js/webrtc.js'));
  const nativeWebrtcJsSha256 = await hashFile(path.join(root, 'js/native-webrtc.js'));

  let gpuInfo = { vendor: 'unknown', renderer: 'unknown' };
  let browserUserAgent = 'unknown';
  if (samplePage) {
    try {
      gpuInfo = await samplePage.evaluate(() => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return { vendor: 'no-webgl', renderer: 'no-webgl' };
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return {
          vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
          renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
        };
      });
      browserUserAgent = await samplePage.evaluate(() => navigator.userAgent);
    } catch {}
  }

  return {
    gitCommit,
    gitBranch,
    gitDirty,
    gitStatusSummary: gitStatus.split('\n').map(s => s.trim()).filter(Boolean),
    exePath: exe,
    exeSha256,
    exeMtime,
    exeSizeBytes,
    componentHashes: {
      'fixtures/deterministic-60fps.html': fixtureSha256,
      'telemetry.mjs': telemetrySha256,
      'test-deterministic-battery.mjs': testScriptSha256,
      'ui.js': uiJsSha256,
      'app.js': appJsSha256,
      'webrtc.js': webrtcJsSha256,
      'native-webrtc.js': nativeWebrtcJsSha256
    },
    gpuInfo,
    browserUserAgent,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    browserChannel: channel,
    viewerBrowserLaunchArgs: viewerLaunchArgs,
    nativeCapabilities: nativeCaps,
    sourceType: 'deterministic-60fps-native1080p',
    startedAt: new Date().toISOString()
  };
};

// Servidor de arquivos estáticos para o cliente web e fixtures
let server;
const serve = async () => {
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (!/^\/(room\.html|index\.html|(?:js|css|assets|fixtures)\/[a-zA-Z0-9_./-]+)$/.test(pathname) || pathname.includes('..')) {
        res.writeHead(404);
        return res.end();
      }
      const filename = path.resolve(root, '.' + pathname);
      if (!filename.startsWith(root + path.sep)) throw new Error('Caminho inválido');
      res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await readFile(filename));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
};

// Configura contexto sem medição óptica parasitária
const setupContext = async context => {
  await context.addInitScript(installTelemetry, { expectedSessionMagic: null, enableOptical: false });
  await context.addInitScript(() => {
    localStorage.setItem('seemygame_terms_version', '1.1');
    localStorage.setItem('seemygame_terms_accepted', 'true');
  });
};

const waitApp = async (page, predicate, argument, timeout = 45000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const ok = await page.evaluate(predicate, argument);
      if (ok) return true;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timeout aguardando condição da aplicação (${timeout}ms)`);
};

const joinRoom = async (page, url, name) => {
  await page.goto(url);
  await page.locator('#green-room-join-btn').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#green-room-user-name').fill(name);
  await page.locator('#green-room-join-btn').click();
  await waitApp(page, async () => {
    const app = await import('/js/app.js');
    return app.roomManager?.isInRoom === true && typeof app.roomManager?.myPeerId === 'string';
  });
};

const runIsolationSuite = async () => {
  console.log('=====================================================');
  console.log('Bateria de Isolamento Científico (60.0 FPS Monotônico Nativo 1080p)');
  console.log('Fonte: HTML5 Canvas 1920x1080 @ 60.0 Hz + WebAudio Sintetizado 48 kHz');
  console.log('Diretório de saída:', outputDir);
  console.log('=====================================================\n');

  const webOrigin = await serve();
  console.log('Servidor web local ativo em:', webOrigin);

  // 1. Iniciar navegador da fonte na resolução nativa 1920x1080 com trava 60 Hz
  console.log('\n[Passo 1] Abrindo janela da fonte no Edge com fixture determinística 1080p60...');
  const sourceBrowser = await chromium.launch({
    channel,
    headless: false,
    args: [
      '--window-position=50,50',
      '--window-size=1920,1080',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion,msSleepingTabs,msSleepingTabsBlockedForTesting,msQuickFreezing'
    ]
  });
  const sourceContext = await sourceBrowser.newContext({ viewport: { width: 1920, height: 1080 } });
  const sourcePage = await sourceContext.newPage();
  await sourcePage.goto(`${webOrigin}/fixtures/deterministic-60fps.html`);
  await sleep(1500);

  const getSourceSceneState = async () => {
    return await sourcePage.evaluate(() => {
      if (window.__deterministicSource) {
        return window.__deterministicSource.getState();
      }
      return {
        drawnFrames: 0,
        plannedFrames: 0,
        skippedTicks: 0,
        fps: 0,
        elapsedMs: 0,
        currentTime: 0,
        audioActive: false,
        nativeWidth: 0,
        nativeHeight: 0,
        paused: true,
        readyState: 0,
        playerState: null,
        hasError: true,
        isReady: false
      };
    });
  };

  const prepareSourceScene = async () => {
    await sourcePage.bringToFront().catch(() => {});
    await sourcePage.evaluate(() => {
      window.focus();
      window.__deterministicSource?.reset?.();
      window.__deterministicSource?.startAudio?.();
      window.__deterministicSource?.setMuted?.(false);
      window.__deterministicSource?.setVolume?.(1.0);
    });
    // Aguarda estabilizar a janela deslizante de 60 frames da fonte
    await sleep(1200);
  };

  await prepareSourceScene();
  const initialProbe = await getSourceSceneState();
  const sourceTitle = await sourcePage.title();
  console.log(`Janela da fonte carregada: "${sourceTitle}" | res=${initialProbe.nativeWidth}x${initialProbe.nativeHeight} | fps=${initialProbe.fps}`);

  // 2. Iniciar aplicativo desktop nativo
  console.log('\n[Passo 2] Iniciando aplicativo desktop nativo (seemygame.exe)...');
  const cdpPort = await freePort();
  const env = {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: path.join(outputDir, 'webview-profile'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort} --remote-debugging-address=127.0.0.1 --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion --autoplay-policy=no-user-gesture-required`
  };
  const desktopProcess = spawn(exe, [], { cwd: path.dirname(exe), env, windowsHide: false, stdio: 'ignore' });
  let nativeBrowser = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (desktopProcess.exitCode !== null) throw new Error(`Desktop saiu prematuramente: ${desktopProcess.exitCode}`);
    try {
      nativeBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 1000 });
      break;
    } catch {
      await sleep(400);
    }
  }
  if (!nativeBrowser) throw new Error('Falha ao conectar CDP ao WebView2 do aplicativo desktop');

  const desktopContext = nativeBrowser.contexts()[0];
  await setupContext(desktopContext);
  const hostPage = desktopContext.pages()[0] || await desktopContext.newPage();
  if (!hostPage.url() || hostPage.url() === 'about:blank') {
    await hostPage.waitForURL(u => u && u.href !== 'about:blank', { timeout: 15000 });
  }
  await hostPage.evaluate(async () => {
    const t = window.__TAURI__;
    if (t && await t.core?.invoke('is_always_on_top')) {
      await t.core?.invoke('toggle_always_on_top');
    }
  }).catch(() => {});
  console.log('Conectado ao WebView2 desktop. URL:', hostPage.url());

  // 3. Iniciar navegador espectador (com --mute-audio para isolar endpoint WASAPI do SO de realimentação acústica em máquina única)
  console.log('\n[Passo 3] Iniciando navegador espectador (Edge com isolamento de áudio do sistema)...');
  const viewerLaunchArgs = [
    '--window-position=600,100',
    '--window-size=1280,720',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio', // Previne retroalimentação / loopback acústico do espectador no endpoint WASAPI padrão em máquina única
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'
  ];
  const viewerBrowser = await chromium.launch({
    channel,
    headless: false,
    args: viewerLaunchArgs
  });
  const viewerContext = await viewerBrowser.newContext();
  await setupContext(viewerContext);
  const viewerPage = await viewerContext.newPage();

  // Listeners de diagnóstico
  hostPage.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('Capture') || msg.text().includes('WebRTC') || msg.text().includes('Native')) {
      console.log(`[Host Console ${msg.type()}] ${msg.text()}`);
    }
  });
  hostPage.on('pageerror', err => console.log(`[Host PageError] ${err.message}`));
  viewerPage.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('WebRTC') || msg.text().includes('Track') || msg.text().includes('Stream')) {
      console.log(`[Viewer Console ${msg.type()}] ${msg.text()}`);
    }
  });
  viewerPage.on('pageerror', err => console.log(`[Viewer PageError] ${err.message}`));

  // Proveniência completa
  const provenance = await getProvenance(viewerPage, null, viewerLaunchArgs);
  console.log(`[Proveniência] Git Commit: ${provenance.gitCommit} (dirty: ${provenance.gitDirty})`);
  console.log(`[Proveniência] Exe SHA256: ${provenance.exeSha256?.slice(0, 16)}...`);
  console.log(`[Proveniência] Fixture SHA256: ${provenance.componentHashes['fixtures/deterministic-60fps.html']?.slice(0, 16)}...`);
  console.log(`[Proveniência] OS Release: ${provenance.osRelease} | GPU Renderer: ${provenance.gpuInfo.renderer}`);

  // 4. Ambos entram na mesma sala
  const roomName = `det-iso-${randomBytes(4).toString('hex')}`;
  const roomKey = randomBytes(16).toString('hex');
  const roomHash = `#room=${roomName}&key=${roomKey}`;
  const nativeOrigin = new URL(hostPage.url()).origin;

  console.log(`\nEntrando na sala WebRTC: ${roomName}`);
  await joinRoom(hostPage, `${nativeOrigin}/room.html${roomHash}`, 'Host Desktop');
  await joinRoom(viewerPage, `${webOrigin}/room.html${roomHash}`, 'Espectador Web');

  const nativeCaps = await hostPage.evaluate(async () => {
    const d = await import('/js/desktop.js').catch(() => null);
    return d?.getNativeCaptureCapabilities ? await d.getNativeCaptureCapabilities() : null;
  }).catch(() => null);
  console.log('[Host] Capacidades nativas detectadas:', JSON.stringify(nativeCaps));
  provenance.nativeCapabilities = nativeCaps;

  const hostId = await hostPage.evaluate(async () => (await import('/js/app.js')).roomManager?.myPeerId);
  const viewerId = await viewerPage.evaluate(async () => (await import('/js/app.js')).roomManager?.myPeerId);
  if (!hostId || !viewerId || hostId === viewerId) throw new Error('Identidades dos clientes na sala são inválidas');
  console.log(`Membros na sala: Host=${hostId}, Espectador=${viewerId}. Aguardando admissão mútua autenticada...`);

  for (const [page, expected, label] of [[hostPage, viewerId, 'Host'], [viewerPage, hostId, 'Espectador']]) {
    await waitApp(page, async id => {
      const r = (await import('/js/app.js')).roomManager;
      return r?.members?.has(id) && r.isPeerAuthorized(id);
    }, expected, 30000).catch(err => {
      throw new Error(`Falha na autorização mútua da sala (${label} esperando ${expected}): ${err.message}`);
    });
  }
  console.log(`Membros devidamente autenticados e autorizados na malha da sala!`);

  let lastSeenVideoTrackId = null;

  const startNativeCapture = async (audioMode = 'system', windowTitleFilter = 'Determinística', encoderChoice = null) => {
    console.log(`Configurando captura nativa: audioMode=${audioMode} | filtro=${windowTitleFilter}`);
    await hostPage.locator('#audio-mode-select').selectOption(audioMode, { force: true });
    const targetEncoder = encoderChoice || encoderOverride;
    if (targetEncoder) {
      await hostPage.evaluate((enc) => {
        const sel = document.getElementById('h264-encoder-select');
        if (sel) {
          sel.value = enc;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        try { localStorage.setItem('seemygame_h264_encoder', enc); } catch (e) {}
      }, targetEncoder).catch(() => {});
    }
    await hostPage.locator('#dock-stream-btn').click();
    await hostPage.locator('.window-item').first().waitFor({ state: 'visible', timeout: 30000 });

    let targetWindow = hostPage.locator('.window-item').filter({ hasText: windowTitleFilter }).first();
    if ((await targetWindow.count()) === 0) {
      targetWindow = hostPage.locator('.window-item').filter({ hasText: '60 FPS' }).first();
    }
    if ((await targetWindow.count()) === 0) {
      targetWindow = hostPage.locator('.window-item').filter({ hasText: 'deterministic' }).first();
    }
    if ((await targetWindow.count()) === 0) {
      const titles = await hostPage.locator('.window-item .window-title').allInnerTexts();
      throw new Error(`Janela alvo não encontrada na lista nativa (${windowTitleFilter}): ${JSON.stringify(titles)}`);
    }

    await sourcePage.bringToFront().catch(() => {});
    await sourcePage.evaluate(() => window.focus()).catch(() => {});
    await sleep(400);

    const actionBtn = targetWindow.locator('.window-action-btn');
    if ((await actionBtn.count()) > 0) {
      await actionBtn.first().click({ force: true });
    } else {
      await targetWindow.click({ force: true });
    }

    await sourcePage.bringToFront().catch(() => {});
    await sourcePage.evaluate(() => window.focus()).catch(() => {});

    console.log('Aguardando stream nativo chegar ao espectador...');
    const deadline = Date.now() + 45000;
    let ready = false;
    let lastDiagTime = 0;
    while (Date.now() < deadline) {
      ready = await currentTargetViewerPage.evaluate(({ hId, prevTrackId }) => {
        const unmute = document.querySelector('.audio-unmute-overlay button');
        if (unmute) unmute.click();
        const card = document.getElementById(`card-${hId}`);
        const v = card?.querySelector('video');
        if (v && v.paused) {
          v.muted = true;
          v.play().catch(() => {});
        }
        const stream = v?.srcObject;
        const vTrack = stream?.getVideoTracks?.()[0];
        if (!v || !stream || !vTrack) return false;
        if (vTrack.readyState !== 'live') return false;
        if (prevTrackId && vTrack.id === prevTrackId) return false;
        return v.videoWidth > 0 && v.readyState >= 2 && !v.paused;
      }, { hId: hostId, prevTrackId: lastSeenVideoTrackId }).catch(() => false);
      if (ready) break;

      if (Date.now() - lastDiagTime >= 4000) {
        lastDiagTime = Date.now();
        const hostDiag = await hostPage.evaluate(async () => {
          const a = await import('/js/app.js').catch(() => null);
          const d = await import('/js/desktop.js').catch(() => null);
          const capState = d?.getNativeCaptureState ? await d.getNativeCaptureState() : null;
          return {
            isStartingStream: a?.isStartingStream,
            hasLocalStream: !!a?.localStream,
            capState: capState?.state
          };
        }).catch(err => ({ err: err.message }));
        const viewerDiag = await currentTargetViewerPage.evaluate(({ hId }) => {
          const card = document.getElementById(`card-${hId}`);
          const v = card?.querySelector('video');
          const stream = v?.srcObject;
          const vTrack = stream?.getVideoTracks?.()[0];
          return {
            card: !!card,
            video: !!v,
            vWidth: v?.videoWidth,
            vReady: v?.readyState,
            vPaused: v?.paused,
            stream: !!stream,
            vTrack: vTrack?.readyState
          };
        }, { hId: hostId }).catch(err => ({ err: err.message }));
        console.log(`  [Aguardando stream] Host: ${JSON.stringify(hostDiag)} | Viewer: ${JSON.stringify(viewerDiag)}`);

        if (hostDiag?.capState === 'error') {
          console.warn('Detectado capState: error no host. Aguardando 4s para reciclagem de handles e tentando reiniciar captura...');
          await sleep(4000);
          await hostPage.locator('#dock-stream-btn').click().catch(() => {});
          await sleep(1500);
          await hostPage.locator('#dock-stream-btn').click().catch(() => {});
          await hostPage.locator('.window-item').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
          const actionBtnRetry = targetWindow.locator('.window-action-btn');
          if ((await actionBtnRetry.count()) > 0) {
            await actionBtnRetry.first().click({ force: true }).catch(() => {});
          } else {
            await targetWindow.click({ force: true }).catch(() => {});
          }
        }
      }

      await sleep(1000);
    }
    if (!ready) throw new Error('Espectador não reproduziu stream nativo dentro de 45s');
    const streamInfo = await inspectViewerStream();
    lastSeenVideoTrackId = streamInfo.videoTrackId;
    console.log(`Stream nativo recebido e reproduzindo no espectador! TrackId: ${lastSeenVideoTrackId}`);
    await sleep(1500);
  };

  let currentTargetViewerPage = viewerPage;

  const stopNativeCapture = async () => {
    console.log('Parando captura nativa e limpando estado WebRTC...');
    // 1. Invoca parada via app.js e desktop.js no host
    await hostPage.evaluate(async () => {
      const app = await import('/js/app.js').catch(() => null);
      if (app?.stopLocalStream) {
        try { app.stopLocalStream(); } catch {}
      }
      const picker = document.getElementById('desktop-picker-modal');
      if (picker) picker.style.display = 'none';
      const d = await import('/js/desktop.js').catch(() => null);
      if (d?.stopNativeCapture) {
        await d.stopNativeCapture().catch(() => {});
      }
    }).catch(() => {});

    // 2. Limpa elemento de vídeo no espectador para desvincular MediaStream antigo
    if (currentTargetViewerPage && !currentTargetViewerPage.isClosed()) {
      await currentTargetViewerPage.evaluate(({ hId }) => {
        const card = document.getElementById(`card-${hId}`);
        const v = card?.querySelector('video');
        if (v) {
          v.pause();
          v.srcObject = null;
        }
      }, { hId: hostId }).catch(() => {});
    }

    // 3. Aguarda confirmação de idle no host (com polling de até 15s)
    let isIdle = false;
    const idleDeadline = Date.now() + 15000;
    while (Date.now() < idleDeadline) {
      const st = await hostPage.evaluate(async () => {
        const d = await import('/js/desktop.js').catch(() => null);
        return d?.getNativeCaptureState ? await d.getNativeCaptureState().catch(() => null) : null;
      }).catch(() => null);
      if (!st || st.state === 'idle') {
        isIdle = true;
        break;
      }
      await sleep(500);
    }
    if (!isIdle) {
      console.warn('[stopNativeCapture] Host não confirmou idle dentro de 15s. Forçando parada direta...');
      await hostPage.evaluate(async () => {
        const d = await import('/js/desktop.js').catch(() => null);
        if (d?.stopNativeCapture) await d.stopNativeCapture().catch(() => {});
      }).catch(() => {});
    }

    // 4. Pausa preventiva de 4s para drenagem de drivers D3D11 e WASAPI no Windows
    await sleep(4000);
  };

  const inspectViewerStream = async (targetPage = currentTargetViewerPage) => {
    return await targetPage.evaluate(hId => {
      const card = document.getElementById(`card-${hId}`);
      const video = card?.querySelector('video');
      const stream = video?.srcObject;
      const vTrack = stream?.getVideoTracks?.()[0];
      const aTrack = stream?.getAudioTracks?.()[0];
      return {
        hasStream: Boolean(stream),
        videoTrackId: vTrack?.id || null,
        videoTrackReadyState: vTrack?.readyState || null,
        audioTrackId: aTrack?.id || null,
        audioTrackReadyState: aTrack?.readyState || null,
        audioTracksCount: stream?.getAudioTracks?.().length || 0,
        videoWidth: video?.videoWidth || 0,
        videoHeight: video?.videoHeight || 0,
        videoPaused: Boolean(video?.paused),
        videoMuted: Boolean(video?.muted),
        videoVolume: video?.volume ?? null
      };
    }, hostId);
  };

  const configureAndInspectJitter = async (playoutDelaySec, jitterTargetMs, targetPage = currentTargetViewerPage) => {
    return await targetPage.evaluate(async ({ pDelay, jTarget }) => {
      const receivers = [];
      if (window.RTCPeerConnection && window.__smgPeers) {
        for (const pc of window.__smgPeers) {
          if (pc.signalingState === 'closed') continue;
          for (const r of pc.getReceivers()) {
            if ('playoutDelayHint' in r) r.playoutDelayHint = pDelay;
            if ('jitterBufferTarget' in r) r.jitterBufferTarget = jTarget;
            receivers.push({
              kind: r.track?.kind,
              effectivePlayoutDelayHint: r.playoutDelayHint ?? null,
              effectiveJitterBufferTarget: r.jitterBufferTarget ?? null
            });
          }
        }
      }
      return receivers;
    }, { pDelay: playoutDelaySec, jTarget: jitterTargetMs });
  };

  // Coleta isolada e rigorosa com verificação contínua de invariantes
  const previousMap = new Map();
  const runScenarioExecution = async (scenarioConfig) => {
    const {
      id,
      name,
      audioMode,
      expectAudible,
      expectedElementMuted,
      expectedElementVolume,
      expectHostPreviewSuspended,
      targetPlayoutDelayHint = undefined,
      targetJitterBufferTarget = undefined,
      warmupSec = 3,
      durationSec = 20
    } = scenarioConfig;

    console.log(`\n-----------------------------------------------------`);
    console.log(`EXECUTANDO: ${name}`);
    console.log(`Configuração: audioMode=${audioMode} | expectAudible=${expectAudible} | muted=${expectedElementMuted} | volume=${expectedElementVolume} | previewSuspended=${expectHostPreviewSuspended} | dur=${durationSec}s`);
    console.log(`-----------------------------------------------------`);

    const unmetInvariants = [];
    let activeViewerPage = viewerPage;
    let dedicatedUnmutedBrowser = null;
    let dedicatedUnmutedContext = null;

    try {
      // Caso o cenário exija saída de áudio desmutada real no navegador (Áudio por Processo)
      if (scenarioConfig.browserGloballyMuted === false) {
        console.log('[Áudio por Processo] Abrindo instância dedicada do navegador SEM --mute-audio...');
        const unmutedViewerLaunchArgs = [
          '--window-position=600,100',
          '--window-size=1280,720',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ];
        dedicatedUnmutedBrowser = await chromium.launch({
          channel,
          headless: false,
          args: unmutedViewerLaunchArgs
        });
        dedicatedUnmutedContext = await dedicatedUnmutedBrowser.newContext();
        await setupContext(dedicatedUnmutedContext);
        activeViewerPage = await dedicatedUnmutedContext.newPage();
        await activeViewerPage.goto(`http://127.0.0.1:${port}/index.html${roomHash}`);
        await activeViewerPage.waitForSelector('#app', { state: 'visible', timeout: 15000 });
        currentTargetViewerPage = activeViewerPage;
      } else {
        currentTargetViewerPage = viewerPage;
      }

      // 0. Teardown preventivo pré-cenário se estado de captura nativa não for idle
      const preCapState = await hostPage.evaluate(async () => {
        const d = await import('/js/desktop.js').catch(() => null);
        return d?.getNativeCaptureState ? await d.getNativeCaptureState().catch(() => null) : null;
      }).catch(() => null);
      if (preCapState && preCapState.state !== 'idle') {
        console.warn(`[Pré-cenário] Detectada captura não-idle no host (${preCapState.state}). Executando teardown preventivo...`);
        await stopNativeCapture();
      }

      // 1. Reset e fixação determinística de estado inicial da fonte
      await prepareSourceScene();

      // 2. Inicia captura nativa
      await startNativeCapture(audioMode, 'Determinística', activeViewerPage);

      // 3. Configura estado de áudio do elemento do espectador
      await activeViewerPage.evaluate(({ hId, muted, volume }) => {
        const unmute = document.querySelector('.audio-unmute-overlay button');
        if (unmute) unmute.click();
        const card = document.getElementById(`card-${hId}`);
        const v = card?.querySelector('video');
        if (v) {
          v.muted = muted;
          v.volume = volume;
          if (!muted && volume > 0 && v.paused) v.play().catch(() => {});
        }
      }, { hId: hostId, muted: expectedElementMuted, volume: expectedElementVolume });

      // 4. Se a prévia local precisa ser suspensa, suspende e verifica
      let hostPreviewSuspended = false;
      if (expectHostPreviewSuspended) {
        await hostPage.locator('#toggle-local-preview-btn').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        await hostPage.locator('#toggle-local-preview-btn').click().catch(() => {});
        hostPreviewSuspended = await hostPage.evaluate(() => {
          const v = document.querySelector('.video-card[data-is-local="true"] video')
                 || document.querySelector('#card-local-me video');
          return v ? v.srcObject === null : false;
        });
        console.log(`[Host] Prévia local suspensa: ${hostPreviewSuspended}`);
        if (!hostPreviewSuspended) {
          unmetInvariants.push('host_preview_suspension_failed');
        }
      } else {
        // Garante prévia ativa
        await hostPage.evaluate(() => {
          const btn = document.getElementById('toggle-local-preview-btn');
          const v = document.querySelector('.video-card[data-is-local="true"] video')
                 || document.querySelector('#card-local-me video');
          if (v && v.srcObject === null && btn) {
            btn.click();
          }
        }).catch(() => {});
      }

      // 5. Configura jitter buffer se especificado
      let effectiveReceivers = [];
      if (targetPlayoutDelayHint !== undefined || targetJitterBufferTarget !== undefined) {
        effectiveReceivers = await configureAndInspectJitter(targetPlayoutDelayHint, targetJitterBufferTarget, activeViewerPage);
        console.log(`[Receptores] Configurados:`, JSON.stringify(effectiveReceivers));
        const videoRecv = effectiveReceivers.find(r => r.kind === 'video');
        if (targetPlayoutDelayHint !== undefined && videoRecv?.effectivePlayoutDelayHint !== targetPlayoutDelayHint) {
          unmetInvariants.push(`targetPlayoutDelayHint_mismatch: expected ${targetPlayoutDelayHint}, got ${videoRecv?.effectivePlayoutDelayHint}`);
        }
        if (targetJitterBufferTarget !== undefined && videoRecv?.effectiveJitterBufferTarget !== targetJitterBufferTarget) {
          unmetInvariants.push(`targetJitterBufferTarget_mismatch: expected ${targetJitterBufferTarget}, got ${videoRecv?.effectiveJitterBufferTarget}`);
        }
      }

      // 6. Warm-up da captura
      console.log(`[${name}] Aguardando estabilização warm-up (${warmupSec}s)...`);
      await sleep(warmupSec * 1000);

      // Inicia rastreamento estrito da fase steady na fonte isolando completamente o warmup
      await sourcePage.evaluate(() => window.__deterministicSource?.startSteadyTracking?.()).catch(() => {});

      const initialSourceState = await getSourceSceneState();
      console.log(`[Fonte] Início da medição steady: frames=${initialSourceState.drawnFrames} | fps=${initialSourceState.fps?.toFixed(2)} | res=${initialSourceState.nativeWidth}x${initialSourceState.nativeHeight} | audio=${initialSourceState.audioActive} | ready=${initialSourceState.isReady}`);

      if (!initialSourceState.isReady || initialSourceState.fps < 57.0 || initialSourceState.fps > 63.0) {
        unmetInvariants.push(`source_initial_cadence_invalid: fps=${initialSourceState.fps}, ready=${initialSourceState.isReady}`);
      }
      if (initialSourceState.nativeWidth !== 1920 || initialSourceState.nativeHeight !== 1080) {
        unmetInvariants.push(`source_resolution_mismatch: got ${initialSourceState.nativeWidth}x${initialSourceState.nativeHeight}, expected 1920x1080`);
      }
      if (expectAudible && !initialSourceState.audioActive) {
        unmetInvariants.push('source_audio_not_active');
      }

      // 7. Zeramento estrito de contadores de apresentação e baselines WebRTC
      await activeViewerPage.evaluate(() => window.__smgE2E?.resetSession());
      previousMap.clear();

      const initialStreamInfo = await inspectViewerStream(activeViewerPage);
      const activeVideoTrackId = initialStreamInfo.videoTrackId;
      const activeAudioTrackId = initialStreamInfo.audioTrackId;

      if (!activeVideoTrackId) unmetInvariants.push('no_initial_video_track');
      if (expectAudible && !activeAudioTrackId) unmetInvariants.push('no_initial_audio_track');
      if (!expectAudible && audioMode === 'none' && activeAudioTrackId) unmetInvariants.push('unexpected_audio_track_in_pure_video');

      // Captura baseline WebRTC imediatamente no início da janela steady
      const initialRtpSample = await activeViewerPage.evaluate(() => window.__smgE2E?.sample()).catch(() => null);
      const baselineVideoRow = initialRtpSample?.rows?.find(r => r.type === 'inbound-rtp' && r.kind === 'video' && r.trackIdentifier === activeVideoTrackId)
                            || initialRtpSample?.rows?.find(r => r.type === 'inbound-rtp' && r.kind === 'video')
                            || null;
      const baselineAudioRow = activeAudioTrackId
        ? (initialRtpSample?.rows?.find(r => r.type === 'inbound-rtp' && r.kind === 'audio' && r.trackIdentifier === activeAudioTrackId)
           || initialRtpSample?.rows?.find(r => r.type === 'inbound-rtp' && r.kind === 'audio')
           || null)
        : null;
      console.log(`[Baseline RTP] Startup: freezes=${baselineVideoRow?.freezeCount ?? 0} (${baselineVideoRow?.totalFreezesDuration ?? 0}s) | drops=${baselineVideoRow?.framesDropped ?? 0} | aSamples=${baselineAudioRow?.totalSamplesReceived ?? 0} | aConcealed=${baselineAudioRow?.concealedSamples ?? 0}`);

      console.log(`[${name}] Coletando telemetria em regime steady por ${durationSec}s...`);
      const timeline = [];
      const startTime = Date.now();
      const endTime = startTime + (durationSec * 1000);

      let sec = 0;
      let totalAudioSamplesStart = null;
      let totalAudioSamplesEnd = null;
      let totalAudioBytesStart = null;
      let totalAudioBytesEnd = null;
      let latestVideoRow = null;
      let latestAudioRow = null;
      let latestVideoCodecRow = null;
      let latestAudioCodecRow = null;

      while (Date.now() < endTime) {
        await sleep(1000);
        sec++;
        const sample = await activeViewerPage.evaluate(() => window.__smgE2E?.sample()).catch(() => null);
        if (!sample) continue;

        const currentStreamInfo = await inspectViewerStream(activeViewerPage);

        // Invariantes por amostra
        if (currentStreamInfo.videoTrackId !== activeVideoTrackId) {
          unmetInvariants.push(`video_track_renegotiated: was ${activeVideoTrackId}, now ${currentStreamInfo.videoTrackId}`);
        }
        if (expectAudible && currentStreamInfo.audioTrackId !== activeAudioTrackId) {
          unmetInvariants.push(`audio_track_renegotiated: was ${activeAudioTrackId}, now ${currentStreamInfo.audioTrackId}`);
        }
        if (currentStreamInfo.videoMuted !== expectedElementMuted) {
          unmetInvariants.push(`video_element_muted_drift: expected ${expectedElementMuted}, got ${currentStreamInfo.videoMuted}`);
        }
        if (Math.abs((currentStreamInfo.videoVolume ?? 0) - expectedElementVolume) > 0.05) {
          unmetInvariants.push(`video_element_volume_drift: expected ${expectedElementVolume}, got ${currentStreamInfo.videoVolume}`);
        }

        // Cálculo de deltas
        for (const row of sample.rows) {
          const rowId = `${row.pcId}:${row.id}`;
          if (previousMap.has(rowId)) row.delta = deltaMetrics(previousMap.get(rowId), row);
          previousMap.set(rowId, row);
        }

        // Localiza linha estrita de vídeo SEM fallback silencioso
        const videoRow = sample.rows.find(r => r.type === 'inbound-rtp' && r.kind === 'video' && r.trackIdentifier === activeVideoTrackId);
        if (!videoRow) {
          unmetInvariants.push(`missing_inbound_video_rtp_track: expected trackId ${activeVideoTrackId}`);
        }

        // Localiza linha estrita de áudio SEM fallback silencioso
        let audioRow = null;
        if (activeAudioTrackId) {
          audioRow = sample.rows.find(r => r.type === 'inbound-rtp' && r.kind === 'audio' && r.trackIdentifier === activeAudioTrackId);
          if (!audioRow && expectAudible) {
            unmetInvariants.push(`missing_inbound_audio_rtp_track: expected trackId ${activeAudioTrackId}`);
          }
        }

        // Vinculação composta estrita de codec por pcId E codecId
        const videoCodecRow = (videoRow?.codecId != null && videoRow.pcId != null)
          ? sample.rows.find(r => r.pcId === videoRow.pcId && r.id === videoRow.codecId)
          : null;
        const audioCodecRow = (audioRow?.codecId != null && audioRow.pcId != null)
          ? sample.rows.find(r => r.pcId === audioRow.pcId && r.id === audioRow.codecId)
          : null;

        if (videoRow) latestVideoRow = videoRow;
        if (audioRow) latestAudioRow = audioRow;
        if (videoCodecRow) latestVideoCodecRow = videoCodecRow;
        if (audioCodecRow) latestAudioCodecRow = audioCodecRow;

        if (audioRow) {
          if (totalAudioSamplesStart === null && typeof audioRow.totalSamplesReceived === 'number') {
            totalAudioSamplesStart = audioRow.totalSamplesReceived;
          }
          if (typeof audioRow.totalSamplesReceived === 'number') {
            totalAudioSamplesEnd = audioRow.totalSamplesReceived;
          }
          if (totalAudioBytesStart === null && typeof audioRow.bytesReceived === 'number') {
            totalAudioBytesStart = audioRow.bytesReceived;
          }
          if (typeof audioRow.bytesReceived === 'number') {
            totalAudioBytesEnd = audioRow.bytesReceived;
          }
        }

        const vid = sample.videos?.find(v => v.id === `card-${hostId}`)
                 || sample.videos?.find(v => !v.isLocal && v.width > 0);
        const pres = vid?.presentation;

        const decodedFps = videoRow?.delta?.decodedFps ?? null;
        const decodeTimeMs = videoRow?.delta?.decodeTimeMs ?? null;
        const videoJitterMs = videoRow?.delta?.jitterBufferMs ?? null;
        const packetsLost = videoRow?.packetsLost !== undefined ? videoRow.packetsLost : null;
        const packetsReceived = videoRow?.packetsReceived !== undefined ? videoRow.packetsReceived : null;
        const framesDropped = videoRow?.framesDropped !== undefined ? videoRow.framesDropped : null;
        const framesReceived = videoRow?.framesReceived !== undefined ? videoRow.framesReceived : null;
        const freezeCount = videoRow?.freezeCount !== undefined ? videoRow.freezeCount : null;
        const totalFreezesDuration = videoRow?.totalFreezesDuration !== undefined ? videoRow.totalFreezesDuration : null;
        const nackCount = videoRow?.nackCount !== undefined ? videoRow.nackCount : null;
        const pliCount = videoRow?.pliCount !== undefined ? videoRow.pliCount : null;

        const audioJitterMs = audioRow?.delta?.jitterBufferMs ?? null;
        const audioLevel = audioRow?.audioLevel ?? null;
        const audioSamplesDelta = audioRow?.delta?.audioSamplesDelta ?? null;
        const maxPauseMs = pres?.intervalMaxPauseMs ?? 0;
        const gapsCount = pres?.gapsCount ?? 0;

        timeline.push({
          second: sec,
          elapsedMs: Date.now() - startTime,
          decodedFps,
          decodeTimeMs,
          videoJitterMs,
          packetsLost,
          packetsReceived,
          framesDropped,
          framesReceived,
          freezeCount,
          totalFreezesDuration,
          nackCount,
          pliCount,
          audioJitterMs,
          audioLevel,
          audioSamplesDelta,
          maxPauseMs,
          gapsCount,
          streamInfo: currentStreamInfo,
          rawStats: {
            videoPcId: videoRow?.pcId ?? null,
            videoSsrc: videoRow?.ssrc ?? null,
            videoTrackId: videoRow?.trackIdentifier ?? null,
            decoderImplementation: videoRow?.decoderImplementation ?? null,
            powerEfficientDecoder: videoRow?.powerEfficientDecoder ?? null,
            totalDecodeTime: videoRow?.totalDecodeTime ?? null,
            framesDecoded: videoRow?.framesDecoded ?? null,
            framesReceived: videoRow?.framesReceived ?? null,
            framesDropped: videoRow?.framesDropped ?? null,
            keyFramesDecoded: videoRow?.keyFramesDecoded ?? null,
            freezeCount: videoRow?.freezeCount ?? null,
            totalFreezesDuration: videoRow?.totalFreezesDuration ?? null,
            nackCount: videoRow?.nackCount ?? null,
            pliCount: videoRow?.pliCount ?? null,
            packetsReceived: videoRow?.packetsReceived ?? null,
            packetsLost: videoRow?.packetsLost ?? null,
            rawDeltaTotalDecodeTime: videoRow?.delta?.rawDeltaTotalDecodeTime ?? null,
            rawDeltaFramesDecoded: videoRow?.delta?.rawDeltaFramesDecoded ?? null,
            rawDeltaFramesDropped: videoRow?.delta?.rawDeltaFramesDropped ?? null,
            rawDeltaFramesReceived: videoRow?.delta?.rawDeltaFramesReceived ?? null,
            rawDeltaFreezeCount: videoRow?.delta?.rawDeltaFreezeCount ?? null,
            rawDeltaTotalFreezesDuration: videoRow?.delta?.rawDeltaTotalFreezesDuration ?? null,
            rawDeltaNackCount: videoRow?.delta?.rawDeltaNackCount ?? null,
            rawDeltaPliCount: videoRow?.delta?.rawDeltaPliCount ?? null,
            rawDeltaPacketsLost: videoRow?.delta?.rawDeltaPacketsLost ?? null,
            rawDeltaPacketsReceived: videoRow?.delta?.rawDeltaPacketsReceived ?? null,
            audioPcId: audioRow?.pcId ?? null,
            audioSsrc: audioRow?.ssrc ?? null,
            audioTotalSamplesReceived: audioRow?.totalSamplesReceived ?? null,
            audioConcealedSamples: audioRow?.concealedSamples ?? null,
            audioSilentConcealedSamples: audioRow?.silentConcealedSamples ?? null,
            audioConcealmentEvents: audioRow?.concealmentEvents ?? null,
            audioPacketsDiscarded: audioRow?.packetsDiscarded ?? null,
            audioPacketsLost: audioRow?.packetsLost ?? null,
            audioPacketsReceived: audioRow?.packetsReceived ?? null,
            audioInsertedSamplesForDeceleration: audioRow?.insertedSamplesForDeceleration ?? null,
            audioRemovedSamplesForAcceleration: audioRow?.removedSamplesForAcceleration ?? null,
            audioBytesReceived: audioRow?.bytesReceived ?? null,
            rawDeltaAudioSamples: audioRow?.delta?.audioSamplesDelta ?? null,
            rawDeltaConcealedSamples: audioRow?.delta?.rawDeltaConcealedSamples ?? null,
            rawDeltaSilentConcealedSamples: audioRow?.delta?.rawDeltaSilentConcealedSamples ?? null,
            rawDeltaConcealmentEvents: audioRow?.delta?.rawDeltaConcealmentEvents ?? null,
            rawDeltaPacketsDiscarded: audioRow?.delta?.rawDeltaPacketsDiscarded ?? null,
            rawDeltaInsertedSamplesForDeceleration: audioRow?.delta?.rawDeltaInsertedSamplesForDeceleration ?? null,
            rawDeltaRemovedSamplesForAcceleration: audioRow?.delta?.rawDeltaRemovedSamplesForAcceleration ?? null
          }
        });

        if (sec % 5 === 0 || Date.now() >= endTime - 500) {
          console.log(`  [s=${sec}] FPS=${decodedFps?.toFixed(1) ?? 'N/A'} | decode=${decodeTimeMs?.toFixed(1) ?? 'N/A'}ms | jitter=${videoJitterMs?.toFixed(1) ?? 'N/A'}ms | aSamples=${audioSamplesDelta ?? 0} | lost=${packetsLost ?? 'null'} | maxPause=${maxPauseMs}ms | gaps=${gapsCount}`);
        }
      }

      const totalDurationMs = Date.now() - startTime;
      const finalSourceState = await getSourceSceneState();
      const elapsedSourceSec = (finalSourceState.elapsedMs - initialSourceState.elapsedMs) / 1000.0;
      const framesAdvanced = finalSourceState.drawnFrames - initialSourceState.drawnFrames;
      const effectiveSourceFps = elapsedSourceSec > 0 ? Number((framesAdvanced / elapsedSourceSec).toFixed(2)) : 0;
      const steadySlotsSlipped = finalSourceState.steadyStats?.slotsSlipped ?? 0;
      console.log(`[Fonte] Encerramento steady: frames=${finalSourceState.drawnFrames} | fps=${finalSourceState.fps?.toFixed(2)} | cadência efetiva=${effectiveSourceFps} FPS (${framesAdvanced} frames em ${elapsedSourceSec.toFixed(2)}s) | skippedTicks=${finalSourceState.skippedTicks} | steadySlotsSlipped=${steadySlotsSlipped}`);

      if (effectiveSourceFps < 57.0 || effectiveSourceFps > 63.0) {
        unmetInvariants.push(`source_steady_cadence_drift: measured ${effectiveSourceFps} FPS (expected 57-63 FPS)`);
      }
      if (finalSourceState.fps < 57.0 || finalSourceState.fps > 63.0) {
        unmetInvariants.push(`source_final_cadence_invalid: fps=${finalSourceState.fps}`);
      }
      if (steadySlotsSlipped > 0) {
        unmetInvariants.push(`source_steady_slots_slipped: ${steadySlotsSlipped} slots lost during steady tracking`);
      }

      // Verificação de progressão de áudio para cenários audíveis
      if (expectAudible) {
        const samplesDiff = (totalAudioSamplesEnd ?? 0) - (totalAudioSamplesStart ?? 0);
        const bytesDiff = (totalAudioBytesEnd ?? 0) - (totalAudioBytesStart ?? 0);
        if (samplesDiff <= 0 && bytesDiff <= 0) {
          unmetInvariants.push('audio_not_progressing: no new samples or bytes received in audible scenario');
        }
      }

      // Coleta estado de captura nativa antes de qualquer teardown
      const hostCaptureState = await hostPage.evaluate(async () => {
        const d = await import('/js/desktop.js').catch(() => null);
        return d?.getNativeCaptureState ? await d.getNativeCaptureState().catch(() => null) : null;
      }).catch(() => null);

      // Processamento estatístico
      const steady = timeline.slice(1);
      const fpsList = steady.map(t => t.decodedFps).filter(n => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
      const decodeList = steady.map(t => t.decodeTimeMs).filter(n => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
      const videoJitterList = steady.map(t => t.videoJitterMs).filter(n => typeof n === 'number' && Number.isFinite(n));
      const audioJitterList = steady.map(t => t.audioJitterMs).filter(n => typeof n === 'number' && Number.isFinite(n));
      const maxPause = Math.max(0, ...steady.map(t => t.maxPauseMs || 0));
      const totalGaps = steady.length ? steady[steady.length - 1].gapsCount : 0;

      const avg = arr => arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;
      const p10 = arr => arr.length ? Number(arr[Math.floor(arr.length * 0.1)].toFixed(1)) : null;
      const median = arr => arr.length ? Number(arr[Math.floor(arr.length * 0.5)].toFixed(1)) : null;

      const validFpsSamples = fpsList.length;
      const requiredSamples = Math.floor(durationSec * 0.7);
      const hasEnoughSamples = validFpsSamples >= requiredSamples;

      if (!hasEnoughSamples) {
        unmetInvariants.push(`insufficient_valid_samples: got ${validFpsSamples}, required >= ${requiredSamples}`);
      }

      const executionStatus = 'COMPLETED';
      const validityStatus = unmetInvariants.length === 0 ? 'VALID' : 'INCONCLUSIVE';

      const elapsedSteadySec = (Date.now() - startTime) / 1000;
      const steadyQuality = computeSteadyQuality({
        baselineVideoRow,
        latestVideoRow,
        baselineAudioRow,
        latestAudioRow,
        elapsedSteadySec
      });

      const qualityBudget = evaluateQualityBudget({
        fpsMean: avg(fpsList),
        fpsP10: p10(fpsList),
        maxPauseMs: maxPause,
        totalGapsCount: totalGaps,
        durationSec,
        measuredDurationSec: elapsedSteadySec,
        totalPacketsLost: steadyQuality.steady.packetsLost,
        videoJitterMeanMs: avg(videoJitterList),
        freezeCount: steadyQuality.steady.freezeCount,
        totalFreezesDuration: steadyQuality.steady.totalFreezesDurationSec,
        audioPacketsLost: steadyQuality.steady.audioPacketsLost,
        audioPacketsDiscarded: steadyQuality.steady.audioPacketsDiscarded,
        audioConcealmentRatio: steadyQuality.steady.audioConcealmentRatio,
        expectAudible
      });
      const qualityStatus = qualityBudget.status;

      // Captura screenshot da fase
      const shotPrefix = id;
      await hostPage.screenshot({ path: path.join(outputDir, `${shotPrefix}-host.png`) }).catch(() => {});
      await activeViewerPage.screenshot({ path: path.join(outputDir, `${shotPrefix}-viewer.png`) }).catch(() => {});

      return {
        name,
        executionStatus,
        validityStatus,
        qualityStatus,
        qualityBudget,
        unmetInvariants,
        audioIsolation: scenarioConfig.audioIsolation || (audioMode === 'none' ? 'none' : 'os_system_loopback_viewer_globally_muted'),
        browserGloballyMuted: scenarioConfig.browserGloballyMuted ?? true,
        validFpsSamples,
        totalDurationMs,
        sourceValidation: {
          initialSourceState,
          finalSourceState,
          effectiveSourceFps,
          elapsedSourceSec,
          framesAdvanced,
          intervalStats: finalSourceState.intervalStats ?? null,
          steadyStats: finalSourceState.steadyStats ?? null,
          layoutDimensions: {
            actualCanvasWidth: finalSourceState.actualCanvasWidth ?? null,
            actualCanvasHeight: finalSourceState.actualCanvasHeight ?? null,
            windowInnerWidth: finalSourceState.windowInnerWidth ?? null,
            windowInnerHeight: finalSourceState.windowInnerHeight ?? null,
            devicePixelRatio: finalSourceState.devicePixelRatio ?? null
          }
        },
        fpsMean: avg(fpsList),
        fpsMedian: median(fpsList),
        fpsP10: p10(fpsList),
        fpsMin: fpsList.length ? Number(fpsList[0].toFixed(1)) : null,
        fpsMax: fpsList.length ? Number(fpsList[fpsList.length - 1].toFixed(1)) : null,
        decodeTimeMeanMs: avg(decodeList),
        decodeTimeP95Ms: decodeList.length ? Number(decodeList[Math.floor(decodeList.length * 0.95)].toFixed(1)) : null,
        jitterBufferMeanMs: avg(videoJitterList),
        audioJitterBufferMeanMs: avg(audioJitterList),
        totalPacketsLost: steadyQuality.steady.packetsLost,
        freezeCount: steadyQuality.steady.freezeCount,
        totalFreezesDurationSec: steadyQuality.steady.totalFreezesDurationSec,
        framesDropped: steadyQuality.steady.framesDropped,
        framesReceived: steadyQuality.steady.framesReceived,
        maxPauseMs: maxPause,
        totalGapsCount: totalGaps,
        gapsPerMinute: qualityBudget.gapsPerMinute,
        encoderInfo: {
          requestedEncoder: encoderOverride || 'auto',
          resolvedH264Encoder: hostCaptureState?.h264Encoder || hostCaptureState?.h264_encoder || 'unknown',
          videoCodec: hostCaptureState?.videoCodec || hostCaptureState?.video_codec || 'h264',
          width: hostCaptureState?.width ?? null,
          height: hostCaptureState?.height ?? null
        },
        decoderInfo: {
          implementation: latestVideoRow?.decoderImplementation ?? 'unknown',
          powerEfficient: latestVideoRow?.powerEfficientDecoder ?? null,
          codec: latestVideoCodecRow?.mimeType ?? 'unknown',
          ssrc: latestVideoRow?.ssrc ?? null
        },
        steadyQuality: steadyQuality.steady,
        startupDynamics: steadyQuality.startupDynamics,
        rawTotals: {
          totalFramesDecoded: latestVideoRow?.framesDecoded ?? null,
          totalFramesReceived: latestVideoRow?.framesReceived ?? null,
          totalFramesDropped: latestVideoRow?.framesDropped ?? null,
          totalKeyFramesDecoded: latestVideoRow?.keyFramesDecoded ?? null,
          totalDecodeTimeSec: latestVideoRow?.totalDecodeTime ?? null,
          cumulativeFreezeCount: latestVideoRow?.freezeCount ?? null,
          cumulativeTotalFreezesDurationSec: latestVideoRow?.totalFreezesDuration ?? null,
          nackCount: latestVideoRow?.nackCount ?? null,
          pliCount: latestVideoRow?.pliCount ?? null,
          packetsReceived: latestVideoRow?.packetsReceived ?? null,
          packetsLost: latestVideoRow?.packetsLost ?? null,
          audioTotalSamplesReceived: latestAudioRow?.totalSamplesReceived ?? null,
          audioConcealedSamples: latestAudioRow?.concealedSamples ?? null,
          audioSilentConcealedSamples: latestAudioRow?.silentConcealedSamples ?? null,
          audioConcealmentEvents: latestAudioRow?.concealmentEvents ?? null,
          audioPacketsDiscarded: latestAudioRow?.packetsDiscarded ?? null,
          audioPacketsLost: latestAudioRow?.packetsLost ?? null,
          audioInsertedSamplesForDeceleration: latestAudioRow?.insertedSamplesForDeceleration ?? null,
          audioRemovedSamplesForAcceleration: latestAudioRow?.removedSamplesForAcceleration ?? null,
          audioBytesReceived: latestAudioRow?.bytesReceived ?? null
        },
        audioValidation: {
          expectAudible,
          audioCodec: latestAudioCodecRow?.mimeType ?? 'unknown',
          audioSsrc: latestAudioRow?.ssrc ?? null,
          audioSamplesReceivedSteady: steadyQuality.steady.audioSamplesReceived,
          audioConcealedSamplesSteady: steadyQuality.steady.audioConcealedSamples,
          audioSilentConcealedSamplesSteady: steadyQuality.steady.audioSilentConcealedSamples,
          audioConcealmentEventsSteady: steadyQuality.steady.audioConcealmentEvents,
          audioConcealmentRatio: steadyQuality.steady.audioConcealmentRatio,
          audioPacketsLostSteady: steadyQuality.steady.audioPacketsLost,
          audioPacketsDiscardedSteady: steadyQuality.steady.audioPacketsDiscarded,
          audioPacketsReceivedSteady: steadyQuality.steady.audioPacketsReceived,
          audioBytesReceivedSteady: steadyQuality.steady.audioBytesReceived,
          audioJitterBufferMeanMs: avg(audioJitterList),
          audioJitterBufferMinMs: audioJitterList.length ? Math.min(...audioJitterList) : null,
          audioJitterBufferMaxMs: audioJitterList.length ? Math.max(...audioJitterList) : null
        },
        effectiveReceivers,
        timeline
      };
    } catch (err) {
      console.error(`\n[${name}] Erro capturado durante a execução do cenário:`, err.message);

      // Captura screenshots de erro IMEDIATAMENTE (antes que o teardown encerre o stream nativo)
      const errorShotPrefix = `${id}-error`;
      await hostPage.screenshot({ path: path.join(outputDir, `${errorShotPrefix}-host.png`) }).catch(() => {});
      if (currentTargetViewerPage) {
        await currentTargetViewerPage.screenshot({ path: path.join(outputDir, `${errorShotPrefix}-viewer.png`) }).catch(() => {});
      }

      // Diagnósticos imediatos enquanto o pipeline e os elementos de vídeo ainda estão intactos
      try {
        const hostDiagnostics = await hostPage.evaluate(async () => {
          const app = await import('/js/app.js').catch(() => null);
          const desktop = await import('/js/desktop.js').catch(() => null);
          const captureState = desktop?.getNativeCaptureState ? await desktop.getNativeCaptureState().catch(() => null) : null;
          const peers = (window.__smgPeers || []).map(p => ({
            signalingState: p.signalingState,
            iceConnectionState: p.iceConnectionState,
            connectionState: p.connectionState,
            sendersCount: p.getSenders ? p.getSenders().length : 0,
            receiversCount: p.getReceivers ? p.getReceivers().length : 0
          }));
          return {
            isInRoom: app?.roomManager?.isInRoom,
            myPeerId: app?.roomManager?.myPeerId,
            isStartingStream: app?.isStartingStream,
            hasLocalStream: !!app?.localStream,
            captureState,
            peers
          };
        }).catch(e => ({ evalError: e.message }));

        const viewerDiagnostics = currentTargetViewerPage ? await currentTargetViewerPage.evaluate(async ({ hId }) => {
          const app = await import('/js/app.js').catch(() => null);
          const card = document.getElementById(`card-${hId}`);
          const video = card?.querySelector('video');
          const stream = video?.srcObject;
          const peers = (window.__smgPeers || []).map(p => ({
            signalingState: p.signalingState,
            iceConnectionState: p.iceConnectionState,
            connectionState: p.connectionState,
            sendersCount: p.getSenders ? p.getSenders().length : 0,
            receiversCount: p.getReceivers ? p.getReceivers().length : 0
          }));
          return {
            isInRoom: app?.roomManager?.isInRoom,
            myPeerId: app?.roomManager?.myPeerId,
            cardFound: !!card,
            videoFound: !!video,
            videoWidth: video?.videoWidth,
            videoHeight: video?.videoHeight,
            videoReadyState: video?.readyState,
            videoPaused: video?.paused,
            hasStream: !!stream,
            videoTracks: stream?.getVideoTracks ? stream.getVideoTracks().map(t => ({ id: t.id, readyState: t.readyState })) : [],
            audioTracks: stream?.getAudioTracks ? stream.getAudioTracks().map(t => ({ id: t.id, readyState: t.readyState })) : [],
            peers
          };
        }, { hId: hostId }).catch(e => ({ evalError: e.message })) : null;

        err.collectedDiagnostics = {
          host: hostDiagnostics,
          viewer: viewerDiagnostics
        };
      } catch (diagErr) {
        console.warn(`[Diagnóstico Pré-Teardown] Falha ao coletar estado: ${diagErr.message}`);
      }

      throw err;
    } finally {
      console.log(`[Teardown] Garantindo parada de captura nativa para ${name}...`);
      await stopNativeCapture().catch(err => {
        console.warn(`[Teardown] Erro durante stopNativeCapture para ${name}:`, err.message);
      });
      if (dedicatedUnmutedBrowser) {
        console.log('[Áudio por Processo] Fechando instância dedicada de navegador desmutado...');
        await dedicatedUnmutedBrowser.close().catch(() => {});
        currentTargetViewerPage = viewerPage;
      }
    }
  };

  const results = {
    provenance,
    scenarios: {}
  };

  const saveReportProgressive = async () => {
    try {
      results.provenance.updatedAt = new Date().toISOString();
      const reportJsonPath = path.join(outputDir, 'isolation-report.json');
      await writeFile(reportJsonPath, JSON.stringify(results, null, 2));
    } catch {}
  };

  const executeScenarioSafely = async (scenarioConfig) => {
    try {
      const res = await runScenarioExecution(scenarioConfig);
      return res;
    } catch (err) {
      console.error(`\n[${scenarioConfig.name}] Falha na execução:`, err.message);

      // Usa diagnósticos coletados antes do teardown (ou faz fallback se necessário)
      const hostDiagnostics = err.collectedDiagnostics?.host || await hostPage.evaluate(async () => {
        const app = await import('/js/app.js').catch(() => null);
        const desktop = await import('/js/desktop.js').catch(() => null);
        const captureState = desktop?.getNativeCaptureState ? await desktop.getNativeCaptureState().catch(() => null) : null;
        const peers = (window.__smgPeers || []).map(p => ({
          signalingState: p.signalingState,
          iceConnectionState: p.iceConnectionState,
          connectionState: p.connectionState,
          sendersCount: p.getSenders ? p.getSenders().length : 0,
          receiversCount: p.getReceivers ? p.getReceivers().length : 0
        }));
        return {
          isInRoom: app?.roomManager?.isInRoom,
          myPeerId: app?.roomManager?.myPeerId,
          isStartingStream: app?.isStartingStream,
          hasLocalStream: !!app?.localStream,
          captureState,
          peers
        };
      }).catch(e => ({ evalError: e.message }));

      const viewerDiagnostics = err.collectedDiagnostics?.viewer || await currentTargetViewerPage.evaluate(async ({ hId }) => {
        const app = await import('/js/app.js').catch(() => null);
        const card = document.getElementById(`card-${hId}`);
        const video = card?.querySelector('video');
        const stream = video?.srcObject;
        const peers = (window.__smgPeers || []).map(p => ({
          signalingState: p.signalingState,
          iceConnectionState: p.iceConnectionState,
          connectionState: p.connectionState,
          sendersCount: p.getSenders ? p.getSenders().length : 0,
          receiversCount: p.getReceivers ? p.getReceivers().length : 0
        }));
        return {
          isInRoom: app?.roomManager?.isInRoom,
          myPeerId: app?.roomManager?.myPeerId,
          cardFound: !!card,
          videoFound: !!video,
          videoWidth: video?.videoWidth,
          videoHeight: video?.videoHeight,
          videoReadyState: video?.readyState,
          videoPaused: video?.paused,
          hasStream: !!stream,
          videoTracks: stream?.getVideoTracks ? stream.getVideoTracks().map(t => ({ id: t.id, readyState: t.readyState })) : [],
          audioTracks: stream?.getAudioTracks ? stream.getAudioTracks().map(t => ({ id: t.id, readyState: t.readyState })) : [],
          peers
        };
      }, { hId: hostId }).catch(e => ({ evalError: e.message }));

      const failedRes = {
        id: scenarioConfig.id,
        name: scenarioConfig.name,
        executionStatus: 'FAILED',
        validityStatus: 'INCONCLUSIVE',
        qualityStatus: 'FAILED',
        error: err.message,
        errorDiagnostics: {
          host: hostDiagnostics,
          viewer: viewerDiagnostics
        },
        unmetInvariants: [`execution_error: ${err.message}`]
      };
      return failedRes;
    }
  };

  const runScenarioAndRecord = async (scenarioKey, scenarioConfig) => {
    if (!shouldRunScenario(scenarioKey, scenarioConfig.id)) {
      console.log(`\n[Filtro] Pulando cenário ${scenarioKey} (${scenarioConfig.id}) por filtro de execução.`);
      return null;
    }
    const res = await executeScenarioSafely(scenarioConfig);
    results.scenarios[scenarioKey] = res;
    await saveReportProgressive();
    return res;
  };

  const durationCoreSec = parseInt(process.env.CORE_DURATION_SEC || '20', 10);
  const durationJitterSec = parseInt(process.env.JITTER_DURATION_SEC || '20', 10);

  // =============================================================
  // BLOCO 1: REPETIÇÃO ALTERNADA 1 (ORDEM DIRETA: C1 -> C2 -> C4)
  // =============================================================
  console.log('\n=============================================================');
  console.log('BLOCO 1: REPETIÇÃO ALTERNADA 1 (ORDEM DIRETA: C1 -> C2 -> C4)');
  console.log('=============================================================');

  await runScenarioAndRecord('c1_rep1_controleBase', {
    id: 'c1_rep1',
    name: 'Cenário 1 (Rep 1): Controle Base (A/V Completo, Prévia Ativa, Receptor Mute SO)',
    audioMode: 'system',
    audioIsolation: 'os_system_loopback_viewer_globally_muted',
    browserGloballyMuted: true,
    expectAudible: true,
    expectedElementMuted: false,
    expectedElementVolume: 1.0,
    expectHostPreviewSuspended: false,
    warmupSec: 3,
    durationSec: durationCoreSec
  });

  await runScenarioAndRecord('c2_rep1_previaSuspensa', {
    id: 'c2_rep1',
    name: 'Cenário 2 (Rep 1): Isolamento de Prévia (A/V Completo, Prévia Suspensa, Receptor Mute SO)',
    audioMode: 'system',
    audioIsolation: 'os_system_loopback_viewer_globally_muted',
    browserGloballyMuted: true,
    expectAudible: true,
    expectedElementMuted: false,
    expectedElementVolume: 1.0,
    expectHostPreviewSuspended: true,
    warmupSec: 3,
    durationSec: durationCoreSec
  });

  await runScenarioAndRecord('c4_rep1_videoPuro', {
    id: 'c4_rep1',
    name: 'Cenário 4 (Rep 1): Baseline Vídeo Puro (Sem Trilha Áudio, Receptor Mute SO)',
    audioMode: 'none',
    audioIsolation: 'none',
    browserGloballyMuted: true,
    expectAudible: false,
    expectedElementMuted: false,
    expectedElementVolume: 1.0,
    expectHostPreviewSuspended: false,
    warmupSec: 3,
    durationSec: durationCoreSec
  });

  // =============================================================
  // BLOCO 2: REPETIÇÃO ALTERNADA 2 (ORDEM INVERTIDA: C4 -> C2 -> C1)
  // =============================================================
  console.log('\n=============================================================');
  console.log('BLOCO 2: REPETIÇÃO ALTERNADA 2 (ORDEM INVERTIDA: C4 -> C2 -> C1)');
  console.log('=============================================================');

  await runScenarioAndRecord('c4_rep2_videoPuro', {
    id: 'c4_rep2',
    name: 'Cenário 4 (Rep 2): Baseline Vídeo Puro (Sem Trilha Áudio, Receptor Mute SO)',
    audioMode: 'none',
    audioIsolation: 'none',
    browserGloballyMuted: true,
    expectAudible: false,
    expectedElementMuted: false,
    expectedElementVolume: 1.0,
    expectHostPreviewSuspended: false,
    warmupSec: 3,
    durationSec: durationCoreSec
  });

  await runScenarioAndRecord('c2_rep2_previaSuspensa', {
    id: 'c2_rep2',
    name: 'Cenário 2 (Rep 2): Isolamento de Prévia (A/V Completo, Prévia Suspensa, Receptor Mute SO)',
    audioMode: 'system',
    audioIsolation: 'os_system_loopback_viewer_globally_muted',
    browserGloballyMuted: true,
    expectAudible: true,
    expectedElementMuted: false,
    expectedElementVolume: 1.0,
    expectHostPreviewSuspended: true,
    warmupSec: 3,
    durationSec: durationCoreSec
  });

  await runScenarioAndRecord('c1_rep2_controleBase', {
    id: 'c1_rep2',
    name: 'Cenário 1 (Rep 2): Controle Base (A/V Completo, Prévia Ativa, Receptor Mute SO)',
    audioMode: 'system',
    audioIsolation: 'os_system_loopback_viewer_globally_muted',
    browserGloballyMuted: true,
    expectAudible: true,
    expectedElementMuted: false,
    expectedElementVolume: 1.0,
    expectHostPreviewSuspended: false,
    warmupSec: 3,
    durationSec: durationCoreSec
  });

  // =============================================================
  // BLOCO 3: CENÁRIOS ESPECÍFICOS (PLAYER MUTADO, ÁUDIO POR PROCESSO, JITTER)
  // =============================================================
  console.log('\n=============================================================');
  console.log('BLOCO 3: CENÁRIOS ESPECÍFICOS (PLAYER MUTADO, ÁUDIO POR PROCESSO, JITTER)');
  console.log('=============================================================');

  await runScenarioAndRecord('c3_audioMutado', {
    id: 'c3',
    name: 'Cenário 3: Isolamento de Saída no Player (Áudio Capturado/RTP, Player Mutado no DOM, Receptor Mute SO)',
    audioMode: 'system',
    audioIsolation: 'os_system_loopback_viewer_globally_muted',
    browserGloballyMuted: true,
    expectAudible: false,
    expectedElementMuted: true,
    expectedElementVolume: 0,
    expectHostPreviewSuspended: false,
    warmupSec: 3,
    durationSec: durationCoreSec
  });

  // CENÁRIO 5: ÁUDIO POR PROCESSO (Isolamento WASAPI por PID)
  if (nativeCaps?.supports_process_audio) {
    await runScenarioAndRecord('c5_audioProcesso', {
      id: 'c5',
      name: 'Cenário 5: Áudio por Processo (Isolamento WASAPI por PID, Instância de Navegador Desmutada)',
      audioMode: 'process',
      audioIsolation: 'wasapi_process_tree',
      browserGloballyMuted: false,
      expectAudible: true,
      expectedElementMuted: false,
      expectedElementVolume: 1.0,
      expectHostPreviewSuspended: false,
      warmupSec: 3,
      durationSec: durationCoreSec
    });
  } else {
    console.log('\n[Cenário 5] Áudio por Processo NÃO suportado no SO atual (requer Windows 11 / Server 2022 build >= 20348).');
    results.scenarios.c5_audioProcesso = {
      id: 'c5',
      name: 'Cenário 5: Áudio por Processo (Isolamento WASAPI por PID)',
      executionStatus: 'SKIPPED_UNSUPPORTED_OS',
      validityStatus: 'NOT_APPLICABLE',
      qualityStatus: 'NOT_APPLICABLE',
      reason: `Host está executando Windows 10 Build ${os.release()} (sem AUDIOCLIENT_ACTIVATION_PARAMS). Requer Windows 11 ou Server 2022 build >= 20348.`,
      capabilities: nativeCaps
    };
    await saveReportProgressive();
  }

  // CENÁRIOS 6A, 6B, 6C: POLÍTICAS DE JITTER INDEPENDENTES
  await runScenarioAndRecord('c6a_jitter0ms', {
    id: 'c6a',
    name: 'Cenário 6A: Jitter Buffer Target 0ms (Ultra-Low Playout, Receptor Mute SO)',
    audioMode: 'system',
    audioIsolation: 'os_system_loopback_viewer_globally_muted',
    browserGloballyMuted: true,
    expectAudible: true,
    expectedElementMuted: false,
    expectedElementVolume: 1.0,
    expectHostPreviewSuspended: false,
    targetPlayoutDelayHint: 0,
    targetJitterBufferTarget: 0,
    warmupSec: 3,
    durationSec: durationJitterSec
  });

  await runScenarioAndRecord('c6b_jitter25ms', {
    id: 'c6b',
    name: 'Cenário 6B: Jitter Buffer Target 25ms (Buffer Estático, Receptor Mute SO)',
    audioMode: 'system',
    audioIsolation: 'os_system_loopback_viewer_globally_muted',
    browserGloballyMuted: true,
    expectAudible: true,
    expectedElementMuted: false,
    expectedElementVolume: 1.0,
    expectHostPreviewSuspended: false,
    targetPlayoutDelayHint: 0.025,
    targetJitterBufferTarget: 25,
    warmupSec: 3,
    durationSec: durationJitterSec
  });

  await runScenarioAndRecord('c6c_jitterDefault', {
    id: 'c6c',
    name: 'Cenário 6C: Jitter Buffer Default (Padrão WebRTC, Receptor Mute SO)',
    audioMode: 'system',
    audioIsolation: 'os_system_loopback_viewer_globally_muted',
    browserGloballyMuted: true,
    expectAudible: true,
    expectedElementMuted: false,
    expectedElementVolume: 1.0,
    expectHostPreviewSuspended: false,
    targetPlayoutDelayHint: null,
    targetJitterBufferTarget: null,
    warmupSec: 3,
    durationSec: durationJitterSec
  });

  // Encerramento ordenado
  console.log('\nEncerrando navegadores e processos...');
  try { await sourceBrowser.close(); } catch {}
  try { await viewerBrowser.close(); } catch {}
  try { nativeBrowser.close(); } catch {}
  try { desktopProcess.kill(); } catch {}
  try { server.close(); } catch {}

  results.provenance.completedAt = new Date().toISOString();

  // Gravar relatório completo
  const reportJsonPath = path.join(outputDir, 'isolation-report.json');
  await writeFile(reportJsonPath, JSON.stringify(results, null, 2));
  console.log(`\nRelatório salvo com sucesso em: ${reportJsonPath}`);

  // Exibir resumo executivo no console
  console.log('\n=====================================================');
  console.log('RESUMO COMPARATIVO DOS TESTES DE ISOLAMENTO CIENTÍFICO (1080p @ 60.0 Hz)');
  console.log('=====================================================');
  const summaryTable = {};
  for (const [key, sc] of Object.entries(results.scenarios)) {
    summaryTable[key] = {
      'Execução': sc.executionStatus,
      'Validade': sc.validityStatus,
      'Qualidade': sc.qualityStatus ?? 'N/A',
      'Problemas Qualidade': sc.qualityBudget?.violations?.length ? sc.qualityBudget.violations.join('; ') : (sc.qualityBudget?.warnings?.length ? sc.qualityBudget.warnings.join('; ') : 'OK'),
      'Invariantes': sc.unmetInvariants?.length ? sc.unmetInvariants.join('; ') : '100% OK',
      'FPS Fonte Real': sc.sourceValidation?.effectiveSourceFps ?? 'N/A',
      'Slots Slipped': sc.sourceValidation?.steadyStats?.slotsSlipped ?? 'N/A',
      'FPS Médio Recv': sc.fpsMean ?? 'N/A',
      'FPS p10': sc.fpsP10 ?? 'N/A',
      'Decode (ms)': sc.decodeTimeMeanMs ?? 'N/A',
      'Jitter V/A (ms)': `${sc.jitterBufferMeanMs ?? 'N/A'} / ${sc.audioValidation?.audioJitterBufferMeanMs ?? 'N/A'}`,
      'Max Pausa (ms)': sc.maxPauseMs ?? 'N/A',
      'Gaps Rate (/min)': sc.gapsPerMinute ?? 'N/A',
      'Gaps >100ms': sc.totalGapsCount ?? 'N/A',
      'Steady Freezes': sc.steadyQuality ? `${sc.steadyQuality.freezeCount} (${sc.steadyQuality.totalFreezesDurationSec}s)` : 'N/A',
      'Startup Freezes': sc.startupDynamics ? `${sc.startupDynamics.startupFreezes} (${sc.startupDynamics.startupFreezeDurationSec}s)` : 'N/A',
      'Perda Pkts V/A': sc.steadyQuality ? `${sc.steadyQuality.packetsLost} / ${sc.steadyQuality.audioPacketsLost}` : 'N/A',
      'Audio Conceal %': sc.audioValidation?.audioConcealmentRatio != null ? `${sc.audioValidation.audioConcealmentRatio}%` : 'N/A',
      'Encoder': sc.encoderInfo?.resolvedH264Encoder ?? 'N/A',
      'Decoder': sc.decoderInfo?.implementation ?? 'N/A'
    };
  }
  console.table(summaryTable);
};

runIsolationSuite().catch(err => {
  console.error('\nErro fatal na suíte de isolamento:', err);
  process.exit(1);
});
