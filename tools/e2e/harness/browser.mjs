import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
export const launchTestBrowser = () => chromium.launch({
  channel: process.env.SEEMYGAME_BROWSER_CHANNEL || 'chrome', headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']
});

export async function prepareSessionContext(browser, signaling) {
  const context = await browser.newContext();
  await context.route('**/peerjs.min.js', route => route.fulfill({ path: fileURLToPath(new URL('../../../node_modules/peerjs/dist/peerjs.min.js', import.meta.url)) }));
  await context.route('**/api/turn', route => route.fulfill({ status: 404, body: '{}' }));
  await context.addInitScript(config => {
    window.__SEEMYGAME_PEER_CONFIG__ = config;
    localStorage.setItem('seemygame_terms_version', '1.1');
    localStorage.setItem('seemygame_terms_accepted', 'true');
    const capture = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const painter = canvas.getContext('2d'); let frames = 0;
      const timer = setInterval(() => { painter.fillStyle = frames++ % 2 ? 'red' : 'blue'; painter.fillRect(0, 0, 640, 360); }, 33);
      const stream = canvas.captureStream(30);
      stream.getTracks().forEach(track => {
        const stop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); stop(); };
        track.addEventListener('ended', () => clearInterval(timer), { once: true });
      });
      return stream;
    };
    navigator.mediaDevices.getDisplayMedia = capture;
  }, signaling.config);
  return context;
}
