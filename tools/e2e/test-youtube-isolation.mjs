import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
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

const setupContext = async context => {
  await context.addInitScript(installTelemetry, { expectedSessionMagic: null });
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
  console.log('Iniciando Bateria de Testes de Isolamento (YouTube)');
  console.log('Vídeo:', ytUrl);
  console.log('Diretório de saída:', outputDir);
  console.log('=====================================================\n');

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
  await sourcePage.evaluate(() => {
    const v = document.querySelector('video');
    if (v) {
      v.muted = false;
      v.volume = 1.0;
      v.currentTime = 25;
      v.play().catch(() => {});
    }
  });
  await sleep(1000);
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

  // Função auxiliar para iniciar captura nativa da janela do YouTube
  const startNativeYouTubeCapture = async (audioMode = 'none') => {
    console.log(`Configurando captura nativa: audioMode=${audioMode}`);
    await hostPage.locator('#audio-mode-select').selectOption(audioMode, { force: true });
    await hostPage.locator('#dock-stream-btn').click();
    await hostPage.locator('.window-item').first().waitFor({ state: 'visible', timeout: 30000 });

    // Localizar item de janela do YouTube
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

    // Aguardar receptor começar a reproduzir
    console.log('Aguardando vídeo chegar ao espectador...');
    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await viewerPage.evaluate(hId => {
        const unmute = document.querySelector('.audio-unmute-overlay button');
        if (unmute) unmute.click();
        const v = document.getElementById(`card-${hId}`)?.querySelector('video');
        if (v && v.paused) {
          v.muted = true;
          v.play().catch(() => {});
        }
        return !!v && v.videoWidth > 0 && v.readyState >= 2 && !v.paused;
      }, hostId).catch(() => false);
      if (ready) break;
      await sleep(1000);
    }
    if (!ready) throw new Error('Espectador não reproduziu stream nativo dentro de 45s');
    console.log('Stream nativo recebido e reproduzindo no espectador!');
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

  // Coleta séries temporais usando a telemetria comprovada
  const previousMap = new Map();
  const collectMetrics = async (durationSec, testLabel) => {
    previousMap.clear();
    console.log(`[${testLabel}] Coletando telemetria por ${durationSec}s...`);
    const timeline = [];

    for (let sec = 1; sec <= durationSec; sec++) {
      await sleep(1000);
      const sample = await viewerPage.evaluate(() => window.__smgE2E?.sample()).catch(() => null);
      if (!sample) continue;

      for (const row of sample.rows) {
        const id = `${row.pcId}:${row.id}`;
        if (previousMap.has(id)) row.delta = deltaMetrics(previousMap.get(id), row);
        previousMap.set(id, row);
      }

      const videoRow = sample.rows.find(r => r.kind === 'video' && r.type === 'inbound-rtp' && (r.framesDecoded > 0 || r.bytesReceived > 0))
                    || sample.rows.find(r => r.kind === 'video' && r.type === 'inbound-rtp');

      const audioRow = sample.rows.find(r => r.kind === 'audio' && r.type === 'inbound-rtp' && (r.packetsReceived > 0 || r.bytesReceived > 0))
                    || sample.rows.find(r => r.kind === 'audio' && r.type === 'inbound-rtp');

      const vid = sample.videos?.find(v => v.width > 0 && !v.paused);
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
        decodedFps,
        decodeTimeMs,
        videoJitterMs,
        packetsLost,
        audioJitterMs,
        maxPauseMs,
        gapsCount
      });

      if (sec % 5 === 0 || sec === durationSec) {
        console.log(`  [s=${sec}] FPS=${decodedFps?.toFixed(1) ?? 'N/A'} | decodeTime=${decodeTimeMs?.toFixed(1) ?? 'N/A'}ms | jitter=${videoJitterMs?.toFixed(1) ?? 'N/A'}ms | lost=${packetsLost} | maxPause=${maxPauseMs}ms | gaps=${gapsCount}`);
      }
    }
    return timeline;
  };

  const summarizeTimeline = (timeline) => {
    const steady = timeline.slice(4); // descarta primeiros 4s de aquecimento
    const fpsList = steady.map(t => t.decodedFps).filter(n => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
    const decodeList = steady.map(t => t.decodeTimeMs).filter(n => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
    const jitterList = steady.map(t => t.videoJitterMs).filter(n => typeof n === 'number' && Number.isFinite(n));
    const lastLost = steady.length ? steady[steady.length - 1].packetsLost : 0;
    const maxPause = Math.max(0, ...timeline.map(t => t.maxPauseMs || 0));
    const totalGaps = timeline.length ? timeline[timeline.length - 1].gapsCount : 0;

    const avg = arr => arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;
    const p10 = arr => arr.length ? Number(arr[Math.floor(arr.length * 0.1)].toFixed(1)) : null;
    const median = arr => arr.length ? Number(arr[Math.floor(arr.length * 0.5)].toFixed(1)) : null;

    return {
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
      timeline
    };
  };

  const results = {};

  // ==========================================
  // TESTE 1: Apenas vídeo nativo (audioMode: 'none')
  // ==========================================
  console.log('\n-----------------------------------------------------');
  console.log('EXECUTANDO TESTE 1: Apenas Vídeo Nativo (audioMode=none)');
  console.log('Objetivo: Medir se o pipeline de vídeo puro sustenta 60 FPS sem áudio.');
  console.log('-----------------------------------------------------');
  await sourcePage.evaluate(() => {
    const v = document.querySelector('video');
    if (v) { v.currentTime = 25; v.play().catch(() => {}); }
  });
  await startNativeYouTubeCapture('none');
  const t1Timeline = await collectMetrics(30, 'TESTE 1');
  results.teste1_videoOnly = summarizeTimeline(t1Timeline);
  await hostPage.screenshot({ path: path.join(outputDir, 't1-host.png') });
  await viewerPage.screenshot({ path: path.join(outputDir, 't1-viewer.png') });
  await stopNativeCapture();

  // ==========================================
  // TESTE 2: Vídeo nativo + áudio capturado, mas espectador mutado
  // ==========================================
  console.log('\n-----------------------------------------------------');
  console.log('EXECUTANDO TESTE 2: Vídeo Nativo + Áudio Capturado (Espectador Mutado)');
  console.log('Objetivo: Verificar se a captura WASAPI e empacotamento de áudio causam queda de FPS.');
  console.log('-----------------------------------------------------');
  await sourcePage.evaluate(() => {
    const v = document.querySelector('video');
    if (v) { v.currentTime = 65; v.play().catch(() => {}); }
  });
  await viewerPage.evaluate(hId => {
    const v = document.getElementById(`card-${hId}`)?.querySelector('video');
    if (v) { v.muted = true; v.volume = 0; }
  }, hostId);
  await startNativeYouTubeCapture('system');
  const t2Timeline = await collectMetrics(30, 'TESTE 2');
  results.teste2_audioCapturedViewerMuted = summarizeTimeline(t2Timeline);
  await hostPage.screenshot({ path: path.join(outputDir, 't2-host.png') });
  await viewerPage.screenshot({ path: path.join(outputDir, 't2-viewer.png') });
  await stopNativeCapture();

  // ==========================================
  // TESTE 3: Vídeo + áudio nativos, sem prévia local (ou prévia pausada)
  // ==========================================
  console.log('\n-----------------------------------------------------');
  console.log('EXECUTANDO TESTE 3: Vídeo + Áudio Nativo com Prévia Local Pausada/Ocultada');
  console.log('Objetivo: Verificar se a carga de decode da prévia concorre com encode/compositor.');
  console.log('-----------------------------------------------------');
  await sourcePage.evaluate(() => {
    const v = document.querySelector('video');
    if (v) { v.currentTime = 105; v.play().catch(() => {}); }
  });
  await startNativeYouTubeCapture('system');
  await hostPage.evaluate(() => {
    const v = document.querySelector('#card-local-me video');
    if (v) {
      v.pause();
      v.style.opacity = '0.2';
    }
  });
  const t3Timeline = await collectMetrics(30, 'TESTE 3');
  results.teste3_previewDisabled = summarizeTimeline(t3Timeline);
  await hostPage.screenshot({ path: path.join(outputDir, 't3-host.png') });
  await viewerPage.screenshot({ path: path.join(outputDir, 't3-viewer.png') });
  await stopNativeCapture();

  // ==========================================
  // TESTE 4: Variação do Jitter Buffer Target (0ms vs 25ms vs default)
  // ==========================================
  console.log('\n-----------------------------------------------------');
  console.log('EXECUTANDO TESTE 4: Variação de Jitter Buffer Target no Espectador');
  console.log('Objetivo: Comparar 0ms vs 25ms vs default no comportamento de engasgos.');
  console.log('-----------------------------------------------------');
  await sourcePage.evaluate(() => {
    const v = document.querySelector('video');
    if (v) { v.currentTime = 145; v.play().catch(() => {}); }
  });
  await startNativeYouTubeCapture('system');

  // 4A: 0ms
  console.log('\nSub-teste 4A: Jitter Buffer Target = 0ms');
  await viewerPage.evaluate(async () => {
    if (window.RTCPeerConnection && window.__smgPeers) {
      for (const pc of window.__smgPeers) {
        for (const receiver of pc.getReceivers()) {
          if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = 0;
        }
      }
    }
  });
  const t4aTimeline = await collectMetrics(15, 'TESTE 4A (0ms)');
  results.teste4a_jitter0ms = summarizeTimeline(t4aTimeline);

  // 4B: 25ms
  console.log('\nSub-teste 4B: Jitter Buffer Target = 25ms (0.025s)');
  await viewerPage.evaluate(async () => {
    if (window.RTCPeerConnection && window.__smgPeers) {
      for (const pc of window.__smgPeers) {
        for (const receiver of pc.getReceivers()) {
          if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = 0.025;
        }
      }
    }
  });
  const t4bTimeline = await collectMetrics(15, 'TESTE 4B (25ms)');
  results.teste4b_jitter25ms = summarizeTimeline(t4bTimeline);

  // 4C: Default (browser managed)
  console.log('\nSub-teste 4C: Jitter Buffer Target = Default (null)');
  await viewerPage.evaluate(async () => {
    if (window.RTCPeerConnection && window.__smgPeers) {
      for (const pc of window.__smgPeers) {
        for (const receiver of pc.getReceivers()) {
          if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = null;
        }
      }
    }
  });
  const t4cTimeline = await collectMetrics(15, 'TESTE 4C (default)');
  results.teste4c_jitterDefault = summarizeTimeline(t4cTimeline);

  await hostPage.screenshot({ path: path.join(outputDir, 't4-host.png') });
  await viewerPage.screenshot({ path: path.join(outputDir, 't4-viewer.png') });
  await stopNativeCapture();

  // Finalizar processos
  console.log('\nEncerrando navegadores e processos...');
  try { await sourceBrowser.close(); } catch {}
  try { await viewerBrowser.close(); } catch {}
  try { await nativeBrowser.close(); } catch {}
  try { desktopProcess.kill(); } catch {}
  try { server.close(); } catch {}

  // Gravar relatório completo
  const reportJsonPath = path.join(outputDir, 'isolation-report.json');
  await writeFile(reportJsonPath, JSON.stringify(results, null, 2));
  console.log(`\nRelatório salvo com sucesso em: ${reportJsonPath}`);

  // Exibir resumo executivo no console
  console.log('\n=====================================================');
  console.log('RESUMO COMPARATIVO DOS 4 TESTES DE ISOLAMENTO');
  console.log('=====================================================');
  console.table({
    'Teste 1 (Vídeo Only)': {
      'FPS Médio': results.teste1_videoOnly.fpsMean,
      'FPS p10': results.teste1_videoOnly.fpsP10,
      'Decode (ms)': results.teste1_videoOnly.decodeTimeMeanMs,
      'Jitter (ms)': results.teste1_videoOnly.jitterBufferMeanMs,
      'Max Pausa (ms)': results.teste1_videoOnly.maxPauseMs,
      'Gaps': results.teste1_videoOnly.totalGapsCount,
      'Perda Pkts': results.teste1_videoOnly.totalPacketsLost
    },
    'Teste 2 (Áudio Mutado)': {
      'FPS Médio': results.teste2_audioCapturedViewerMuted.fpsMean,
      'FPS p10': results.teste2_audioCapturedViewerMuted.fpsP10,
      'Decode (ms)': results.teste2_audioCapturedViewerMuted.decodeTimeMeanMs,
      'Jitter (ms)': results.teste2_audioCapturedViewerMuted.jitterBufferMeanMs,
      'Max Pausa (ms)': results.teste2_audioCapturedViewerMuted.maxPauseMs,
      'Gaps': results.teste2_audioCapturedViewerMuted.totalGapsCount,
      'Perda Pkts': results.teste2_audioCapturedViewerMuted.totalPacketsLost
    },
    'Teste 3 (Sem Prévia)': {
      'FPS Médio': results.teste3_previewDisabled.fpsMean,
      'FPS p10': results.teste3_previewDisabled.fpsP10,
      'Decode (ms)': results.teste3_previewDisabled.decodeTimeMeanMs,
      'Jitter (ms)': results.teste3_previewDisabled.jitterBufferMeanMs,
      'Max Pausa (ms)': results.teste3_previewDisabled.maxPauseMs,
      'Gaps': results.teste3_previewDisabled.totalGapsCount,
      'Perda Pkts': results.teste3_previewDisabled.totalPacketsLost
    },
    'Teste 4A (0ms Jitter)': {
      'FPS Médio': results.teste4a_jitter0ms.fpsMean,
      'FPS p10': results.teste4a_jitter0ms.fpsP10,
      'Decode (ms)': results.teste4a_jitter0ms.decodeTimeMeanMs,
      'Jitter (ms)': results.teste4a_jitter0ms.jitterBufferMeanMs,
      'Max Pausa (ms)': results.teste4a_jitter0ms.maxPauseMs,
      'Gaps': results.teste4a_jitter0ms.totalGapsCount,
      'Perda Pkts': results.teste4a_jitter0ms.totalPacketsLost
    },
    'Teste 4B (25ms Jitter)': {
      'FPS Médio': results.teste4b_jitter25ms.fpsMean,
      'FPS p10': results.teste4b_jitter25ms.fpsP10,
      'Decode (ms)': results.teste4b_jitter25ms.decodeTimeMeanMs,
      'Jitter (ms)': results.teste4b_jitter25ms.jitterBufferMeanMs,
      'Max Pausa (ms)': results.teste4b_jitter25ms.maxPauseMs,
      'Gaps': results.teste4b_jitter25ms.totalGapsCount,
      'Perda Pkts': results.teste4b_jitter25ms.totalPacketsLost
    },
    'Teste 4C (Def Jitter)': {
      'FPS Médio': results.teste4c_jitterDefault.fpsMean,
      'FPS p10': results.teste4c_jitterDefault.fpsP10,
      'Decode (ms)': results.teste4c_jitterDefault.decodeTimeMeanMs,
      'Jitter (ms)': results.teste4c_jitterDefault.jitterBufferMeanMs,
      'Max Pausa (ms)': results.teste4c_jitterDefault.maxPauseMs,
      'Gaps': results.teste4c_jitterDefault.totalGapsCount,
      'Perda Pkts': results.teste4c_jitterDefault.totalPacketsLost
    }
  });
};

runIsolationSuite().catch(err => {
  console.error('\n[ERRO CRÍTICO NA EXECUÇÃO]:', err);
  process.exit(1);
});
