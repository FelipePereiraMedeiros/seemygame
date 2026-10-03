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
  const observerContext = await prepareSessionContext(browser, signaling);
  const observer = await observerContext.newPage(); observe(observer);
  await observer.goto(`${server.origin}/viewer.html#watch=${hostId}`);
  await observer.locator('#pin-prompt-modal').waitFor({ state: 'visible' });
  await observer.evaluate(async () => (await import('/js/entries/viewer-entry.js')).submitViewerPin('1234'));
  await wait(observer, () => [...document.querySelectorAll('video')].some(video => video.readyState >= 2));
  const authorId = await guest.evaluate(async () => {
    const { viewerState } = await import('/js/entries/viewer-entry.js');
    const { sendSessionMessage } = await import('/js/protocol/transport.js');
    sendSessionMessage(viewerState.session, viewerState.activeConn, { type: 'CHAT_MESSAGE', message: {
      id: 'relay-security-e2e', senderId: viewerState.targetHostId, senderName: 'Host', role: 'system',
      isSystem: true, channel: 'geral', text: 'relay-identity-regression' } });
    return viewerState.peer.id;
  });
  await wait(observer, async () => (await import('/js/entries/viewer-entry.js')).viewerState.session.services.chatManager.getMessages().some(message => message.id === 'relay-security-e2e'));
  const forwarded = await observer.evaluate(async () => (await import('/js/entries/viewer-entry.js')).viewerState.session.services.chatManager.getMessages().find(message => message.id === 'relay-security-e2e'));
  assert.equal(forwarded.senderId, authorId); assert.equal(forwarded.role, 'viewer');
  assert.equal(forwarded.isSystem, false); assert.notEqual(forwarded.senderName, 'Host');
  console.log('PASS Chat relay: sanitized guest identity preserved at a second Viewer');
  await hostContext.close(); await guestContext.close(); await observerContext.close();

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
  const lateContext = await prepareSessionContext(browser, signaling);
  roomContexts.push(lateContext);
  const late = await lateContext.newPage(); observe(late);
  await late.goto(server.origin + '/room.html?room=modular-e2e');
  await late.locator('#green-room-user-name').fill('Late member');
  await late.locator('#green-room-join-btn').click();
  for (const page of [...rooms, late]) await wait(page, async () => (await import('/js/entries/room-entry.js')).roomState.roomManager?.members.size === 3);
  await wait(late, () => [...document.querySelectorAll('video')].some(video => video.videoWidth === 640 && video.readyState >= 2));
  console.log('PASS Room: coordinator admission, three peers, decoded shared video including late join');
  const snapshotSource = await rooms[0].evaluate(async () => {
    const { roomState } = await import('/js/entries/room-entry.js');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(canvas.width, canvas.height);
    let seed = 123;
    for (let i = 0; i < pixels.data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels.data[i] = i % 4 === 3 ? 255 : seed >>> 24;
    }
    ctx.putImageData(pixels, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    roomState.features.whiteboard.manager.setElements([
      { id: 'snapshot-image', type: 'image', startX: 0, startY: 0, endX: 320, endY: 240, dataUrl },
      { id: 'snapshot-overlay', type: 'rectangle', startX: 10, startY: 10, endX: 50, endY: 50 }
    ]);
    return { peerId: roomState.peer.id, imageLength: dataUrl.length };
  });
  assert.ok(snapshotSource.imageLength > 256 * 1024, 'Fixture must exceed the Room message limit');
  await wait(late, async sourceId => Boolean((await import('/js/entries/room-entry.js')).roomState.roomManager.meshConnections.get(sourceId)?.open), snapshotSource.peerId);
  await late.evaluate(async sourceId => {
    const { roomState } = await import('/js/entries/room-entry.js');
    const { sendSessionMessage } = await import('/js/protocol/transport.js');
    roomState.features.whiteboard.manager.setElements([{ id: 'stale', type: 'rectangle', startX: 0, startY: 0, endX: 10, endY: 10 }]);
    sendSessionMessage(roomState.session, roomState.roomManager.meshConnections.get(sourceId), { type: 'WHITEBOARD_REQUEST_SYNC' });
  }, snapshotSource.peerId);
  await wait(late, async expected => {
    const elements = (await import('/js/entries/room-entry.js')).roomState.features.whiteboard.manager.elements;
    return elements.length === 2 && elements[0].id === 'snapshot-image' &&
      elements[0].dataUrl.length === expected && elements[1].id === 'snapshot-overlay';
  }, snapshotSource.imageLength);
  console.log('PASS Whiteboard snapshot: large PNG, obsolete elements removed, layer order preserved over real Room data channels');
  await Promise.all(roomContexts.map(context => context.close()));
  assert.deepEqual(errors, [], 'Page JavaScript errors');
} finally {
  await browser?.close();
  await signaling.close();
  await server.close();
}
