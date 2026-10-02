import { readdir } from 'node:fs/promises';
import path from 'node:path';
/** Includes nested modules so native/web source comparisons cannot miss refactors. */
export async function listFrontendFiles(root, folder = 'js') {
  const files = [];
  for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
    const relative = `${folder}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await listFrontendFiles(root, relative));
    else if (entry.name.endsWith('.js')) files.push(relative);
  }
  return files.sort();
}

export async function listRustFiles(root, folder = 'src-tauri/src') {
  const files = [];
  for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
    const relative = `${folder}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await listRustFiles(root, relative));
    else if (entry.name.endsWith('.rs')) files.push(relative);
  }
  return files.sort();
}
