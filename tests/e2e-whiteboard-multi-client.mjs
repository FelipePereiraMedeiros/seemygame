import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const PORT = 3046;

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
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
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
          res.writeHead(404);
          res.end('Not found: ' + pathname);
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const mockScript = (name) => `
  try {
    localStorage.setItem('seemygame_terms_version', '1.1');
    localStorage.setItem('seemygame_terms_accepted', 'true');
    localStorage.setItem('seemygame_user_name', '${name}');
  } catch(e) {}
`;

async function run() {
  const server = await startServer();
  console.log(`[E2E] Servidor para teste de lousa multi-cliente ouvindo na porta ${PORT}`);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-web-security']
  });

  const roomId = 'audit-wb-' + Math.random().toString(36).substring(2, 8);
  const roomUrl = `http://127.0.0.1:${PORT}/room.html?room=${roomId}`;
  console.log(`[E2E] Sala: ${roomUrl}`);

  try {
    // 3 Participantes: Host, Viewer 1, Viewer 2
    const ctxHost = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageHost = await ctxHost.newPage();
    pageHost.on('console', msg => console.log(`[Host Console] ${msg.text()}`));
    pageHost.on('pageerror', err => console.log(`[Host Error] ${err.stack || err.message}`));
    await pageHost.addInitScript(mockScript('Host'));
    await pageHost.goto(roomUrl);

    const ctxV1 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageV1 = await ctxV1.newPage();
    pageV1.on('console', msg => console.log(`[V1 Console] ${msg.text()}`));
    pageV1.on('pageerror', err => console.log(`[V1 Error] ${err.stack || err.message}`));
    await pageV1.addInitScript(mockScript('Viewer1'));
    await pageV1.goto(roomUrl);

    const ctxV2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageV2 = await ctxV2.newPage();
    pageV2.on('console', msg => console.log(`[V2 Console] ${msg.text()}`));
    pageV2.on('pageerror', err => console.log(`[V2 Error] ${err.stack || err.message}`));
    await pageV2.addInitScript(mockScript('Viewer2'));
    await pageV2.goto(roomUrl);

    // Entra na Green Room
    for (const [name, page] of [['Host', pageHost], ['Viewer 1', pageV1], ['Viewer 2', pageV2]]) {
      const btn = page.locator('#green-room-join-btn');
      await btn.waitFor({ state: 'visible', timeout: 10000 });
      await btn.click();
      console.log(`[E2E] ${name} entrou na sala.`);
    }

    // Aguarda todos verem 3 online
    console.log('[E2E] Aguardando confirmação de 3 membros online...');
    for (const page of [pageHost, pageV1, pageV2]) {
      await page.waitForFunction(() => {
        const badge = document.getElementById('sidebar-members-count');
        return badge && badge.textContent.includes('3 online');
      }, { timeout: 20000 });
    }
    console.log('[E2E] Todos os 3 membros confirmados online!');

    // Todos abrem a lousa
    console.log('[E2E] Todos os 3 membros abrindo a lousa via dock...');
    for (const page of [pageHost, pageV1, pageV2]) {
      const dockBtn = page.locator('#dock-whiteboard-btn');
      await dockBtn.waitFor({ state: 'visible' });
      await dockBtn.click();
      await page.waitForFunction(() => {
        const modal = document.getElementById('whiteboard-modal');
        return modal && modal.style.display === 'flex';
      }, { timeout: 5000 });
    }
    console.log('[E2E] Lousa aberta nos 3 clientes simultaneamente.');

    // 1. Host desenha um elemento na lousa
    console.log('[E2E] Host adicionando elemento de desenho (retângulo)...');
    const diag = await pageHost.evaluate(() => {
      const rm = window.roomManager;
      const wbm = window.whiteboardManager;
      return {
        hasWbm: Boolean(wbm),
        hasOnElementCreated: typeof wbm?.onElementCreated === 'function',
        isMaster: rm?.isMaster,
        meshSize: rm?.meshConnections?.size,
        meshPeers: Array.from(rm?.meshConnections?.entries() || []).map(([k, v]) => ({ peer: k, open: v?.open })),
        authPeers: Array.from(rm?.authenticatedPeers || [])
      };
    });
    console.log('[E2E Host Diag]:', JSON.stringify(diag));

    await pageHost.evaluate(() => {
      window.whiteboardManager.addElement({
        id: 'host-shape-1',
        type: 'rectangle',
        startX: 200,
        startY: 150,
        endX: 500,
        endY: 350,
        color: '#38bdf8',
        strokeWidth: 3,
        rough: false
      }, true);
    });

    // 2. Verifica se Viewer 1 e Viewer 2 receberam o desenho do Host
    console.log('[E2E] Verificando se Viewer 1 e Viewer 2 receberam o retângulo do Host...');
    for (const [name, page] of [['Viewer 1', pageV1], ['Viewer 2', pageV2]]) {
      await page.waitForFunction(() => {
        return window.whiteboardManager.elements.some(el => el.id === 'host-shape-1');
      }, { timeout: 10000 });
      console.log(`✅ ${name} recebeu o desenho do Host com sucesso!`);
    }

    // 3. Viewer 1 desenha um elemento
    console.log('[E2E] Viewer 1 desenhando círculo...');
    await pageV1.evaluate(() => {
      window.whiteboardManager.addElement({
        id: 'v1-shape-2',
        type: 'circle',
        startX: 520,
        startY: 220,
        endX: 680,
        endY: 380,
        color: '#f43f5e',
        strokeWidth: 4,
        rough: false
      }, true);
    });

    // 4. Verifica se Host e Viewer 2 receberam o desenho do Viewer 1
    console.log('[E2E] Verificando se Host e Viewer 2 receberam o círculo do Viewer 1...');
    for (const [name, page] of [['Host', pageHost], ['Viewer 2', pageV2]]) {
      await page.waitForFunction(() => {
        return window.whiteboardManager.elements.some(el => el.id === 'v1-shape-2');
      }, { timeout: 10000 });
      console.log(`✅ ${name} recebeu o desenho do Viewer 1 com sucesso!`);
    }

    // 5. Todos os 3 clientes têm exatamente os mesmos 2 elementos
    for (const [name, page] of [['Host', pageHost], ['Viewer 1', pageV1], ['Viewer 2', pageV2]]) {
      const count = await page.evaluate(() => window.whiteboardManager.elements.length);
      if (count !== 2) throw new Error(`${name} possui ${count} elementos em vez de 2!`);
      console.log(`✅ ${name} possui 2/2 elementos sincronizados perfeitamente.`);
    }

    // 6. Testar retorno para a sala em todos os clientes
    console.log('[E2E] Fechando a lousa e retornando para a sala em todos os clientes...');
    await pageHost.locator('#wb-back-room-btn').click();
    await pageV1.locator('#wb-floating-close-btn').click();
    await pageV2.locator('#wb-close-btn').click();

    for (const [name, page] of [['Host', pageHost], ['Viewer 1', pageV1], ['Viewer 2', pageV2]]) {
      await page.waitForFunction(() => {
        const modal = document.getElementById('whiteboard-modal');
        return modal && modal.style.display === 'none';
      }, { timeout: 5000 });
      console.log(`✅ ${name} retornou para a sala com sucesso!`);
    }

    console.log('\n🎉 TESTE DE SINCRONIZAÇÃO MULTI-CLIENTE DA LOUSA CONCLUÍDO COM 100% DE SUCESSO!\n');
  } catch (err) {
    console.error('❌ Falha no teste da lousa multi-cliente:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

run();
