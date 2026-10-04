// Serves the built app (dist/) over local HTTP in headless Chromium. Used by the test suite
// (tests/harness.mjs) and the command line / local API (bin/cassycas.mjs).
// Pyodide requests to jsDelivr are answered from the `pyodide` npm package, and the SymPy,
// mpmath and gmpy2 wheels from tests/.wheels when they are there (`npm run test:setup`).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYODIDE_VERSION } from '../src/sympy/version.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PYODIDE = path.join(ROOT, 'node_modules', 'pyodide');
const WHEELS = path.join(ROOT, 'tests', '.wheels');
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.wasm': 'application/wasm', '.zip': 'application/zip', '.whl': 'application/zip',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2' };

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
// offline: answer every request from disk (tests); otherwise only Pyodide files that are on disk are
// served locally and the rest is fetched from the CDN (bin/cassycas.mjs).
export async function openApp({ engine = true, hash = '', serviceWorkers = 'block', host = '127.0.0.1', args = [], offline = true } = {}) {
  const server = await serve();
  const origin = `http://${host}:${server.address().port}`;
  const browser = await chromium.launch({ args, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ serviceWorkers });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async route => {
    const url = route.request().url();
    const name = url.startsWith(PYODIDE_CDN) && url.slice(PYODIDE_CDN.length).split('?')[0];
    const headers = { 'access-control-allow-origin': '*' };
    if (name && engine) {
      for (const p of [path.join(PYODIDE, name), path.join(WHEELS, name)]) {
        if (fs.existsSync(p)) return route.fulfill({ path: p, headers: { ...headers, 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' } });
      }
    }
    if (!offline) return route.continue();
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
