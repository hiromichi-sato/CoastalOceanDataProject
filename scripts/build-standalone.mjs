import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFile(path.join(root, name), "utf8");
const [template, css, app, map, topology, d3, topojson, icon, d3License, topoLicense] = await Promise.all([
  "public/index.html", "public/styles.css", "public/app.js", "public/contour-map.js",
  "public/data/japan.topo.json", "public/vendor/d3.v7.min.js", "public/vendor/topojson-client.min.js",
  "public/icons/icon.svg", "public/vendor/d3.LICENSE", "public/vendor/topojson-client.LICENSE"
].map(read));

function replaceOnce(text, target, replacement) {
  if (text.split(target).length !== 2) throw new Error(`Expected one build marker: ${target}`);
  return text.replace(target, () => replacement);
}

const scriptSafe = (text) => text.replace(/<\/script/gi, "<\\/script");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(map).toString("base64")}`;
const offlineApp = replaceOnce(app, 'from "./contour-map.js"', `from "${moduleUrl}"`);
const offlineCss = `
.workspace { max-width: 920px; }
.layout { display: block; }
.top-actions, .summary-strip, #extract-form, .preview-panel > .panel-title,
.query-card, #research-plan, .results, .source-panel, #install-sheet, .download-box { display: none !important; }
.preview-panel { padding: 0; border: 0; box-shadow: none; background: none; }
.visualization { margin: 0; }
.app-shell { padding-bottom: 24px; }
`;

let html = replaceOnce(template, '<link rel="stylesheet" href="/styles.css" />', `<style>${css}\n${offlineCss}</style>`);
html = replaceOnce(html, '<link rel="manifest" href="/manifest.webmanifest" />', "");
html = replaceOnce(html, '<link rel="apple-touch-icon" href="/icons/icon.svg" />', "");
html = replaceOnce(html, 'href="/icons/icon.svg"', `href="data:image/svg+xml;base64,${Buffer.from(icon).toString("base64")}"`);
html = replaceOnce(html, "<title>Aqua Level Lab</title>", "<title>Aqua Level Lab - HTML デモ</title>");
html = replaceOnce(html, "multi-source ocean data", "HTML デモ / サンプルデータ");
html = replaceOnce(html, '<script src="/vendor/d3.v7.min.js"></script>', `<script>${scriptSafe(d3)}</script>`);
html = replaceOnce(html, '<script src="/vendor/topojson-client.min.js"></script>', `<script>${scriptSafe(topojson)}</script>`);
for (const file of ['vendor/clipper.js', 'safe-clipping.js', 'vendor/shpwrite.js', 'vendor/jszip.min.js', 'contour-export.js']) {
  html = replaceOnce(html, `<script src="/${file}"></script>`, `<script>${scriptSafe(await read('public/' + file))}</script>`);
}
for (const file of ['clipper.LICENSE', 'jsbn.LICENSE', 'shpwrite.LICENSE', 'jszip.LICENSE']) {
  html = html.replace('</body>', `<script type="text/plain">${scriptSafe(await read('public/vendor/' + file))}</script>\n</body>`);
}
html = replaceOnce(html, '<script src="/app.js" type="module"></script>', [
  `<script type="application/json" id="aqua-offline-map">${JSON.stringify(JSON.parse(topology)).replace(/</g, "\\u003c")}</script>`,
  `<script type="text/plain" id="bundled-library-licenses">${scriptSafe(d3License + "\n\n" + topoLicense)}</script>`,
  `<script type="module">${scriptSafe(offlineApp)}</script>`
].join("\n"));

const output = path.join(root, "Aqua-Level-Lab-Demo.html");
await writeFile(output, html, "utf8");
console.log(`Built standalone HTML: ${output} (${Buffer.byteLength(html)} bytes)`);
