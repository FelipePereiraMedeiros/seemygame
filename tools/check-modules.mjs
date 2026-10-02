import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export function authoredModules(folder = path.join(root, 'js')) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'vendor') return [];
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? authoredModules(file) : file.endsWith('.js') ? [file] : [];
  }).sort();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const modules = authoredModules();
  const dependencies = new Set(Object.keys({ ...JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).dependencies, ...JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).devDependencies }));
  let imports = 0;
  for (const file of modules) {
    const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module' });
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      const source = (['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type) ? node.source : node.type === 'CallExpression' && node.callee.type === 'Import' ? node.arguments[0] : null);
      if (source?.type === 'StringLiteral') {
        imports++;
        const value = source.value;
        if (value.startsWith('.')) {
          if (!fs.existsSync(path.resolve(path.dirname(file), value))) throw new Error(`Missing import: ${path.relative(root, file)} -> ${value}`);
        } else if (!/^(https?:|node:)/.test(value)) {
          const pkg = value.startsWith('@') ? value.split('/').slice(0,2).join('/') : value.split('/')[0];
          if (!dependencies.has(pkg)) throw new Error(`Undeclared dependency: ${pkg}`);
        }
      }
      for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child);
    };
    visit(ast.program);
  }
  for (const role of ['room','streamer','viewer','lobby']) {
    const html = fs.readFileSync(path.join(root, `${role}.html`), 'utf8');
    if (!html.includes(`js/pages/${role}-page.js`)) throw new Error(`Page ${role} bypasses page composition`);
  }
  console.log(`Module graph validated: ${modules.length} authored modules, ${imports} imports/exports.`);
}
