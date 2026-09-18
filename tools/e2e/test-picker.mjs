import { chromium } from 'playwright';
import { createServer } from 'node:http';

const title = 'SMG Dedicated Window Test';

const server = createServer((req, res) => {
  if (req.url === '/source') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><head><title>${title}</title></head><body style="background:red;"><h1>SOURCE WINDOW</h1></body></html>`);
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><head><title>Picker Test</title></head><body style="background:blue;">
    <h1>PICKER</h1>
    <button id="share-btn">Share Window</button>
    <script>
      window.capturePromise = null;
      document.getElementById('share-btn').onclick = () => {
        window.capturePromise = navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'browser' },
          audio: false,
          monitorTypeSurfaces: 'exclude'
        }).then(stream => {
          const track = stream.getVideoTracks()[0];
          return { label: track.label, settings: track.getSettings(), error: null };
        }).catch(e => ({ error: e.message }));
      };
    </script>
  </body></html>`);
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const targetTitle = 'SMG Dedicated Window Test';

const pickerBrowser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: [
    '--use-fake-ui-for-media-stream',
    `--auto-select-tab-capture-source-by-title=${targetTitle}`,
    '--enable-usermedia-screen-capturing',
    '--allow-http-screen-capture',
    '--autoplay-policy=no-user-gesture-required'
  ]
});

// Source tab running in the same browser
const sourcePage = await pickerBrowser.newPage();
await sourcePage.setViewportSize({ width: 1280, height: 720 });
await sourcePage.goto(`http://127.0.0.1:${port}/source`);

// Picker page
const pickerPage = await pickerBrowser.newPage();
await pickerPage.goto(`http://127.0.0.1:${port}/picker`);
await pickerPage.bringToFront();
await new Promise(r => setTimeout(r, 1000));

await pickerPage.click('#share-btn');
const captureResult = await pickerPage.evaluate(async () => {
  return await window.capturePromise;
});
console.log('CAPTURE RESULT:', captureResult);

await pickerBrowser.close();
await new Promise(r => server.close(r));


