// Reproducible visual audit. Run after build:single; images stay outside source control.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const dir = '/tmp/cassycas-audit'; await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(pathToFileURL(path.resolve('index.html')).href); await page.waitForFunction(() => window.CAS?.ready);
const findings = [];
for (const [size, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
  await page.setViewportSize(viewport);
  for (const view of ['nb', 'graph', 'library', 'settings']) {
    await page.evaluate(v => switchView(v), view); await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${size}-${view}.png` });
    findings.push(await page.evaluate(([size, view]) => ({ size, view, overflow: document.documentElement.scrollWidth > innerWidth, visibleButtonsWithoutNames: [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width && !b.textContent.trim() && !b.getAttribute('aria-label') && !b.title).length }), [size, view]));
  }
}
await page.setViewportSize({ width: 1440, height: 1000 });
await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
await page.evaluate(() => switchView('nb')); await page.waitForTimeout(200);
await page.screenshot({ path: `${dir}/desktop-dark.png` });
await page.evaluate(() => switchView('settings'));
await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
await page.evaluate(() => switchView('graph'));
await page.getByRole('textbox', { name: 'Expression 1', exact: true }).fill('x^2');
await page.getByRole('textbox', { name: 'Expression 2', exact: true }).fill('a*sin(x)');
await page.waitForSelector('input[data-param="a"]');
await page.getByLabel('Inspect at x', { exact: true }).fill('2');
await page.getByLabel('Area upper bound').fill('3');
await page.getByLabel('Tangent', { exact: true }).check();
await page.getByRole('button', { name: /Value table/ }).click();
await page.screenshot({ path: `${dir}/desktop-analysis.png` });
console.log(JSON.stringify({ errors, findings, dir }, null, 2));
await browser.close();
