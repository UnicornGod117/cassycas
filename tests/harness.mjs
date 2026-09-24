// Loads "CAS (new).html" in headless Chromium with every CDN request served from the
// pinned npm packages, so the suite runs offline and deterministically.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(ROOT, 'node_modules');
const PAGE = 'file://' + path.join(ROOT, 'CAS (new).html');
const MAP = [
  [/mathjax\/3\.2\.2\/es5\/(.*)$/, m => `${NM}/mathjax/es5/${m[1]}`],
  [/mathjs\/12\.4\.2\/math\.min\.js/, () => `${NM}/mathjs/lib/browser/math.js`],
  [/plotly\.js\/2\.27\.0\/plotly\.min\.js/, () => `${NM}/plotly.js-dist-min/plotly.min.js`],
  [/monaco-editor\/0\.45\.0\/min\/(.*)$/, m => `${NM}/monaco-editor/min/${m[1]}`],
  [/mathlive@0\.98\.6\/dist\/(.*)$/, m => `${NM}/mathlive/dist/${m[1]}`],
  [/algebrite@1\.4\.0\/dist\/(.*)$/, m => `${NM}/algebrite/dist/${m[1]}`],
];

export async function openApp() {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const url = route.request().url();
    if (/^(file|blob|data):/.test(url)) return route.continue();
    for (const [re, toPath] of MAP) {
      const m = url.match(re);
      if (!m) continue;
      let p = toPath(m).split('?')[0];
      if (!fs.existsSync(p)) p = p.replace(/\.min\.js$/, '.js');
      if (fs.existsSync(p)) {
        return route.fulfill({ path: p, headers: {
          'access-control-allow-origin': '*',
          'content-type': p.endsWith('.css') ? 'text/css' : 'application/javascript' } });
      }
    }
    return route.fulfill({ status: 404, body: '' });   // fonts etc.
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(PAGE);
  await page.waitForFunction(() => typeof math !== 'undefined' && typeof Algebrite !== 'undefined' && monReady, null, { timeout: 60000 });
  return { browser, context, page, errors, reload: async () => {
    await page.reload();
    await page.waitForFunction(() => typeof math !== 'undefined' && typeof Algebrite !== 'undefined' && monReady, null, { timeout: 60000 });
  } };
}

// Type an expression into the editor in the given mode, run it through the real UI path
// and return the cell's plain-text result (or {error}).
export async function run(page, expr, mode = 'algebra') {
  return page.evaluate(async ([expr, mode]) => {
    setMode(mode);
    mon.setValue(expr);
    await runCell();
    const cell = document.getElementById('c' + cellN);
    const out = document.getElementById('oc' + cellN);
    if (out.classList.contains('err')) return { error: out.innerText.trim() };
    return { plain: cell.dataset.plain, latex: cell.dataset.latex };
  }, [expr, mode]);
}
