import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const PORT = 3048;

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
  const targetBase = process.argv.includes('--prod') ? 'https://seemygame.vercel.app' : null;
  let server = null;
  if (!targetBase) {
    server = await startServer();
    console.log(`[E2E] Servidor local ouvindo na porta ${PORT}`);
  } else {
    console.log(`[E2E] Executando teste diretamente contra o ambiente de PRODUÇÃO: ${targetBase}`);
  }

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-web-security'
    ]
  });

  const roomId = 'audit-green-' + Math.random().toString(36).substring(2, 8);
  const roomUrl = targetBase ? `${targetBase}/room.html?room=${roomId}` : `http://127.0.0.1:${PORT}/room.html?room=${roomId}`;
  console.log(`[E2E] URL da sala: ${roomUrl}`);

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.on('console', msg => console.log(`[Console] ${msg.text()}`));
    await page.addInitScript(mockScript('AudioTester'));
    await page.goto(roomUrl);

    console.log('\n--- 1. VERIFICAÇÃO DO MODAL DA GREEN ROOM ("Pronto para entrar?") ---');
    const modal = page.locator('#green-room-modal');
    await modal.waitFor({ state: 'visible', timeout: 10000 });
    const isModalVisible = await modal.isVisible();
    console.log(`Modal da Green Room visível: ${isModalVisible}`);
    if (!isModalVisible) throw new Error('Modal da Green Room não apareceu!');

    console.log('\n--- 2. VERIFICAÇÃO DO TESTE DE MICROFONE E VU METER EM TEMPO REAL ---');
    // Com --use-fake-device-for-media-stream, o microfone fake gera áudio senoidal
    // O VU meter deve receber sinal e ter largura maior que 0%
    console.log('Aguardando captação de áudio pelo VU meter...');
    await page.waitForFunction(() => {
      const vu = document.getElementById('green-room-vu-bar');
      if (!vu) return false;
      const width = parseFloat(vu.style.width || '0');
      return width > 0;
    }, { timeout: 10000 });

    const vuWidth = await page.evaluate(() => document.getElementById('green-room-vu-bar').style.width);
    console.log(`✅ VU Meter captando áudio ativamente no lobby! Largura: ${vuWidth}`);

    // Verifica status text
    await page.waitForFunction(() => {
      const status = document.getElementById('green-room-mic-status');
      return status && status.textContent.includes('captado');
    }, { timeout: 5000 });
    const statusText = await page.evaluate(() => document.getElementById('green-room-mic-status').textContent);
    console.log(`✅ Status do microfone: "${statusText}"`);

    console.log('\n--- 3. TESTE DE MUTE/UNMUTE NO LOBBY PRÉ-ENTRADA ---');
    const toggleBtn = page.locator('#green-room-toggle-mic-btn');
    await toggleBtn.click();
    console.log('Clicou no botão de mutar microfone...');

    await page.waitForFunction(() => {
      const btn = document.getElementById('green-room-toggle-mic-btn');
      const text = document.getElementById('green-room-mic-btn-text');
      const vu = document.getElementById('green-room-vu-bar');
      return btn.classList.contains('is-muted') && text.textContent.includes('Mutado') && vu.style.width === '0%';
    }, { timeout: 5000 });
    console.log('✅ Microfone mutado no lobby com sucesso (VU meter travado em 0% e botão com estilo mutado)!');

    // Desmuta novamente
    await toggleBtn.click();
    await page.waitForFunction(() => {
      const btn = document.getElementById('green-room-toggle-mic-btn');
      const text = document.getElementById('green-room-mic-btn-text');
      return !btn.classList.contains('is-muted') && text.textContent.includes('Ativo');
    }, { timeout: 5000 });
    console.log('✅ Microfone reativado no lobby com sucesso!');

    console.log('\n--- 4. TESTE DE SELEÇÃO DE DISPOSITIVOS E TESTE DE SOM ---');
    const micOptionsCount = await page.evaluate(() => {
      const select = document.getElementById('green-room-mic-select');
      return select ? select.options.length : 0;
    });
    console.log(`Dispositivos de microfone listados: ${micOptionsCount}`);
    if (micOptionsCount < 1) throw new Error('Seletor de microfone está vazio!');

    const testSpeakerBtn = page.locator('#green-room-test-speaker-btn');
    if (await testSpeakerBtn.isVisible()) {
      await testSpeakerBtn.click();
      console.log('✅ Botão "Testar Som" clicado e executado sem erros!');
    }

    console.log('\n--- 5. ENTRADA NA SALA E TRANSIÇÃO LIMPA ---');
    const joinBtn = page.locator('#green-room-join-btn');
    await joinBtn.click();
    await page.waitForFunction(() => {
      const m = document.getElementById('green-room-modal');
      return !m || m.style.display === 'none';
    }, { timeout: 5000 });
    console.log('✅ Modal da Green Room fechou e transferiu o controle para a sala com sucesso!');

    console.log('\n======================================================');
    console.log('🎉 TESTE DO MICROFONE NA TELA PRÉ-SALA CONCLUÍDO COM 100% DE SUCESSO!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Falha no teste do microfone da Green Room:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (server) server.close();
  }
}

run();
