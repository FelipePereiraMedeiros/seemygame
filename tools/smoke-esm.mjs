/**
 * SeeMyGame - Smoke Test for Native ESM Imports
 * Verifica se todos os módulos autorais vinculam e resolvem seus exports
 * no runtime nativo do Node.js sem erros de sintaxe ou imports faltantes.
 */

// Simula ambiente mínimo de DOM para permitir carregamento seguro dos módulos em Node
globalThis.window = {
  location: { pathname: '/room.html', search: '', hash: '', origin: 'http://localhost' },
  addEventListener: () => {},
  removeEventListener: () => {}
};
globalThis.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  readyState: 'complete'
};
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

const modulesToVerify = [
  '../js/shared/peer-id.js',
  '../js/room/room-id.js',
  '../js/navigation/room-links.js',
  '../js/core/event-bus.js',
  '../js/core/message-dispatcher.js',
  '../js/core/plugin-manager.js',
  '../js/core/session-context.js',
  '../js/protocol/index.js',
  '../js/entries/viewer-entry.js',
  '../js/entries/streamer-entry.js',
  '../js/entries/room-entry.js',
  '../js/entries/lobby-entry.js',
  '../js/entries/index.js',
  '../js/app.js'
];

let failed = 0;

for (const modPath of modulesToVerify) {
  try {
    const mod = await import(modPath);
    const exportNames = Object.keys(mod);
    console.log(`✓ [ESM OK] ${modPath} (${exportNames.length} exports)`);
  } catch (err) {
    console.error(`✗ [ESM FAIL] ${modPath}:`, err.message);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n❌ Falha de vinculação ESM: ${failed} módulo(s) com erro.`);
  process.exit(1);
} else {
  console.log(`\n✅ Todos os ${modulesToVerify.length} módulos foram vinculados e importados com sucesso via ESM nativo!`);
  process.exit(0);
}
