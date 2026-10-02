import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

/** Expand local imports in cascade order; missing files and cycles are errors. */
export function expandCss(file, ancestors = new Set()) {
  const absolute = path.resolve(file);
  if (ancestors.has(absolute)) throw new Error(`CSS import cycle: ${absolute}`);
  const stack = new Set(ancestors).add(absolute);
  const root = postcss.parse(fs.readFileSync(absolute, 'utf8'), { from: absolute });
  root.walkAtRules('import', rule => {
    const match = rule.params.match(/^['"]([^'"]+)['"]$/);
    if (!match || !match[1].startsWith('.')) throw new Error(`Unsupported local CSS import: ${rule.params}`);
    rule.replaceWith(expandCss(path.resolve(path.dirname(absolute), match[1]), stack).nodes);
  });
  return root;
}
