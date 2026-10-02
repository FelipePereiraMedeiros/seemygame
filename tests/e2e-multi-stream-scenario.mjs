import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchHistoricalBrowser, historicalArtifactDir, waitHistorical } from '../tools/e2e/harness/historical-browser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const PORT = 3048;
const ARTIFACT_DIR = historicalArtifactDir('multi-stream-scenario');
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
      const filePath = path.normalize(path.join(root, pathname));
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end();
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
        dataset: { ...c.dataset },
        style: c.getAttribute('style'),
        innerHTML: c.innerHTML.slice(0, 150)
      }));
    });
    console.error(`❌ [verifyStreamStopped FAILED on ${label}] Cards no grid:`, JSON.stringify(cardsInfo, null, 2));
    throw err;
  }
}

async function safeScreenshot(page, filename) {
  try {
    await page.bringToFront().catch(() => {});
    await page.screenshot({ path: path.join(ARTIFACT_DIR, filename), timeout: 5000 });
    console.log(`📸 Screenshot salvo: ${filename}`);
  } catch (e) {
    console.warn(`[Screenshot Warning] Não foi possível capturar ${filename}: ${e.message}`);
  }
}

async function run() {
  const server = await startServer();
  console.log(`[E2E] Servidor para cenário multi-stream ouvindo na porta ${PORT}`);

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

  const roomId = 'multi-stream-' + Math.random().toString(36).substring(2, 8);
  const roomUrl = `http://127.0.0.1:${PORT}/room.html?room=${roomId}`;
  console.log(`[E2E] Sala: ${roomUrl}\n`);

  try {
    // Desktop A (Host / Criador da sala)
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    await pageA.addInitScript(desktopInitScript('DesktopA', '#38bdf8'));

    // Web B (Participante Web)
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageB = await ctxB.newPage();
    await pageB.addInitScript(webInitScript('WebB', '#f43f5e'));

    // Web C (Participante Web)
    const ctxC = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageC = await ctxC.newPage();
    await pageC.addInitScript(webInitScript('WebC', '#a855f7'));

    // Desktop D (Participante Desktop)
    const ctxD = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageD = await ctxD.newPage();
    await pageD.addInitScript(desktopInitScript('DesktopD', '#10b981'));

    for (const [name, page] of [['Desktop A', pageA], ['Web B', pageB], ['Web C', pageC], ['Desktop D', pageD]]) {
      page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[RoomManager]') || text.includes('[Security]') || text.includes('[watchFriend]') || text.includes('STREAM') || text.includes('Peer') || text.includes('Error') || text.includes('error') || text.includes('Falha') || text.includes('call') || text.includes('Espectador') || text.includes('Rejeitando')) {
          console.log(`[${name}] ${text}`);
        }
      });
      page.on('pageerror', err => console.error(`[${name} Error]`, err));
    }

    console.log('[E2E Setup] Desktop A criando a sala como Coordenador Master...');
    await pageA.goto(roomUrl);
    const btnA = pageA.locator('#green-room-join-btn');
    await btnA.waitFor({ state: 'visible', timeout: 10000 });
    await btnA.click();

    // Aguarda Desktop A estabelecer a coordenação da sala
    await waitHistorical(pageA, async () => {
      const rm = (await import('/js/entries/room-entry.js')).roomState.roomManager;
      return rm && rm.isMaster && rm.isInRoom;
    }, undefined, { timeout: 15000 });
    console.log('✅ Desktop A conectado e confirmado como Coordenador Master da sala.');

    // Agora os demais participantes entram na sala criada por Desktop A
    console.log('[E2E Setup] Web B, Web C e Desktop D ingressando na sala...');
    for (const [name, page] of [['Web B', pageB], ['Web C', pageC], ['Desktop D', pageD]]) {
      await page.goto(roomUrl);
      const btn = page.locator('#green-room-join-btn');
      await btn.waitFor({ state: 'visible', timeout: 10000 });
      await btn.click();
      console.log(`[E2E Setup] ${name} entrou na sala.`);
      await new Promise(r => setTimeout(r, 600));
    }

    // Aguarda sincronização de presença dos 4 membros
    console.log('[E2E Setup] Aguardando confirmação de 4 membros online em todos os clientes...');
    for (const [name, page] of [['Desktop A', pageA], ['Web B', pageB], ['Web C', pageC], ['Desktop D', pageD]]) {
      await waitHistorical(page, async () => {
        const badge = document.getElementById('sidebar-members-count');
        return badge && badge.textContent.includes('4 online');
      }, undefined, { timeout: 25000 });
      console.log(`✅ ${name} confirmou 4 membros online!`);
    }

    // ================================================================
    // CENÁRIO 1: Desktop A streamando Janela (CS2)
    // ================================================================
    console.log('\n================================================================');
    console.log('--- CENÁRIO 1: Desktop A começa a streamar JANELA (CS2) ---');
    console.log('================================================================');
    await startDesktopStream(pageA, 'Counter-Strike 2');
    console.log('✅ Desktop A: Transmissão local de janela ativa!');

    console.log('[E2E 1] Verificando recebimento em Web B, Web C e Desktop D...');
    const res1B = await verifyStreamReceived(pageB, 'Web B');
    console.log('✅ Web B recebeu o stream de janela do Desktop A com sucesso!', res1B);
    const res1C = await verifyStreamReceived(pageC, 'Web C');
    console.log('✅ Web C recebeu o stream de janela do Desktop A com sucesso!', res1C);
    const res1D = await verifyStreamReceived(pageD, 'Desktop D');
    console.log('✅ Desktop D recebeu o stream de janela do Desktop A com sucesso!', res1D);

    await safeScreenshot(pageB, 'multi_01_webB_received.png');

    console.log('[E2E 1] Desktop A fechando stream...');
    await stopStream(pageA);
    console.log('✅ Desktop A encerrou transmissão.');

    await verifyStreamStopped(pageB, 'Web B (Cenário 1)');
    await verifyStreamStopped(pageC, 'Web C (Cenário 1)');
    await verifyStreamStopped(pageD, 'Desktop D (Cenário 1)');
    console.log('✅ Stream de Desktop A removido do palco em B, C e D.');
    await new Promise(r => setTimeout(r, 1200));

    // ================================================================
    // CENÁRIO 2: Web B streamando Janela
    // ================================================================
    console.log('\n================================================================');
    console.log('--- CENÁRIO 2: Web B começa a streamar JANELA ---');
    console.log('================================================================');
    await startWebStream(pageB);
    console.log('✅ Web B: Transmissão local de janela iniciada!');

    console.log('[E2E 2] Verificando recebimento em Desktop A, Web C e Desktop D...');
    const res2A = await verifyStreamReceived(pageA, 'Desktop A');
    console.log('✅ Desktop A recebeu o stream do Web B com sucesso!', res2A);
    const res2C = await verifyStreamReceived(pageC, 'Web C');
    console.log('✅ Web C recebeu o stream do Web B com sucesso!', res2C);
    const res2D = await verifyStreamReceived(pageD, 'Desktop D');
    console.log('✅ Desktop D recebeu o stream do Web B com sucesso!', res2D);

    await safeScreenshot(pageA, 'multi_02_desktopA_received.png');

    console.log('[E2E 2] Web B fechando stream...');
    await stopStream(pageB);
    console.log('✅ Web B encerrou transmissão.');

    await verifyStreamStopped(pageA, 'Desktop A (Cenário 2)');
    await verifyStreamStopped(pageC, 'Web C (Cenário 2)');
    await verifyStreamStopped(pageD, 'Desktop D (Cenário 2)');
    console.log('✅ Stream de Web B removido do palco em A, C e D.');
    await new Promise(r => setTimeout(r, 1200));

    // ================================================================
    // CENÁRIO 3: Web C streamando Janela
    // ================================================================
    console.log('\n================================================================');
    console.log('--- CENÁRIO 3: Web C começa a streamar JANELA ---');
    console.log('================================================================');
    await startWebStream(pageC);
    console.log('✅ Web C: Transmissão local de janela iniciada!');

    console.log('[E2E 3] Verificando recebimento em Desktop A, Web B e Desktop D...');
    const res3A = await verifyStreamReceived(pageA, 'Desktop A');
    console.log('✅ Desktop A recebeu o stream do Web C com sucesso!', res3A);
    const res3B = await verifyStreamReceived(pageB, 'Web B');
    console.log('✅ Web B recebeu o stream do Web C com sucesso!', res3B);
    const res3D = await verifyStreamReceived(pageD, 'Desktop D');
    console.log('✅ Desktop D recebeu o stream do Web C com sucesso!', res3D);

    await safeScreenshot(pageA, 'multi_03_desktopA_received.png');

    console.log('[E2E 3] Web C fechando stream...');
    await stopStream(pageC);
    console.log('✅ Web C encerrou transmissão.');

    await verifyStreamStopped(pageA, 'Desktop A (Cenário 3)');
    await verifyStreamStopped(pageB, 'Web B (Cenário 3)');
    await verifyStreamStopped(pageD, 'Desktop D (Cenário 3)');
    console.log('✅ Stream de Web C removido do palco em A, B e D.');
    await new Promise(r => setTimeout(r, 1200));

    // ================================================================
    // CENÁRIO 4: Desktop D streamando Janela (CS2)
    // ================================================================
    console.log('\n================================================================');
    console.log('--- CENÁRIO 4: Desktop D começa a streamar JANELA (CS2) ---');
    console.log('================================================================');
    await startDesktopStream(pageD, 'Counter-Strike 2');
    console.log('✅ Desktop D: Transmissão local de janela ativa!');

    console.log('[E2E 4] Verificando recebimento em Desktop A, Web B e Web C...');
    const res4A = await verifyStreamReceived(pageA, 'Desktop A');
    console.log('✅ Desktop A recebeu o stream do Desktop D com sucesso!', res4A);
    const res4B = await verifyStreamReceived(pageB, 'Web B');
    console.log('✅ Web B recebeu o stream do Desktop D com sucesso!', res4B);
    const res4C = await verifyStreamReceived(pageC, 'Web C');
    console.log('✅ Web C recebeu o stream do Desktop D com sucesso!', res4C);

    await safeScreenshot(pageB, 'multi_04_webB_received.png');

    console.log('[E2E 4] Desktop D fechando stream...');
    await stopStream(pageD);
    console.log('✅ Desktop D encerrou transmissão.');

    await verifyStreamStopped(pageA, 'Desktop A (Cenário 4)');
    await verifyStreamStopped(pageB, 'Web B (Cenário 4)');
    await verifyStreamStopped(pageC, 'Web C (Cenário 4)');
    console.log('✅ Stream de Desktop D removido do palco em A, B e C.');
    await new Promise(r => setTimeout(r, 1200));

    // ================================================================
    // CENÁRIO 5: Desktop A streamando de novo em Modo TELA CHEIA
    // ================================================================
    console.log('\n================================================================');
    console.log('--- CENÁRIO 5: Desktop A começa a streamar de novo em TELA CHEIA ---');
    console.log('================================================================');
    await startDesktopStream(pageA, 'Monitor 1');
    console.log('✅ Desktop A: Transmissão local em TELA CHEIA (Monitor 1) ativa!');

    console.log('[E2E 5] Verificando recebimento de Tela Cheia em Web B, Web C e Desktop D...');
    const res5B = await verifyStreamReceived(pageB, 'Web B');
    console.log('✅ Web B recebeu o stream em TELA CHEIA do Desktop A com sucesso!', res5B);
    const res5C = await verifyStreamReceived(pageC, 'Web C');
    console.log('✅ Web C recebeu o stream em TELA CHEIA do Desktop A com sucesso!', res5C);
    const res5D = await verifyStreamReceived(pageD, 'Desktop D');
    console.log('✅ Desktop D recebeu o stream em TELA CHEIA do Desktop A com sucesso!', res5D);

    await safeScreenshot(pageB, 'multi_05_webB_received_fullscreen.png');

    console.log('\n================================================================');
    console.log('🎉 TODOS OS 5 CENÁRIOS FORAM EXECUTADOS COM SUCESSO ABSOLUTO (100%)!');
    console.log('================================================================\n');

    // Fechamento limpo do stream do cenário 5
    await stopStream(pageA);
    await verifyStreamStopped(pageB);
    await verifyStreamStopped(pageC);
    await verifyStreamStopped(pageD);
    console.log('✅ Cleanup final concluído.');

  } catch (err) {
    console.error('❌ Falha na execução do cenário multi-stream:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (server) server.close();
  }
}

run();
