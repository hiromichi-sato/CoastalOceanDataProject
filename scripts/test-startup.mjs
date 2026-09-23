import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
test('desktop launches isolate servers and serve current research assets', { timeout: 20000 }, async (t) => {
  const ports = [];
  for (let i = 0; i < 2; i++) {
    const child = spawn(process.execPath, ['server.js', '--desktop'], { cwd: root, windowsHide: true });
    t.after(async () => {
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    });
    const port = await new Promise((resolve, reject) => {
      let output = '';
      child.on('error', reject);
      child.on('exit', (code) => reject(new Error(`Server exited: ${code}`)));
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const ready = output.split('\n').find((line) => line.startsWith('{'));
        if (ready) resolve(JSON.parse(ready).port);
      });
    });
    ports.push(port);
    for (const file of ['research.html', 'research.js', 'sw.js']) {
      const response = await fetch(`http://127.0.0.1:${port}/${file === 'research.html' ? '' : file}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      assert.equal(await response.text(), await readFile(new URL(`public/${file}`, root), 'utf8'));
    }
  }
  assert.notEqual(ports[0], ports[1]);
  const cmd = await readFile(new URL('start-windows.cmd', root), 'utf8');
  assert.match(cmd, /server\.js" --desktop --open/);
  assert.ok(cmd.indexOf('call :use_node "%~dp0runtime') < cmd.indexOf('where.exe node.exe'));
});

test('service worker uses current assets online and scoped cache offline', async () => {
  const handlers = {};
  let offline = false;
  let status = 200;
  let cached = new Response('old');
  const removed = [];
  const cache = {
    match: async () => cached?.clone(),
    put: async (_request, response) => { cached = response; }
  };
  vm.runInNewContext(await readFile(new URL('public/sw.js', root), 'utf8'), {
    URL, Response,
    self: { location: { origin: 'http://localhost' }, clients: { claim() {} }, addEventListener: (type, handler) => { handlers[type] = handler; } },
    caches: {
      open: async () => cache,
      keys: async () => ['water-workbench-v10', 'water-workbench-v11', 'unrelated-app'],
      delete: async (key) => { removed.push(key); }
    },
    fetch: async (_request, options) => {
      assert.equal(options.cache, 'no-cache');
      if (offline) throw new Error('Offline');
      return new Response('current', { status });
    }
  });
  async function request(url = 'http://localhost/research.js', method = 'GET') {
    const pending = [];
    let result;
    handlers.fetch({ request: { url, method }, waitUntil: (p) => pending.push(p), respondWith: (p) => { result = p; } });
    const response = await result;
    await Promise.all(pending);
    return response;
  }
  assert.equal(await (await request()).text(), 'current');
  offline = true;
  assert.equal(await (await request()).text(), 'current');
  cached = undefined;
  assert.equal((await request()).type, 'error');
  offline = false;
  status = 404;
  assert.equal((await request()).status, 404);
  assert.equal(cached, undefined);
  assert.equal(await request('http://localhost/api/observations'), undefined);
  assert.equal(await request('https://another.example/asset.js'), undefined);
  assert.equal(await request('http://localhost/research.js', 'POST'), undefined);
  let activation;
  handlers.activate({ waitUntil: (p) => { activation = p; } });
  await activation;
  assert.deepEqual(removed, ['water-workbench-v10']);
});
