import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { startSignalingServer } from './signaling.mjs';
import { waitForAsync } from '../wait.mjs';

// Explicitly await async entry-module predicates; a Promise must not count as success.
export async function waitHistorical(page, predicate, argument, options = {}) {
  let value;
  await waitForAsync(async () => {
    value = await page.evaluate(predicate, argument);
    return Boolean(value);
  }, { timeout: options.timeout || 30000, interval: 100 });
  return { jsonValue: async () => value };
}

/** Historical scenarios keep their UI/source fixtures, using local real WebRTC. */
export async function launchHistoricalBrowser(options) {
  const signaling = await startSignalingServer();
  let browser;
  try { browser = await chromium.launch(options); }
  catch (error) { await signaling.close(); throw error; }
  const newContext = browser.newContext.bind(browser);
  const close = browser.close.bind(browser);
  const errors = [];
  browser.newContext = async options => {
    const context = await newContext(options);
    await context.route('**/peerjs.min.js', route => route.fulfill({
      path: fileURLToPath(new URL('../../../node_modules/peerjs/dist/peerjs.min.js', import.meta.url))
    }));
    await context.route('**/api/turn', route => route.fulfill({ status: 404, body: '{}' }));
    await context.addInitScript(config => { window.__SEEMYGAME_PEER_CONFIG__ = config; }, signaling.config);
    context.on('page', page => page.on('pageerror', error => errors.push(`${page.url()}: ${error.message}`)));
    return context;
  };
  browser.close = async () => {
    try { await close(); } finally { await signaling.close(); }
    if (errors.length) throw new Error(`Browser JavaScript errors:\n${errors.join('\n')}`);
  };
  return browser;
}

export function historicalArtifactDir(scenario) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = path.join(process.env.SEEMYGAME_E2E_OUTPUT || path.join(root, 'output/playwright'),
    `historical-${scenario}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(directory, { recursive: true });
  console.log(`[E2E artifacts] ${directory}`);
  return directory;
}
