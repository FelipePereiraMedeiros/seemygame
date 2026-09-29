import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const playerCssPath = path.join(root, 'css', 'player.css');
const componentsDir = path.join(root, 'css', 'components');

fs.mkdirSync(componentsDir, { recursive: true });

const content = fs.readFileSync(playerCssPath, 'utf8');
const lines = content.split(/\r?\n/);

console.log(`Total lines in player.css: ${lines.length}`);

// Helper to slice 1-based line ranges [start, end] inclusive
function sliceLines(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

// 1. video-grid.css
const videoGridContent = [
  '/* ==========================================================================\n   SeeMyGame - Video Grid, Player Canvas & Media Overlays Component\n   ========================================================================== */\n',
  sliceLines(1, 439),
  sliceLines(485, 558),
  sliceLines(559, 766),
  sliceLines(1902, 1965),
  sliceLines(1966, 1991)
].join('\n\n');

// 2. hud-telemetry.css
const hudTelemetryContent = [
  '/* ==========================================================================\n   SeeMyGame - HUD Telemetry, Latency & ABR Badges Component\n   ========================================================================== */\n',
  sliceLines(440, 484),
  sliceLines(1992, 2007)
].join('\n\n');

// 3. discord-drawer.css
const discordDrawerContent = [
  '/* ==========================================================================\n   SeeMyGame - Discord Drawer, Voice/Chat Panels & Room Stage Component\n   ========================================================================== */\n',
  sliceLines(865, 1901),
  sliceLines(2715, 3116)
].join('\n\n');

// 4. whiteboard.css
const whiteboardContent = [
  '/* ==========================================================================\n   SeeMyGame - Interactive Whiteboard & Vector Sync Component\n   ========================================================================== */\n',
  sliceLines(2395, 2714)
].join('\n\n');

// 5. modals.css
const modalsContent = [
  '/* ==========================================================================\n   SeeMyGame - Modals, Green Room Preflight & Gamepad Tester Component\n   ========================================================================== */\n',
  sliceLines(767, 864),
  sliceLines(2008, 2394),
  sliceLines(3117, 3271),
  sliceLines(3272, 3339),
  sliceLines(3340, lines.length)
].join('\n\n');

fs.writeFileSync(path.join(componentsDir, 'video-grid.css'), videoGridContent, 'utf8');
fs.writeFileSync(path.join(componentsDir, 'hud-telemetry.css'), hudTelemetryContent, 'utf8');
fs.writeFileSync(path.join(componentsDir, 'discord-drawer.css'), discordDrawerContent, 'utf8');
fs.writeFileSync(path.join(componentsDir, 'whiteboard.css'), whiteboardContent, 'utf8');
fs.writeFileSync(path.join(componentsDir, 'modals.css'), modalsContent, 'utf8');

console.log('Component CSS files written successfully to css/components/');

const modularPlayerCss = `/* ==========================================================================
   SeeMyGame - Player Stylesheet (Modular Architecture)
   ========================================================================== */
@import './components/video-grid.css';
@import './components/hud-telemetry.css';
@import './components/discord-drawer.css';
@import './components/whiteboard.css';
@import './components/modals.css';
`;

fs.writeFileSync(playerCssPath, modularPlayerCss, 'utf8');
console.log('player.css updated to import modular components.');
