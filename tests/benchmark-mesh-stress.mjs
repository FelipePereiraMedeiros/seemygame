import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const PORT = 3005;
const ARTIFACT_DIR = 'C:\\Users\\diogo\\.gemini\\antigravity\\brain\\1dcd93eb-1e09-4570-856b-4ee876bf9f9b';

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

function startStaticServer() {
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
        res.end('Acesso negado');
        return;
      }

      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Arquivo não encontrado: ' + pathname);
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
      });
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[Bench Server] Porta ${PORT} já em uso, reaproveitando.`);
        resolve(null);
      } else {
        reject(err);
      }
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Bench Server] Servidor de benchmark ativo em http://localhost:${PORT}`);
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
  window._testFrame = 0;
  function renderFrame() {
    frame++;
    window._testFrame = frame;
    window._testTimestamp = Date.now();
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = '${color}';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('🎮 BENCHMARK STREAM: ${label}', 50, 70);
    ctx.fillStyle = '#10b981';
    ctx.font = '24px monospace';
    ctx.fillText('FRAME ' + frame + ' - TS: ' + window._testTimestamp, 50, 120);

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

async function measureHostStats(pageHost) {
  return await pageHost.evaluate(async () => {
    let totalBytesSent = 0;
    let peerCount = 0;
    let outboundFps = 0;
    const peerStats = [];

    if (window.activeMediaCalls) {
      for (const [peerId, call] of window.activeMediaCalls.entries()) {
        if (call.peerConnection && call.peerConnection.connectionState !== 'closed') {
          peerCount++;
          try {
            const stats = await call.peerConnection.getStats();
            stats.forEach(r => {
              if (r.type === 'outbound-rtp' && r.kind === 'video') {
                if (r.bytesSent) totalBytesSent += r.bytesSent;
                if (r.framesPerSecond) outboundFps = r.framesPerSecond;
                peerStats.push({
                  peerId,
                  bytesSent: r.bytesSent,
                  fps: r.framesPerSecond,
                  framesEncoded: r.framesEncoded
                });
              }
            });
          } catch(e) {}
        }
      }
    }

    return {
      activeCallsCount: peerCount,
      totalBytesSent,
      outboundFps,
      peerStats,
      targetBitrateBps: window.customBitrateBps || null,
      abrEnabled: window.adaptiveBitrateController?.isEnabled ?? null,
      canvasFrame: window._testFrame || 0
    };
  });
}

async function measureViewerStats(pageViewer, label) {
  return await pageViewer.evaluate(async (lbl) => {
    let bytesReceived = 0;
    let fps = 0;
    let readyState = 0;
    let videoWidth = 0;
    let rtt = null;
    let jitterBufferDelayMs = null;

    const vid = document.querySelector('.video-card video');
    if (vid) {
      readyState = vid.readyState;
      videoWidth = vid.videoWidth;
    }

    if (window.activeMediaCalls) {
      for (const [peerId, call] of window.activeMediaCalls.entries()) {
        if (call.peerConnection) {
          try {
            const stats = await call.peerConnection.getStats();
            stats.forEach(r => {
              if (r.type === 'inbound-rtp' && r.kind === 'video') {
                if (r.bytesReceived) bytesReceived = r.bytesReceived;
                if (r.framesPerSecond) fps = r.framesPerSecond;
              }
              if (r.type === 'candidate-pair' && (r.nominated || r.selected)) {
                if (r.currentRoundTripTime) rtt = Math.round(r.currentRoundTripTime * 1000);
              }
            });
          } catch(e) {}
        }
      }
    }

    return {
      label: lbl,
      fps,
      bytesReceived,
      rtt,
      readyState,
      videoWidth,
      paused: vid ? vid.paused : true
    };
  }, label);
}

async function run() {
  console.log('================================================================');
  console.log('--- INICIANDO BENCHMARK E2E DE ESCALABILIDADE DE ESPECTADORES ---');
  console.log('================================================================');
  const server = await startStaticServer();
  const roomId = 'bench-scale-' + Math.random().toString(36).substring(2, 8);
  const roomUrl = `http://localhost:${PORT}/room.html?room=${roomId}`;

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-web-security',
      '--allow-file-access-from-files'
    ]
  });

  const benchmarkResults = [];

  try {
    // 1. Inicia Host
    console.log('[Bench] Iniciando Host...');
    const ctxHost = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageHost = await ctxHost.newPage();
    await pageHost.addInitScript(mockDefaultUserScript('#38bdf8', 'HOST'));
    pageHost.on('console', msg => {
      const text = msg.text();
      if (text.includes('[FPS Target]') || text.includes('Chamada') || text.includes('Bitrate')) {
        console.log(`[Host] ${text}`);
      }
    });
    await pageHost.goto(roomUrl);
    await pageHost.locator('#green-room-join-btn').click();
    console.log('[Bench] Host entrou na sala.');

    // Host inicia transmissão
    console.log('[Bench] Host iniciando transmissão de vídeo...');
    const streamBtn = pageHost.locator('#dock-stream-btn');
    await streamBtn.waitFor({ state: 'visible' });
    await streamBtn.click();
    await new Promise(r => setTimeout(r, 2000));

    // Array de espectadores dinâmicos
    const viewers = [];
    const colors = ['#f43f5e', '#a855f7', '#10b981', '#f59e0b'];

    // Loop incremental de 1 até 4 espectadores
    for (let i = 1; i <= 4; i++) {
      console.log(`\n------------------------------------------------------------`);
      console.log(`>>> ESCALANDO PARA ${i} ESPECTADOR(ES) SIMULTÂNEO(S)... <<<`);
      console.log(`------------------------------------------------------------`);

      const vCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const vPage = await vCtx.newPage();
      const label = `VIEWER_${i}`;
      await vPage.addInitScript(mockDefaultUserScript(colors[i - 1], label));
      await vPage.goto(roomUrl);
      await vPage.locator('#green-room-join-btn').click();
      viewers.push({ id: i, label, ctx: vCtx, page: vPage });

      // Aguarda todos verem a quantidade certa na sala
      const expectedMembers = i + 1; // 1 host + i viewers
      await pageHost.waitForFunction((count) => {
        const badge = document.getElementById('sidebar-members-count');
        return badge && badge.textContent.includes(`${count} online`);
      }, expectedMembers, { timeout: 25000 });
      console.log(`[Bench] Sala sincronizada com ${expectedMembers} membros.`);

      // Aguarda o novo espectador receber e começar a reproduzir o stream
      console.log(`[Bench] Aguardando reprodução no ${label}...`);
      const vVideo = vPage.locator('.video-card video');
      await vVideo.waitFor({ state: 'attached', timeout: 25000 });
      await vPage.waitForFunction(() => {
        const vid = document.querySelector('.video-card video');
        if (vid && vid.paused) vid.play().catch(() => {});
        return Boolean(vid && !vid.paused && vid.readyState >= 2 && vid.videoWidth > 0);
      }, { timeout: 25000 });
      console.log(`[Bench] ✅ ${label} reproduzindo com sucesso!`);

      // Deixa o streaming estabilizar por 4 segundos para coletar métricas reais
      console.log(`[Bench] Estabilizando medição por 4 segundos...`);
      const t0Host = await measureHostStats(pageHost);
      const t0Viewers = await Promise.all(viewers.map(v => measureViewerStats(v.page, v.label)));
      await new Promise(r => setTimeout(r, 4000));
      const t1Host = await measureHostStats(pageHost);
      const t1Viewers = await Promise.all(viewers.map(v => measureViewerStats(v.page, v.label)));

      // Calcula bitrate de upload do Host (total bytes enviados / tempo)
      const dHostBytes = t1Host.totalBytesSent - t0Host.totalBytesSent;
      const hostUploadMbps = ((dHostBytes * 8) / 4 / 1000000).toFixed(2);

      // Bitrates de download dos viewers
      const viewerMetrics = viewers.map((v, idx) => {
        const dBytes = t1Viewers[idx].bytesReceived - t0Viewers[idx].bytesReceived;
        const mbps = ((dBytes * 8) / 4 / 1000000).toFixed(2);
        return {
          label: v.label,
          downloadMbps: parseFloat(mbps) || 0,
          fps: t1Viewers[idx].fps,
          rtt: t1Viewers[idx].rtt,
          videoWidth: t1Viewers[idx].videoWidth,
          readyState: t1Viewers[idx].readyState
        };
      });

      const stepResult = {
        viewerCount: i,
        activeCalls: t1Host.activeCallsCount,
        hostUploadMbps: parseFloat(hostUploadMbps) || 0,
        hostTargetBitrateMbps: t1Host.targetBitrateBps ? (t1Host.targetBitrateBps / 1000000).toFixed(1) : 'N/A',
        hostFps: t1Host.outboundFps,
        viewers: viewerMetrics
      };

      benchmarkResults.push(stepResult);

      console.log(`\n📊 [MÉTRICAS DO DEGRAU - ${i} ESPECTADOR(ES)]:`);
      console.log(`   - Upload Total do Host: ${stepResult.hostUploadMbps} Mbps (Alvo ABR: ${stepResult.hostTargetBitrateMbps} Mbps)`);
      console.log(`   - Chamadas WebRTC ativas do Host: ${stepResult.activeCalls}`);
      console.log(`   - FPS de Saída do Host: ${stepResult.hostFps} FPS`);
      viewerMetrics.forEach(vm => {
        console.log(`   - ${vm.label}: Download=${vm.downloadMbps} Mbps | FPS=${vm.fps} | RTT=${vm.rtt}ms`);
      });
    }

    console.log('\n================================================================');
    console.log('--- RELATÓRIO CONSOLIDADO DO ESTRESSE SOB CARGA FULL-MESH ---');
    console.log('================================================================');
    console.table(benchmarkResults.map(r => ({
      Espectadores: r.viewerCount,
      'Upload Host (Mbps)': r.hostUploadMbps,
      'Alvo ABR (Mbps)': r.hostTargetBitrateMbps,
      'FPS Host': r.hostFps,
      'Avg Viewer FPS': (r.viewers.reduce((acc, v) => acc + v.fps, 0) / r.viewers.length).toFixed(1),
      'Total Bitrate Consumido': r.viewers.reduce((acc, v) => acc + v.downloadMbps, 0).toFixed(2) + ' Mbps'
    })));

    // Salva JSON das métricas
    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'benchmark_mesh_results.json'),
      JSON.stringify(benchmarkResults, null, 2)
    );
    console.log('\n[Bench] Métricas salvas em benchmark_mesh_results.json');

  } catch (err) {
    console.error('❌ ERRO NO BENCHMARK:', err);
    throw err;
  } finally {
    await browser.close();
    if (server) server.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
