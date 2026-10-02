import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';
import { authoredModules } from './check-modules.mjs';
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/__smoke__.html' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.location = dom.window.location;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const effects = [];
// Initialize JSDOM's selector implementation before observing application effects.
document.querySelector(':focus');
for (const target of [window, document]) target.addEventListener = (...args) => effects.push(`listener:${args[0]} ${new Error().stack.split('\n')[2]}`);
for (const name of ['fetch','setInterval','requestAnimationFrame','WebSocket','RTCPeerConnection','AudioContext','Peer']) {
  globalThis[name] = function () { effects.push(name); throw new Error(`Import side effect: ${name}`); };
}
window.AudioContext = globalThis.AudioContext;
let count = 0;
// theme.js is an intentional classic, pre-style HTML bootstrap, not an ESM module.
for (const file of authoredModules().filter(file => !/[\\/]pages[\\/]/.test(file) && !/[\\/]theme\.js$/.test(file))) {
  try { await import(pathToFileURL(file)); count++; }
  catch (error) { console.error(`ESM FAIL: ${file}: ${error.message}`); process.exitCode = 1; }
}
if (effects.length) { console.error('Unexpected import effects:', effects); process.exitCode = 1; }
if (!process.exitCode) console.log(`ESM imports passed: ${count} modules; no page listeners, network, audio or timers started.`);
dom.window.close();
