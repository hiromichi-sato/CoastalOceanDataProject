const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('node:path');
const fs = require('node:fs');
fs.mkdirSync('artifacts', { recursive: true });
const assert = require('node:assert/strict');

// Independent minimal CDF-1 reader checks the file rather than writer internals.
function readNC(buffer) {
  let at = 4;
  assert.equal(buffer.subarray(0, 4).toString('hex'), '43444601');
  const u32 = () => { const v = buffer.readUInt32BE(at); at += 4; return v; };
  const str = () => { const n = u32(); const s = buffer.subarray(at, at + n).toString('utf8'); at += (n + 3) & ~3; return s; };
  function attrs() {
    const tag = u32(), n = u32(); assert.ok(tag === 12 || tag === 0);
    const result = {};
    for (let i = 0; i < n; i++) {
      const key = str(), type = u32(), count = u32();
      result[key] = type === 2 ? buffer.subarray(at, at + count).toString('utf8') : buffer.readDoubleBE(at);
      at += ((type === 2 ? count : count * 8) + 3) & ~3;
    }
    return result;
  }
  assert.equal(u32(), 0); assert.equal(u32(), 10);
  const dims = Array.from({ length: u32() }, () => ({ name: str(), size: u32() }));
  const global = attrs(); assert.equal(u32(), 11);
  const vars = Array.from({ length: u32() }, () => {
    const name = str(), ids = Array.from({ length: u32() }, u32), attributes = attrs();
    assert.equal(u32(), 6); const size = u32(), offset = u32();
    assert.ok(offset + size <= buffer.length);
    return { name, ids, attributes, values: Array.from({ length: size / 8 }, (_, i) => buffer.readDoubleBE(offset + i * 8)) };
  });
  return { dims, global, vars };
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('file:///' + path.resolve('Aqua-Level-Lab-Demo.html').replaceAll('\\', '/'));
    await page.locator('[data-contour-export="nc"]:enabled').waitFor();
    for (const kind of ['nc', 'shape']) {
      const pending = page.waitForEvent('download');
      await page.locator(`[data-contour-export="${kind}"]`).click();
      const download = await pending;
      await download.saveAs(`artifacts/export-test.${kind === 'nc' ? 'nc' : 'zip'}`);
    }
    const nc = readNC(fs.readFileSync('artifacts/export-test.nc'));
    const field = nc.vars.find((v) => v.name === 'value');
    const mask = nc.vars.find((v) => v.name === 'water_mask');
    assert.equal(field.values.length, nc.dims[0].size * nc.dims[1].size);
    assert.ok(mask.values.includes(0) && mask.values.includes(1));
    field.values.forEach((value, i) => assert.ok(mask.values[i] ? value < 100 : value === field.attributes._FillValue));
    assert.equal(JSON.parse(nc.global.processing_metadata).mode, 'demo');
    const shape = await page.evaluate(async (base64) => {
      const zip = await JSZip.loadAsync(base64, { base64: true });
      const files = Object.keys(zip.files);
      const name = files.find((f) => f.endsWith('.shp'));
      const bytes = await zip.file(name).async('uint8array');
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { files, code: v.getInt32(0), length: v.getInt32(24) * 2, actual: bytes.length, type: v.getInt32(32, true), meta: JSON.parse(await zip.file('metadata.json').async('string')) };
    }, fs.readFileSync('artifacts/export-test.zip').toString('base64'));
    assert.equal(shape.code, 9994); assert.equal(shape.length, shape.actual); assert.equal(shape.type, 5);
    for (const suffix of ['.shx', '.dbf', '.prj', '.cpg']) assert.ok(shape.files.some((f) => f.endsWith(suffix)));
    assert.equal(shape.meta.mode, 'demo');
    await page.locator('#contour-view').screenshot({ path: 'artifacts/export-contour-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.locator('[data-contour-export="shape"]:enabled').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('#visualization').screenshot({ path: 'artifacts/export-contour-mobile.png' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ netcdf: nc.dims, shapefile: shape.files, errors, mobile: 'passed' }));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
