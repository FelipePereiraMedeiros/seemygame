import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { listFrontendFiles } from '../tools/e2e/harness/provenance.mjs';
import { fileURLToPath } from 'node:url';
import { launchHistoricalBrowser, historicalArtifactDir, waitHistorical } from '../tools/e2e/harness/historical-browser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const PORT = 3010;
const deliveryOnly = process.argv.includes('--delivery-only');
const replayEnabled = !process.argv.includes('--no-replay');
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const replayCase = option('--replay-case', replayEnabled ? 'viewers' : 'none');
const replayProfile = option('--replay-profile', 'source');
const replayCodec = option('--replay-codec', 'auto');
const sampleSeconds = Number(option('--sample-seconds', '8'));
const warmupSeconds = Number(option('--warmup-seconds', '8'));
const historySeconds = Number(option('--replay-history', '30'));
assert.ok(historySeconds >= 5 && historySeconds <= 120);
const clipCheck = process.argv.includes('--clip-check');
const ffprobe = process.env.SEEMYGAME_FFPROBE || 'ffprobe';
if (clipCheck) {
  try { execFileSync(ffprobe, ['-version'], { stdio: 'ignore', windowsHide: true, timeout: 10000 }); }
  catch (cause) { throw new Error('O teste de clipes exige ffprobe funcional. Configure SEEMYGAME_FFPROBE com o caminho do executável correto.', { cause }); }
}
assert.ok(['none', 'host', 'viewers', 'both'].includes(replayCase));
assert.ok(['source', 'balanced', 'light'].includes(replayProfile));
assert.ok(['auto', 'vp8', 'vp9', 'h264'].includes(replayCodec));
assert.ok(sampleSeconds >= 5 && sampleSeconds <= 120 && warmupSeconds >= 1 && warmupSeconds <= 120);
const viewerOption = process.argv.indexOf('--viewers');
const viewerCount = Number(viewerOption < 0 ? 3 : process.argv[viewerOption + 1]);
assert.ok(Number.isInteger(viewerCount) && viewerCount >= 1 && viewerCount <= 3, '--viewers must be 1..3');
assert.ok(deliveryOnly || viewerCount === 3, 'The relay scenario requires three spectators');
const ARTIFACT_DIR = historicalArtifactDir('720p-tree-benchmark');

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
        console.log(`[720p Server] Porta ${PORT} em uso, reaproveitando.`);
        reject(err);
      } else {
        reject(err);
      }
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[720p Server] Servidor ativo em http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

const mockHost720pScript = (color, label) => `
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
  let lastFrameTime = null;
  window.__historicalSourceFrames = 0;
  function renderFrame(now) {
    requestAnimationFrame(renderFrame);
    if (lastFrameTime === null) lastFrameTime = now - 1000 / 60;
    if (now - lastFrameTime < 1000 / 60) return;
    lastFrameTime += Math.floor((now - lastFrameTime) / (1000 / 60)) * (1000 / 60);
    frame++;
    window.__historicalSourceFrames = frame;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 1280, 720);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = 0; x < 1280; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 720);
      ctx.stroke();
    }
    for (let y = 0; y < 720; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1280, y);
      ctx.stroke();
    }

    ctx.fillStyle = '${color}';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('🎮 720p60 STREAM: ${label}', 50, 70);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '22px monospace';
    ctx.fillText('FONTE: 1280x720 | CADÊNCIA SOLICITADA: 60 FPS', 50, 120);

    ctx.fillStyle = '#10b981';
    ctx.font = '20px monospace';
    ctx.fillText('FRAME ' + frame + ' - ' + new Date().toLocaleTimeString(), 50, 160);

    const bx = (frame * 10) % 1160 + 60;
    const by = 420 + Math.abs(Math.sin(frame * 0.08)) * -200;
    ctx.fillStyle = '${color}';
    ctx.beginPath();
    ctx.arc(bx, by, 32, 0, Math.PI * 2);
    ctx.fill();

  }
  requestAnimationFrame(renderFrame);

  const mockStream = canvas.captureStream(60);
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    window.__historicalSourceAudio = ac;
    document.addEventListener('click', () => ac.resume(), { once: true });
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

const mockViewerScript = () => `
  try {
    localStorage.setItem('seemygame_terms_version', '1.1');
    localStorage.setItem('seemygame_terms_accepted', 'true');
    localStorage.removeItem('seemygame_user_name');
  } catch(e) {}
`;

async function captureScreenshotFast(page, filePath) {
  try {
    await page.screenshot({ path: filePath, timeout: 5000 });
    console.log(`[Screenshot] Salvo: ${path.basename(filePath)}`);
  } catch (err) {
    try {
      const client = await page.context().newCDPSession(page);
      const { data } = await Promise.race([
        client.send('Page.captureScreenshot', { format: 'png' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
      ]);
      fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
      await client.detach();
      console.log(`[Screenshot CDP] Salvo: ${path.basename(filePath)}`);
    } catch (err2) {
      console.warn(`[Screenshot] Falha em ${path.basename(filePath)}:`, err2.message);
    }
  }
}

async function run() {
  console.log('========================================================================');
  console.log(deliveryOnly ? '--- E2E: ENTREGA 720p, SEM VALIDAR RELAY ---' : '--- E2E: ENTREGA 720p E ÁRVORE DE RELAY ---');
  console.log('========================================================================');

  const server = await startStaticServer();
  const roomId = 'bench-720p-' + Math.random().toString(36).substring(2, 8);
  const roomUrl = `http://localhost:${PORT}/room.html?room=${roomId}`;
  console.log(`[720p E2E] URL da sala: ${roomUrl}`);

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
    // 1. Inicializa Host em 720p (Preset 'ultra' = 1280x720 @ 60 FPS, 4.5 Mbps)
    console.log('[720p E2E] Iniciando Host...');
    const ctxHost = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageHost = await ctxHost.newPage();
    await pageHost.addInitScript(mockHost720pScript('#38bdf8', 'HOST 720p'));
    pageHost.on('console', msg => {
      const text = msg.text();
      if (text.includes('[FPS Target]') || text.includes('RelayTree') || text.includes('Bitrate') || text.includes('STREAM_CONFIG')) {
        console.log(`[Host Console] ${text}`);
      }
    });
    await pageHost.goto(roomUrl);

    // Ajusta Preset para 'ultra' (720p @ 60 FPS, 4.5 Mbps)
    await pageHost.evaluate(async () => {
      const select = document.getElementById('quality-preset');
      if (select) {
        select.value = 'ultra';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // 2. Inicializa Viewer 1 (Peer Direto Rápido - 20ms RTT)
    const ctxV1 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageV1 = await ctxV1.newPage();
    await pageV1.addInitScript(mockViewerScript());
    pageV1.on('console', msg => {
      const text = msg.text();
      if (text.includes('Relay') || text.includes('Stream remoto')) console.log(`[V1 Console] ${text}`);
    });
    await pageV1.goto(roomUrl);

    // 3. Inicializa Viewer 2 (Peer Direto Médio - 55ms RTT)
    const ctxV2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageV2 = await ctxV2.newPage();
    await pageV2.addInitScript(mockViewerScript());
    pageV2.on('console', msg => {
      const text = msg.text();
      if (text.includes('Relay') || text.includes('Stream remoto')) console.log(`[V2 Console] ${text}`);
    });
    await pageV2.goto(roomUrl);

    // 4. Inicializa Viewer 3 (Espectador que excederá a cota de 2 diretos e será Relayed)
    const ctxV3 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageV3 = await ctxV3.newPage();
    await pageV3.addInitScript(mockViewerScript());
    pageV3.on('console', msg => {
      const text = msg.text();
      if (text.includes('Relay') || text.includes('Stream remoto')) console.log(`[V3 Console] ${text}`);
    });
    await pageV3.goto(roomUrl);

    // Entrada pela Green Room para todos os 4 participantes
    const participants = [
      { name: 'Host', page: pageHost },
      { name: 'Viewer 1', page: pageV1 },
      { name: 'Viewer 2', page: pageV2 },
      { name: 'Viewer 3', page: pageV3 }
    ].slice(0, viewerCount + 1);

    for (const p of participants) {
      const btn = p.page.locator('#green-room-join-btn');
      await btn.waitFor({ state: 'visible', timeout: 15000 });
      await btn.click();
      console.log(`[720p E2E] ${p.name} entrou na sala.`);
    }
    for (const { page, name } of participants) await page.evaluate(async config => {
      const recorder = (await import('/js/entries/room-entry.js')).roomState.features.clipping.recorder;
      recorder.setMaxDurationSeconds(config.historySeconds);
      recorder.setPreferences(config);
    }, { enabled: name === 'Host' ? ['host', 'both'].includes(replayCase) : ['viewers', 'both'].includes(replayCase),
      recordLocal: true, profile: replayProfile, codec: replayCodec, historySeconds });

    // Aguarda todos os 4 confirmarem "4 online"
    console.log(`[720p E2E] Aguardando presença dos ${viewerCount + 1} participantes sincronizada...`);
    for (const p of participants) {
      await waitHistorical(p.page, async count => {
        const badge = document.getElementById('sidebar-members-count');
        return badge && badge.textContent.includes(`${count} online`);
      }, viewerCount + 1, { timeout: 25000 });
      console.log(`[720p E2E] ${p.name} confirmou ${viewerCount + 1} membros online!`);
    }

    // Captura Peer IDs
    const peerV1Id = await pageV1.evaluate(async () => (await import('/js/entries/room-entry.js')).roomState.roomManager?.myPeerId);
    const peerV2Id = await pageV2.evaluate(async () => (await import('/js/entries/room-entry.js')).roomState.roomManager?.myPeerId);
    const peerV3Id = await pageV3.evaluate(async () => (await import('/js/entries/room-entry.js')).roomState.roomManager?.myPeerId);
    console.log(`[720p E2E] Peer IDs: V1=${peerV1Id}, V2=${peerV2Id}, V3=${peerV3Id}`);

    // Injeta telemetria de rede simulada no Host para a árvore
    await pageHost.evaluate(async ({ v1, v2, v3 }) => {
      if ((await import('/js/entries/room-entry.js')).roomState.relayManager) {
        (await import('/js/entries/room-entry.js')).roomState.relayManager.updateTelemetry(v1, { rtt: 20, packetLoss: 0 });
        (await import('/js/entries/room-entry.js')).roomState.relayManager.updateTelemetry(v2, { rtt: 55, packetLoss: 0 });
        (await import('/js/entries/room-entry.js')).roomState.relayManager.updateTelemetry(v3, { rtt: 35, packetLoss: 0 });
      }
    }, { v1: peerV1Id, v2: peerV2Id, v3: peerV3Id });

    // Host inicia transmissão em 720p
    console.log('[720p E2E] Host iniciando transmissão 720p...');
    const streamBtn = pageHost.locator('#dock-stream-btn');
    await streamBtn.waitFor({ state: 'visible' });
    await streamBtn.click();

    // Verificação de recepção e reprodução nos 3 espectadores
    console.log(`[720p E2E] Verificando reprodução nos ${viewerCount} espectadores...`);
    const viewers = [
      { name: 'Viewer 1', page: pageV1 },
      { name: 'Viewer 2', page: pageV2 },
      { name: 'Viewer 3', page: pageV3 }
    ].slice(0, viewerCount);

    for (const v of viewers) {
      console.log(`[720p E2E] Aguardando vídeo no ${v.name}...`);
      const videoLoc = v.page.locator('.video-card video');
      await videoLoc.waitFor({ state: 'attached', timeout: 35000 });

      await waitHistorical(v.page, async () => {
        const vid = document.querySelector('.video-card video');
        if (vid) {
          vid.muted = true;
          if (vid.paused) vid.play().catch(() => {});
        }
        return Boolean(vid && !vid.paused && vid.readyState >= 2 && vid.videoWidth > 0);
      }, undefined, { timeout: 35000 });
      console.log(`✅ ${v.name} está reproduzindo o vídeo 720p com sucesso!`);
    }

    // Warm up congestion control before observing actual delivered frames.
    await pageHost.waitForTimeout(warmupSeconds * 1000);
    const senderObservation = pageHost.evaluate(async sampleMs => {
      const state = (await import('/js/entries/room-entry.js')).roomState;
      const calls = [...state.screenCalls.values()];
      const snapshot = async call => [...(await call.peerConnection.getStats()).values()]
        .filter(stat => ['outbound-rtp', 'remote-inbound-rtp', 'codec', 'candidate-pair'].includes(stat.type));
      const before = await Promise.all(calls.map(snapshot));
      const sourceFrames = window.__historicalSourceFrames;
      const started = performance.now();
      await new Promise(resolve => setTimeout(resolve, sampleMs));
      return { sourceFps: (window.__historicalSourceFrames - sourceFrames) * 1000 / (performance.now() - started),
        calls: await Promise.all(calls.map(async (call, index) => ({ peer: call.peer,
          parameters: call.peerConnection.getSenders().filter(sender => sender.track?.kind === 'video').map(sender => sender.getParameters()),
          localSdp: call.peerConnection.localDescription?.sdp, remoteSdp: call.peerConnection.remoteDescription?.sdp,
          before: before[index], after: await snapshot(call) }))) };
    }, sampleSeconds * 1000);
    const delivered = await Promise.all(viewers.map(async ({ name, page }) => ({ name,
      ...await page.evaluate(async sampleMs => {
        const video = document.querySelector('.video-card video');
        const state = (await import('/js/entries/room-entry.js')).roomState;
        const pc = [...state.remoteStreams.values()][0]?.call?.peerConnection;
        const snapshot = async () => pc ? [...(await pc.getStats()).values()].filter(row => row.type === 'inbound-rtp' && row.kind === 'video') : [];
        const before = await snapshot();
        let frames = 0, active = true, callback, lastFrameAt = performance.now();
        const pauses = [];
        const start = performance.now();
        const count = () => { if (active) { const now = performance.now(); pauses.push(now - lastFrameAt); lastFrameAt = now; frames++; callback = video.requestVideoFrameCallback(count); } };
        callback = video.requestVideoFrameCallback(count);
        await new Promise(resolve => setTimeout(resolve, sampleMs));
        active = false; video.cancelVideoFrameCallback(callback);
        const elapsedMs = performance.now() - start;
        pauses.push(performance.now() - lastFrameAt); pauses.sort((a, b) => a - b);
        const after = await snapshot();
        const previous = before[0], current = after[0];
        const decoded = previous && current ? current.framesDecoded - previous.framesDecoded : 0;
        const emitted = previous && current ? current.jitterBufferEmittedCount - previous.jitterBufferEmittedCount : 0;
        return { width: video.videoWidth, height: video.videoHeight, presentedFrames: frames,
          presentationFps: Number((1000 * frames / elapsedMs).toFixed(2)), elapsedMs,
          maxPauseMs: pauses.at(-1), pauseP95Ms: pauses[Math.floor((pauses.length - 1) * 0.95)],
          pausesOver100Ms: pauses.filter(pause => pause > 100).length,
          inbound: { before, after, decodedFps: decoded * 1000 / elapsedMs,
            decodeMsPerFrame: decoded ? (current.totalDecodeTime - previous.totalDecodeTime) * 1000 / decoded : null,
            jitterBufferMs: emitted ? (current.jitterBufferDelay - previous.jitterBufferDelay) * 1000 / emitted : null } };
      }, sampleSeconds * 1000)
    })));
    const hostInfo = await pageHost.evaluate(async () => {
      const state = (await import('/js/entries/room-entry.js')).roomState;
      return { activeCalls: state.screenCalls.size, topology: state.relayManager.getTopology(),
        maxDirectViewers: state.relayManager.maxDirectViewers,
        sourceSettings: state.localStream.getVideoTracks()[0].getSettings() };
    });
    const replayRecorders = await Promise.all(participants.map(async ({ name, page }) => ({ name,
      ...await page.evaluate(async () => {
        const clipping = (await import('/js/entries/room-entry.js')).roomState.features.clipping;
        return { enabled: clipping.enabled, replayEnabled: clipping.recorder.preferences.enabled, recorders: [...clipping.recorder.recorders].map(([sourceId, recorder]) => ({
          sourceId, isRecording: recorder.isRecording, mimeType: recorder.mediaRecorder?.mimeType,
          videoBitsPerSecond: recorder.mediaRecorder?.videoBitsPerSecond,
          recordingSettings: recorder.recordingStream?.getVideoTracks()[0]?.getSettings(),
          profileTelemetry: recorder._recordingProfile?.telemetry, error: recorder.lastError?.message,
          audioContextState: recorder._audioContext?.state,
          incomingAudio: recorder.stream?.getAudioTracks().map(t => ({ enabled: t.enabled, muted: t.muted, state: t.readyState })),
          audioMixerSources: recorder._audioTrackSources?.size
        })) };
      })
    })));
    console.log('[Replay recorders]', JSON.stringify(replayRecorders));
    const clipResults = [];
    const observed = { timestamp: new Date().toISOString(), mode: deliveryOnly ? 'delivery-only' : 'delivery-and-relay',
      sourceHashes: Object.fromEntries((await listFrontendFiles(root)).map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
      viewerCount, replayEnabled: replayCase !== 'none', replayCase, replayProfile, replayCodec, sampleSeconds, warmupSeconds,
      status: 'measured', historySeconds, clipResults, replayRecorders, hostInfo, delivered, senderObservation: await senderObservation,
      limitations: ['Shared physical CPU/GPU/memory across transmitter and all receivers; results do not isolate publisher overhead.', 'Headless synthetic source, local network; no GPU/game stress or physical capture.',
        'Presentation FPS measured by requestVideoFrameCallback; requested capture FPS is not delivered FPS.',
        'No optical latency measurement or measured saturation/bitrate in this historical runner.'] };
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'observed-720p.json'), JSON.stringify(observed, null, 2));
    console.log(JSON.stringify({ evidence: path.join(ARTIFACT_DIR, 'observed-720p.json') }));
    if (clipCheck) for (const { name, page } of participants) {
      const expected = name === 'Host' ? ['host', 'both'].includes(replayCase) : ['viewers', 'both'].includes(replayCase);
      if (expected) {
        const raw = await page.evaluate(async () => {
          const recorder = (await import('/js/entries/room-entry.js')).roomState.features.clipping.recorder.getRecorder();
          await recorder.flushPendingData();
          return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.slice(reader.result.lastIndexOf(',') + 1)); reader.readAsDataURL(new Blob(recorder.chunks.map(c => c.blob))); });
        });
        fs.writeFileSync(path.join(ARTIFACT_DIR, `${name.replaceAll(' ', '-')}-raw-history.webm`), Buffer.from(raw, 'base64'));
      }
      const clip = await page.evaluate(async expected => {
        const registry = (await import('/js/entries/room-entry.js')).roomState.features.clipping.recorder;
        if (!expected) return { recorders: registry.recorders.size };
        const start = performance.now();
        const blob = await registry.exportClip();
        if (!blob?.size) throw new Error('Replay has no clip bytes');
        window.__replayLastClip = blob;
        const url = URL.createObjectURL(blob), video = document.createElement('video');
        video.src = url; video.muted = false; video.playsInline = true;
        video.style.cssText = 'position:fixed;bottom:0;left:0;width:320px;z-index:100000';
        document.body.appendChild(video);
        const audio = new AudioContext(), analyser = audio.createAnalyser(), gain = audio.createGain();
        gain.gain.value = 0;
        audio.createMediaElementSource(video).connect(analyser); analyser.connect(gain); gain.connect(audio.destination);
        const timeout = setTimeout(() => video.dispatchEvent(new Event('error')), 10000);
        try {
          await audio.resume();
          await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('Exported clip cannot decode')); });
          // Startup can contain silence before the remote audio track unmutes.
          // Decode from the start; inspect audio across several seconds so a
          // silent startup is not mistaken for a missing audio track.
          await video.play();
          let frames = 0, active = true;
          const count = () => { if (active) { frames++; video.requestVideoFrameCallback(count); } };
          video.requestVideoFrameCallback(count);
          let audioRms = 0;
          for (let i = 0; i < 40; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
            audioRms = Math.max(audioRms, Math.sqrt(samples.reduce((sum, x) => sum + x*x, 0) / samples.length));
          }
          active = false;
          return { size: blob.size, mime: blob.type, width: video.videoWidth, height: video.videoHeight,
            frames, audioRms, exportAndDecodeMs: performance.now() - start, recorders: registry.recorders.size };
        } finally { clearTimeout(timeout); video.pause(); video.src = ''; video.remove(); URL.revokeObjectURL(url); await audio.close(); }
      }, expected);
      if (expected) {
        const data = await page.evaluate(() => new Promise(resolve => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result.slice(reader.result.lastIndexOf(',') + 1)); reader.readAsDataURL(window.__replayLastClip);
        }));
        const filename = path.join(ARTIFACT_DIR, `${name.replaceAll(' ', '-')}-clip.webm`);
        fs.writeFileSync(filename, Buffer.from(data, 'base64'));
        const container = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height,start_time,duration', '-of', 'json', filename], { encoding: 'utf8', windowsHide: true, timeout: 15000 }));
        assert.ok(container.streams.some(s => s.codec_type === 'video'));
        assert.ok(container.streams.some(s => s.codec_type === 'audio'));
        clip.containerStreams = container.streams;
      }
      console.log('[Replay clip]', name, JSON.stringify(clip));
      assert.equal(clip.recorders, expected ? 1 : 0, `${name}: explicit recording policy`);
      if (expected) { assert.ok(clip.frames > 2, `${name}: clip presents video`); assert.ok(clip.audioRms > 0.001, `${name}: clip has audible source`); }
      clipResults.push({ name, ...clip });
    }
    observed.status = 'clips-verified';
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'observed-720p.json'), JSON.stringify(observed, null, 2));
    console.log(JSON.stringify({ mode: observed.mode, viewerCount, replayEnabled, hostInfo, delivered,
      sourceFps: observed.senderObservation.sourceFps, evidence: path.join(ARTIFACT_DIR, 'observed-720p.json') }, null, 2));
    for (const [index, { page }] of viewers.entries()) await captureScreenshotFast(page, path.join(ARTIFACT_DIR, 'viewer-' + (index + 1) + '.png'));
    for (const viewer of delivered) {
      assert.ok(viewer.presentedFrames > 0, 'Each spectator must present frames');
      assert.equal(viewer.width, 1280, 'Actual steady resolution must be 720p');
      assert.equal(viewer.height, 720);
    }
    if (!deliveryOnly) {
      assert.equal(hostInfo.topology.relayedCount, 1, '720p tree benchmark requires a real relay route');
      assert.equal(hostInfo.activeCalls, 2, 'Origin must have only two media calls');
    }
    console.log(deliveryOnly ? 'PASS Actual 720p delivery verified; relay was not tested' : 'PASS Actual 720p delivery and relay route verified');
  } catch (err) {
    const checkpoint = path.join(ARTIFACT_DIR, 'observed-720p.json');
    if (fs.existsSync(checkpoint)) { const report = JSON.parse(fs.readFileSync(checkpoint, 'utf8')); report.status = 'failed'; report.error = err.message; fs.writeFileSync(checkpoint, JSON.stringify(report, null, 2)); }
    console.error('❌ ERRO NO BENCHMARK:', err);
    throw err;
  } finally {
    await browser.close();
    if (server) server.close();
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
