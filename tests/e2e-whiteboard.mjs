import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const PORT = 3045;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json'
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

async function run() {
  const server = await startServer();
  console.log(`[E2E] Servidor local ouvindo na porta ${PORT}`);

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox']
  });

  const page = await browser.newPage();
  const consoleMessages = [];
  page.on('console', msg => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => consoleMessages.push(`[PAGE_ERROR] ${err.message}`));

  try {
    // Injeta localStorage pré-configurado para pular termos e entrar direto na sala
    await page.addInitScript(() => {
      localStorage.setItem('seemygame_terms_version', '1.1');
      localStorage.setItem('seemygame_terms_accepted', 'true');
      localStorage.setItem('seemygame_user_name', 'HostTester');
    });

    console.log(`\n======================================================`);
    console.log(`[E2E CENÁRIO 1] Teste da Lousa na Sala (room.html)`);
    console.log(`======================================================`);

    await page.goto(`http://127.0.0.1:${PORT}/room.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Clica no botão Entrar na Sala (Green Room) se estiver visível
    const joinBtn = await page.$('#green-room-join-btn');
    if (joinBtn && await joinBtn.isVisible()) {
      console.log('[E2E] Clicando em #green-room-join-btn para entrar no stage...');
      await joinBtn.click();
      await page.waitForTimeout(800);
    }

    const modal = page.locator('#whiteboard-modal');
    const dockBtn = page.locator('#dock-whiteboard-btn');
    const toggleBtn = page.locator('#toggle-whiteboard-btn');
    const closeBtn = page.locator('#wb-close-btn');
    const canvas = page.locator('#whiteboard-canvas');

    // 1. Estado inicial
    const initialVisible = await modal.isVisible();
    console.log(`1. Estado inicial da lousa: visível=${initialVisible} (esperado: false)`);
    if (initialVisible) throw new Error('Lousa não deveria estar visível no início');

    // 2. Abrir via dock inferior
    console.log('2. Clicando em #dock-whiteboard-btn para abrir a lousa...');
    await dockBtn.click();
    await page.waitForTimeout(400);

    const isVisibleAfterDock = await modal.isVisible();
    console.log(`   Lousa visível após clique no dock: ${isVisibleAfterDock} (esperado: true)`);
    if (!isVisibleAfterDock) throw new Error('Lousa falhou em abrir após clique no dock inferior!');

    // 3. Desenhar na lousa
    console.log('3. Testando traço do mouse/caneta no canvas da lousa...');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas bounding box não encontrado');

    const startX = box.x + 100;
    const startY = box.y + 100;
    const endX = box.x + 300;
    const endY = box.y + 250;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 50, startY + 50, { steps: 5 });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const elementsCount = await page.evaluate(() => {
      const wbm = window.whiteboardManager || (window.__whiteboardManager);
      const canvasEl = document.getElementById('whiteboard-canvas');
      return {
        canvasWidth: canvasEl?.width,
        canvasHeight: canvasEl?.height,
        canvasHasListeners: typeof canvasEl?.onmousedown === 'function'
      };
    });
    console.log('   Canvas verificado:', elementsCount);

    // 4. Fechar via botão fechar da topbar da lousa (#wb-close-btn)
    console.log('4. Clicando em #wb-close-btn para fechar a lousa...');
    await closeBtn.click();
    await page.waitForTimeout(400);

    const isVisibleAfterClose = await modal.isVisible();
    console.log(`   Lousa visível após clicar em fechar: ${isVisibleAfterClose} (esperado: false)`);
    if (isVisibleAfterClose) throw new Error('Lousa falhou em fechar ao clicar em #wb-close-btn!');

    // 5. Abrir novamente pelo dock e fechar com tecla Escape
    console.log('5. Abrindo novamente via #dock-whiteboard-btn e fechando com Escape...');
    await dockBtn.click();
    await page.waitForTimeout(400);
    console.log(`   Lousa visível após abrir pelo dock: ${await modal.isVisible()} (esperado: true)`);
    if (!(await modal.isVisible())) throw new Error('Lousa falhou em reabrir pelo dock!');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    console.log(`   Lousa visível após pressionar Escape: ${await modal.isVisible()} (esperado: false)`);
    if (await modal.isVisible()) throw new Error('Lousa falhou em fechar com Escape!');

    // 6. Abrir via header (#toggle-whiteboard-btn)
    console.log('6. Abrindo via header #toggle-whiteboard-btn...');
    await toggleBtn.click();
    await page.waitForTimeout(400);
    console.log(`   Lousa visível após clique no header: ${await modal.isVisible()} (esperado: true)`);
    if (!(await modal.isVisible())) throw new Error('Lousa falhou em abrir pelo header!');

    await closeBtn.click();
    await page.waitForTimeout(400);
    console.log(`   Lousa fechada novamente: ${!(await modal.isVisible())} (esperado: true)`);

    console.log(`\n======================================================`);
    console.log(`[E2E CENÁRIO 2] Teste da Lousa no Streamer Clássico (streamer.html)`);
    console.log(`======================================================`);

    await page.goto(`http://127.0.0.1:${PORT}/streamer.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const streamerModal = page.locator('#whiteboard-modal');
    const streamerToggleBtn = page.locator('#toggle-whiteboard-btn');
    const streamerCloseBtn = page.locator('#wb-close-btn');

    console.log('1. Clicando em #toggle-whiteboard-btn no streamer.html...');
    await streamerToggleBtn.click();
    await page.waitForTimeout(400);

    const streamerModalVisible = await streamerModal.isVisible();
    console.log(`   Lousa visível no streamer.html: ${streamerModalVisible} (esperado: true)`);
    if (!streamerModalVisible) throw new Error('Lousa falhou em abrir no streamer.html!');

    console.log('2. Fechando com botão #wb-close-btn...');
    await streamerCloseBtn.click();
    await page.waitForTimeout(400);

    const streamerModalClosed = !(await streamerModal.isVisible());
    console.log(`   Lousa fechada no streamer.html: ${streamerModalClosed} (esperado: true)`);
    if (!streamerModalClosed) throw new Error('Lousa falhou em fechar via #wb-close-btn no streamer.html!');

    console.log(`\n======================================================`);
    console.log(`🎉 TESTE E2E DA LOUSA CONCLUÍDO COM 100% DE SUCESSO!`);
    console.log(`======================================================\n`);

  } catch (err) {
    console.error('\n❌ [E2E FALHA]:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

run();
