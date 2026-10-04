// Named tools (src/tools.js ↔ src/sympy/tools.py), probability distributions and plot(...).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, run, hasWheels, latexProblems } from './harness.mjs';
import { TOOLS } from '../src/tools.js';
import { JS_NUMBER_THEORY } from '../src/kernel/numtheory.js';

const ENGINES = (process.env.CAS_ENGINES || 'exact,fallback').split(',');
const flat = (s) => s.replace(/\s+/g, '');

// Expected exact results for every registered example (flat comparison).
const EXPECTED = {
  'isprime(2^31 - 1)': 'true', 'nextprime(1000)': '1009', 'prevprime(1000)': '997', 'prime(1000)': '7919',
  'primepi(10^6)': '78498', 'factorint(2^32 + 1)': '641 * 6700417',
  'divisors(360)': '{1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 18, 20, 24, 30, 36, 40, 45, 60, 72, 90, 120, 180, 360}',
  'totient(360)': '96', 'mobius(30)': '-1', 'modinv(17, 3120)': '2753', 'powmod(2, 10^18, 10^9 + 7)': '719476260',
  'crt([2, 3, 2], [3, 5, 7])': 'x = 23 mod 105', 'fibonacci(100)': '354224848179261915075', 'lucas(50)': '28143753123',
  'catalan(20)': '6564120420', 'bernoulli(12)': '-691/2730', 'partition(100)': '190569292',
  'contfrac(sqrt(7))': '[2; (1, 1, 1, 4 repeating)]', 'identify(0.7853981633974483)': 'pi/4', 'tobase(255, 16)': 'ff₁₆',
  'diophantine(3x + 5y = 7)': '(x, y) = (5*t_0 + 14, -3*t_0 - 7)',
  'jacobian([x*y, x + y^2], [x, y])': '[[y, x], [1, 2*y]]', 'hessian(x^3 + x*y^2, [x, y])': '[[6*x, 2*y], [2*y, 2*x]]',
  'laplacian(1/sqrt(x^2 + y^2 + z^2), [x, y, z])': '0', 'divergence([x^2, x*y, z], [x, y, z])': '3*x + 1',
  'curl([-y, x, 0], [x, y, z])': '[[0], [0], [2]]',
  'extrema(x^3 - 3x, x)': 'x = -1: local maximum, f = 2; x = 1: local minimum, f = -2',
  'tangent(x^2, x, 3)': 'y = 6*x - 9', 'idiff(x^2 + y^2 = 25, y, x)': '-x/y',
  'laplace(t^2*exp(-t), t, s)': '2/(s + 1)^3', 'invlaplace(1/(s^2 + 4), s, t)': 'sin(2*t)/2',
  'fourier(exp(-x^2), x, k)': 'sqrt(pi)*exp(-pi^2*k^2)', 'invfourier(exp(-k^2), k, x)': 'sqrt(pi)*exp(-pi^2*x^2)',
  'fourierseries(x, x, 4)': '2*sin(x) - sin(2*x) + 2*sin(3*x)/3 - sin(4*x)/2',
  'residue(1/(z^2 + 1), z, i)': '-i/2 ≈ -0.5i', 'arclength(x^2, x, 0, 1)': '1.47894285754460',
  'rsolve(a(n+2) = a(n+1) + a(n), a(n), a(0) = 0, a(1) = 1)': 'a(n) = sqrt(5)*(-(1 - sqrt(5))^n + (1 + sqrt(5))^n)/(5*2^n)',
  'nsolve(cos(x) = x, x, 1, 50)': 'x = 0.73908513321516064165531208767387340401341175890076',
  'csolve(x^5 = 1, x)': null,   // checked separately
  'N(pi, 100)': '3.141592653589793238462643383279502884197169399375105820974944592307816406286208998628034825342117068',
  'subs(x^2 + 3x, x, 2)': '10', 'resultant(x^2 - 2, x^3 - x - 1, x)': '-1', 'discriminant(a*x^2 + b*x + c, x)': '-4*a*c + b^2',
  'degree((x^2 + 1)^3, x)': '6', 'coeffs((x + 2)^4, x)': '[1, 8, 24, 32, 16]',
  'groebner([x^2 + y^2 - 1, x - y], [x, y])': '[x - y, 2*y^2 - 1]', 'completesquare(2x^2 + 8x + 3, x)': '-5 + 2*(x + 2)^2',
  'rewrite(cos(x), exp)': 'exp(i*x)/2 + exp(-i*x)/2', 'logcombine(log(x) + 2*log(y))': 'log(x*y^2)',
  'expandlog(log(x^2*y/z))': '2*log(x) + log(y) - log(z)', 'powsimp(x^a*x^b*y^a)': 'x^(a + b)*y^a',
  'polar(1 + sqrt(3)*i)': '2*exp(i*(pi/3))', 'rect(2*exp(i*pi/3))': '1 + sqrt(3)*i ≈ 1 + 1.732050808i',
  'diagonalize([[2, 1], [1, 2]])': 'P = [[-1, 1], [1, 1]]; D = [[1, 0], [0, 3]]',
  'jordan([[1, 1], [0, 1]])': 'P = [[1, 0], [0, 1]]; J = [[1, 1], [0, 1]]',
  'expm([[0, 1], [-1, 0]])': '[[cos(1), sin(1)], [-sin(1), cos(1)]]',
  'lu([[2, 1], [4, 5]])': 'L = [[1, 0], [2, 1]]; U = [[2, 1], [0, 3]]',
  'qr([[1, 1], [1, -1]])': 'Q = [[sqrt(2)/2, sqrt(2)/2], [sqrt(2)/2, -sqrt(2)/2]]; R = [[sqrt(2), 0], [0, sqrt(2)]]',
  'adj([[1, 2], [3, 4]])': '[[4, -2], [-3, 1]]', 'columnspace([[1, 2], [2, 4]])': 'span{[[1], [2]]}',
  'rowspace([[1, 2, 3], [2, 4, 6]])': 'span{[[1, 2, 3]]}', 'pinv([[1, 2], [2, 4]])': '[[1/25, 2/25], [2/25, 4/25]]',
  'linsolve([[1, 1], [2, 2]], [3, 6])': 'x = [[3 - tau0], [tau0]]',
};

for (const name of ENGINES) {
  const exact = name === 'exact';
  describe(`tools: ${name} engine`, { skip: exact && !hasWheels() && 'SymPy wheels missing: run `npm run test:setup`' }, () => {
    let app, page;
    before(async () => { app = await openApp({ engine: exact }); page = app.page; if (exact) await app.waitForEngine(); });
    after(async () => { await app?.close(); });
    const res = (e, m = 'algebra') => run(page, e, m);

    test('every tool has a verified example', () => {
      assert.deepEqual(Object.values(TOOLS).map(t => t.ex).filter(ex => !(ex in EXPECTED)), []);
    });

    test('tool examples', async () => {
      for (const [n, t] of Object.entries(TOOLS)) {
        const r = await res(t.ex, t.mode);
        if (exact) {
          assert.ok(!r.error, `${t.ex}: ${r.error}`);
          assert.equal(r.engine, 'sympy', t.ex);
          if (EXPECTED[t.ex] !== null) assert.equal(flat(r.plain), flat(EXPECTED[t.ex]), t.ex);
        } else if (JS_NUMBER_THEORY[n]) {
          assert.ok(!r.error, `${t.ex}: ${r.error}`);
          assert.equal(flat(r.plain), flat(EXPECTED[t.ex]), `${t.ex} (JavaScript number theory)`);
        } else if (t.jsFallback) {
          assert.equal(flat(r.plain || r.error), flat(EXPECTED[t.ex]), `${t.ex} (JavaScript fallback)`);
        } else if (t.fallback === 'mathjs') {
          assert.ok(!r.error, `${n} should fall back to the numeric engine: ${r.error}`);
        } else {
          assert.match(r.error || '', /needs the exact engine/, `${t.ex} should decline without SymPy`);
        }
      }
    });

    test('complex roots, mixed partials, multiple integrals', { skip: !exact }, async () => {
      const roots = (await res('csolve(x^5 = 1, x)', 'solve')).plain.split(/,\s*(?=x =)/);
      assert.equal(roots.length, 5);
      for (const r of roots) {
        const v = await page.evaluate(s => { const z = window.CAS.math.evaluate(s.replace(/^x = /, '')); return window.CAS.math.abs(window.CAS.math.subtract(window.CAS.math.pow(z, 5), 1)); }, r);
        assert.ok(v < 1e-12, `${r} is not a fifth root of unity`);
      }
      assert.equal(flat((await res('derivative(x^2*y^3, x, y)', 'calculus')).plain), flat('6*x*y^2'));
      assert.equal((await res('integrate(x*y, [y, 0, x], [x, 0, 1])', 'calculus')).plain, '1/8');
      assert.equal((await res('integrate(1, [x, 0, 1], [y, 0, 2])', 'calculus')).plain, '2');
      assert.match((await res('integrate(exp(-x^2 - y^2), [x, -Infinity, Infinity], [y, -Infinity, Infinity])', 'calculus')).plain, /^pi\b/);
    });

    test('workspace values do not leak into tool variables', { skip: !exact }, async () => {
      const def = await res('x = 5');
      assert.equal(flat((await res('jacobian([x*y, x + y], [x, y])', 'calculus')).plain), flat('[[y, x], [1, 1]]'));
      assert.equal(flat((await res('tangent(x^3, x, 1)', 'calculus')).plain), flat('y = 3*x - 2'));
      await page.evaluate(async id => { await window.CAS.deleteCell(window.CAS.cells.find(c => c.id === id)); await window.CAS.idle(); }, def.id);
      assert.equal(await page.evaluate(() => window.CAS.scope.x), undefined);
    });

    test('number theory without SymPy is exact or declines', { skip: exact }, async () => {
      assert.equal((await res('isprime(2^61 - 1)')).plain, 'true');
      assert.equal((await res('isprime(3317044064679887385961979)')).plain, 'false');     // just below the deterministic bound
      assert.match((await res('isprime(2^89 - 1)')).error, /needs the exact engine/);     // beyond it: decline, never guess
      assert.equal(flat((await res('factorint(2^62 - 1)')).plain), flat('3 * 715827883 * 2147483647'));
      assert.equal(flat((await res('factorint(10403 * 1000003 * 998244353)')).plain), flat('101 * 103 * 1000003 * 998244353'));
      assert.equal((await res('powmod(3, -1, 7)')).plain, '5');
      assert.match((await res('modinv(6, 9)')).error, /no inverse/);
      assert.match((await res('integrate(x*y, [y, 0, x], [x, 0, 1])', 'calculus')).plain, /^(1\/8|0\.125)$/);
      const def = await res('m = 97');
      assert.equal((await res('totient(m)')).plain, '96');
      await page.evaluate(async id => { await window.CAS.deleteCell(window.CAS.cells.find(c => c.id === id)); await window.CAS.idle(); }, def.id);
    });

    test('argument checking', async () => {
      assert.match((await res('modinv(3)')).error, /Use modinv\(a, m\)/);
      assert.match((await res('jacobian([x, y], [x, 2])', 'calculus')).error, /should be a variable name/);
      assert.match((await res('tobase(10, 2, 3)')).error, /Too many arguments/);
      if (exact) {
        assert.match((await res('prime(0)')).error, /at least 1/);
        assert.match((await res('curl([x, y], [x, y])', 'calculus')).error, /3-component/);
        assert.match((await res('rewrite(x, banana)')).error, /one of/);
      }
    });

    test('probability distributions (JavaScript, both engines)', async () => {
      const close = async (e, want, tol = 1e-9) => {
        const v = Number((await res(e, 'stats')).plain);
        assert.ok(Math.abs(v - want) <= tol * (1 + Math.abs(want)), `${e}: ${v} ≠ ${want}`);
      };
      await setApprox(page, true);
      await close('normalcdf(-1.96, 1.96)', 0.9500042097);
      await close('normalcdf(0)', 0.5);
      await close('invnorm(0.975)', 1.959963985);
      await close('invnorm(0.5, 100, 15)', 100);
      await close('binompdf(20, 0.3, 6)', 0.1916389828);
      await close('binomcdf(20, 0.3, 6)', 0.6080098122);
      await close('poissoncdf(4, 2)', 0.2381033056);
      await close('tcdf(-2.1, 2.1, 12)', 0.9424550613);
      await close('chi2cdf(0, 3.84, 1)', 0.9499564788);
      await close('geometcdf(0.2, 5)', 0.67232);
      await close('normalcdf(90, 110, 100, 15) + invnorm(0.5)', 0.4950149249);
      assert.match((await res('invnorm(1.5)', 'stats')).error, /between 0 and 1/);
      await setApprox(page, false);
    });

    // The grapher keeps its items (with compiled functions) on the canvas; draw() runs synchronously.
    const grapher = (id, fn) => page.evaluate(([id, src]) => {
      const g = document.getElementById(id || 'gplot').querySelector('canvas').__grapher;
      g.draw();
      return (0, eval)(src)(g);
    }, [id, fn.toString()]);

    test('plot(...) draws functions, implicit, polar and parametric curves', async () => {
      const r = await res('plot(sin(x), x^2 + y^2 = 16, r = 2 + 2cos(theta), [3cos(3t), 3sin(2t)])', 'calculus');
      assert.ok(!r.error, r.error);
      assert.deepEqual(await grapher(r.id, g => g.items.map(i => i.kind)), ['fn', 'implicit', 'polar', 'param']);
      assert.ok(await grapher(r.id, g => {
        const it = g.items[3];
        let inside = true, low = false;
        for (let k = 0; k <= 1000; k++) { const t = 2 * Math.PI * k / 1000, x = it.fx(t), y = it.fy(t); if (Math.abs(x) > 3 + 1e-9) inside = false; if (y < -2.9) low = true; }
        return inside && low && it.t0 === 0 && Math.abs(it.t1 - 2 * Math.PI) < 1e-12;
      }), 'parametric curve sampled over [0, 2π]');
      assert.ok(await grapher(r.id, g => g.items[1].screen.length > 100), 'the circle is traced');
      const roots = await grapher(r.id, g => g.pois.filter(p => p.kindName === 'root').map(p => p.x).sort((a, b) => a - b));
      for (const want of [-Math.PI, 0, Math.PI]) assert.ok(roots.some(x => Math.abs(x - want) < 1e-9), `root of sin at ${want}: ${roots}`);
      const ranged = await res('plot(x^2, [x, 0, 2])', 'calculus');
      assert.deepEqual(await grapher(ranged.id, g => [g.home.xRange[0], g.home.xRange[1]]), [0, 2]);
      const tan = await res('plot(tan(x))', 'calculus');
      assert.ok(await grapher(tan.id, g => g.items[0].runs.length >= 6), 'tan(x) is broken at its poles, not joined across them');
      const ineq = await res('plot(y < x^2 - 2, x^2 + y^2 <= 9, x < 2)', 'calculus');
      assert.ok(!ineq.error, ineq.error);
      assert.deepEqual(await grapher(ineq.id, g => g.items.map(i => `${i.kind} ${i.rel}`)), ['ineq-fn <', 'ineq <=', 'ineq <']);
      const both = await res('plot(x^2, 2x + 3)', 'calculus');
      const meet = await grapher(both.id, g => g.pois.filter(p => p.kindName === 'intersection').map(p => [p.x, p.y]));
      assert.ok(meet.some(([x, y]) => Math.abs(x - 3) < 1e-9 && Math.abs(y - 9) < 1e-6) && meet.some(([x]) => Math.abs(x + 1) < 1e-9), JSON.stringify(meet));
      const fields = await res('plot(slopefield(x - y), vectorfield([-y, x]), point(1, 2))', 'calculus');
      assert.deepEqual(await grapher(fields.id, g => g.items.map(i => i.kind)), ['slope', 'vector', 'point']);
      const dc = await res('domaincolor(z^2 - 1)', 'calculus');
      assert.deepEqual(await grapher(dc.id, g => g.items[0].w(2, 0)), [3, 0]);
      const par = await res('plot(a*sin(x))', 'calculus');
      assert.equal(await page.evaluate(id => document.getElementById(id).querySelectorAll('input[data-param]').length, par.id), 1, 'a slider for the parameter');
    });

    test('Graph view accepts implicit and polar curves', async () => {
      await page.evaluate(() => { document.getElementById('ginp').value = 'x^2/9 + y^2/4 = 1, r = 1 + cos(theta), cos(x)'; plotGraph(false); });
      assert.deepEqual(await grapher(null, g => g.items.map(i => i.kind)), ['implicit', 'polar', 'fn']);
    });

    test('expressions compile to native code for plotting, with a safe fallback', async () => {
      const r = await page.evaluate(() => {
        const { compileReal } = window.CAS.jit;
        const f = compileReal('x^2 + sin(x) * y', ['x', 'y']);
        const cube = compileReal('x^(1/3)', ['x']);
        return { f: f && f(2, 3), cube: cube && cube(-8), unsafe: compileReal('alert(1)', ['x']), unknown: compileReal('foo + x', ['x']) };
      });
      assert.ok(Math.abs(r.f - (4 + Math.sin(2) * 3)) < 1e-12);
      assert.ok(Math.abs(r.cube + 2) < 1e-12, 'real cube root of a negative number');
      assert.equal(r.unsafe, null); assert.equal(r.unknown, null);
    });

    test('every rendered result is well-formed LaTeX', async () => {
      assert.deepEqual(await latexProblems(page), []);
    });

    test('tools appear in autocomplete and the palette; no page errors', async () => {
      const n = await page.evaluate(() => { openPalette(); document.getElementById('palette-input').value = 'laplace'; filterPalette(); const k = document.querySelectorAll('.palette-item').length; closePalette(); return k; });
      assert.ok(n >= 2, 'laplace and invlaplace are listed');
      assert.deepEqual(app.errors, []);
    });
  });
}

async function setApprox(page, on) { await page.evaluate(async on => { await window.CAS.setExact(!on); }, on); }
