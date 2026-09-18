import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { spawn, execSync } from 'node:child_process';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDefaultDesktop } from './desktop-affinity.mjs';
import { installTelemetry, deltaMetrics } from './telemetry.mjs';

ensureDefaultDesktop();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const exe = path.join(root, 'src-tauri/target/release/seemygame.exe');
const channel = 'msedge';
const ytUrl = 'https://www.youtube.com/watch?v=6FhmyWT-_0U';
const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.join(root, 'output/youtube-isolation', runTimestamp);
await mkdir(outputDir, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = async () => {
  const s = createTcpServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  await new Promise(r => s.close(r));
  return port;
};

// Coleta de proveniência estrita do ambiente e binário
const getProvenance = async () => {
  let gitCommit = 'unknown';
  let gitBranch = 'unknown';
  let gitDirty = false;
  try {
    gitCommit = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
    gitBranch = execSync('git branch --show-current', { cwd: root }).toString().trim();
    const status = execSync('git status --porcelain', { cwd: root }).toString().trim();
    gitDirty = status.length > 0;
  } catch {}

  let exeSha256 = null;
  let exeMtime = null;
  let exeSizeBytes = null;
  try {
    const fileBytes = await readFile(exe);
    exeSha256 = createHash('sha256').update(fileBytes).digest('hex');
    const fileStat = await stat(exe);
    exeMtime = fileStat.mtime.toISOString();
    exeSizeBytes = fileStat.size;
  } catch {}

  return {
    gitCommit,
    gitBranch,
    gitDirty,
    exePath: exe,
    exeSha256,
    exeMtime,
    exeSizeBytes,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    browserChannel: channel,
    ytUrl,
    startedAt: new Date().toISOString()
  };
};

// Servidor de arquivos estáticos para o cliente web
let server;
const serve = async () => {
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (!/^\/(room\.html|index\.html|(?:js|css|assets)\/[a-zA-Z0-9_./-]+)$/.test(pathname) || pathname.includes('..')) {
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

// Desabilita medição óptica parasitária na suíte YouTube
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
  console.log('Iniciando Bateria de Testes de Isolamento Científico (YouTube)');
  console.log('Vídeo:', ytUrl);
  console.log('Diretório de saída:', outputDir);
  console.log('=====================================================\n');

  const provenance = await getProvenance();
  console.log(`[Proveniência] Git Commit: ${provenance.gitCommit} (dirty: ${provenance.gitDirty})`);
  console.log(`[Proveniência] Binário Exe SHA256: ${provenance.exeSha256?.slice(0, 16)}...`);
  console.log(`[Proveniência] Modificado em: ${provenance.exeMtime}`);

  const webOrigin = await serve();
  console.log('Servidor web local ativo em:', webOrigin);

  // 1. Iniciar navegador da fonte (YouTube)
  console.log('\n[Passo 1] Abrindo janela da fonte no Edge com vídeo do YouTube...');
  const sourceBrowser = await chromium.launch({
    channel,
    headless: false,
    args: [
      '--window-position=50,50',
      '--window-size=1280,720',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion'
    ]
  });
  const sourceContext = await sourceBrowser.newContext({ viewport: { width: 1280, height: 720 } });
  const sourcePage = await sourceContext.newPage();
  await sourcePage.goto(ytUrl);
  await sleep(3000);
  const ytTitle = await sourcePage.title();
  console.log(`Janela da fonte carregada: "${ytTitle}"`);

  const playBtnCount = await sourcePage.locator('.ytp-large-play-button').count();
  if (playBtnCount > 0) {
    await sourcePage.locator('.ytp-large-play-button').click().catch(() => {});
  } else {
    await sourcePage.locator('.html5-video-player').click().catch(() => {});
  }
  await sleep(1500);

  // Função para fixar o vídeo exatamente no mesmo trecho (segundo 25.0) para todos os cenários
  const resetSourceVideo = async () => {
    await sourcePage.evaluate(() => {
      const v = document.querySelector('video');
      if (v) {
        v.muted = false;
        v.volume = 1.0;
        v.currentTime = 25.0;
        v.play().catch(() => {});
      }
    });
    await sleep(1500);
  };
  await resetSourceVideo();

  const isPlaying = await sourcePage.evaluate(() => {
    const v = document.querySelector('video');
    return v && !v.paused && v.currentTime > 0;
  }).catch(() => false);
  console.log('Estado de reprodução do vídeo do YouTube:', isPlaying ? 'REPRODUZINDO' : 'AGUARDANDO');

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

  // 3. Iniciar navegador espectador
  console.log('\n[Passo 3] Iniciando navegador espectador (Edge)...');
  const viewerBrowser = await chromium.launch({
    channel,
    headless: false,
    args: [
      '--window-position=600,100',
      '--window-size=1280,720',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  });
  const viewerContext = await viewerBrowser.newContext();
  await setupContext(viewerContext);
  const viewerPage = await viewerContext.newPage();

  // 4. Ambos entram na mesma sala
  const roomName = `yt-iso-${randomBytes(4).toString('hex')}`;
  const roomKey = randomBytes(16).toString('hex');
  const roomHash = `#room=${roomName}&key=${roomKey}`;
  const nativeOrigin = new URL(hostPage.url()).origin;

  console.log(`\nEntrando na sala WebRTC: ${roomName}`);
  await joinRoom(hostPage, `${nativeOrigin}/room.html${roomHash}`, 'Host Desktop');
  await joinRoom(viewerPage, `${webOrigin}/room.html${roomHash}`, 'Espectador Web');

  const hostId = await hostPage.evaluate(async () => (await import('/js/app.js')).roomManager?.myPeerId);
  const viewerId = await viewerPage.evaluate(async () => (await import('/js/app.js')).roomManager?.myPeerId);
  console.log(`Membros autenticados: Host=${hostId}, Espectador=${viewerId}`);

  let lastSeenVideoTrackId = null;
  // Iniciar captura nativa da janela do YouTube
  const startNativeYouTubeCapture = async (audioMode = 'none') => {
    console.log(`Configurando captura nativa: audioMode=${audioMode}`);
    await hostPage.locator('#audio-mode-select').selectOption(audioMode, { force: true });
    await hostPage.locator('#dock-stream-btn').click();
    await hostPage.locator('.window-item').first().waitFor({ state: 'visible', timeout: 30000 });

    let targetWindow = hostPage.locator('.window-item').filter({ hasText: 'HUNTING FOR YOUR DREAM' }).first();
    if ((await targetWindow.count()) === 0) {
      targetWindow = hostPage.locator('.window-item').filter({ hasText: 'GALNERYUS' }).first();
    }
    if ((await targetWindow.count()) === 0) {
      targetWindow = hostPage.locator('.window-item').filter({ hasText: 'YouTube' }).first();
    }
    if ((await targetWindow.count()) === 0) {
      const titles = await hostPage.locator('.window-item .window-title').allInnerTexts();
      throw new Error(`Janela do YouTube não encontrada na lista nativa: ${JSON.stringify(titles)}`);
    }

    await sourcePage.bringToFront().catch(() => {});
    await sourcePage.evaluate(() => window.focus()).catch(() => {});
    await sleep(400);
    await targetWindow.click();
    await sourcePage.bringToFront().catch(() => {});
    await sourcePage.evaluate(() => window.focus()).catch(() => {});

    console.log('Aguardando stream nativo chegar ao espectador...');
    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await viewerPage.evaluate(({ hId, prevTrackId }) => {
        const unmute = document.querySelector('.audio-unmute-overlay button');
        if (unmute) unmute.click();
        const card = document.getElementById(`card-${hId}`);
        const v = card?.querySelector('video');
        if (v && v.paused) {
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
      await sleep(1000);
    }
    if (!ready) throw new Error('Espectador não reproduziu stream nativo dentro de 45s');
    const streamInfo = await inspectViewerStream();
    lastSeenVideoTrackId = streamInfo.videoTrackId;
    console.log(`Stream nativo recebido e reproduzindo no espectador! TrackId: ${lastSeenVideoTrackId}`);
    await sleep(2000);
  };

  const stopNativeCapture = async () => {
    console.log('Parando captura nativa...');
    await hostPage.locator('#dock-stream-btn').click();
    await waitApp(hostPage, async () => {
      const d = await import('/js/desktop.js');
      return (await d.getNativeCaptureState()).state === 'idle';
    }, null, 15000).catch(() => {});
    await sleep(1500);
  };

  // Inspeção das trilhas reais associadas ao card do host
  const inspectViewerStream = async () => {
    return await viewerPage.evaluate(hId => {
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

  // Coleta estritamente isolada de séries temporais
  const previousMap = new Map();
  const collectIsolatedMetrics = async (durationSec, testLabel) => {
    console.log(`[${testLabel}] Aguardando 3s para warm-up e estabilização da conexão...`);
    await sleep(3000);

    // Zeramento estrito dos contadores de apresentação antes de cronometrar a fase
    await viewerPage.evaluate(() => window.__smgE2E?.resetSession());
    previousMap.clear();

    console.log(`[${testLabel}] Coletando telemetria por ${durationSec}s em estado steady...`);
    const timeline = [];
    const startTime = Date.now();
    const endTime = startTime + (durationSec * 1000);

    let sec = 0;
    while (Date.now() < endTime) {
      await sleep(1000);
      sec++;
      const sample = await viewerPage.evaluate(() => window.__smgE2E?.sample()).catch(() => null);
      if (!sample) continue;

      const streamInfo = await inspectViewerStream();
      const targetVideoTrackId = streamInfo?.videoTrackId;
      const targetAudioTrackId = streamInfo?.audioTrackId;

      for (const row of sample.rows) {
        const id = `${row.pcId}:${row.id}`;
        if (previousMap.has(id)) row.delta = deltaMetrics(previousMap.get(id), row);
        previousMap.set(id, row);
      }

      // Seleção inequívoca de inbound-rtp vinculada à trilha ativa
      let videoRow = null;
      if (targetVideoTrackId) {
        videoRow = sample.rows.find(r => r.type === 'inbound-rtp' && r.kind === 'video' && r.trackIdentifier === targetVideoTrackId);
      }
      if (!videoRow) {
        videoRow = sample.rows
          .filter(r => r.type === 'inbound-rtp' && r.kind === 'video')
          .sort((a, b) => (b.framesDecoded || 0) - (a.framesDecoded || 0))[0] || null;
      }

      let audioRow = null;
      if (targetAudioTrackId) {
        audioRow = sample.rows.find(r => r.type === 'inbound-rtp' && r.kind === 'audio' && r.trackIdentifier === targetAudioTrackId);
      }
      if (!audioRow) {
        audioRow = sample.rows
          .filter(r => r.type === 'inbound-rtp' && r.kind === 'audio')
          .sort((a, b) => (b.packetsReceived || 0) - (a.packetsReceived || 0))[0] || null;
      }

      const vid = sample.videos?.find(v => v.id === `card-${hostId}`)
               || sample.videos?.find(v => !v.isLocal && v.width > 0);
      const pres = vid?.presentation;

      const decodedFps = videoRow?.delta?.decodedFps ?? null;
      const decodeTimeMs = videoRow?.delta?.decodeTimeMs ?? null;
      const videoJitterMs = videoRow?.delta?.jitterBufferMs ?? null;
      const packetsLost = videoRow?.packetsLost ?? 0;
      const audioJitterMs = audioRow?.delta?.jitterBufferMs ?? null;
      const maxPauseMs = pres?.intervalMaxPauseMs ?? 0;
      const gapsCount = pres?.gapsCount ?? 0;

      timeline.push({
        second: sec,
        elapsedMs: Date.now() - startTime,
        decodedFps,
        decodeTimeMs,
        videoJitterMs,
        packetsLost,
        audioJitterMs,
        maxPauseMs,
        gapsCount,
        streamInfo
      });

      if (sec % 5 === 0 || Date.now() >= endTime - 500) {
        console.log(`  [s=${sec}] FPS=${decodedFps?.toFixed(1) ?? 'N/A'} | decodeTime=${decodeTimeMs?.toFixed(1) ?? 'N/A'}ms | jitter=${videoJitterMs?.toFixed(1) ?? 'N/A'}ms | lost=${packetsLost} | maxPause=${maxPauseMs}ms | gaps=${gapsCount}`);
      }
    }

    return {
      timeline,
      totalDurationMs: Date.now() - startTime
    };
  };

  const summarizeTimeline = ({ timeline, totalDurationMs }, validationMetadata = {}) => {
    // Descarta o primeiro segundo de amostragem local
    const steady = timeline.slice(1);
    const fpsList = steady.map(t => t.decodedFps).filter(n => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
    const decodeList = steady.map(t => t.decodeTimeMs).filter(n => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
    const jitterList = steady.map(t => t.videoJitterMs).filter(n => typeof n === 'number' && Number.isFinite(n));
    const lastLost = steady.length ? steady[steady.length - 1].packetsLost : 0;
    const maxPause = Math.max(0, ...steady.map(t => t.maxPauseMs || 0));
    const totalGaps = steady.length ? steady[steady.length - 1].gapsCount : 0;

    const avg = arr => arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;
    const p10 = arr => arr.length ? Number(arr[Math.floor(arr.length * 0.1)].toFixed(1)) : null;
    const median = arr => arr.length ? Number(arr[Math.floor(arr.length * 0.5)].toFixed(1)) : null;

    const validFpsSamples = fpsList.length;
    const status = validFpsSamples >= 5 ? 'COMPLETED' : 'INCONCLUSIVE';

    return {
      status,
      validFpsSamples,
      totalDurationMs,
      fpsMean: avg(fpsList),
      fpsMedian: median(fpsList),
      fpsP10: p10(fpsList),
      fpsMin: fpsList.length ? Number(fpsList[0].toFixed(1)) : null,
      fpsMax: fpsList.length ? Number(fpsList[fpsList.length - 1].toFixed(1)) : null,
      decodeTimeMeanMs: avg(decodeList),
      decodeTimeP95Ms: decodeList.length ? Number(decodeList[Math.floor(decodeList.length * 0.95)].toFixed(1)) : null,
      jitterBufferMeanMs: avg(jitterList),
      totalPacketsLost: lastLost,
      maxPauseMs: maxPause,
      totalGapsCount: totalGaps,
      validation: validationMetadata,
      timeline
    };
  };

  const results = {
    provenance,
    scenarios: {}
  };

  // ==========================================
  // TESTE 1: Apenas vídeo nativo (audioMode: 'none')
  // ==========================================
  console.log('\n-----------------------------------------------------');
  console.log('EXECUTANDO TESTE 1: Apenas Vídeo Nativo (audioMode=none)');
  console.log('Objetivo: Medir baseline de 60 FPS com áudio 100% ausente.');
  console.log('-----------------------------------------------------');
  await resetSourceVideo();
  await startNativeYouTubeCapture('none');
  const t1Data = await collectIsolatedMetrics(30, 'TESTE 1');
  const t1Validation = await inspectViewerStream();
  results.scenarios.teste1_videoOnly = summarizeTimeline(t1Data, {
    audioModeRequested: 'none',
    hasAudioTrack: t1Validation.audioTracksCount > 0,
    audioTracksCount: t1Validation.audioTracksCount
  });
  await hostPage.screenshot({ path: path.join(outputDir, 't1-host.png') });
  await viewerPage.screenshot({ path: path.join(outputDir, 't1-viewer.png') });
  await stopNativeCapture();

  // ==========================================
  // TESTE 2: Vídeo nativo + áudio capturado, mas espectador mutado
  // ==========================================
  console.log('\n-----------------------------------------------------');
  console.log('EXECUTANDO TESTE 2: Vídeo Nativo + Áudio Capturado (Saída Mutada)');
  console.log('Objetivo: Isolar impacto do envio de RTP de áudio e NetEQ com saída do player mutada.');
  console.log('-----------------------------------------------------');
  await resetSourceVideo();
  await startNativeYouTubeCapture('system');

  // Muta explicitamente a saída de áudio no elemento <video>
  await viewerPage.evaluate(hId => {
    const v = document.getElementById(`card-${hId}`)?.querySelector('video');
    if (v) {
      v.muted = true;
      v.volume = 0;
    }
  }, hostId);

  const t2Data = await collectIsolatedMetrics(30, 'TESTE 2');
  const t2Validation = await inspectViewerStream();
  results.scenarios.teste2_audioCapturedViewerMuted = summarizeTimeline(t2Data, {
    audioModeRequested: 'system',
    hasAudioTrack: t2Validation.audioTracksCount > 0,
    audioTracksCount: t2Validation.audioTracksCount,
    elementMuted: t2Validation.videoMuted,
    elementVolume: t2Validation.videoVolume,
    note: 'Saída mutada no DOM; decodificador NetEQ e sincronização WebRTC continuam ativos'
  });
  await hostPage.screenshot({ path: path.join(outputDir, 't2-host.png') });
  await viewerPage.screenshot({ path: path.join(outputDir, 't2-viewer.png') });
  await stopNativeCapture();

  // ==========================================
  // TESTE 3: Vídeo + áudio nativos com prévia local suspensa
  // ==========================================
  console.log('\n-----------------------------------------------------');
  console.log('EXECUTANDO TESTE 3: Vídeo + Áudio Nativo com Prévia Local Suspensa');
  console.log('Objetivo: Avaliar ganho de performance ao desvincular decodificador de prévia no host.');
  console.log('-----------------------------------------------------');
  await resetSourceVideo();
  await startNativeYouTubeCapture('system');

  // Ocultar e suspender prévia local no host usando o botão dedicado que remove srcObject
  await hostPage.locator('#toggle-local-preview-btn').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await hostPage.locator('#toggle-local-preview-btn').click().catch(() => {});
  const hostPreviewSuspended = await hostPage.evaluate(() => {
    const v = document.querySelector('.video-card[data-is-local="true"] video')
           || document.querySelector('#card-local-me video');
    return v ? v.srcObject === null : false;
  });
  console.log(`[Host] Prévia local suspensa: ${hostPreviewSuspended}`);

  const t3Data = await collectIsolatedMetrics(30, 'TESTE 3');
  const t3Validation = await inspectViewerStream();
  results.scenarios.teste3_previewDisabled = summarizeTimeline(t3Data, {
    audioModeRequested: 'system',
    hostPreviewSuspended,
    hasAudioTrack: t3Validation.audioTracksCount > 0,
    audioTracksCount: t3Validation.audioTracksCount
  });
  await hostPage.screenshot({ path: path.join(outputDir, 't3-host.png') });
  await viewerPage.screenshot({ path: path.join(outputDir, 't3-viewer.png') });
  await stopNativeCapture();

  // ==========================================
  // TESTE 4: Variação de Jitter Buffer Target (0ms vs 25ms vs default)
  // ==========================================
  console.log('\n-----------------------------------------------------');
  console.log('EXECUTANDO TESTE 4: Variação de Jitter Buffer Target no Espectador');
  console.log('Objetivo: Comparar 0ms vs 25ms vs default com alvos e leitura efetiva.');
  console.log('-----------------------------------------------------');
  await resetSourceVideo();
  await startNativeYouTubeCapture('system');

  const configureAndInspectJitter = async (playoutDelaySec, jitterTargetMs) => {
    return await viewerPage.evaluate(async ({ pDelay, jTarget }) => {
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

  // 4A: 0ms
  console.log('\nSub-teste 4A: Jitter Buffer Target = 0ms');
  const receivers4a = await configureAndInspectJitter(0, 0);
  const t4aData = await collectIsolatedMetrics(20, 'TESTE 4A (0ms)');
  results.scenarios.teste4a_jitter0ms = summarizeTimeline(t4aData, {
    targetPlayoutDelayHint: 0,
    targetJitterBufferTarget: 0,
    effectiveReceivers: receivers4a
  });

  // 4B: 25ms
  console.log('\nSub-teste 4B: Jitter Buffer Target = 25ms (0.025s)');
  const receivers4b = await configureAndInspectJitter(0.025, 25);
  const t4bData = await collectIsolatedMetrics(20, 'TESTE 4B (25ms)');
  results.scenarios.teste4b_jitter25ms = summarizeTimeline(t4bData, {
    targetPlayoutDelayHint: 0.025,
    targetJitterBufferTarget: 25,
    effectiveReceivers: receivers4b
  });

  // 4C: Default (browser managed)
  console.log('\nSub-teste 4C: Jitter Buffer Target = Default (null)');
  const receivers4c = await configureAndInspectJitter(null, null);
  const t4cData = await collectIsolatedMetrics(20, 'TESTE 4C (default)');
  results.scenarios.teste4c_jitterDefault = summarizeTimeline(t4cData, {
    targetPlayoutDelayHint: null,
    targetJitterBufferTarget: null,
    effectiveReceivers: receivers4c
  });

  await hostPage.screenshot({ path: path.join(outputDir, 't4-host.png') });
  await viewerPage.screenshot({ path: path.join(outputDir, 't4-viewer.png') });
  await stopNativeCapture();

  // Finalizar processos
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
  console.log('RESUMO COMPARATIVO DOS TESTES DE ISOLAMENTO (CIENTÍFICO)');
  console.log('=====================================================');
  const summaryTable = {};
  for (const [key, sc] of Object.entries(results.scenarios)) {
    summaryTable[key] = {
      'Status': sc.status,
      'FPS Médio': sc.fpsMean,
      'FPS p10': sc.fpsP10,
      'Decode (ms)': sc.decodeTimeMeanMs,
      'Jitter (ms)': sc.jitterBufferMeanMs,
      'Max Pausa (ms)': sc.maxPauseMs,
      'Gaps': sc.totalGapsCount,
      'Perda Pkts': sc.totalPacketsLost,
      'Amostras Válidas': sc.validFpsSamples
    };
  }
  console.table(summaryTable);
};

runIsolationSuite().catch(err => {
  console.error('\nErro fatal na suíte de isolamento:', err);
  process.exit(1);
});
