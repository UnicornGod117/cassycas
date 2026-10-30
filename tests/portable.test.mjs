import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

test('root index opens from disk and calculates and graphs without a network', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ offline: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve('index.html')).href);
    await page.waitForFunction(() => window.CAS?.ready);
    assert.equal(await page.locator('#sidebar').evaluate(el => el.classList.contains('collapsed')), true);
    const result = await page.evaluate(() => CAS.run('sqrt(144) + 2^3'));
    assert.equal(result.plain, '20');
    const factored = await page.evaluate(() => CAS.run('factor(x^2 - 9)'));
    assert.ok(!factored.error, factored.error);
    const solved = await page.evaluate(() => CAS.run('solve(x^2 - 5*x + 6 = 0, x)', 'solve'));
    assert.ok(!solved.error, solved.error);
    assert.match(solved.plain, /2/);
    assert.match(solved.plain, /3/);
    await page.getByTitle('Graph', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#view-graph').classList.contains('on'));
    await page.locator('#ginp').fill('sin(x), x^2');
    await page.getByRole('button', { name: 'Plot 2D', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#gplot canvas')?.width > 0);
    assert.ok(await page.locator('#gplot canvas').count(), '2D plot is rendered');
    await page.getByTitle('Notebook', { exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/tmp/cassycas-mobile.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});
