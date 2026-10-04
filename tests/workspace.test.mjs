// Notebook workspace: gallery, formulas, version history, undo/redo, the function library,
// Markdown/Quarto round trips, plug-ins, citations, read-aloud text and peer-to-peer collaboration.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, run, hasWheels } from './harness.mjs';
import { speak } from '../src/speech.js';
import { newer } from '../src/collab.js';

test('results read aloud in words', () => {
  assert.equal(speak('x^2 + 1'), 'x squared plus 1');
  assert.equal(speak('sqrt(2)/2'), 'the square root of 2, over 2');
  assert.equal(speak('x = -1 or x = 1'), 'x equals minus 1, or x equals 1');
  assert.equal(speak('sin(x)^3'), 'sine of x cubed');
});

test('collaboration versions are a total order', () => {
  assert.ok(newer([2, 'a'], [1, 'z']));
  assert.ok(newer([2, 'b'], [2, 'a']));
  assert.ok(!newer([2, 'a'], [2, 'b']));
  assert.ok(newer([1, 'a'], null));
});

describe('workspace', { skip: !hasWheels() && 'SymPy wheels missing: run `npm run test:setup`' }, () => {
  let app, page;
  before(async () => { app = await openApp(); page = app.page; await app.waitForEngine(); });
  after(async () => { await app?.close(); });
  const errorsInNotebook = () => page.evaluate(async () => {
    await window.CAS.idle();
    return window.CAS.cells.filter(c => c.kind === 'math' && c.error).map(c => `${c.expr}: ${c.error}`);
  });

  test('every gallery notebook runs without errors', async () => {
    const n = await page.evaluate(() => window.CAS.workspace.GALLERY.length);
    assert.ok(n >= 10);
    for (let i = 0; i < n; i++) {
      const title = await page.evaluate(async (i) => { await window.CAS.workspace.openGalleryItem(i); return window.CAS.workspace.GALLERY[i].title; }, i);
      assert.deepEqual(await errorsInNotebook(), [], title);
    }
  });

  test('every formula in the library runs', async () => {
    await page.evaluate(() => window.CAS.workspace.load({ version: 4, cells: [] }));
    const defs = await page.evaluate(() => window.CAS.workspace.FORMULAS.map(f => f.def));
    assert.ok(defs.length >= 40);
    for (const d of defs) {
      const r = await run(page, d);
      assert.ok(!r.error, `${d}: ${r.error}`);
    }
  });

  test('versions are recorded, named and restored; undo and redo', async () => {
    await page.evaluate(() => window.CAS.workspace.load({ version: 4, cells: [{ type: 'math', mode: 'algebra', expr: 'a1 = 1' }] }));
    await run(page, 'a2 = 2');
    await run(page, 'a3 = 3');
    const exprs = () => page.evaluate(() => window.CAS.cells.map(c => c.expr));
    assert.deepEqual(await exprs(), ['a1 = 1', 'a2 = 2', 'a3 = 3']);
    await page.evaluate(() => window.CAS.workspace.undo());
    assert.deepEqual(await exprs(), ['a1 = 1', 'a2 = 2']);
    await page.evaluate(() => window.CAS.workspace.undo());
    assert.deepEqual(await exprs(), ['a1 = 1']);
    await page.evaluate(() => window.CAS.workspace.redo());
    assert.deepEqual(await exprs(), ['a1 = 1', 'a2 = 2']);

    await page.evaluate(() => window.CAS.workspace.checkpoint('two cells'));
    await run(page, 'a4 = 4');
    const versions = await page.evaluate(() => window.CAS.workspace.WS.listVersions());
    const named = versions.find(v => v.label === 'two cells');
    assert.ok(named, 'the checkpoint is listed');
    const restored = await page.evaluate(async (id) => { const d = await window.CAS.workspace.WS.loadVersion(id); await window.CAS.workspace.load(d); return window.CAS.cells.map(c => c.expr); }, named.id);
    assert.deepEqual(restored, ['a1 = 1', 'a2 = 2']);
    // the history survives a reload (IndexedDB), and the notebook reopens as it was
    await app.reload();
    assert.ok((await page.evaluate(() => window.CAS.workspace.WS.listVersions())).some(v => v.label === 'two cells'));
    assert.deepEqual(await exprs(), ['a1 = 1', 'a2 = 2']);
    await app.waitForEngine();
  });

  test('the function library is available in every notebook', async () => {
    await page.evaluate(() => window.CAS.workspace.WS.librarySave('sq3', 'sq3(x) = 3x^2', 'test'));
    const list = await page.evaluate(() => window.CAS.workspace.WS.libraryList());
    assert.ok(list.some(f => f.name === 'sq3' && f.mine));
    assert.ok(list.some(f => f.name === 'sigmoid' && !f.mine), 'built-in entries are listed');
    await page.evaluate(() => window.CAS.workspace.WS.libraryRemove('sq3'));
    assert.ok(!(await page.evaluate(() => window.CAS.workspace.WS.libraryList())).some(f => f.name === 'sq3'));
  });

  test('Markdown and Quarto round trip', async () => {
    await page.evaluate(() => window.CAS.workspace.load({ version: 4, cells: [
      { type: 'text', content: '# Title\nSome *prose*.' },
      { type: 'math', mode: 'calculus', expr: 'integrate(x^2, x)' },
      { type: 'math', mode: 'algebra', expr: 'factor(x^2 - 1)' }] }));
    for (const quarto of [false, true]) {
      const md = await page.evaluate((q) => window.CAS.workspace.exportMarkdown(q), quarto);
      assert.match(md, quarto ? /```\{\.cas mode="calculus"\}/ : /```cas \{mode=calculus\}/);
      assert.match(md, /\n\$\$[^\n]*\\frac\{\{ x\}\^\{3\}\}\{3\}[^\n]*\$\$\n/);
      const back = await page.evaluate((md) => window.CAS.workspace.WS.fromMarkdown(md), md);
      assert.deepEqual(back.cells, [
        { type: 'text', content: '# Title\nSome *prose*.' },
        { type: 'math', mode: 'calculus', expr: 'integrate(x^2, x)' },
        { type: 'math', mode: 'algebra', expr: 'factor(x^2 - 1)' }]);
    }
  });

  test('JavaScript and Python plug-ins', async () => {
    await page.evaluate(() => window.CAS.plugins.register({
      name: 'double', sig: 'double(x)', desc: 'Twice x',
      run(args, { evaluate }) { const v = evaluate(args[0]); return { latex: String(2 * v), plain: String(2 * v) }; },
    }));
    assert.equal((await run(page, 'double(21)')).plain, '42');
    await page.evaluate(() => window.CAS.plugins.registerPython('cube', 'def t_cube(e):\n    return sp.expand(e**3)', { sig: 'cube(x)' }));
    assert.equal((await run(page, 'cube(x + 1)')).plain, 'x^3 + 3*x^2 + 3*x + 1');
    const refused = await page.evaluate(() => window.CAS.plugins.registerPython('factor', 'def t_factor(e):\n    return e').then(() => null, e => e.message));
    assert.match(refused, /built-in/);
    const refusedJs = await page.evaluate(() => { try { window.CAS.plugins.register({ name: 'solve', run() {} }); return null; } catch (e) { return e.message; } });
    assert.match(refusedJs, /built-in/);
  });

  test('citations', async () => {
    const { bib, apa } = await page.evaluate(() => window.CAS.workspace.WS.citations({ link: 'https://example.org/#nb=1' }));
    assert.match(bib, /@software\{cassycas/);
    assert.match(bib, /@article\{sympy/);
    assert.ok(apa.length >= 2);
  });

  test('the More menu opens each dialog; dialogs are labelled and close on Escape', async () => {
    for (const k of ['gallery', 'history', 'library', 'cite', 'plugins', 'collab']) {
      await page.evaluate((k) => window.CAS.workspace.more(k), k);
      await page.waitForSelector('#modal [role="dialog"]');
      const label = await page.evaluate(() => document.getElementById('modal-title').textContent);
      assert.ok(label.length > 2, k);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => !!document.getElementById('modal')), false, `${k} closes`);
    }
  });

  test('two browsers edit one notebook peer to peer', async () => {
    await page.evaluate(() => window.CAS.workspace.load({ version: 4, cells: [{ type: 'math', mode: 'algebra', expr: 'k = 5' }] }));
    const guest = await app.context.newPage();
    await guest.goto(app.origin + '/');
    await guest.waitForFunction(() => window.CAS && window.CAS.ready, null, { timeout: 60000 });
    // Signalling codes are made and read in both directions.
    const invite = await page.evaluate(() => window.CAS.collab.invite());
    assert.match(invite, /^CAS1\./);
    const reply = await guest.evaluate((inv) => window.CAS.collab.join(inv), invite);
    assert.match(reply, /^CAS1R\./);
    await page.evaluate((r) => window.CAS.collab.accept(r), reply);
    if (!process.env.CAS_WEBRTC) {
      // Headless Chromium on some hosts cannot complete ICE between two pages without trickle
      // (the same happens with two bare RTCPeerConnections), so by default the peers are joined
      // by an in-memory channel and everything above the transport is tested. CAS_WEBRTC=1
      // uses the real data channel.
      const bridge = async (from, to, role) => {
        await from.exposeFunction('__collabSend', (d) => to.evaluate((d) => window.__collabChannel.onmessage({ data: d }), d));
        await from.evaluate((role) => {
          const c = window.CAS.collab;
          c.role = role;
          window.__collabChannel = { readyState: 'open', send: (d) => { window.__collabSend(d).catch(() => {}); } };
          c.wire(window.__collabChannel);
        }, role);
      };
      await bridge(page, guest, 'host');
      await bridge(guest, page, 'guest');
      await guest.evaluate(() => window.__collabChannel.onopen());
      await page.evaluate(() => window.__collabChannel.onopen());
    }
    await guest.waitForFunction(() => window.CAS.collab.connected && window.CAS.cells.some(c => c.expr === 'k = 5'), null, { timeout: 20000 });
    // host → guest
    await run(page, 'k^2 + 1');
    await guest.waitForFunction(() => window.CAS.cells.some(c => c.expr === 'k^2 + 1'), null, { timeout: 10000 });
    // guest → host: an edit, then a new cell
    await guest.evaluate(async () => { const c = window.CAS.cells.find(c => c.expr === 'k = 5'); await window.CAS.editCell(c, 'k = 7'); });
    await page.waitForFunction(() => window.CAS.cells.some(c => c.expr === 'k = 7'), null, { timeout: 10000 });
    const value = await page.evaluate(async () => { await window.CAS.idle(); const c = window.CAS.cells.find(c => c.expr === 'k^2 + 1'); return document.getElementById(c.id).dataset.plain; });
    assert.equal(value, '50', 'dependent cells recompute on the host');
    await guest.evaluate(() => window.CAS.run('k - 1'));
    await page.waitForFunction(() => window.CAS.cells.some(c => c.expr === 'k - 1'), null, { timeout: 10000 });
    const both = await Promise.all([page, guest].map(p => p.evaluate(() => window.CAS.cells.map(c => c.expr))));
    assert.deepEqual(both[0], both[1], 'both peers converge');
    await guest.close();
  });

  test('accessibility: landmarks, labels, live region', async () => {
    const a = await page.evaluate(() => ({
      skip: !!document.querySelector('.skip-link'),
      live: document.getElementById('sr-live')?.getAttribute('aria-live'),
      unlabelled: [...document.querySelectorAll('button')].filter(b => b.offsetParent && !(b.getAttribute('aria-label') || b.textContent.trim() || b.title)).length,
      cellLabel: document.querySelector('.cell')?.getAttribute('aria-label'),
    }));
    assert.ok(a.skip);
    assert.equal(a.live, 'polite');
    assert.equal(a.unlabelled, 0);
    assert.match(a.cellLabel || '', /^Cell \d+: /);
    await run(page, 'x^2 = 4');
    const said = await page.evaluate(() => document.getElementById('sr-live').textContent);
    assert.match(said, /x equals/);
  });

  test('no page errors', () => { assert.deepEqual(app.errors, []); });
});
