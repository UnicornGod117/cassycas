// End-to-end tests against the built app (run `npm run build` first). Every test runs twice:
// once with the exact engine (SymPy on Pyodide, needs `npm run test:setup`) and once with it
// disabled, so the JavaScript fallback engine is held to the same answers.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openApp, run, hasWheels } from './harness.mjs';

const ENGINES = (process.env.CAS_ENGINES || 'exact,fallback').split(',');

for (const name of ENGINES) {
  const exact = name === 'exact';
  describe(`${name} engine`, { skip: exact && !hasWheels() && 'SymPy wheels missing: run `npm run test:setup`' }, () => {
    let app, page;
    before(async () => {
      app = await openApp({ engine: exact });
      page = app.page;
      if (exact) await app.waitForEngine();
    });
    after(async () => { await app?.close(); });

    const ok = (r) => { assert.ok(!r.error, `unexpected error: ${r.error}`); return r.plain; };
    const flat = (s) => s.replace(/\s+/g, '');
    // Engines format differently ("(x - 3)*(x - 2)" vs "(x - 3) * (x - 2)"); compare without spaces.
    const same = (got, ...want) => assert.ok(want.some(w => flat(got) === flat(w)), `got ${got}, want ${want.join(' | ')}`);
    const res = (expr, mode) => run(page, expr, mode);
    const is = async (expr, mode, ...want) => same(ok(await res(expr, mode)), ...want);
    // Evaluate a plain-text result numerically (mathjs in the page).
    const num = (s) => page.evaluate(s => window.CAS.math.evaluate(s.replace(/\s*\+\s*C$/, '').replace(/\bexp\(/g, 'exp(').replace(/\*\*/g, '^')), s);
    const equiv = (a, b) => page.evaluate(([a, b]) => window.CAS.numericallyEqual(a.replace(/\*\*/g, '^'), b), [a, b]);
    const setModes = (ex, angle) => page.evaluate(async ([ex, angle]) => { await window.CAS.setExact(ex); await window.CAS.setAngle(angle); }, [ex, angle]);
    const lastPlain = () => page.evaluate(() => { const c = window.CAS.cells.filter(c => c.kind === 'math').at(-1); return document.getElementById(c.id).dataset.plain; });
    async function close(expr, mode, expected, tol = 1e-9) {
      const v = await num(ok(await res(expr, mode)).replace(/\s*≈.*$/, ''));
      assert.ok(Math.abs(v - expected) <= tol * (1 + Math.abs(expected)), `${expr}: got ${v}, expected ${expected}`);
    }
    // An antiderivative is correct when its derivative matches the integrand.
    async function antiderivative(integrand) {
      const plain = ok(await res(`integrate(${integrand}, x)`, 'calculus'));
      assert.doesNotMatch(plain, /no elementary/, plain);
      const F = plain.replace(/\s*\+\s*C$/, '').replace(/\*\*/g, '^');
      const good = await page.evaluate(([F, f]) => window.CAS.numericallyEqual(window.CAS.math.derivative(F, 'x').toString(), f), [F, integrand]);
      assert.ok(good, `d/dx(${F}) ≠ ${integrand}`);
    }

    test('exact arithmetic and showcased examples', async () => {
      await setModes(true, 'rad');
      await is('1/3 + 1/6', 'algebra', '1/2');
      await is('0.1 + 0.2', 'algebra', '3/10');
      await is('sin(pi/6)', 'trig', '1/2');
      await is('e^(i*pi)', 'numeric', '-1');
      await is('std([1,2,3,4,5])', 'stats', '1.58113883', 'sqrt(10)/2 ≈ 1.58113883');
      await is('quantileSeq([1..10], 0.75)', 'stats', '31/4');
      await is('bitAnd(0b1010,0b1100)', 'logic', '8');
      assert.match(ok(await res('1 acre to m^2', 'units')), /^4046\.86\d* m\^2$/);
      assert.match(ok(await res('100 km/h to m/s', 'units')), /^27\.7777777\d* m \/ s$/);
      if (exact) {
        await is('sqrt(8) + sqrt(2)', 'algebra', '3*sqrt(2) ≈ 4.242640687');
        await is('sqrt(2)', 'algebra', 'sqrt(2) ≈ 1.414213562');
      } else {
        await is('sqrt(2)', 'algebra', '1.414213562');
      }
      await close('pi^e', 'algebra', Math.PI ** Math.E);
      await close('atan2(1,1)', 'trig', Math.PI / 4);
      await close('phi^10', 'numeric', 122.99186938124421);
      await close('tan(60 deg)', 'trig', Math.sqrt(3));
    });

    test('every showcased example evaluates without error', async () => {
      const examples = await page.evaluate(() => Object.entries(window.CAS.MODES).flatMap(([k, m]) => m.ex.map(e => [e.expr, k])));
      for (const [expr, mode] of examples) {
        const r = await res(expr, mode);
        // Without SymPy the fallback may decline, but only by pointing at the exact engine.
        assert.ok(!r.error || (!exact && /exact engine/.test(r.error)), `${expr}: ${r.error}`);
      }
    });

    test('solve: polynomials exactly, others numerically', async () => {
      await setModes(true, 'rad');
      await is('solve(x^2-5x+6=0, x)', 'solve', 'x = 2, x = 3');
      await is('zeros(x^3-6x^2+11x-6, x)', 'solve', 'x = 1, x = 2, x = 3');
      assert.match(ok(await res('solve(x^2 = 2, x)', 'solve')), /x = -sqrt\(2\) ≈ -1\.414213562, x = sqrt\(2\) ≈ 1\.414213562/);
      await is('solve(x^2+1=0, x)', 'solve', 'x = -i, x = i');
      await is('solve(x - 1000 = 0, x)', 'solve', 'x = 1000');
      assert.match(flat(ok(await res('solve(x^2 - 5x + a = 0, x)', 'solve'))), /25-4\*a/);
      const e6 = ok(await res('solve(exp(x) = 1e6, x)', 'solve'));
      assert.match(e6, exact ? /^x = (6\*log\(10\)|log\(1000000\)) ≈ 13\.81551056$/ : /^x = 13\.81551056$/);
      const sinRoots = ok(await res('solve(sin(x)=0, x)', 'solve'));
      if (exact) assert.match(sinRoots, /pi/);
      else { assert.match(sinRoots, /x = 0\b/); assert.match(sinRoots, /x = 3\.14159265/); }
      await is('solve([x+y=10,2x-y=2],[x,y])', 'solve', 'x=4, y=6');
      assert.match(flat(ok(await res('solve([x^2+y^2=25, x-y=1],[x,y])', 'solve'))), /x=4,y=3/);
      assert.equal(ok(await res('solve(tan(x) = 0, x)', 'solve')).includes('1.570796'), false, 'poles are not roots');
    });

    test('integration: antiderivatives are verified, definite integrals accurate', async () => {
      await setModes(true, 'rad');
      for (const f of ['x^2+1', '3*x + 1', 'x + 1/2', '2*x^2 - 3', 'x^3 - 2*x', 'sec(x)^2', 'x*sin(x)', 'x*exp(x)',
                       '1/(x^2+4)', 'sin(3*x+1)', '1/(2*x+1)', '(2*x+1)^5', '2^x', 'x^2*log(x)', 'exp(-x)*3', 'tan(x)'])
        await antiderivative(f);
      const nonElem = ok(await res('integrate(x^2 + exp(x^2), x)', 'calculus'));
      if (exact) assert.match(nonElem, /erfi/); else assert.match(nonElem, /no elementary antiderivative/);
      await is('integrate(x^2, x, 0, 1)', 'calculus', '1/3');
      await is('integrate(sin(x), x, 0, pi)', 'calculus', '2');
      await close('integrate(exp(-x^2), x, -Infinity, Infinity)', 'calculus', Math.sqrt(Math.PI), 1e-7);
      await close('integrate(1/sqrt(x), x, 0, 1)', 'calculus', 2, 1e-4);
    });

    test('limits: one- and two-sided, divergence, non-existence', async () => {
      await setModes(true, 'rad');
      const lim = (e, ...want) => is(e, 'calculus', ...want);
      await lim('limit(sin(x)/x, x, 0)', '1');
      await lim('limit(x^2, x, 0)', '0');
      await lim('limit(x^2 + x, x, 0)', '0');
      await lim('limit((1-cos(x))/x^2, x, 0)', '1/2');
      await lim('limit(x*sin(1/x), x, 0)', '0');
      await lim('limit(1/x, x, 0)', 'does not exist');
      await lim('limit(abs(x)/x, x, 0)', 'does not exist');
      await lim('limit(abs(x)/x, x, 0, "+")', '1');
      await lim('limit(1/x, x, 0, "-")', '-Infinity');
      await lim('limit(1/x^2, x, 0)', 'Infinity');
      await lim('limit(log(x), x, 0, "+")', '-Infinity');
      await lim('limit(exp(-x), x, Infinity)', '0');
      await lim('limit(sin(1/x), x, 0)', 'does not exist');
      if (exact) await lim('limit((1+1/x)^x, x, Infinity)', 'e ≈ 2.718281828', 'E ≈ 2.718281828');
      else await close('limit((1+1/x)^x, x, Infinity)', 'calculus', Math.E, 1e-7);
    });

    test('series and sums', async () => {
      await setModes(true, 'rad');
      await is('series(sin(x), x, 0, 8)', 'calculus', 'x - 1/6*x^3 + 1/120*x^5 - 1/5040*x^7 + O(x^9)', 'x - x^3/6 + x^5/120 - x^7/5040 + O(x^9)');
      await is('series(1/(1-x), x, 0, 3)', 'calculus', '1 + x + x^2 + x^3 + O(x^4)');
      assert.match(flat(ok(await res('series(cos(x), x, pi, 2)', 'calculus'))), /^-1\+(1\/2\*)?\(x-pi\)\^2(\/2)?/);
      const lau = await res('series(1/x, x, 0, 3)', 'calculus');
      if (exact) same(ok(lau), '1/x + O(x^4)');   // SymPy gives the Laurent series
      else assert.match(lau.error, /not analytic/);
      await is('sum(k^2, k, 1, 10)', 'calculus', '385');
      await is('product(k, k, 1, 5)', 'calculus', '120');
    });

    test('algebra: factor, simplify, expand, apart, polydiv, collect', async () => {
      await setModes(true, 'rad');
      // Factor order differs between engines; check the factors and the product.
      const factors = async (e, want) => {
        const got = ok(await res(`factor(${e})`));
        for (const f of want) assert.ok(flat(got).includes(flat(f)), `factor(${e}) = ${got}: missing ${f}`);
        assert.ok(await equiv(got, e), `factor(${e}) = ${got} is not equal to ${e}`);
      };
      await factors('x^3-8', ['(x - 2)', 'x^2 + 2*x + 4']);
      await factors('x^4-1', ['(x - 1)', '(x + 1)', '(x^2 + 1)']);
      await factors('6x^2+x-2', ['(2*x - 1)', '(3*x + 2)']);
      await is('simplify((x^2-1)/(x-1))', 'algebra', 'x + 1');
      await is('expand((x-1)^3)', 'algebra', 'x^3 - 3*x^2 + 3*x - 1', 'x ^ 3 - 3 * x ^ 2 + 3 * x - 1');
      const pf = ok(await res('apart((x^2+1)/(x^3-x), x)'));
      assert.ok(await equiv(pf, '(x^2+1)/(x^3-x)'), pf);
      assert.match(flat(ok(await res('polydiv(x^3-1, x-1, x)'))), /quotient:x\^2\+x\+1,remainder:0/);
      assert.match(flat(ok(await res('polydiv(x^3+2, x-1, x)'))), /quotient:x\^2\+x\+1,remainder:3/);
      const col = ok(await res('collect(x*a + x*b + 2*x + 3, x)'));
      assert.equal(flat(col).match(/x/g).length, 1, `x collected once: ${col}`);
      assert.ok(await equiv(col.replace(/\ba\b/g, '1.7').replace(/\bb\b/g, '-0.3'), '1.7*x - 0.3*x + 2*x + 3'), col);
    });

    test('workspace: definitions, reactivity, idempotent replays', async () => {
      await setModes(true, 'rad');
      await page.evaluate(() => window.CAS.clearDefs(true));
      await is('a = 1/3', 'algebra', 'a = 1/3');
      await is('3*a', 'algebra', '1');
      await is('n = 1', 'algebra', 'n = 1');
      await is('n = n + 1', 'algebra', 'n = 2');
      assert.equal(await page.evaluate(() => window.CAS.scope.n), 2);
      await setModes(false, 'rad'); await setModes(true, 'rad');
      assert.equal(await page.evaluate(() => window.CAS.scope.n), 2, 'replaying must not re-increment');
      await is('f(x) = a*x^2 + 3*x - 1', 'algebra', 'f(x) = a*x^2 + 3*x - 1');
      const d = ok(await res('derivative(f(x), x)', 'calculus'));
      assert.ok(await equiv(d.replace(/\ba\b/g, '(1/3)'), '2/3*x + 3'), d);
      await is('f(3)', 'algebra', '11');   // a = 1/3
      // reactive chain: editing c in place re-runs b and its dependants, in notebook order
      const cId = (await res('c = 2')).id; await res('b = c * 10');
      const id = (await res('b + 2')).id;
      await page.evaluate(async id => { await window.CAS.editCell(window.CAS.cells.find(c => c.id === id), 'c = 5'); await window.CAS.idle(); }, cId);
      assert.equal(await page.evaluate(() => window.CAS.scope.b), 50);
      assert.equal(await page.evaluate(id => document.getElementById(id).dataset.plain, id), '52');
      // a later redefinition only affects the cells below it
      await res('c = 7');
      await is('b', 'algebra', '50');
      await is('c * 10', 'algebra', '70');
    });

    test('Approx mode shows decimals and never writes results into the workspace', async () => {
      await setModes(false, 'rad');
      await page.evaluate(() => { delete window.CAS.scope.x; });
      await is('1/3 + 1/6', 'algebra', '0.5');
      await is('solve(x - 7 = 0, x)', 'solve', 'x = 7');
      assert.equal(await page.evaluate(() => window.CAS.scope.x), undefined);
      await is('factor(x^2-1)', 'algebra', '(x - 1) * (x + 1)');
      await setModes(true, 'rad');
    });

    test('degree mode converts whole arguments, respects units and user functions', async () => {
      await setModes(true, 'deg');
      await close('sin(30+60)', 'trig', 1);
      await close('sin(2*45)', 'trig', 1);
      await close('tan(60 deg)', 'trig', Math.sqrt(3));
      await close('asin(1)', 'trig', 90);
      await close('2^asin(1)', 'trig', 2 ** 90, 1e-5);
      await res('g(t) = sin(t)');
      await close('g(90)', 'trig', 1);
      await setModes(true, 'rad');
      await close('g(pi/2)', 'trig', 1);
    });

    test('state survives a reload and session files round-trip', async () => {
      await setModes(true, 'rad');
      await res('keep = 5');
      await res('M = [[1,2],[3,4]]');
      await app.reload();
      if (exact) await app.waitForEngine();
      await is('keep + 1', 'algebra', '6');
      await is('det(M)', 'matrix', '-2');
      const file = path.join(os.tmpdir(), `cas-${process.pid}.cas`);
      fs.writeFileSync(file, JSON.stringify({ version: 3, scope: { k0: 7 }, cells: [
        { type: 'text', content: 'notes' }, { type: 'math', expr: 'k1 = k0 * 2', mode: 'algebra' }, { type: 'math', expr: 'k1 + 1', mode: 'algebra' } ] }));
      await page.setInputFiles('#floader', file);
      await page.waitForFunction(() => { const c = window.CAS.cells.filter(c => c.kind === 'math').at(-1); return c && c.expr === 'k1 + 1' && document.getElementById(c.id).dataset.plain; });
      assert.equal(await lastPlain(), '15');
    });

    test('shared links round-trip the notebook', async () => {
      await res('shared = 21');
      await res('shared * 2');
      const link = await page.evaluate(() => window.CAS.shareLink());
      const other = await openApp({ engine: false, hash: link.slice(link.indexOf('#')) });
      try {
        await other.page.waitForFunction(() => window.CAS.cells.some(c => c.expr === 'shared * 2'));
        await other.page.evaluate(() => window.CAS.idle());
        assert.equal(await other.page.evaluate(() => { const c = window.CAS.cells.find(c => c.expr === 'shared * 2'); return document.getElementById(c.id).dataset.plain; }), '42');
      } finally { await other.close(); }
    });

    test('security: hostile session files and inputs cannot inject markup or script', async () => {
      const file = path.join(os.tmpdir(), `evil-${process.pid}.cas`);
      fs.writeFileSync(file, JSON.stringify({ version: 2,
        scope: { 'q" onmouseover="window.__pwn=1" x="': 1, __proto__: { polluted: 1 }, ok1: 1 },
        cells: [{ type: 'math', expr: `"x'); window.__pwn2=1; ('" <img src=x onerror=window.__pwn3=1>`, mode: 'algebra' }] }));
      await page.setInputFiles('#floader', file);
      await page.waitForTimeout(800);
      await page.evaluate(() => document.querySelectorAll('.def').forEach(d => d.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))));
      await res('"<img src=x onerror=window.__pwn4=1>"');
      await res('x^2 + 1');   // gives the explore menu something to open
      await page.evaluate(() => document.querySelectorAll('[data-p]').forEach(b => b.dispatchEvent(new MouseEvent('click', { bubbles: true }))));
      await page.waitForTimeout(300);
      assert.deepEqual(await page.evaluate(() => [window.__pwn, window.__pwn2, window.__pwn3, window.__pwn4, ({}).polluted]),
        [undefined, undefined, undefined, undefined, undefined]);
      assert.equal(await page.evaluate(() => Object.keys(window.CAS.scope).filter(k => !/^[A-Za-z_]\w*$/.test(k)).length), 0);
    });

    test('a runaway computation is killed and the kernel recovers', async () => {
      await setModes(false, 'rad');
      await res('fib(n) = n < 2 ? n : fib(n-1) + fib(n-2)');
      const r = await res('fib(40)');
      assert.match(r.error, /timed out/);
      const t = Date.now();
      await is('1+1', 'algebra', '2');
      assert.ok(Date.now() - t < 3000, 'kernel must be responsive immediately after a timeout');
      await setModes(true, 'rad');
    });

    test('UI: palette, sidebar toggle, unique ids, no page errors', async () => {
      assert.ok(await page.evaluate(() => { openPalette(); const n = document.querySelectorAll('.palette-item').length; closePalette(); return n; }) > 10);
      await page.evaluate(() => toggleSidebar());
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().width), 0);
      await page.click('#view-tab-panel');
      await page.waitForTimeout(400);
      assert.ok(await page.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().width) > 200);
      const dup = await page.evaluate(() => { const c = {}; document.querySelectorAll('[id]').forEach(e => c[e.id] = (c[e.id] || 0) + 1); return Object.keys(c).filter(k => c[k] > 1); });
      assert.deepEqual(dup, []);
      assert.deepEqual(app.errors, []);
    });
  });
}
