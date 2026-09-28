import { chromium } from 'playwright';

const BASE_URL = 'https://seemygame.vercel.app';

const mockScript = (name) => `
  try {
    localStorage.setItem('seemygame_terms_version', '1.1');
    localStorage.setItem('seemygame_terms_accepted', 'true');
    localStorage.setItem('seemygame_user_name', '${name}');
  } catch(e) {}

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  let frame = 0;
  setInterval(() => {
    frame++;
    ctx.fillStyle = (frame % 2 === 0) ? '#10b981' : '#3b82f6';
    ctx.fillRect(0, 0, 640, 360);
  }, 1000 / 30);
  const mockStream = canvas.captureStream(30);
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

async function runVercelLiveE2E() {
  console.log(`\n======================================================`);
  console.log(`[VERCEL LIVE E2E] Iniciando testes em ${BASE_URL}`);
  console.log(`======================================================\n`);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-web-security']
  });

  const roomId = 'prod-' + Math.random().toString(36).substring(2, 8);
  const roomUrl = `${BASE_URL}/room.html?room=${roomId}`;
  console.log(`[VERCEL LIVE] URL da sala de teste em produção: ${roomUrl}`);

  try {
    // 1. Criar contextos para Host, Viewer 1 e Viewer 2
    const ctxHost = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageHost = await ctxHost.newPage();
    pageHost.on('console', msg => console.log(`[Host Console] ${msg.text()}`));
    await pageHost.addInitScript(mockScript('Prod-Host'));
    await pageHost.goto(roomUrl);

    const ctxV1 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageV1 = await ctxV1.newPage();
    pageV1.on('console', msg => console.log(`[V1 Console] ${msg.text()}`));
    await pageV1.addInitScript(mockScript('Prod-Viewer1'));
    await pageV1.goto(roomUrl);

    const ctxV2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageV2 = await ctxV2.newPage();
    pageV2.on('console', msg => console.log(`[V2 Console] ${msg.text()}`));
    await pageV2.addInitScript(mockScript('Prod-Viewer2'));
    await pageV2.goto(roomUrl);

    // 2. Entrar no stage (Green Room)
    for (const [name, page] of [['Host', pageHost], ['Viewer 1', pageV1], ['Viewer 2', pageV2]]) {
      const btn = page.locator('#green-room-join-btn');
      await btn.waitFor({ state: 'visible', timeout: 15000 });
      await btn.click();
      console.log(`[VERCEL LIVE] ${name} clicou para entrar na sala.`);
    }

    // 3. Confirmar presença de 3 participantes online em produção
    console.log('[VERCEL LIVE] Aguardando presença de 3 participantes no sidebar...');
    for (const [name, page] of [['Host', pageHost], ['Viewer 1', pageV1], ['Viewer 2', pageV2]]) {
      await page.waitForFunction(() => {
        const badge = document.getElementById('sidebar-members-count');
        return badge && badge.textContent.includes('3 online');
      }, { timeout: 25000 });
      console.log(`[VERCEL LIVE] ${name} confirmou 3 participantes conectados na malha P2P!`);
    }

    // 4. Testar Lousa em Produção: Abertura simultânea
    console.log('\n--- TESTE 1: ABERTURA E SINCRONIZAÇÃO DA LOUSA EM PRODUÇÃO ---');
    for (const [name, page] of [['Host', pageHost], ['Viewer 1', pageV1], ['Viewer 2', pageV2]]) {
      const dockBtn = page.locator('#dock-whiteboard-btn');
      await dockBtn.waitFor({ state: 'visible' });
      await dockBtn.click();
      await page.waitForFunction(() => {
        const modal = document.getElementById('whiteboard-modal');
        return modal && modal.style.display === 'flex';
      }, { timeout: 8000 });
      console.log(`[VERCEL LIVE] Lousa aberta no ${name}.`);
    }

    // 5. Host desenha um retângulo azul
    console.log('[VERCEL LIVE] Host desenhando forma retangular...');
    await pageHost.evaluate(() => {
      window.whiteboardManager.addElement({
        id: 'prod-shape-host',
        type: 'rectangle',
        startX: 150,
        startY: 120,
        endX: 450,
        endY: 320,
        color: '#38bdf8',
        strokeWidth: 4,
        rough: false
      }, true);
    });

    // 6. Validar se Viewer 1 e Viewer 2 receberam o retângulo
    for (const [name, page] of [['Viewer 1', pageV1], ['Viewer 2', pageV2]]) {
      await page.waitForFunction(() => {
        return window.whiteboardManager.elements.some(el => el.id === 'prod-shape-host');
      }, { timeout: 15000 });
      console.log(`✅ [VERCEL LIVE] ${name} recebeu o traço do Host em tempo real!`);
    }

    // 7. Viewer 1 desenha um círculo vermelho
    console.log('[VERCEL LIVE] Viewer 1 desenhando círculo...');
    await pageV1.evaluate(() => {
      window.whiteboardManager.addElement({
        id: 'prod-shape-v1',
        type: 'circle',
        startX: 500,
        startY: 200,
        endX: 700,
        endY: 400,
        color: '#f43f5e',
        strokeWidth: 4,
        rough: false
      }, true);
    });

    // 8. Validar se Host e Viewer 2 receberam o círculo
    for (const [name, page] of [['Host', pageHost], ['Viewer 2', pageV2]]) {
      await page.waitForFunction(() => {
        return window.whiteboardManager.elements.some(el => el.id === 'prod-shape-v1');
      }, { timeout: 15000 });
      console.log(`✅ [VERCEL LIVE] ${name} recebeu o traço do Viewer 1 em tempo real!`);
    }

    // 9. Testar os botões de retorno para a sala
    console.log('\n--- TESTE 2: RETORNO DA LOUSA PARA A SALA ---');
    console.log('[VERCEL LIVE] Testando saída da lousa via botão flutuante no Host...');
    await pageHost.locator('#wb-floating-close-btn').click();
    await pageHost.waitForFunction(() => {
      const modal = document.getElementById('whiteboard-modal');
      return modal && modal.style.display === 'none';
    }, { timeout: 5000 });
    console.log('✅ [VERCEL LIVE] Host retornou para a sala com sucesso via #wb-floating-close-btn!');

    console.log('[VERCEL LIVE] Testando saída da lousa via botão pill no Viewer 1...');
    await pageV1.locator('#wb-back-room-btn').click();
    await pageV1.waitForFunction(() => {
      const modal = document.getElementById('whiteboard-modal');
      return modal && modal.style.display === 'none';
    }, { timeout: 5000 });
    console.log('✅ [VERCEL LIVE] Viewer 1 retornou para a sala com sucesso via #wb-back-room-btn!');

    console.log('[VERCEL LIVE] Testando saída da lousa via botão de fechar no Viewer 2...');
    await pageV2.locator('#wb-close-btn').click();
    await pageV2.waitForFunction(() => {
      const modal = document.getElementById('whiteboard-modal');
      return modal && modal.style.display === 'none';
    }, { timeout: 5000 });
    console.log('✅ [VERCEL LIVE] Viewer 2 retornou para a sala com sucesso via #wb-close-btn!');

    // 10. Testar Streaming de Vídeo ao Vivo no Vercel (Host transmite tela para Viewer 1 e Viewer 2)
    console.log('\n--- TESTE 3: TRANSMISSÃO DE VÍDEO WEBRTC AO VIVO NO VERCEL ---');
    console.log('[VERCEL LIVE] Host iniciando transmissão de tela...');
    const streamBtn = pageHost.locator('#dock-stream-btn');
    await streamBtn.waitFor({ state: 'visible' });
    await streamBtn.click();

    console.log('[VERCEL LIVE] Verificando se Viewer 1 e Viewer 2 recebem e reproduzem o stream em produção...');
    for (const [name, page] of [['Viewer 1', pageV1], ['Viewer 2', pageV2]]) {
      await page.waitForFunction(() => {
        const videos = Array.from(document.querySelectorAll('video'));
        const playingVideo = videos.find(v => !v.paused && v.readyState >= 2 && v.videoWidth > 0);
        return Boolean(playingVideo);
      }, { timeout: 30000 });
      console.log(`✅ [VERCEL LIVE] ${name} está reproduzindo o stream de vídeo do Host com sucesso!`);
    }

    console.log(`\n======================================================`);
    console.log(`🎉 TESTES NO DEPLOY DE PRODUÇÃO (VERCEL) CONCLUÍDOS COM 100% DE SUCESSO!`);
    console.log(`URL Testada: ${roomUrl}`);
    console.log(`======================================================\n`);
  } catch (err) {
    console.error('❌ [VERCEL LIVE] Falha no teste em produção:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runVercelLiveE2E();
