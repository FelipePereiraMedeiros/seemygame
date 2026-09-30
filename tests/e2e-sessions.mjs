import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startAssetServer } from '../tools/e2e/harness/server.mjs';
import { startSignalingServer } from '../tools/e2e/harness/signaling.mjs';
import { launchTestBrowser, prepareSessionContext } from '../tools/e2e/harness/browser.mjs';
import { waitForAsync } from '../tools/e2e/wait.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await startAssetServer({ root });
const signaling = await startSignalingServer();
let browser;
const errors = [];
const observe = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('[browser]', message.text()); });
};
const wait = (page, predicate, argument) => waitForAsync(() => page.evaluate(predicate, argument), { timeout: 20000 });
try {
  browser = await launchTestBrowser();
  const hostContext = await prepareSessionContext(browser, signaling);
  const guestContext = await prepareSessionContext(browser, signaling);
  const host = await hostContext.newPage(), guest = await guestContext.newPage();
  observe(host); observe(guest);
  await host.goto(server.origin + '/streamer.html');
  await wait(host, async () => (await import('/js/entries/streamer-entry.js')).streamerState.peer?.id);
  const hostId = await host.evaluate(async () => (await import('/js/entries/streamer-entry.js')).streamerState.peer.id);
  // Explicit PIN admission before media is sent.
  await host.evaluate(async () => (await import('/js/entries/streamer-entry.js')).setStreamerPin('1234'));
  await host.locator('#stream-btn').click();
  await wait(host, async () => Boolean((await import('/js/entries/streamer-entry.js')).streamerState.localStream));
  await guest.goto(`${server.origin}/viewer.html#watch=${hostId}`);
  await guest.locator('#pin-prompt-modal').waitFor({ state: 'visible' });
  await guest.evaluate(async () => (await import('/js/entries/viewer-entry.js')).submitViewerPin('9999'));
  await wait(guest, () => document.getElementById('viewer-pin-error').textContent.includes('PIN'));
  assert.equal(await guest.evaluate(async () => Boolean((await import('/js/entries/viewer-entry.js')).viewerState.remoteStream)), false);
  await guest.evaluate(async () => (await import('/js/entries/viewer-entry.js')).submitViewerPin('1234'));
  await wait(guest, () => [...document.querySelectorAll('video')].some(video => video.videoWidth === 640 && video.readyState >= 2));
  await guest.evaluate(async () => {
    const { viewerState } = await import('/js/entries/viewer-entry.js');
    const { sendSessionMessage } = await import('/js/protocol/transport.js');
    const chat = viewerState.session.services.chatManager;
    const message = chat.createMessage({ senderId: viewerState.peer.id, senderName: 'Guest', text: 'network-regression', role: 'viewer' });
    sendSessionMessage(viewerState.session, viewerState.activeConn, { type: 'CHAT_MESSAGE', message });
  });
  await wait(host, async () => (await import('/js/entries/streamer-entry.js')).streamerState.session.services.chatManager.getMessages().some(message => message.text === 'network-regression'));
  console.log('PASS Streamer/Viewer: PIN rejected/accepted, decoded video, real data-channel chat');
  await hostContext.close(); await guestContext.close();

  const roomContexts = await Promise.all([prepareSessionContext(browser, signaling), prepareSessionContext(browser, signaling)]);
  const rooms = await Promise.all(roomContexts.map(context => context.newPage()));
  for (const [index, page] of rooms.entries()) {
    observe(page);
    await page.goto(server.origin + '/room.html?room=modular-e2e');
    await page.locator('#green-room-user-name').fill('Member ' + index);
    await page.locator('#green-room-join-btn').click();
    await wait(page, async () => (await import('/js/entries/room-entry.js')).roomState.roomManager?.isInRoom);
  }
  for (const page of rooms) await wait(page, async () => (await import('/js/entries/room-entry.js')).roomState.roomManager?.members.size === 2);
  await rooms[0].locator('#dock-stream-btn').click();
  await wait(rooms[1], () => [...document.querySelectorAll('video')].some(video => video.videoWidth === 640 && video.readyState >= 2));
  console.log('PASS Room: coordinator admission, two peers, decoded shared video');
  await Promise.all(roomContexts.map(context => context.close()));
  assert.deepEqual(errors, [], 'Page JavaScript errors');
} finally {
  await browser?.close();
  await signaling.close();
  await server.close();
}
