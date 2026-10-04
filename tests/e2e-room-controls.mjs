import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startAssetServer } from '../tools/e2e/harness/server.mjs';
import { startSignalingServer } from '../tools/e2e/harness/signaling.mjs';
import { launchTestBrowser, prepareSessionContext } from '../tools/e2e/harness/browser.mjs';
import { exerciseVoiceControls } from '../tools/e2e/harness/voice-controls.mjs';
import { waitForAsync } from '../tools/e2e/wait.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../output/playwright/room-controls-' + Date.now() + '/', import.meta.url);
await mkdir(output, { recursive: true });
const server = await startAssetServer({ root }), signaling = await startSignalingServer();
let browser;
const evidence = { status: 'running', checks: [], errors: [], limitations: ['Chrome on one machine, isolated contexts, synthetic display capture and fake microphone device; real PeerJS voice/data channels.'] };
const wait = (page, predicate, arg) => waitForAsync(() => page.evaluate(predicate, arg), { timeout: 20000 });
try {
  browser = await launchTestBrowser();
  const contexts = await Promise.all([prepareSessionContext(browser, signaling), prepareSessionContext(browser, signaling)]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  for (const [index, page] of pages.entries()) {
    page.on('pageerror', err => evidence.errors.push(err.message));
    await page.goto(server.origin + '/room.html?room=controls-e2e');
    await page.locator('#green-room-user-name').fill('Controls ' + index);
    await page.locator('#green-room-join-btn').click();
    await wait(page, async () => (await import('/js/entries/room-entry.js')).roomState.roomManager?.isInRoom);
  }
  for (const page of pages) await wait(page, async () => (await import('/js/entries/room-entry.js')).roomState.roomManager.members.size === 2);
  evidence.checks = await exerciseVoiceControls(pages);
  const disconnectHeader = await pages[0].evaluate(async () => {
    const { roomState } = await import('/js/entries/room-entry.js');
    roomState.peer.disconnect();
    return document.getElementById('copy-badge').textContent;
  });
  assert.ok(disconnectHeader.includes('Conectando'));
  await wait(pages[0], async () => {
    const { roomState } = await import('/js/entries/room-entry.js');
    return !roomState.peer.disconnected && !document.getElementById('copy-badge').textContent.includes('Conectando');
  });
  evidence.checks.push({ signalingReconnect: 'passed', disconnectHeader });
  await pages[0].screenshot({ path: fileURLToPath(new URL('controls.png', output)), fullPage: true });
  assert.deepEqual(evidence.errors, []);
  evidence.status = 'passed'; console.log('PASS Web–Web: Room header, live mic tracks, deafen output, remote state, drawer and quick controls on both endpoints');
} catch (error) { evidence.status = 'failed'; evidence.failure = error.message; throw error; }
finally {
  await writeFile(new URL('report.json', output), JSON.stringify(evidence, null, 2));
  console.log('Evidence:', fileURLToPath(output));
  await browser?.close(); await signaling.close(); await server.close();
}
