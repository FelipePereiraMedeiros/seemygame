import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchHistoricalBrowser, historicalArtifactDir, waitHistorical } from '../tools/e2e/harness/historical-browser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const PORT = 3006;
const ARTIFACT_DIR = historicalArtifactDir('tree-relay-benchmark');

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
        console.log(`[Relay Bench Server] Porta ${PORT} já em uso, reaproveitando.`);
        reject(err);
      } else {
        reject(err);
      }
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Relay Bench Server] Servidor ativo em http://localhost:${PORT}`);
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
    window._lastRenderedFrame = frame;
    window._lastRenderedTime = Date.now();
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

async function captureCdpScreenshot(page, filePath) {
  try {
    const client = await page.context().newCDPSession(page);
    const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    await client.detach();
  } catch (err) {
    console.warn(`[CDP Screenshot] Falha em ${path.basename(filePath)}:`, err.message);
  }
}

async function run() {
  console.log('================================================================');
  console.log('--- TESTE E2E: ÁRVORE DE RETRANSMISSÃO P2P (TREE RELAY MESH) ---');
  console.log('================================================================');
  const server = await startStaticServer();
  const roomId = 'bench-tree-' + Math.random().toString(36).substring(2, 8);
  const roomUrl = `http://localhost:${PORT}/room.html?room=${roomId}`;
  console.log(`[E2E] URL da sala: ${roomUrl}`);

  const browser = await launchHistoricalBrowser({
    channel: 'chrome',
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-web-security',
      '--allow-file-access-from-files'
    ]
  });

  try {
    // 1. Inicia Host
    const ctxHost = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageHost = await ctxHost.newPage();
    await pageHost.addInitScript(mockDefaultUserScript('#38bdf8', 'HOST'));
    pageHost.on('console', msg => console.log(`[Host Console] ${msg.text()}`));
    await pageHost.goto(roomUrl);

    // 2. Inicia Viewer 1 (Internet rápida: 20ms RTT)
    const ctxV1 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageV1 = await ctxV1.newPage();
    await pageV1.addInitScript(mockDefaultUserScript('#f43f5e', 'VIEWER_1 (Fast: 20ms)'));
    pageV1.on('console', msg => console.log(`[V1 Console] ${msg.text()}`));
    await pageV1.goto(roomUrl);

    // 3. Inicia Viewer 2 (Internet média: 65ms RTT)
    const ctxV2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageV2 = await ctxV2.newPage();
    await pageV2.addInitScript(mockDefaultUserScript('#a855f7', 'VIEWER_2 (Medium: 65ms)'));
    pageV2.on('console', msg => console.log(`[V2 Console] ${msg.text()}`));
    await pageV2.goto(roomUrl);

    // Entrada na Green Room
    for (const [name, page] of [['Host', pageHost], ['Viewer 1', pageV1], ['Viewer 2', pageV2]]) {
      const btn = page.locator('#green-room-join-btn');
      await btn.waitFor({ state: 'visible', timeout: 10000 });
      await btn.click();
      console.log(`[E2E] ${name} entrou na sala.`);
    }

    // Aguarda os 3 confirmarem presença
    await waitHistorical(pageHost, async () => {
      const badge = document.getElementById('sidebar-members-count');
      return badge && badge.textContent.includes('3 online');
    }, undefined, { timeout: 20000 });
    console.log('[E2E] 3 participantes confirmados na sala.');

    // Simula telemetria no Host: Viewer 1 tem RTT=20ms, Viewer 2 tem RTT=65ms
    const peerV1Id = await pageV1.evaluate(async () => (await import('/js/entries/room-entry.js')).roomState.roomManager?.myPeerId);
    const peerV2Id = await pageV2.evaluate(async () => (await import('/js/entries/room-entry.js')).roomState.roomManager?.myPeerId);
    console.log(`[E2E] Peer IDs: V1=${peerV1Id}, V2=${peerV2Id}`);

    // Inicia stream no Host
    console.log('[E2E] Host iniciando transmissão...');
    const streamBtn = pageHost.locator('#dock-stream-btn');
    await streamBtn.waitFor({ state: 'visible' });
    await streamBtn.click();

    // Informa telemetria de rede simulada para a árvore
    await pageHost.evaluate(async ({ v1, v2 }) => {
      if ((await import('/js/entries/room-entry.js')).roomState.relayManager) {
        (await import('/js/entries/room-entry.js')).roomState.relayManager.updateTelemetry(v1, { rtt: 20, packetLoss: 0 });
        (await import('/js/entries/room-entry.js')).roomState.relayManager.updateTelemetry(v2, { rtt: 65, packetLoss: 0 });
      }
    }, { v1: peerV1Id, v2: peerV2Id });

    // Confirma reprodução em V1 e V2
    for (const [name, page] of [['Viewer 1', pageV1], ['Viewer 2', pageV2]]) {
      const vid = page.locator('.video-card video');
      await vid.waitFor({ state: 'attached', timeout: 25000 });
      await waitHistorical(page, async () => {
        const v = document.querySelector('.video-card video');
        if (v && v.paused) v.play().catch(() => {});
        return Boolean(v && !v.paused && v.readyState >= 2 && v.videoWidth > 0);
      }, undefined, { timeout: 25000 });
      console.log(`✅ ${name} reproduzindo vídeo diretamente do Host!`);
    }

    // 4. Inicia Viewer 3 (3º espectador - Excede a cota de 2 diretos!)
    console.log('\n------------------------------------------------------------');
    console.log('[E2E] Ingressando Viewer 3 para testar ativação da Árvore P2P Relay...');
    console.log('------------------------------------------------------------');
    const ctxV3 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageV3 = await ctxV3.newPage();
    await pageV3.addInitScript(mockDefaultUserScript('#10b981', 'VIEWER_3 (Relayed)'));
    pageV3.on('console', msg => console.log(`[V3 Console] ${msg.text()}`));
    await pageV3.goto(roomUrl);
    await pageV3.locator('#green-room-join-btn').click();

    // Aguarda todos verem 4 membros online
    await waitHistorical(pageHost, async () => {
      const badge = document.getElementById('sidebar-members-count');
      return badge && badge.textContent.includes('4 online');
    }, undefined, { timeout: 25000 });
    console.log('[E2E] 4 membros online na sala.');

    const peerV3Id = await pageV3.evaluate(async () => (await import('/js/entries/room-entry.js')).roomState.roomManager?.myPeerId);
    console.log(`[E2E] Peer ID do Viewer 3: ${peerV3Id}`);

    // Verifica a decisão do algoritmo de árvore no Host
    const topology = await pageHost.evaluate(async () => {
      return (await import('/js/entries/room-entry.js')).roomState.relayManager.getTopology();
    });
    console.log('[E2E] Topologia da Árvore no Host:', JSON.stringify(topology, null, 2));

    const savings = await pageHost.evaluate(async () => {
      return (await import('/js/entries/room-entry.js')).roomState.relayManager.calculateBandwidthSavings(4500000);
    });
    console.log('[E2E] Economia calculada de upload no Host:', JSON.stringify(savings, null, 2));
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'observed-topology.json'), JSON.stringify({ topology, savings, v1: peerV1Id, v2: peerV2Id, v3: peerV3Id }, null, 2));
    assert.equal(topology?.relayedCount, 1, 'Third spectator must actually be relayed; decoded video alone does not prove relay');
    assert.equal(topology?.directCount, 2);
    assert.equal(topology?.relayed?.[0]?.parentPeerId, peerV1Id);

    // Aguarda o Viewer 3 receber a stream retransmitida e reproduzir
    console.log('[E2E] Aguardando Viewer 3 receber stream retransmitida...');
    const v3Video = pageV3.locator('.video-card video');
    await v3Video.waitFor({ state: 'attached', timeout: 35000 });
    await waitHistorical(pageV3, async () => {
      const v = document.querySelector('.video-card video');
      if (v && v.paused) v.play().catch(() => {});
      return Boolean(v && !v.paused && v.readyState >= 2 && v.videoWidth > 0);
    }, undefined, { timeout: 35000 });
    console.log('✅ Viewer 3 está reproduzindo com sucesso via Árvore P2P Relay!');

    // Inspeciona o card do Viewer 3 para verificar a identificação de Relay
    const v3CardInfo = await pageV3.evaluate(async () => {
      const card = document.querySelector('.video-card');
      const label = card?.querySelector('.streamer-name')?.textContent || '';
      return {
        cardId: card?.id,
        label,
        isRelayed: label.includes('Relay')
      };
    });
    console.log('[E2E] Informações do Card no Viewer 3:', v3CardInfo);

    // Separate video timelines cannot be subtracted to measure relay latency.
    const avgDelayMs = null;
    // Captura de Screenshots via CDP
    const shotHost = path.join(ARTIFACT_DIR, 'relay_audit_01_host.png');
    const shotV1 = path.join(ARTIFACT_DIR, 'relay_audit_02_v1_direct.png');
    const shotV2 = path.join(ARTIFACT_DIR, 'relay_audit_03_v2_direct.png');
    const shotV3 = path.join(ARTIFACT_DIR, 'relay_audit_04_v3_relayed.png');

    await captureCdpScreenshot(pageHost, shotHost);
    await captureCdpScreenshot(pageV1, shotV1);
    await captureCdpScreenshot(pageV2, shotV2);
    await captureCdpScreenshot(pageV3, shotV3);
    console.log('📸 Todos os screenshots de auditoria da árvore foram salvos!');

    // Consolidação do Relatório do Benchmark
    const finalReport = {
      timestamp: new Date().toISOString(),
      treeAlgorithmActivated: topology.relayedCount > 0,
      latencyMeasurement: "Not measured; requires an optical marker on the same source",
      activationThreshold: 'Exceder maxDirectViewers (2 espectadores)',
      electedParentPeerId: topology?.relayed?.[0]?.parentPeerId,
      electedParentExpected: peerV1Id,
      electedReason: 'Viewer 1 possuía menor RTT (20ms) que Viewer 2 (65ms)',
      savings: savings,
      additionalRelayDelayMs: avgDelayMs,
      v3CardInfo: v3CardInfo
    };

    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'relay_tree_benchmark_report.json'),
      JSON.stringify(finalReport, null, 2)
    );

    console.log('\n================================================================');
    console.log('🎉 SUCESSO TOTAL NO BENCHMARK DA ÁRVORE DE RELAY P2P!');
    console.log('================================================================');
    console.log(`- Algoritmo de Tree Ativou? SIM (ao conectar o 3º espectador)`);
    console.log(`- Quem foi eleito como pai? ${finalReport.electedParentPeerId} (Viewer 1, com RTT menor: 20ms)`);
    console.log(`- Economia de banda de upload no Host: ${savings?.percentSaved}% (${(savings?.savingsBps / 1000000).toFixed(1)} Mbps economizados)`);
    console.log(`- Delay Adicional no Espectador Relayed: ~${avgDelayMs} ms`);

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
