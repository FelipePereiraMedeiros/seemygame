import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const pages = ['index.html', 'lobby.html', 'room.html', 'streamer.html', 'viewer.html'];

/** Generated pages remain directly servable by Vercel, Tauri and local HTTP. */
export function buildHtmlPartials({ check = false } = {}) {
  for (const page of pages) {
    const file = path.join(root, page), before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const after = before.replace(/<!-- smg:partial ([a-zA-Z0-9_./-]+) -->[\s\S]*?<!-- smg:end -->/g, (_, partial) => {
      const source = path.resolve(root, partial);
      if (!source.startsWith(path.join(root, 'templates') + path.sep)) throw new Error(`Invalid partial: ${partial}`);
      return `<!-- smg:partial ${partial} -->\n${fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n')}\n<!-- smg:end -->`;
    });
    if (after !== before && check) throw new Error(`${page} differs from its templates. Run npm run build:html.`);
    if (after !== before) fs.writeFileSync(file, after);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildHtmlPartials({ check: process.argv.includes('--check') });
  console.log('HTML partials validated.');
}
