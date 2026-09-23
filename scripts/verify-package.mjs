import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../public/vendor/jszip.min.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zip = await globalThis.JSZip.loadAsync(await readFile(path.join(root, 'Aqua-Level-Lab-Windows-x64.zip')));
const required = ['server.js','lib/catalog.js','lib/observations.js','lib/profiles.js','lib/seawater.js','public/research.html','public/research.js','public/safe-clipping.js','public/vendor/clipper.js','runtime/node.exe','AquaLevelLab.exe','README.md','SCIENTIFIC-METHOD.md'];
for (const name of required) if (!zip.file(name)) throw new Error(`Missing from distribution: ${name}`);
let count = 0;
for (const [name, entry] of Object.entries(zip.files)) {
  if (entry.dir) continue;
  const target = path.resolve(root, name);
  if (path.relative(root, target).startsWith('..') || path.isAbsolute(name)) throw new Error(`Invalid archive path: ${name}`);
  const archived = await entry.async('nodebuffer');
  const current = await readFile(target);
  if (!archived.equals(current)) throw new Error(`Distribution is stale: ${name}`);
  count++;
}
console.log(`Verified ${count} packaged files against the current workspace.`);
