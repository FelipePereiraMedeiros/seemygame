import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchHistoricalBrowser, historicalArtifactDir, waitHistorical } from '../tools/e2e/harness/historical-browser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const PORT = 3049;
const ARTIFACT_DIR = historicalArtifactDir('late-joiner-trios');
if (!fs.existsSync(ARTIFACT_DIR)) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://localhost:${PORT}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';

      const filePath = path.join(root, pathname);
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found: ' + pathname);
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      });
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[E2E Server] Porta ${PORT} em uso, reaproveitando.`);
        reject(err);
      } else {
        reject(err);
      }
    });

    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const webInitScript = (name, color = '#10b981') => `
  try {
    localStorage.setItem('seemygame_terms_version', '1.1');
    localStorage.setItem('seemygame_terms_accepted', 'true');
    localStorage.setItem('seemygame_user_name', '${name}');
  } catch(e) {}

  if (navigator.mediaDevices) {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      let frame = 0;
      const timer = setInterval(() => {
        frame++;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = '${color}';
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText('🌐 ${name} (Janela Web)', 100, 150);
        ctx.font = '24px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Frame: ' + frame + ' | ' + new Date().toLocaleTimeString(), 100, 220);
      }, 1000 / 30);
      const stream = canvas.captureStream(30);
      try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ac.createOscillator();
        const dest = ac.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        const audioTrack = dest.stream.getAudioTracks()[0];
        if (audioTrack) stream.addTrack(audioTrack);
      } catch (e) {}
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    };
  }
`;

const desktopInitScript = (name, primaryColor = '#38bdf8') => `
  try {
    localStorage.setItem('seemygame_terms_version', '1.1');
    localStorage.setItem('seemygame_terms_accepted', 'true');
    localStorage.setItem('seemygame_user_name', '${name}');
  } catch(e) {}

  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args = {}) => {
        if (cmd === 'get_native_capture_capabilities') {
          return { provider: 'native', available: true, supports_process_audio: true };
        }
        if (cmd === 'list_capture_sources' || cmd === 'list_capturable_windows') {
          return [
            { id: 'win_cs2', sourceId: 'win_cs2', title: 'Counter-Strike 2 (Janela)', processName: 'cs2.exe', sourceType: 'window' },
            { id: 'mon_primary', sourceId: 'mon_primary', title: 'Monitor 1 - Tela Cheia (1920x1080)', sourceType: 'monitor' }
          ];
        }
        if (cmd === 'get_native_capture_state') {
          return { state: 'idle' };
        }
        if (cmd === 'start_native_capture') {
          return { state: 'capturing', sourceId: args.sourceId };
        }
        if (cmd === 'stop_native_capture') {
          return { state: 'idle' };
        }
        return {};
      }
    }
  };

  window.__SEEMYGAME_NATIVE_CAPTURE__ = {
    createStream: async (options) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      const isMon = options.sourceType === 'monitor';
      let frame = 0;
      const timer = setInterval(() => {
        frame++;
        ctx.fillStyle = isMon ? '#020617' : '#1e1b4b';
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = isMon ? '#38bdf8' : '${primaryColor}';
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText(isMon ? '🖥️ ${name} - Monitor 1 (Tela Cheia)' : '🎮 ${name} - Counter-Strike 2 (Janela)', 100, 150);
        ctx.font = '24px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Frame: ' + frame + ' | ' + new Date().toLocaleTimeString(), 100, 220);
      }, 1000 / 30);
      const stream = canvas.captureStream(30);
      try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ac.createOscillator();
        const dest = ac.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        const audioTrack = dest.stream.getAudioTracks()[0];
        if (audioTrack) stream.addTrack(audioTrack);
      } catch (e) {}
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    }
  };
`;

async function toggleStream(page) {
  await page.evaluate(async () => {
    const btn = document.getElementById('dock-stream-btn');
    if (btn) btn.click();
  });
}

async function startDesktopStream(page, sourceSearchText) {
  await toggleStream(page);
  const modal = page.locator('#desktop-picker-modal');
  await modal.waitFor({ state: 'visible', timeout: 6000 });

  const item = page.locator('#desktop-windows-list .window-item').filter({ hasText: sourceSearchText });
  await item.waitFor({ state: 'visible', timeout: 6000 });
  await item.click();
  await modal.waitFor({ state: 'hidden', timeout: 6000 });

  await waitHistorical(page, async () => {
    const btn = document.getElementById('dock-stream-btn');
    return btn && btn.classList.contains('is-streaming');
  }, undefined, { timeout: 10000 });
}

async function startWebStream(page) {
  await toggleStream(page);
  await waitHistorical(page, async () => {
    const btn = document.getElementById('dock-stream-btn');
    return btn && btn.classList.contains('is-streaming');
  }, undefined, { timeout: 10000 });
}

async function stopStream(page) {
  await toggleStream(page);
  await waitHistorical(page, async () => {
    const btn = document.getElementById('dock-stream-btn');
    return btn && !btn.classList.contains('is-streaming');
  }, undefined, { timeout: 10000 });
}

async function verifyStreamReceived(page, peerLabel) {
  await page.bringToFront().catch(() => {});
  const result = await waitHistorical(page, async () => {
    const grid = document.getElementById('video-grid');
    if (!grid) return false;
    const cards = grid.querySelectorAll('.video-card:not([data-is-local="true"])');
    if (cards.length === 0) return false;
    for (const card of cards) {
      const video = card.querySelector('video');
      if (video && video.srcObject) {
        const stream = video.srcObject;
        const tracks = stream.getVideoTracks ? stream.getVideoTracks() : [];
        if (tracks.length > 0 && tracks[0].readyState === 'live' && video.videoWidth > 0 && video.readyState >= 2) {
          video.muted = true;
          if (video.paused) video.play().catch(() => {});
          return {
            cardId: card.id,
            trackReady: true,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            readyState: video.readyState
          };
        }
      }
    }
    return false;
  }, undefined, { timeout: 25000 });
  return await result.jsonValue();
}

async function verifyStreamStillActive(page, label = '') {
  const result = await page.evaluate(async () => {
    const grid = document.getElementById('video-grid');
    if (!grid) return false;
    const cards = grid.querySelectorAll('.video-card:not([data-is-local="true"])');
    if (cards.length === 0) return false;
    for (const card of cards) {
      const video = card.querySelector('video');
      if (video && video.srcObject) {
        const tracks = video.srcObject.getVideoTracks();
        if (tracks.length > 0 && tracks[0].readyState === 'live' && video.videoWidth > 0 && video.readyState >= 2) {
          return { cardId: card.id, live: true };
        }
      }
    }
    return false;
  });
  if (!result || !result.live) {
    throw new Error(`[verifyStreamStillActive] Stream não está ativo em ${label}`);
  }
  return result;
}

async function verifyStreamStopped(page, label = '') {
  try {
    await waitHistorical(page, async () => {
      const grid = document.getElementById('video-grid');
      if (!grid) return true;
      const cards = grid.querySelectorAll('.video-card:not(#card-local-me):not([data-is-local="true"])');
      return cards.length === 0;
    }, undefined, { timeout: 10000 });
  } catch (err) {
    const cardsInfo = await page.evaluate(async () => {
      const grid = document.getElementById('video-grid');
      if (!grid) return 'No grid found';
      const cards = Array.from(grid.querySelectorAll('.video-card'));
      return cards.map(c => ({
        id: c.id,
        className: c.className,
        dataset: { ...c.dataset }
      }));
    });
    console.error(`❌ [verifyStreamStopped FAILED on ${label}] Cards no grid:`, JSON.stringify(cardsInfo, null, 2));
    throw err;
  }
}

async function safeScreenshot(page, filename) {
  try {
    await page.bringToFront().catch(() => {});
    await page.screenshot({ path: path.join(ARTIFACT_DIR, filename), timeout: 8000 });
    console.log(`📸 Screenshot salvo: ${filename}`);
  } catch (e) {
    console.warn(`[Screenshot Warning] Não foi possível capturar ${filename}: ${e.message}`);
  }
}

function attachDebugListeners(name, page) {
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[RoomManager]') || text.includes('[Security]') || text.includes('[watchFriend]') || text.includes('STREAM') || text.includes('Peer') || text.includes('Error') || text.includes('error') || text.includes('Falha') || text.includes('call') || text.includes('Espectador') || text.includes('Rejeitando')) {
      console.log(`[${name}] ${text}`);
    }
  });
  page.on('pageerror', err => console.error(`[${name} Error]`, err));
}

async function runTrioTest({
  browser,
  trioName,
  streamerConfig,     // { name, isDesktop, color, windowTitle }
  existingViewerConfig,// { name, isDesktop, color }
  lateJoinerConfig    // { name, isDesktop, color }
}) {
  console.log(`\n================================================================`);
  console.log(`--- TESTE TRIO ${trioName}: ${streamerConfig.name} transmitindo para ${existingViewerConfig.name}, e ${lateJoinerConfig.name} ENTRA DURANTE A TRANSMISSÃO ---`);
  console.log(`================================================================`);

  const roomId = `late-${trioName.toLowerCase()}-${Math.random().toString(36).substring(2, 7)}`;
  const roomUrl = `http://127.0.0.1:${PORT}/room.html?room=${roomId}`;
  console.log(`[Trio ${trioName}] URL da Sala: ${roomUrl}`);

  // Contextos
  const ctxStreamer = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pageStreamer = await ctxStreamer.newPage();
  await pageStreamer.addInitScript(
    streamerConfig.isDesktop
      ? desktopInitScript(streamerConfig.name, streamerConfig.color)
      : webInitScript(streamerConfig.name, streamerConfig.color)
  );
  attachDebugListeners(streamerConfig.name, pageStreamer);

  const ctxViewer1 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pageViewer1 = await ctxViewer1.newPage();
  await pageViewer1.addInitScript(
    existingViewerConfig.isDesktop
      ? desktopInitScript(existingViewerConfig.name, existingViewerConfig.color)
      : webInitScript(existingViewerConfig.name, existingViewerConfig.color)
  );
  attachDebugListeners(existingViewerConfig.name, pageViewer1);

  const ctxLateJoiner = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pageLateJoiner = await ctxLateJoiner.newPage();
  await pageLateJoiner.addInitScript(
    lateJoinerConfig.isDesktop
      ? desktopInitScript(lateJoinerConfig.name, lateJoinerConfig.color)
      : webInitScript(lateJoinerConfig.name, lateJoinerConfig.color)
  );
  attachDebugListeners(lateJoinerConfig.name, pageLateJoiner);

  try {
    // 1. Streamer cria a sala como Coordenador Master
    console.log(`[Trio ${trioName}] 1. ${streamerConfig.name} abrindo e criando a sala...`);
    await pageStreamer.goto(roomUrl);
    const joinBtnS = pageStreamer.locator('#green-room-join-btn');
    await joinBtnS.waitFor({ state: 'visible', timeout: 10000 });
    await joinBtnS.click();

    await waitHistorical(pageStreamer, async () => {
      const rm = (await import('/js/entries/room-entry.js')).roomState.roomManager;
      return rm && rm.isMaster && rm.isInRoom;
    }, undefined, { timeout: 15000 });
    console.log(`✅ ${streamerConfig.name} confirmado como Coordenador Master.`);

    // 2. Existing Viewer 1 entra na sala
    console.log(`[Trio ${trioName}] 2. ${existingViewerConfig.name} entrando na sala...`);
    await pageViewer1.goto(roomUrl);
    const joinBtnV1 = pageViewer1.locator('#green-room-join-btn');
    await joinBtnV1.waitFor({ state: 'visible', timeout: 10000 });
    await joinBtnV1.click();

    // Aguarda sincronização de 2 membros online
    for (const [name, p] of [[streamerConfig.name, pageStreamer], [existingViewerConfig.name, pageViewer1]]) {
      await waitHistorical(p, async () => {
        const badge = document.getElementById('sidebar-members-count');
        return badge && badge.textContent.includes('2 online');
      }, undefined, { timeout: 15000 });
      console.log(`✅ ${name} confirmou 2 membros online.`);
    }

    // 3. Streamer inicia a transmissão
    console.log(`[Trio ${trioName}] 3. ${streamerConfig.name} iniciando transmissão...`);
    if (streamerConfig.isDesktop) {
      await startDesktopStream(pageStreamer, streamerConfig.windowTitle || 'Counter-Strike 2');
    } else {
      await startWebStream(pageStreamer);
    }
    console.log(`✅ ${streamerConfig.name} está transmitindo ao vivo!`);

    // 4. Verifica recebimento em Existing Viewer 1
    console.log(`[Trio ${trioName}] 4. Verificando recebimento da stream em ${existingViewerConfig.name}...`);
    const resV1 = await verifyStreamReceived(pageViewer1, existingViewerConfig.name);
    console.log(`✅ ${existingViewerConfig.name} recebeu o stream com sucesso:`, resV1);
    await safeScreenshot(pageViewer1, `trio_${trioName.toLowerCase()}_01_${existingViewerConfig.name}_watching.png`);

    await new Promise(r => setTimeout(r, 1000));

    // 5. AGORA O LATE-JOINER ENTRA NA SALA DURANTE A TRANSMISSÃO ATIVA
    console.log(`\n⚡ [Trio ${trioName}] 5. ${lateJoinerConfig.name} INGRESSANDO NA SALA DURANTE A TRANSMISSÃO...`);
    await pageLateJoiner.goto(roomUrl);
    const joinBtnLate = pageLateJoiner.locator('#green-room-join-btn');
    await joinBtnLate.waitFor({ state: 'visible', timeout: 10000 });
    await joinBtnLate.click();
    console.log(`[Trio ${trioName}] ${lateJoinerConfig.name} clicou para entrar na sala.`);

    // Aguarda 3 membros online em todos os 3 clientes
    console.log(`[Trio ${trioName}] Aguardando confirmação de 3 membros online em todos os 3 clientes...`);
    for (const [name, p] of [
      [streamerConfig.name, pageStreamer],
      [existingViewerConfig.name, pageViewer1],
      [lateJoinerConfig.name, pageLateJoiner]
    ]) {
      await waitHistorical(p, async () => {
        const badge = document.getElementById('sidebar-members-count');
        return badge && badge.textContent.includes('3 online');
      }, undefined, { timeout: 20000 });
      console.log(`✅ ${name} confirmou 3 membros online.`);
    }

    // 6. Verifica se o Late-Joiner recebeu a stream em andamento automaticamente!
    console.log(`[Trio ${trioName}] 6. Verificando se ${lateJoinerConfig.name} (Late-Joiner) detectou e recebeu a transmissão automaticamente...`);
    const resLate = await verifyStreamReceived(pageLateJoiner, lateJoinerConfig.name);
    console.log(`🎉 ✅ ${lateJoinerConfig.name} (Late-Joiner) recebeu com sucesso o stream em andamento:`, resLate);

    // 7. Verifica se o Existing Viewer 1 continua assistindo normalmente sem interrupção!
    console.log(`[Trio ${trioName}] 7. Confirmando que ${existingViewerConfig.name} CONTINUA assistindo sem interrupção...`);
    const stillActiveV1 = await verifyStreamStillActive(pageViewer1, existingViewerConfig.name);
    console.log(`✅ ${existingViewerConfig.name} continua assistindo ininterruptamente:`, stillActiveV1);

    await safeScreenshot(pageLateJoiner, `trio_${trioName.toLowerCase()}_02_${lateJoinerConfig.name}_late_received.png`);

    // 8. Streamer encerra a transmissão
    console.log(`[Trio ${trioName}] 8. ${streamerConfig.name} encerrando a transmissão...`);
    await stopStream(pageStreamer);
    console.log(`✅ ${streamerConfig.name} encerrou a transmissão.`);

    // 9. Ambos os espectadores verificam o encerramento e remoção do card do palco
    console.log(`[Trio ${trioName}] 9. Verificando limpeza do grid em ${existingViewerConfig.name} e ${lateJoinerConfig.name}...`);
    await verifyStreamStopped(pageViewer1, existingViewerConfig.name);
    await verifyStreamStopped(pageLateJoiner, lateJoinerConfig.name);
    console.log(`✅ Stream removido do palco com sucesso em ambos os espectadores!`);

    console.log(`\n🎉 TRIO ${trioName} APROVADO COM 100% DE SUCESSO!\n`);

  } finally {
    await ctxStreamer.close();
    await ctxViewer1.close();
    await ctxLateJoiner.close();
  }
}

async function run() {
  const server = await startServer();
  console.log(`[E2E Late-Joiner] Servidor ouvindo na porta ${PORT}`);

  const browser = await launchHistoricalBrowser({
    channel: 'chrome',
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-web-security',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  });

  try {
    // -------------------------------------------------------------
    // TRIO 1: ADB (A streams to D, B enters during stream)
    // -------------------------------------------------------------
    await runTrioTest({
      browser,
      trioName: 'ADB',
      streamerConfig: { name: 'DesktopA', isDesktop: true, color: '#38bdf8', windowTitle: 'Counter-Strike 2' },
      existingViewerConfig: { name: 'DesktopD', isDesktop: true, color: '#10b981' },
      lateJoinerConfig: { name: 'WebB', isDesktop: false, color: '#f43f5e' }
    });

    // -------------------------------------------------------------
    // TRIO 2: ABC (A streams to B, C enters during stream)
    // -------------------------------------------------------------
    await runTrioTest({
      browser,
      trioName: 'ABC',
      streamerConfig: { name: 'DesktopA', isDesktop: true, color: '#38bdf8', windowTitle: 'Counter-Strike 2' },
      existingViewerConfig: { name: 'WebB', isDesktop: false, color: '#f43f5e' },
      lateJoinerConfig: { name: 'WebC', isDesktop: false, color: '#a855f7' }
    });

    // -------------------------------------------------------------
    // TRIO 3: ACD (A streams to C, D enters during stream)
    // -------------------------------------------------------------
    await runTrioTest({
      browser,
      trioName: 'ACD',
      streamerConfig: { name: 'DesktopA', isDesktop: true, color: '#38bdf8', windowTitle: 'Counter-Strike 2' },
      existingViewerConfig: { name: 'WebC', isDesktop: false, color: '#a855f7' },
      lateJoinerConfig: { name: 'DesktopD', isDesktop: true, color: '#10b981' }
    });

    // -------------------------------------------------------------
    // TRIO 4: BCA (B streams to C, A enters during stream)
    // -------------------------------------------------------------
    await runTrioTest({
      browser,
      trioName: 'BCA',
      streamerConfig: { name: 'WebB', isDesktop: false, color: '#f43f5e' },
      existingViewerConfig: { name: 'WebC', isDesktop: false, color: '#a855f7' },
      lateJoinerConfig: { name: 'DesktopA', isDesktop: true, color: '#38bdf8' }
    });

    console.log('\n================================================================');
    console.log('🏆 TODOS OS 4 TRIOS (ADB, ABC, ACD, BCA) PASSARAM COM SUCESSO TOTAL!');
    console.log('================================================================\n');

  } catch (err) {
    console.error('❌ Falha na execução da suíte de trios late-joiner:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (server) server.close();
  }
}

run();
