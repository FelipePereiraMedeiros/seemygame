import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchHistoricalBrowser, historicalArtifactDir, waitHistorical } from '../tools/e2e/harness/historical-browser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const PORT = 3049;
const ARTIFACT_DIR = historicalArtifactDir('dual-stream-repro');
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
        console.log(`[E2E Server] Porta ${PORT} em uso.`);
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
        ctx.fillText('🌐 ${name} (Web Stream)', 100, 150);
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
        ctx.fillText(isMon ? '🖥️ ${name} - Monitor 1' : '🎮 ${name} - Counter-Strike 2', 100, 150);
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

async function verifyStreamReceived(page, peerLabel, timeout = 15000) {
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
  }, undefined, { timeout });
  return await result.jsonValue();
}

async function safeScreenshot(page, filename) {
  try {
    await page.bringToFront().catch(() => {});
    await page.screenshot({ path: path.join(ARTIFACT_DIR, filename), timeout: 5000 });
    console.log(`📸 Screenshot: ${filename}`);
  } catch (e) {
    console.warn(`[Screenshot Warning] ${filename}: ${e.message}`);
  }
}

async function run() {
  const server = await startServer();
  console.log(`[E2E] Servidor ouvindo na porta ${PORT}`);

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

  const roomId = 'dual-stream-' + Math.random().toString(36).substring(2, 8);
  const roomUrl = `http://127.0.0.1:${PORT}/room.html?room=${roomId}`;
  console.log(`[E2E] Sala: ${roomUrl}\n`);

  try {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    await pageA.addInitScript(desktopInitScript('PersonA', '#38bdf8'));

    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageB = await ctxB.newPage();
    await pageB.addInitScript(webInitScript('PersonB', '#f43f5e'));

    for (const [name, page] of [['Person A', pageA], ['Person B', pageB]]) {
      page.on('console', msg => {
        const text = msg.text();
        console.log(`[${name}] ${text}`);
      });
      page.on('pageerror', err => console.error(`[${name} Error]`, err));
    }

    console.log('[E2E Setup] Person A criando a sala como Master...');
    await pageA.goto(roomUrl);
    const btnA = pageA.locator('#green-room-join-btn');
    await btnA.waitFor({ state: 'visible', timeout: 10000 });
    await btnA.click();

    await waitHistorical(pageA, async () => {
      const rm = (await import('/js/entries/room-entry.js')).roomState.roomManager;
      return rm && rm.isMaster && rm.isInRoom;
    }, undefined, { timeout: 15000 });
    console.log('✅ Person A conectado como Master.');

    console.log('[E2E Setup] Person B entrando na sala...');
    await pageB.goto(roomUrl);
    const btnB = pageB.locator('#green-room-join-btn');
    await btnB.waitFor({ state: 'visible', timeout: 10000 });
    await btnB.click();

    // Aguarda 2 membros online em ambas as páginas
    for (const [name, page] of [['Person A', pageA], ['Person B', pageB]]) {
      await waitHistorical(page, async () => {
        const badge = document.getElementById('sidebar-members-count');
        return badge && badge.textContent.includes('2 online');
      }, undefined, { timeout: 25000 });
      console.log(`✅ ${name} confirmou 2 membros online!`);
    }

    // ETAPA 1: Person A começa a transmitir
    console.log('\n--- ETAPA 1: Person A começa a transmitir ---');
    await startDesktopStream(pageA, 'Counter-Strike 2');
    console.log('✅ Person A transmitindo!');

    console.log('Verificando se Person B recebe a transmissão de Person A...');
    const resAonB = await verifyStreamReceived(pageB, 'Person B');
    console.log('✅ Person B recebeu a transmissão de Person A!', resAonB);

    await safeScreenshot(pageB, 'step1_personB_watching_personA.png');

    // ETAPA 2: Enquanto Person A está transmitindo, Person B começa a transmitir também!
    console.log('\n--- ETAPA 2: Person B também começa a transmitir simultaneamente ---');
    await startWebStream(pageB);
    console.log('✅ Person B começou a transmitir localmente!');

    // Verifica se Person B vê AMBAS as transmissões: local + Person A
    const countCardsB = await pageB.evaluate(() => {
      const cards = document.querySelectorAll('#video-grid .video-card');
      return cards.length;
    });
    console.log(`[Person B] Cartões de vídeo visíveis no grid: ${countCardsB} (esperado: 2 - local-me + Person A)`);

    // ETAPA 3: Agora verifica se Person A recebe a transmissão de Person B!
    console.log('\n--- ETAPA 3: Verificando se Person A recebe a transmissão de Person B ---');
    let resBonA = null;
    try {
      resBonA = await verifyStreamReceived(pageA, 'Person A', 10000);
      console.log('✅ Person A recebeu a transmissão de Person B!', resBonA);
    } catch (e) {
      console.error('❌ FALHA: Person A NÃO recebeu a transmissão de Person B!', e.message);
      const gridInfoA = await pageA.evaluate(() => {
        const grid = document.getElementById('video-grid');
        const cards = Array.from(grid?.querySelectorAll('.video-card') || []);
        return cards.map(c => ({ id: c.id, html: c.outerHTML.slice(0, 200) }));
      });
      console.error('[Person A] Cards no grid:', JSON.stringify(gridInfoA, null, 2));
    }
    await safeScreenshot(pageA, 'step2_personA_view.png');
    await safeScreenshot(pageB, 'step2_personB_view.png');

    // ETAPA 4: Person A recarrega a página (F5/Reload)
    console.log('\n--- ETAPA 4: Person A dá refresh (F5) na página ---');
    await pageA.reload();
    console.log('[Person A] Página recarregada. Tentando entrar novamente...');
    const btnARejoin = pageA.locator('#green-room-join-btn');
    if (await btnARejoin.isVisible({ timeout: 5000 })) {
      await btnARejoin.click();
    }

    // Verifica se Person A volta a ver os membros da sala
    await pageA.waitForTimeout(4000);
    const membersAAfterReload = await pageA.evaluate(() => {
      const badge = document.getElementById('sidebar-members-count');
      const items = Array.from(document.querySelectorAll('#room-participants-list .participant-item'));
      return {
        badgeText: badge?.textContent || '',
        participantNames: items.map(el => el.textContent.trim())
      };
    });
    console.log('[Person A pós-refresh] Membros:', membersAAfterReload);

    const membersBAfterReload = await pageB.evaluate(() => {
      const badge = document.getElementById('sidebar-members-count');
      const items = Array.from(document.querySelectorAll('#room-participants-list .participant-item'));
      return {
        badgeText: badge?.textContent || '',
        participantNames: items.map(el => el.textContent.trim())
      };
    });
    console.log('[Person B após refresh de A] Membros:', membersBAfterReload);

    await safeScreenshot(pageA, 'step4_personA_after_refresh.png');
    await safeScreenshot(pageB, 'step4_personB_after_refresh.png');

  } catch (err) {
    console.error('❌ Erro no teste dual stream:', err);
  } finally {
    await browser.close();
    if (server) server.close();
  }
}

run();
