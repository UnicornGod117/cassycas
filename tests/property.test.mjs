// Property-based tests: seeded random expressions are put through the real UI path, and each
// answer is checked against an oracle that shares no code with the engine (mathjs in Node,
// central differences, Simpson's rule). A failure prints the seed and the expression, so it can
// be replayed: PROPERTY_SEED=<seed> node --test tests/property.test.mjs
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { create, all } from 'mathjs';
import { openApp, run, hasWheels } from './harness.mjs';

const math = create(all);
const SEED = Number(process.env.PROPERTY_SEED) || 20261005;
const CASES = Number(process.env.PROPERTY_CASES) || 12;

// Park–Miller generator: the same seed gives the same expressions on every machine.
function rng(seed) {
  let s = seed % 2147483647 || 1;
  const next = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return { next, int: (a, b) => a + Math.floor(next() * (b - a + 1)), pick: (xs) => xs[Math.floor(next() * xs.length)] };
}
const coef = (r) => r.pick([1, 2, 3, -1, -2, 5, 1 / 2]).toString().replace('0.5', '1/2');
function poly(r, deg = r.int(1, 3)) {
  const terms = [];
  for (let k = deg; k >= 0; k--) if (k === deg || r.next() < 0.6) terms.push(k === 0 ? coef(r) : `${coef(r)}*x${k > 1 ? '^' + k : ''}`);
  return terms.join(' + ');
}
// Smooth on the real line, so derivatives and integrals can be checked anywhere.
function smooth(r, depth = 2) {
  if (depth === 0) return r.pick(['x', poly(r, 1), poly(r, 2)]);
  const a = smooth(r, depth - 1), b = smooth(r, depth - 1);
  return r.pick([
    `(${a}) + (${b})`, `(${a}) * (${b})`, `sin(${a})`, `cos(${a})`, `exp(${poly(r, 1)})`,
    `(${a})^2`, `log(x^2 + ${r.int(1, 4)})`, `sqrt(x^2 + ${r.int(1, 4)})`, `atan(${a})`,
  ]);
}
// Families SymPy integrates in closed form.
function integrable(r) {
  return r.pick([
    () => `(${poly(r)}) * exp(${coef(r)}*x)`, () => `(${poly(r, 2)}) * sin(${r.int(1, 3)}*x)`, () => `(${poly(r, 2)}) * cos(${r.int(1, 3)}*x)`,
    () => `1/(x^2 + ${r.int(1, 9)})`, () => `x/(x^2 + ${r.int(1, 9)})`, () => `(${poly(r, 3)})`, () => `sin(x)^${r.int(2, 4)}`,
    () => `x * log(x^2 + ${r.int(1, 4)})`, () => `exp(x) * sin(x)`,
  ])();
}

const PTS = [-1.37, -0.61, 0.23, 0.9, 1.7];
const at = (expr, x) => { const v = math.evaluate(expr.replace(/\bE\b/g, 'e').replace(/\bI\b/g, 'i'), { x }); return typeof v === 'number' ? v : (v && v.re !== undefined && Math.abs(v.im) < 1e-9 ? v.re : NaN); };
const close = (a, b, tol = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol * (1 + Math.abs(a) + Math.abs(b));
const deriv = (f, x, h = 1e-4) => (-at(f, x + 2 * h) + 8 * at(f, x + h) - 8 * at(f, x - h) + at(f, x - 2 * h)) / (12 * h);
function simpson(f, a, b, n = 400) {
  const h = (b - a) / n;
  let s = at(f, a) + at(f, b);
  for (let k = 1; k < n; k++) s += (k % 2 ? 4 : 2) * at(f, a + k * h);
  return s * h / 3;
}
const rhs = (plain) => plain.replace(/\s*\+\s*C\s*$/, '').replace(/^.*=\s*/, '');

describe('property-based tests', { skip: !hasWheels() && 'SymPy wheels missing: run `npm run test:setup`' }, () => {
  let app, page;
  before(async () => { app = await openApp(); page = app.page; await app.waitForEngine(); });
  after(async () => { await app?.close(); });
  const answer = async (input, mode) => {
    const r = await run(page, input, mode);
    assert.ok(!r.error, `seed ${SEED}: ${input} → error ${r.error}`);
    return r.plain;
  };

  test('d/dx agrees with finite differences', async () => {
    const r = rng(SEED);
    for (let i = 0; i < CASES; i++) {
      const f = smooth(r);
      const d = rhs(await answer(`diff(${f}, x)`, 'calculus'));
      for (const x of PTS) assert.ok(close(at(d, x), deriv(f, x), 1e-5), `seed ${SEED}: d/dx ${f} = ${d} at x = ${x}: ${at(d, x)} vs ${deriv(f, x)}`);
    }
  });

  test('antiderivatives differentiate back to the integrand', async () => {
    const r = rng(SEED + 1);
    for (let i = 0; i < CASES; i++) {
      const f = integrable(r);
      const F = rhs(await answer(`integrate(${f}, x)`, 'calculus'));
      assert.ok(!/integral|Integral/.test(F), `seed ${SEED}: ∫ ${f} left unevaluated`);
      for (const x of PTS) assert.ok(close(deriv(F, x), at(f, x), 1e-5), `seed ${SEED}: ∫ ${f} dx = ${F}; F'(${x}) = ${deriv(F, x)}, f = ${at(f, x)}`);
    }
  });

  test('definite integrals agree with Simpson’s rule', async () => {
    const r = rng(SEED + 2);
    for (let i = 0; i < CASES; i++) {
      const f = integrable(r), a = r.int(-2, 0), b = r.int(1, 3);
      const plain = await answer(`integrate(${f}, x, ${a}, ${b})`, 'calculus');
      const v = at(plain.replace(/\s*≈.*$/, '').replace(/^.*=\s*/, ''), 0);
      assert.ok(close(v, simpson(f, a, b), 1e-7), `seed ${SEED}: ∫_${a}^${b} ${f} = ${plain} (${v}) vs ${simpson(f, a, b)}`);
    }
  });

  test('expand and factor preserve the value', async () => {
    const r = rng(SEED + 3);
    for (let i = 0; i < CASES; i++) {
      const p = `(${poly(r, r.int(1, 2))}) * (${poly(r, r.int(1, 2))})`;
      for (const op of ['expand', 'factor', 'simplify']) {
        const out = rhs(await answer(`${op}(${p})`, 'algebra'));
        for (const x of PTS) assert.ok(close(at(out, x), at(p, x), 1e-9), `seed ${SEED}: ${op}(${p}) = ${out} at ${x}`);
      }
    }
  });

  test('every root that solve returns satisfies the equation', async () => {
    const r = rng(SEED + 4);
    for (let i = 0; i < CASES; i++) {
      const roots = Array.from({ length: r.int(1, 3) }, () => r.int(-4, 4));
      const p = math.simplify(roots.map(k => `(x - (${k}))`).join(' * ') + (r.next() < 0.5 ? ` + ${r.int(1, 3)}` : '')).toString();
      const plain = await answer(`solve(${p} = 0, x)`, 'algebra');
      const sols = plain.split(/,\s*(?=x\s*=)|\s+or\s+/).map(s => s.replace(/^x\s*=\s*/, '').replace(/\s*≈.*$/, '').trim()).filter(Boolean);
      assert.ok(sols.length >= 1, `seed ${SEED}: solve(${p} = 0) gave no roots: ${plain}`);
      for (const s of sols) {
        const v = math.evaluate(p, { x: math.evaluate(s.replace(/\bI\b/g, 'i')) });
        assert.ok(math.abs(v) < 1e-6, `seed ${SEED}: ${p} at x = ${s} is ${v}`);
      }
    }
  });
});
