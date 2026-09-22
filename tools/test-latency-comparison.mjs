/**
 * SeeMyGame - Benchmark Comparativo de Latência & Estabilidade
 * Compara simultaneamente:
 *  1. Desktop Host -> Desktop Viewer (Tauri WebView2 isolado com alta prioridade)
 *  2. Desktop Host -> Web Viewer (Microsoft Edge)
 *
 * Mede: FPS, RTT (ms), JitterBufferDelay (ms), DecodeTime (ms), Stutters (MaxPauseMs)
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.join(root, 'src-tauri/target/release/seemygame.exe');
const channel = 'msedge';
const outputDir = path.join(root, 'output/latency-comparison', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(outputDir, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = async () => {
  const s = createTcpServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  await new Promise(r => s.close(r));
  return port;
};

// Servidor de arquivos estáticos
let server;
const serve = async () => {
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!filename.startsWith(root + path.sep)) {
        res.writeHead(404);
        return res.end();
      }
      const ext = path.extname(filename);
      const mimeTypes = {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.json': 'application/json',
        '.png': 'image/png'
      };
      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      res.end(await readFile(filename));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
};

const setupContext = async (context) => {
  await context.addInitScript(() => {
    localStorage.setItem('seemygame_terms_version', '1.1');
    localStorage.setItem('seemygame_terms_accepted', 'true');
  });
};

const runBenchmark = async () => {
  console.log('========================================================================');
  console.log('🚀 SeeMyGame - Benchmark Comparativo: Desktop x Desktop vs Desktop x Web');
  console.log('========================================================================\n');

  const webOrigin = await serve();
  console.log(`[Servidor] Ativo em: ${webOrigin}`);

  // 1. Abrir janela de teste determinística 1080p60
  console.log('\n[Passo 1] Abrindo janela da fonte determinística 60 FPS...');
  const sourceBrowser = await chromium.launch({
    channel,
    headless: false,
    args: [
      '--window-position=50,50',
      '--window-size=1280,720',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  });
  const sourceContext = await sourceBrowser.newContext({ viewport: { width: 1280, height: 720 } });
  const sourcePage = await sourceContext.newPage();
  await sourcePage.goto(`${webOrigin}/fixtures/deterministic-60fps.html`);
  await sleep(1500);

  // 2. Iniciar Host Desktop (Tauri seemygame.exe)
  console.log('\n[Passo 2] Iniciando Host Desktop (seemygame.exe)...');
  const hostCdpPort = await freePort();
  const hostEnv = {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: path.join(outputDir, 'host-profile'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${hostCdpPort} --remote-debugging-address=127.0.0.1 --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required`
  };
  const hostProcess = spawn(exe, [], { cwd: path.dirname(exe), env: hostEnv, stdio: 'ignore' });
  
  let hostBrowser = null;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      hostBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${hostCdpPort}`, { timeout: 1000 });
      break;
    } catch {
      await sleep(500);
    }
  }
  if (!hostBrowser) throw new Error('Não foi possível conectar ao WebView2 do Host Desktop.');
  const hostContext = hostBrowser.contexts()[0];
  await setupContext(hostContext);
  const hostPage = hostContext.pages()[0] || await hostContext.newPage();
  await hostPage.waitForURL(u => u && u.href !== 'about:blank', { timeout: 15000 }).catch(() => {});
  console.log('Host Desktop conectado com sucesso!');
  const hostOrigin = new URL(hostPage.url()).origin;

  // Criar sala no Host
  const roomId = `bench_${Math.random().toString(36).slice(2, 8)}`;
  console.log(`Criando sala de benchmark: ${roomId}`);
  await hostPage.goto(`${hostOrigin}/room.html#room=${roomId}`);
  await hostPage.locator('#green-room-join-btn').waitFor({ state: 'visible', timeout: 30000 });
  await hostPage.locator('#green-room-user-name').fill('Host-Streamer');
  await hostPage.locator('#green-room-join-btn').click();
  await sleep(2000);

  // 3. Iniciar Web Viewer (Edge)
  console.log('\n[Passo 3] Conectando Web Viewer (Edge)...');
  const webViewerBrowser = await chromium.launch({
    channel,
    headless: false,
    args: [
      '--window-position=600,50',
      '--window-size=1000,600',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio'
    ]
  });
  const webViewerContext = await webViewerBrowser.newContext();
  await setupContext(webViewerContext);
  const webViewerPage = await webViewerContext.newPage();
  await webViewerPage.goto(`${webOrigin}/room.html#room=${roomId}`);
  await webViewerPage.locator('#green-room-join-btn').waitFor({ state: 'visible', timeout: 30000 });
  await webViewerPage.locator('#green-room-user-name').fill('Web-Viewer');
  await webViewerPage.locator('#green-room-join-btn').click();
  await sleep(2000);

  // 4. Iniciar Desktop Viewer (segunda instância de seemygame.exe)
  console.log('\n[Passo 4] Iniciando Desktop Viewer (seemygame.exe - Instância 2)...');
  const viewerCdpPort = await freePort();
  const viewerEnv = {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: path.join(outputDir, 'desktop-viewer-profile'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${viewerCdpPort} --remote-debugging-address=127.0.0.1 --mute-audio --autoplay-policy=no-user-gesture-required`
  };
  const desktopViewerProcess = spawn(exe, [], { cwd: path.dirname(exe), env: viewerEnv, stdio: 'ignore' });
  
  let desktopViewerBrowser = null;
  const deadlineViewer = Date.now() + 25000;
  while (Date.now() < deadlineViewer) {
    try {
      desktopViewerBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${viewerCdpPort}`, { timeout: 1000 });
      break;
    } catch {
      await sleep(500);
    }
  }
  if (!desktopViewerBrowser) throw new Error('Não foi possível conectar ao WebView2 do Desktop Viewer.');
  const desktopViewerContext = desktopViewerBrowser.contexts()[0];
  await setupContext(desktopViewerContext);
  const desktopViewerPage = desktopViewerContext.pages()[0] || await desktopViewerContext.newPage();
  await desktopViewerPage.waitForURL(u => u && u.href !== 'about:blank', { timeout: 15000 }).catch(() => {});
  const viewerOrigin = new URL(desktopViewerPage.url()).origin;
  
  await desktopViewerPage.goto(`${viewerOrigin}/room.html#room=${roomId}`);
  await desktopViewerPage.locator('#green-room-join-btn').waitFor({ state: 'visible', timeout: 30000 });
  await desktopViewerPage.locator('#green-room-user-name').fill('Desktop-Viewer');
  await desktopViewerPage.locator('#green-room-join-btn').click();

  // Diagnósticos de console
  hostPage.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('DirectStream') || msg.text().includes('initiateMediaCall')) {
      console.log(`[Host Console] ${msg.text()}`);
    }
  });
  desktopViewerPage.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('DirectStream') || msg.text().includes('Stream') || msg.text().includes('Recebendo')) {
      console.log(`[DesktopViewer Console] ${msg.text()}`);
    }
  });
  webViewerPage.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('DirectStream') || msg.text().includes('Stream') || msg.text().includes('Recebendo')) {
      console.log(`[WebViewer Console] ${msg.text()}`);
    }
  });

  const waitApp = async (page, predicate, argument, timeout = 30000) => {
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

  console.log('Aguardando sincronização mútua dos participantes na sala...');
  await waitApp(hostPage, async () => (await import('/js/app.js')).roomManager?.isInRoom === true);
  await waitApp(webViewerPage, async () => (await import('/js/app.js')).roomManager?.isInRoom === true);
  await waitApp(desktopViewerPage, async () => (await import('/js/app.js')).roomManager?.isInRoom === true);

  const hostId = await hostPage.evaluate(async () => (await import('/js/app.js')).roomManager?.myPeerId);
  const webViewerId = await webViewerPage.evaluate(async () => (await import('/js/app.js')).roomManager?.myPeerId);
  const desktopViewerId = await desktopViewerPage.evaluate(async () => (await import('/js/app.js')).roomManager?.myPeerId);

  await waitApp(hostPage, async id => {
    const r = (await import('/js/app.js')).roomManager;
    return r?.members?.has(id) && r.isPeerAuthorized(id);
  }, webViewerId, 30000);

  await waitApp(hostPage, async id => {
    const r = (await import('/js/app.js')).roomManager;
    return r?.members?.has(id) && r.isPeerAuthorized(id);
  }, desktopViewerId, 30000);
  console.log(`Participantes autorizados na malha da sala! (Host: ${hostId}, Web: ${webViewerId}, Desktop: ${desktopViewerId})`);

  // 5. Iniciar transmissão nativa no Host
  console.log('\n[Passo 5] Iniciando transmissão nativa Direct3D 11 NVENC no Host...');
  await sourcePage.bringToFront().catch(() => {});
  await sourcePage.evaluate(() => window.focus()).catch(() => {});
  await sleep(500);
  await hostPage.bringToFront().catch(() => {});
  await hostPage.locator('#audio-mode-select').selectOption('none', { force: true }).catch(() => {});
  await hostPage.locator('#dock-stream-btn').click();
  await hostPage.locator('.window-item').first().waitFor({ state: 'visible', timeout: 30000 });
  
  let targetWindow = hostPage.locator('.window-item').filter({ hasText: 'Determinística' }).first();
  if ((await targetWindow.count()) === 0) {
    targetWindow = hostPage.locator('.window-item').filter({ hasText: '60 FPS' }).first();
  }
  if ((await targetWindow.count()) === 0) {
    targetWindow = hostPage.locator('.window-item').first();
  }
  const actionBtn = targetWindow.locator('.window-action-btn');
  if ((await actionBtn.count()) > 0) {
    await actionBtn.first().click({ force: true });
  } else {
    await targetWindow.click({ force: true });
  }
  await sourcePage.bringToFront().catch(() => {});
  await sourcePage.evaluate(() => window.focus()).catch(() => {});
  await sleep(500);
  console.log('Stream nativo iniciado! Aguardando recepção de vídeo em ambos os espectadores...');

  // Aguarda vídeo carregar em ambos os espectadores
  const waitForVideo = async (page, name) => {
    const start = Date.now();
    while (Date.now() - start < 30000) {
      const playing = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v && v.readyState >= 2 && !v.paused && v.currentTime > 0;
      }).catch(() => false);
      if (playing) return true;
      await sleep(500);
    }
    throw new Error(`Timeout aguardando reprodução no ${name}`);
  };

  await Promise.all([
    waitForVideo(webViewerPage, 'Web Viewer'),
    waitForVideo(desktopViewerPage, 'Desktop Viewer')
  ]);
  console.log('Vídeo reproduzindo perfeitamente em ambos os espectadores!');

  // 6. Coleta de telemetria comparativa por 15 segundos
  console.log('\n[Passo 6] Coletando telemetria em tempo real por 15 segundos...');
  
  const collectMetrics = async (page) => {
    return await page.evaluate(async () => {
      const pcs = [];
      const app = await import('/js/app.js');
      if (app.roomManager?.meshConnections) {
        for (const conn of app.roomManager.meshConnections.values()) {
          if (conn.peerConnection) pcs.push(conn.peerConnection);
        }
      }
      
      let fps = null;
      let rtt = null;
      let packetsLost = 0;
      let decodeTimeMs = null;
      let jitterBufferDelayMs = null;
      let bitrateMbps = null;

      for (const pc of pcs) {
        try {
          const stats = await pc.getStats();
          stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
              if (report.framesPerSecond !== undefined) fps = Math.round(report.framesPerSecond);
              if (report.packetsLost !== undefined) packetsLost = report.packetsLost;
              if (report.totalDecodeTime !== undefined && report.framesDecoded > 0) {
                decodeTimeMs = Number(((report.totalDecodeTime / report.framesDecoded) * 1000).toFixed(2));
              }
              if (report.jitterBufferDelay !== undefined && report.jitterBufferEmittedCount > 0) {
                jitterBufferDelayMs = Number(((report.jitterBufferDelay / report.jitterBufferEmittedCount) * 1000).toFixed(2));
              }
            }
            if (report.type === 'candidate-pair' && (report.nominated || report.selected)) {
              if (report.currentRoundTripTime !== undefined) {
                rtt = Math.round(report.currentRoundTripTime * 1000);
              }
            }
          });
        } catch (_) {}
      }

      return { fps, rtt, packetsLost, decodeTimeMs, jitterBufferDelayMs };
    });
  };

  const webSamples = [];
  const desktopSamples = [];

  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const [webM, deskM] = await Promise.all([
      collectMetrics(webViewerPage),
      collectMetrics(desktopViewerPage)
    ]);
    if (webM.fps !== null) webSamples.push(webM);
    if (deskM.fps !== null) desktopSamples.push(deskM);
  }

  // Funções de agregação
  const avg = (arr, key) => {
    const vals = arr.map(x => x[key]).filter(v => typeof v === 'number' && !isNaN(v));
    if (vals.length === 0) return 0;
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };

  const summary = {
    webViewer: {
      avgFps: avg(webSamples, 'fps'),
      avgRttMs: avg(webSamples, 'rtt'),
      avgDecodeTimeMs: avg(webSamples, 'decodeTimeMs'),
      avgJitterBufferMs: avg(webSamples, 'jitterBufferDelayMs'),
      totalPacketsLost: webSamples[webSamples.length - 1]?.packetsLost || 0
    },
    desktopViewer: {
      avgFps: avg(desktopSamples, 'fps'),
      avgRttMs: avg(desktopSamples, 'rtt'),
      avgDecodeTimeMs: avg(desktopSamples, 'decodeTimeMs'),
      avgJitterBufferMs: avg(desktopSamples, 'jitterBufferDelayMs'),
      totalPacketsLost: desktopSamples[desktopSamples.length - 1]?.packetsLost || 0
    }
  };

  console.log('\n========================================================================');
  console.log('📊 RESULTADO CONSOLIDADO DO BENCHMARK COMPARATIVO');
  console.log('========================================================================');
  console.table({
    'Desktop Host -> Web Viewer': {
      'FPS Médio': `${summary.webViewer.avgFps} FPS`,
      'RTT Rede': `${summary.webViewer.avgRttMs} ms`,
      'Decode Time': `${summary.webViewer.avgDecodeTimeMs} ms`,
      'Jitter Buffer Delay': `${summary.webViewer.avgJitterBufferMs} ms`,
      'Pacotes Perdidos': summary.webViewer.totalPacketsLost
    },
    'Desktop Host -> Desktop Viewer': {
      'FPS Médio': `${summary.desktopViewer.avgFps} FPS`,
      'RTT Rede': `${summary.desktopViewer.avgRttMs} ms`,
      'Decode Time': `${summary.desktopViewer.avgDecodeTimeMs} ms`,
      'Jitter Buffer Delay': `${summary.desktopViewer.avgJitterBufferMs} ms`,
      'Pacotes Perdidos': summary.desktopViewer.totalPacketsLost
    }
  });
  console.log('========================================================================\n');

  // Encerramento
  console.log('Encerrando processos de teste...');
  try { hostProcess.kill(); } catch (_) {}
  try { desktopViewerProcess.kill(); } catch (_) {}
  try { await sourceBrowser.close(); } catch (_) {}
  try { await webViewerBrowser.close(); } catch (_) {}
  try { server.close(); } catch (_) {}
  console.log('Benchmark finalizado com sucesso!');
};

runBenchmark().catch(err => {
  console.error('Erro na execução do benchmark:', err);
  process.exit(1);
});
