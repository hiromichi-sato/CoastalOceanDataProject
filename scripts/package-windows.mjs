import { readFile, readdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../public/vendor/jszip.min.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zip = new globalThis.JSZip();
async function add(relative) {
  const absolute = path.join(root, relative);
  let entries;
  try { entries = await readdir(absolute, { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOTDIR') throw error; }
  if (entries) {
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error(`Refusing symlink: ${relative}/${entry.name}`);
      await add(path.join(relative, entry.name));
    }
  } else zip.file(relative.replaceAll('\\', '/'), await readFile(absolute));
}
for (const file of ['AquaLevelLab.exe', 'Aqua-Level-Lab-Demo.html', 'server.js', 'package.json', 'lib/catalog.js', 'lib/observations.js', 'lib/profiles.js', 'lib/seawater.js', 'lib/vendor/seawater.LICENSE', 'public', 'runtime', 'START-HERE.txt', 'README.md', 'SCIENTIFIC-METHOD.md']) await add(file);
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
const output = path.join(root, 'Aqua-Level-Lab-Windows-x64.zip');
await writeFile(output + '.tmp', bytes);
await rename(output + '.tmp', output);
console.log(`Packaged ${bytes.length} bytes`);
