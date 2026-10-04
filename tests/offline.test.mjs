// The hosted app works offline: after one online visit the service worker serves the app shell
// and the Pyodide/SymPy files, so a reload without network still reaches the exact engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, run, hasWheels } from './harness.mjs';

test('service worker: offline reload keeps the exact engine', { skip: !hasWheels() && 'SymPy wheels missing: run `npm run test:setup`' }, async () => {
  const app = await openApp({ host: 'localhost', serviceWorkers: 'allow' });
  try {
    await app.waitForEngine();
    await app.page.evaluate(() => navigator.serviceWorker.ready);
    await app.reload();                       // first controlled load populates the runtime cache
    await app.waitForEngine();
    assert.ok(await app.page.evaluate(() => !!navigator.serviceWorker.controller), 'page is controlled by the service worker');
    // No test routes from here on: anything not in the service worker's caches fails.
    await app.context.unrouteAll();
    await app.context.setOffline(true);
    await app.reload();
    await app.waitForEngine();
    const r = await run(app.page, 'factor(x^4 - 1)');
    assert.equal(r.engine, 'sympy');
    assert.match(r.plain.replace(/\s/g, ''), /\(x-1\)\*\(x\+1\)\*\(x\^2\+1\)/);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('the engine restarts from its memory snapshot on the next visit', { skip: !hasWheels() && 'SymPy wheels missing: run `npm run test:setup`' }, async () => {
  const app = await openApp();
  try {
    await app.waitForEngine();
    assert.equal(await app.page.evaluate(() => window.CAS.engine.boot), 'fresh');
    await app.page.waitForFunction(() => window.CAS.engine.snapshotBytes > 1e6, null, { timeout: 60000 });
    await app.reload();
    await app.waitForEngine();
    const { boot, bootMs } = await app.page.evaluate(() => window.CAS.engine);
    assert.equal(boot, 'snapshot');
    assert.ok(bootMs < 5000, `restoring took ${bootMs} ms`);
    const r = await run(app.page, 'integrate(x*sin(x), x)', 'calculus');
    assert.equal(r.engine, 'sympy');
    assert.equal(r.plain, '-x*cos(x) + sin(x) + C');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
