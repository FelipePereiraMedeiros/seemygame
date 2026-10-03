import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const PORT = 3004;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const url = new URL(req.url, `http://localhost:${PORT}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';

      const filePath = path.normalize(path.join(root, pathname));
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
      if (err.code === 'EADDRINUSE') resolve(null);
      else reject(err);
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[E2E] Servidor ativo em http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

const mockDefaultUserScript = (color, label) => `
  try {
    localStorage.setItem('seemygame_terms_version', '1.1');
    localStorage.setItem('seemygame_terms_accepted', 'true');
    localStorage.removeItem('seemygame_user_name');
  } catch(e) {}

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  let frame = 0;
  function renderFrame() {
    frame++;
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = '${color}';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('🎮 STREAM TEST: ${label}', 50, 70);
    ctx.fillStyle = '#10b981';
    ctx.font = '22px monospace';
    ctx.fillText('FRAME ' + frame + ' - ' + new Date().toLocaleTimeString(), 50, 120);

    const bx = (frame * 8) % 1100 + 50;
    const by = 350 + Math.abs(Math.sin(frame * 0.08)) * -180;
    ctx.fillStyle = '${color}';
    ctx.beginPath();
    ctx.arc(bx, by, 30, 0, Math.PI * 2);
    ctx.fill();

    requestAnimationFrame(renderFrame);
  }
  requestAnimationFrame(renderFrame);

  const mockStream = canvas.captureStream(60);
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ac.createOscillator();
    const dest = ac.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    const audioTrack = dest.stream.getAudioTracks()[0];
    if (audioTrack) mockStream.addTrack(audioTrack);
  } catch (e) {}

  if (navigator.mediaDevices) {
    navigator.mediaDevices.getDisplayMedia = async () => mockStream;
  }
`;

async function runAudit() {
  console.log('================================================================');
  console.log('TESTE E2E: CAPTURA E REPRODUÇÃO DE ÁUDIO NO NAVEGADOR (WEB/WEB)');
  console.log('================================================================\n');

  console.log('[1/2] Iniciando servidor estático e navegadores Chrome...');
  const server = await startStaticServer();

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files',
      '--disable-web-security'
    ]
  });

  const roomId = 'audit-audio-' + Math.random().toString(36).substring(2, 8);
  const roomUrl = `http://localhost:${PORT}/room.html?room=${roomId}`;

  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const viewerContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  const hostPage = await hostContext.newPage();
  await hostPage.addInitScript(mockDefaultUserScript('#38bdf8', 'HOST'));
  await hostPage.goto(roomUrl);

  const viewerPage = await viewerContext.newPage();
  await viewerPage.addInitScript(mockDefaultUserScript('#f43f5e', 'VIEWER'));
  await viewerPage.goto(roomUrl);

  // Entrada Green Room
  for (const [name, page] of [['Host', hostPage], ['Viewer', viewerPage]]) {
    const btn = page.locator('#green-room-join-btn');
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    await btn.click();
    console.log(`  [E2E] ${name} entrou na sala.`);
  }

  // Aguarda confirmação de presença mútua dos 2 membros antes de iniciar transmissão
  await hostPage.waitForFunction(() => {
    const badge = document.getElementById('sidebar-members-count');
    return badge && badge.textContent.includes('2 online');
  }, { timeout: 20000 });
  console.log('  [E2E] 2 participantes confirmados online na sala.');

  // Verifica opções de áudio na interface web
  console.log('\n[2/2] Validando controles de áudio e transmissão P2P...');
  const audioOptions = await hostPage.evaluate(() => {
    const sel = document.getElementById('audio-mode-select');
    if (!sel) return [];
    return Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent.trim(), disabled: o.disabled }));
  });
  console.log('  Opções de modo de áudio no seletor web:', audioOptions);

  const processOption = audioOptions.find(o => o.value === 'process');
  if (processOption && processOption.disabled) {
    console.log('  ✓ Modo "Áudio da Janela" corretamente desabilitado no ambiente Web.');
  }

  // Inicia transmissão no Host
  const streamBtn = hostPage.locator('#dock-stream-btn');
  await streamBtn.waitFor({ state: 'visible' });
  await streamBtn.click();
  console.log('  [E2E] Host iniciou transmissão de tela com áudio.');

  // Viewer aguarda vídeo do Host
  const viewerVideo = viewerPage.locator('.video-card video');
  await viewerVideo.waitFor({ state: 'visible', timeout: 15000 });
  console.log('  [E2E] Viewer recebeu a transmissão com sucesso!');

  const tracksReceived = await viewerPage.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('.video-card video'));
    return videos.map(v => {
      const s = v.srcObject;
      return {
        videoTracks: s ? s.getVideoTracks().length : 0,
        audioTracks: s ? s.getAudioTracks().length : 0
      };
    });
  });
  console.log('  Trilhas recebidas pelo espectador:', tracksReceived);

  const hasAudio = tracksReceived.some(t => t.audioTracks > 0);
  const hasVideo = tracksReceived.some(t => t.videoTracks > 0);

  if (hasAudio && hasVideo) {
    console.log('\n================================================================');
    console.log('✓ TESTE E2E CONCLUÍDO COM SUCESSO: Áudio e vídeo sincronizados!');
    console.log('================================================================\n');
  } else {
    throw new Error('Falha: trilhas de áudio ou vídeo ausentes no espectador');
  }

  await browser.close();
  if (server) server.close();
}

runAudit().catch(err => {
  console.error('Falha no teste E2E:', err);
  process.exit(1);
});
