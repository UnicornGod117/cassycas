// Serves the built single-file app (dist/) over local HTTP in headless Chromium.
// Pyodide requests to jsDelivr are answered from the `pyodide` npm package, and SymPy/mpmath
// wheels from tests/.wheels (see `npm run test:setup`) with the lockfile hashes patched to
// match — so the whole suite, exact engine included, runs offline.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PYODIDE = path.join(ROOT, 'node_modules', 'pyodide');
const WHEELS = path.join(ROOT, 'tests', '.wheels');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.wasm': 'application/wasm', '.zip': 'application/zip', '.whl': 'application/zip',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

function patchedLock() {
  const lock = JSON.parse(fs.readFileSync(path.join(PYODIDE, 'pyodide-lock.json'), 'utf8'));
  for (const f of fs.existsSync(WHEELS) ? fs.readdirSync(WHEELS) : []) {
    const name = f.split('-')[0].toLowerCase();
    const entry = lock.packages[name];
    if (!entry) continue;
    entry.file_name = f;
    entry.sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(WHEELS, f))).digest('hex');
  }
  return JSON.stringify(lock);
}
export const hasWheels = () => fs.existsSync(WHEELS) && fs.readdirSync(WHEELS).some(f => f.startsWith('sympy'));

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(DIST, url === '/' ? 'index.html' : url);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// host 'localhost' lets the app register its service worker (it skips 127.0.0.1).
export async function openApp({ engine = true, hash = '', serviceWorkers = 'block', host = '127.0.0.1' } = {}) {
  const server = await serve();
  const origin = `http://${host}:${server.address().port}`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ serviceWorkers });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async route => {
    const url = route.request().url();
    const m = url.match(/cdn\.jsdelivr\.net\/pyodide\/v0\.26\.4\/full\/([^?]+)/);
    const headers = { 'access-control-allow-origin': '*' };
    if (m && engine) {
      const name = m[1];
      if (name === 'pyodide-lock.json') return route.fulfill({ body: patchedLock(), headers: { ...headers, 'content-type': 'application/json' } });
      for (const p of [path.join(PYODIDE, name), path.join(WHEELS, name)]) {
        if (fs.existsSync(p)) return route.fulfill({ path: p, headers: { ...headers, 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' } });
      }
    }
    return route.fulfill({ status: 404, body: '', headers });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  if (!engine) await page.addInitScript(() => { try { localStorage.setItem('cas-engine', 'off'); } catch {} });
  const ready = () => page.waitForFunction(() => window.CAS && window.CAS.ready, null, { timeout: 60000 });
  await page.goto(origin + '/' + hash);
  await ready();
  return {
    browser, context, page, errors, origin,
    close: async () => { await browser.close(); server.close(); },
    reload: async () => { await page.reload(); await ready(); },
    waitForEngine: () => page.waitForFunction(() => window.CAS.engine.status === 'ready', null, { timeout: 180000 }),
  };
}

// Run an expression through the real UI path in a mode; returns the cell's result.
export async function run(page, expr, mode = 'algebra') {
  return page.evaluate(([expr, mode]) => window.CAS.run(expr, mode), [expr, mode]);
}
