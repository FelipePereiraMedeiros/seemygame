import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startAssetServer } from '../tools/e2e/harness/server.mjs';
import { startSignalingServer } from '../tools/e2e/harness/signaling.mjs';
import { launchTestBrowser, prepareSessionContext } from '../tools/e2e/harness/browser.mjs';
import { waitForAsync } from '../tools/e2e/wait.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../output/playwright/controller-lab/', import.meta.url));
await fs.mkdir(output, { recursive: true });
const server = await startAssetServer({ root });
const signaling = await startSignalingServer();
let browser; const errors = [], contexts = [], checks = [];
const wait = (page, predicate, argument) => waitForAsync(() => page.evaluate(predicate, argument), { timeout: 20000 });
async function participant(role, index, url) {
  const context = await prepareSessionContext(browser, signaling); contexts.push(context);
  await context.addInitScript(({ role, index }) => {
    window.__labRole = role;
    window.__labPad = { connected: true, index, id: ['Xbox Wireless', 'DualSense', 'Nintendo Switch Pro', '8BitDo'][index], mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__labPad] });
    window.__labState = async () => (await import(`/js/entries/${role}-entry.js`))[`${role}State`];
    window.__labDrawnCanvases = new Set();
    const draw = WebGL2RenderingContext.prototype.drawElements;
    WebGL2RenderingContext.prototype.drawElements = function (...args) {
      window.__labDrawnCanvases.add(this.canvas); return draw.apply(this, args);
    };
  }, { role, index });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(url); return page;
}
async function fullInput(page, uniqueButton) {
  await page.evaluate(button => {
    window.__labPad.buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: i < 4 || i === 6 || i === 7, value: i < 4 || i === 6 || i === 7 ? 1 : 0 }));
    window.__labPad.axes = [.6, -.4, -.7, .2];
  }, uniqueButton);
  await wait(page, async () => (await window.__labState()).features.controllerLab.ownPlayer()?.checks.face === 15);
  await page.evaluate(button => {
    window.__labPad.buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: i === button, value: i === button ? 1 : 0 }));
  }, uniqueButton);
}
try {
  browser = await launchTestBrowser();
  const host = await participant('streamer', 0, `${server.origin}/streamer.html`);
  await wait(host, async () => (await window.__labState()).peer?.id);
  const hostId = await host.evaluate(async () => (await window.__labState()).peer.id);
  const guests = [];
  for (let i = 1; i <= 3; i++) guests.push(await participant('viewer', i, `${server.origin}/viewer.html#watch=${hostId}`));
  await wait(host, async () => (await window.__labState()).connectedViewers.size === 3);
  for (const guest of guests) await wait(guest, async () => (await window.__labState()).activeConn?.open);
  await host.locator('#open-controller-lab-btn').click();
  for (const guest of guests) {
    await guest.locator('.controller-lab-invitation').waitFor({ state: 'visible' });
    assert.equal(await guest.evaluate(async () => (await window.__labState()).features.controllerLab.active), false);
    await guest.locator('[data-accept]').click();
  }
  const pages = [host, ...guests];
  for (const page of pages) {
    await wait(page, async () => (await window.__labState()).features.controllerLab.list().length === 4);
    assert.equal(await page.evaluate(async () => (await window.__labState()).session.services.coopController.isInputTestMode), true);
  }
  checks.push('Quatro participantes via conexões WebRTC reais, com aceite explícito e Co-op pausado');
  // Distinct button presses must arrive in each player's own card in all browsers.
  for (const [index, page] of pages.entries()) await fullInput(page, index);
  for (const page of pages) {
    await wait(page, async () => (await window.__labState()).features.controllerLab.list().every((player, slot) => player.state.buttons[slot] === 1 && player.state.buttons.filter(value => value > 0).length === 1));
    await page.locator('.controller-lab-ready:not([hidden])').click();
  }
  for (const page of pages) await wait(page, async () => (await window.__labState()).features.controllerLab.list().every(player => player.ready));
  checks.push('Inputs isolados e checklist/Pronto sincronizados nos quatro navegadores');
  await wait(host, () => [...document.querySelectorAll('.controller-lab canvas')].every(canvas => canvas.getContext('webgl2')));
  assert.equal(await host.locator('.controller-lab-fallback:visible').count(), 0);
  // Verify geometry draw calls; WebGL clears its drawing buffer after composition.
  await wait(host, () => [...document.querySelectorAll('.controller-lab canvas')].every(canvas => window.__labDrawnCanvases.has(canvas)));
  await host.evaluate(() => document.querySelector('.controller-lab').scrollTo(0, 0));
  await host.screenshot({ path: `${output}/desktop.png` });
  checks.push('Quatro modelos WebGL renderizados sem fallback');
  await guests[0].setViewportSize({ width: 390, height: 844 });
  assert.equal(await guests[0].evaluate(() => document.querySelector('.controller-lab').scrollWidth <= 390), true);
  await guests[0].evaluate(() => document.querySelector('.controller-lab').scrollTo(0, 0));
  await guests[0].screenshot({ path: `${output}/mobile.png` });
  await guests[0].locator('.controller-lab-close').click();
  await wait(host, async () => (await window.__labState()).features.controllerLab.list().length === 3);
  assert.equal(await guests[0].evaluate(async () => (await window.__labState()).session.services.coopController.isInputTestMode), false);
  assert.equal(await guests[0].evaluate(async () => (await window.__labState()).activeConn.open), true);
  await host.locator('.controller-lab-close').click();
  for (const page of pages) await wait(page, async () => !(await window.__labState()).features.controllerLab.active);
  for (const page of pages) assert.equal(await page.evaluate(async () => (await window.__labState()).session.services.coopController.isInputTestMode), false);
  checks.push('Layout móvel sem overflow e fechamento conserva conexão e retoma Co-op');
  await Promise.all(contexts.map(context => context.close())); contexts.length = 0;

  const rooms = [];
  for (let i = 0; i < 2; i++) {
    const page = await participant('room', i, `${server.origin}/room.html?room=controller-lab-e2e`);
    await page.locator('#green-room-user-name').fill(['Diogo', 'Amigo'][i]);
    await page.locator('#green-room-join-btn').click(); rooms.push(page);
  }
  for (const page of rooms) await wait(page, async () => (await window.__labState()).roomManager?.members.size === 2);
  await rooms[0].locator('#open-controller-lab-btn').click();
  await rooms[1].locator('.controller-lab-invitation').waitFor({ state: 'visible' });
  await rooms[1].locator('[data-accept]').click();
  for (const page of rooms) await wait(page, async () => (await window.__labState()).features.controllerLab.list().length === 2);
  await fullInput(rooms[1], 1);
  await wait(rooms[0], async () => (await window.__labState()).features.controllerLab.list()[1].state.buttons[1] === 1);
  await rooms[0].screenshot({ path: `${output}/room.png` });
  await rooms[0].locator('.controller-lab-close').click();
  for (const page of rooms) await wait(page, async () => !(await window.__labState()).features.controllerLab.active);
  checks.push('Fluxo Room: convite, nome, input remoto e encerramento via mesh real');
  assert.deepEqual(errors, []);
  await fs.writeFile(`${output}/report.json`, JSON.stringify({ checks, pageErrors: errors, physicalGamepads: 'simulated via navigator.getGamepads; real WebRTC and WebGL', timestamp: new Date().toISOString() }, null, 2));
  for (const check of checks) console.log('PASS ' + check);
} catch (error) {
  for (const [index, context] of contexts.entries()) for (const page of context.pages()) await page.screenshot({ path: `${output}/failure-${index}.png` }).catch(() => {});
  console.error('Page errors:', errors); throw error;
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser?.close(); await signaling.close(); await server.close();
}
