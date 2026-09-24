import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openApp, run } from './harness.mjs';

let app, page;
before(async () => { app = await openApp(); page = app.page; });
after(async () => { await app?.browser.close(); });

const ok = r => { assert.ok(!r.error, `unexpected error: ${r.error}`); return r.plain; };
// Evaluate a plain-text result numerically (in a clean mathjs instance inside the page).
const num = (s) => page.evaluate(s => math.evaluate(s.replace(/\s*\+\s*C$/, '')), s);
const setModes = (exact, angle) => page.evaluate(async ([exact, angle]) => {
  if (exactMode !== exact) await toggleExact();
  if (angleMode !== angle) await toggleAngle();
}, [exact, angle]);
async function close(expr, mode, expected, tol = 1e-9) {
  const v = await num(ok(await run(page, expr, mode)));
  assert.ok(Math.abs(v - expected) <= tol * (1 + Math.abs(expected)), `${expr}: got ${v}, expected ${expected}`);
}
// An antiderivative is correct when its derivative matches the integrand.
async function antiderivative(integrand) {
  const plain = ok(await run(page, `integrate(${integrand}, x)`, 'calculus'));
  assert.doesNotMatch(plain, /no elementary/, plain);
  const F = plain.replace(/\s*\+\s*C$/, '');
  const same = await page.evaluate(([F, f]) => numericallyEqual(math.derivative(F, 'x').toString(), f), [F, integrand]);
  assert.ok(same, `d/dx(${F}) ≠ ${integrand}`);
}

test('default Exact mode: arithmetic and showcased examples', async () => {
  await setModes(true, 'rad');
  assert.equal(ok(await run(page, '1/3 + 1/6')), '1/2');
  assert.equal(ok(await run(page, '0.1 + 0.2')), '3/10');
  assert.equal(ok(await run(page, 'sqrt(2)')), '1.414213562');
  assert.equal(ok(await run(page, 'pi^e')), '22.45915772');
  assert.equal(ok(await run(page, 'sin(pi/6)', 'trig')), '1/2');
  assert.equal(ok(await run(page, 'atan2(1,1)', 'trig')), '0.7853981634');
  assert.equal(ok(await run(page, 'e^(i*pi)', 'numeric')), '-1');
  assert.equal(ok(await run(page, 'std([1,2,3,4,5])', 'stats')), '1.58113883');
  assert.equal(ok(await run(page, 'quantileSeq([1..10], 0.75)', 'stats')), '31/4');
  assert.equal(ok(await run(page, 'bitAnd(0b1010,0b1100)', 'logic')), '8');
  assert.match(ok(await run(page, '1 acre to m^2', 'units')), /^4046\.86 m\^2$/);
  assert.match(ok(await run(page, '100 km/h to m/s', 'units')), /^27\.7777777\d* m \/ s$/);
  await close('phi^10', 'numeric', 122.99186938124421);
  await close('tan(60 deg)', 'trig', Math.sqrt(3));
});

test('every showcased example evaluates without error', async () => {
  const examples = await page.evaluate(() => Object.entries(MODES).flatMap(([k, m]) => m.ex.map(e => [e.expr, k])));
  for (const [expr, mode] of examples) {
    const r = await run(page, expr, mode);
    assert.ok(!r.error, `${expr}: ${r.error}`);
  }
});

test('solve: polynomials exactly, others numerically', async () => {
  await setModes(true, 'rad');
  assert.equal(ok(await run(page, 'solve(x^2-5x+6=0, x)', 'solve')), 'x = 2, x = 3');
  assert.equal(ok(await run(page, 'zeros(x^3-6x^2+11x-6, x)', 'solve')), 'x = 1, x = 2, x = 3');
  assert.match(ok(await run(page, 'solve(x^2 = 2, x)', 'solve')), /x = -sqrt\(2\) ≈ -1\.414213562, x = sqrt\(2\) ≈ 1\.414213562/);
  assert.equal(ok(await run(page, 'solve(x^2+1=0, x)', 'solve')), 'x = -i, x = i');
  assert.equal(ok(await run(page, 'solve(x - 1000 = 0, x)', 'solve')), 'x = 1000');
  assert.match(ok(await run(page, 'solve(x^2 - 5x + a = 0, x)', 'solve')), /25 - 4 \* a/);
  assert.match(ok(await run(page, 'solve(exp(x) = 1e6, x)', 'solve')), /^x = 13\.81551056$/);
  const sinRoots = ok(await run(page, 'solve(sin(x)=0, x)', 'solve'));
  assert.match(sinRoots, /x = 0\b/); assert.match(sinRoots, /x = 3\.14159265/);
  assert.equal(ok(await run(page, 'solve([x+y=10,2x-y=2],[x,y])', 'solve')), 'x=4, y=6');
  assert.equal(ok(await run(page, 'solve([x^2+y^2=25, x-y=1],[x,y])', 'solve')), 'x=4, y=3');
  assert.equal(ok(await run(page, 'solve(tan(x) = 0, x)', 'solve')).includes('1.570796'), false, 'poles are not roots');
});

test('integration: antiderivatives are verified, definite integrals accurate', async () => {
  await setModes(true, 'rad');
  for (const f of ['x^2+1', '3*x + 1', 'x + 1/2', '2*x^2 - 3', 'x^3 - 2*x', 'sec(x)^2', 'x*sin(x)', 'x*exp(x)',
                   '1/(x^2+4)', 'sin(3*x+1)', '1/(2*x+1)', '(2*x+1)^5', '2^x', 'x^2*log(x)', 'exp(-x)*3', 'tan(x)'])
    await antiderivative(f);
  assert.match(ok(await run(page, 'integrate(x^2 + exp(x^2), x)', 'calculus')), /no elementary antiderivative/);
  assert.equal(ok(await run(page, 'integrate(x^2, x, 0, 1)', 'calculus')), '1/3');
  assert.equal(ok(await run(page, 'integrate(sin(x), x, 0, pi)', 'calculus')), '2');
  await close('integrate(exp(-x^2), x, -Infinity, Infinity)', 'calculus', Math.sqrt(Math.PI), 1e-7);
  await close('integrate(1/sqrt(x), x, 0, 1)', 'calculus', 2, 1e-4);
});

test('limits: one- and two-sided, divergence, non-existence', async () => {
  await setModes(true, 'rad');
  const lim = async (e, want) => assert.equal(ok(await run(page, e, 'calculus')), want, e);
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
  await close('limit((1+1/x)^x, x, Infinity)', 'calculus', Math.E, 1e-7);
});

test('series, sums, algebra', async () => {
  await setModes(true, 'rad');
  assert.equal(ok(await run(page, 'series(sin(x), x, 0, 8)', 'calculus')), 'x - 1/6*x^3 + 1/120*x^5 - 1/5040*x^7 + O(x^9)');
  assert.equal(ok(await run(page, 'series(1/(1-x), x, 0, 3)', 'calculus')), '1 + x + x^2 + x^3 + O(x^4)');
  assert.match(ok(await run(page, 'series(cos(x), x, pi, 2)', 'calculus')), /^-1 \+ 1\/2\*\(x - pi\)\^2/);
  assert.match((await run(page, 'series(1/x, x, 0, 3)', 'calculus')).error, /not analytic/);
  assert.equal(ok(await run(page, 'sum(k^2, k, 1, 10)', 'calculus')), '385');
  assert.equal(ok(await run(page, 'product(k, k, 1, 5)', 'calculus')), '120');
  assert.equal(ok(await run(page, 'factor(x^3-8)')), '(x - 2) * (x ^ 2 + 2 * x + 4)');
  assert.equal(ok(await run(page, 'factor(x^4-1)')), '(x - 1) * (x + 1) * (x ^ 2 + 1)');
  assert.equal(ok(await run(page, 'factor(6x^2+x-2)')), '(2 * x - 1) * (3 * x + 2)');
  assert.equal(ok(await run(page, 'simplify((x^2-1)/(x-1))')), 'x + 1');
  assert.equal(ok(await run(page, 'expand((x-1)^3)')), 'x ^ 3 - 3 * x ^ 2 + 3 * x - 1');
  assert.match(ok(await run(page, 'apart((x^2+1)/(x^3-x), x)')), /^-?\(?-?1\)? \/ \(?x\)?/);
  const pf = ok(await run(page, 'apart((x^2+1)/(x^3-x), x)'));
  assert.ok(await page.evaluate(([a]) => numericallyEqual(a, '(x^2+1)/(x^3-x)'), [pf]));
  assert.equal(ok(await run(page, 'polydiv(x^3-1, x-1, x)')), 'quotient: x ^ 2 + x + 1, remainder: 0');
  assert.equal(ok(await run(page, 'polydiv(x^3+2, x-1, x)')), 'quotient: x ^ 2 + x + 1, remainder: 3');
  assert.equal(ok(await run(page, 'collect(x*a + x*b + 2*x + 3, x)')), '(2 + a + b) * x + 3');
});

test('workspace: definitions, reactivity, idempotent replays', async () => {
  await setModes(true, 'rad');
  await page.evaluate(() => clearDefs(true));
  assert.equal(ok(await run(page, 'a = 1/3')), 'a = 1/3');
  assert.equal(ok(await run(page, '3*a')), '1');
  assert.equal(ok(await run(page, 'n = 1')), 'n = 1');
  assert.equal(ok(await run(page, 'n = n + 1')), 'n = 2');
  assert.equal(await page.evaluate(() => scope.n), 2);
  await setModes(false, 'rad'); await setModes(true, 'rad');
  assert.equal(await page.evaluate(() => scope.n), 2, 'replaying must not re-increment');
  assert.equal(ok(await run(page, 'f(x) = a*x^2 + 3*x - 1')), 'f(x) = a*x^2 + 3*x - 1');
  assert.equal(ok(await run(page, 'derivative(f(x), x)', 'calculus')), '2 * a * x + 3');
  assert.equal(ok(await run(page, 'f(3)')), '11');   // a = 1/3
  // reactive chain: b depends on c, a later redefinition of c updates b and its dependants
  await run(page, 'c = 2'); await run(page, 'b = c * 10'); await run(page, 'b + 1');
  const idx = await page.evaluate(() => cellN);
  await run(page, 'c = 5');
  assert.equal(await page.evaluate(() => scope.b), 50);
  assert.equal(await page.evaluate(i => document.getElementById('c' + i).dataset.plain, idx), '51');
});

test('Approx mode shows decimals and never writes results into the workspace', async () => {
  await setModes(false, 'rad');
  await page.evaluate(() => { delete scope.x; });
  assert.equal(ok(await run(page, '1/3 + 1/6')), '0.5');
  assert.equal(ok(await run(page, 'solve(x - 7 = 0, x)', 'solve')), 'x = 7');
  assert.equal(await page.evaluate(() => scope.x), undefined);
  assert.equal(ok(await run(page, 'factor(x^2-1)')), '(x - 1) * (x + 1)');
  await setModes(true, 'rad');
});

test('degree mode converts whole arguments, respects units and user functions', async () => {
  await setModes(true, 'deg');
  await close('sin(30+60)', 'trig', 1);
  await close('sin(2*45)', 'trig', 1);
  await close('tan(60 deg)', 'trig', Math.sqrt(3));
  await close('asin(1)', 'trig', 90);
  await close('2^asin(1)', 'trig', 2 ** 90, 1e-5);
  await run(page, 'g(t) = sin(t)');
  await close('g(90)', 'trig', 1);
  await setModes(true, 'rad');
  await close('g(pi/2)', 'trig', 1);
});

test('state survives a reload and session files round-trip', async () => {
  await setModes(true, 'rad');
  await run(page, 'keep = 5');
  await run(page, 'M = [[1,2],[3,4]]');
  await app.reload();
  assert.equal(ok(await run(page, 'keep + 1')), '6');
  assert.equal(ok(await run(page, 'det(M)', 'matrix')), '-2');
  const file = path.join(os.tmpdir(), `cas-${process.pid}.cas`);
  fs.writeFileSync(file, JSON.stringify({ version: 3, scope: { k0: 7 }, cells: [
    { type: 'text', content: 'notes' }, { type: 'math', expr: 'k1 = k0 * 2', mode: 'algebra' }, { type: 'math', expr: 'k1 + 1', mode: 'algebra' } ] }));
  const before = await page.evaluate(() => cellN);
  await page.setInputFiles('#floader', file);
  await page.waitForFunction(n => cellN >= n + 2 && document.getElementById('c' + cellN).dataset.plain, before);
  assert.equal(await page.evaluate(() => document.getElementById('c' + cellN).dataset.plain), '15');
});

test('security: hostile session files and inputs cannot inject markup or script', async () => {
  const file = path.join(os.tmpdir(), `evil-${process.pid}.cas`);
  fs.writeFileSync(file, JSON.stringify({ version: 2,
    scope: { 'q" onmouseover="window.__pwn=1" x="': 1, __proto__: { polluted: 1 }, ok1: 1 },
    cells: [{ type: 'math', expr: `"x'); window.__pwn2=1; ('" <img src=x onerror=window.__pwn3=1>`, mode: 'algebra' }] }));
  await page.setInputFiles('#floader', file);
  await page.waitForTimeout(800);
  for (const d of await page.$$('.def')) await d.hover();
  await page.evaluate(() => document.querySelectorAll('.cexpr, .cact').forEach(b => b.click()));
  await run(page, '"<img src=x onerror=window.__pwn4=1>"');
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => [window.__pwn, window.__pwn2, window.__pwn3, window.__pwn4, ({}).polluted]),
    [undefined, undefined, undefined, undefined, undefined]);
  assert.equal(await page.evaluate(() => Object.keys(scope).filter(k => !/^[A-Za-z_]\w*$/.test(k)).length), 0);
});

test('a runaway computation is killed and the kernel recovers', async () => {
  await setModes(false, 'rad');
  await run(page, 'fib(n) = n < 2 ? n : fib(n-1) + fib(n-2)');
  const r = await run(page, 'fib(40)');
  assert.match(r.error, /timed out/);
  const t = Date.now();
  assert.equal(ok(await run(page, '1+1')), '2');
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
