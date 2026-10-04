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
  // advanced.py — each value checked against a textbook or table, not against SymPy
  'lll([[1, 1, 1], [-1, 0, 2], [3, 5, 6]])': '[[0, 1, 0], [1, 0, 1], [-1, 0, 2]]',
  'minpoly(sqrt(2) + sqrt(3))': 'x^4 - 10*x^2 + 1', 'nfactor(x^2 - 2, sqrt(2))': '(x - sqrt(2))*(x + sqrt(2))',
  'galois(x^5 - x - 1)': 'Gal = S₅, order 120 — not solvable: the roots cannot be written with radicals',
  'ztrans(2^n, n, z)': 'z/(z - 2)', 'iztrans(z/(z^2 + 1), z, n)': 'sin(pi*n/2)',
  'convolve(exp(-t), exp(-2t), t)': '(exp(t) - 1)*exp(-2*t)',
  'dft([1, 2, 3, 4])': '[[10, -2 + 2*i, -2, -2 - 2*i]]', 'idft([10, -2 + 2i, -2, -2 - 2i])': '[[1, 2, 3, 4]]',
  'bode(1/(s + 1), s)': 'Bode plot of H(s) = 1/(s + 1)', 'holonomic(exp(x^2), x)': "-2*x*y(x) + y'(x) = 0",
  'maximize(x*y, [x + y = 10])': 'maximum 25 at x = 5, y = 5', 'minimize(x^2 + y^2, [x + 2y = 5])': 'minimum 5 at x = 1, y = 2',
  'lagrange(x + y, [x^2 + y^2 = 1], [x, y])': 'x = -sqrt(2)/2, y = -sqrt(2)/2, lambda = -sqrt(2)/2 => f = -sqrt(2); x = sqrt(2)/2, y = sqrt(2)/2, lambda = sqrt(2)/2 => f = sqrt(2)',
  'ito(X^2, X, 0, 1)': 'd(X^2) = 1 dt + (2*X) dW',
  'sdesolve(2X, 3X, X)': 'X_t = X_0*exp(3*W_t - 5*t/2) (geometric Brownian motion)',
  'christoffel([[1, 0], [0, r^2]], [r, theta])': 'Γ^r_(theta,theta) = -r; Γ^theta_(r,theta) = 1/r',
  'riemann([[r^2, 0], [0, r^2 sin(theta)^2]], [theta, phi])': 'R^theta_(phi,theta,phi) = sin(theta)^2; R^phi_(theta,theta,phi) = -1',
  'ricci([[r^2, 0], [0, r^2 sin(theta)^2]], [theta, phi])': '[[1, 0], [0, sin(theta)^2]]',
  'ricciscalar([[r^2, 0], [0, r^2 sin(theta)^2]], [theta, phi])': '2/r^2',
  'einstein([[-(1 - 2M/r), 0, 0, 0], [0, 1/(1 - 2M/r), 0, 0], [0, 0, r^2, 0], [0, 0, 0, r^2 sin(theta)^2]], [t, r, theta, phi])': '[[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]',
  'geodesic([[1, 0], [0, r^2]], [r, theta])': "-r(s)*theta'(s)^2 + r''(s) = 0; theta''(s) + 2*r'(s)*theta'(s)/r(s) = 0",
  'curvature(x^2, x)': '2/(4*x^2 + 1)^(3/2)', 'surfcurv([sin(u) cos(v), sin(u) sin(v), cos(u)], [u, v])': '1',
  'wedge(x*dx + y*dy, dz)': 'x*wedge(dx, dz) + y*wedge(dy, dz)', 'extd(x*dy - y*dx)': '2*wedge(dx, dy)',
  'hodge(dx, [x, y, z])': 'wedge(dy, dz)', "diffelim([x' = y, y' = -x], [x], t)": "x(t) + x''(t) = 0",
  'circuit(2, H(0), CNOT(0, 1))': 'sqrt(2)/2|00> + sqrt(2)/2|11>',
  'alexander(figure8)': 'Δ(t) = -t + 3 - 1/t', 'jones(trefoil)': 'V(q) = -q^4 + q^3 + q',
  'ieval(x^2 - 2x, [x, 0, 1])': '[-1.0077972412109375, 0.0000152587890625]',
  'prove(x^4 - 4x^3 + 6x^2 - 4x + 1 >= 0)': 'proved: x^4 - 4*x^3 + 6*x^2 - 4*x + 1 >= 0 for all x',
  'grade(x^3/3 + 5, x^3/3, x)': 'correct up to a constant',
  // random variables and geometry
  'P(Normal(0, 1) > 1)': '1/2 - erf(sqrt(2)/2)/2 ≈ 0.1586552539', 'E(Die(6))': '7/2', 'Var(Exponential(2))': '1/4',
  'Std(Uniform(0, 12))': '2*sqrt(3) ≈ 3.464101615', 'density(Exponential(2))': '2*exp(-2*x)',
  'cdf(Uniform(0, 2))': 'Piecewise((0, x < 0), (x/2, x <= 2), (1, True))',
  'intersect(Circle(Point(0, 0), 2), Line(Point(-3, 1), Point(3, 1)))': '(sqrt(3), 1), (-sqrt(3), 1)',
  'distance([0, 0], [3, 4])': '5', 'midpoint(Point(0, 0), Point(4, 2))': '(2, 1)',
  'angle(Point(1, 0), Point(0, 0), Point(0, 1))': 'pi/2 ≈ 1.570796327',
  'area(Triangle(Point(0, 0), Point(4, 0), Point(0, 3)))': '6', 'perimeter(Triangle(Point(0, 0), Point(4, 0), Point(0, 3)))': '12',
  'perpendicular(Line(Point(0, 0), Point(1, 1)), Point(2, 0))': 'y = 2 - x', 'parallel(Line(Point(0, 0), Point(1, 2)), Point(0, 3))': 'y = 2*x + 3',
  'tangents(Circle(Point(0, 0), 2), Point(4, 0))': 'y = sqrt(3)*(x - 4)/3; y = sqrt(3)*(4 - x)/3',
  'circumcircle(Triangle(Point(0, 0), Point(4, 0), Point(0, 3)))': '(x - 2)^2 + (y - 3/2)^2 = 25/4',
  'incircle(Triangle(Point(0, 0), Point(4, 0), Point(0, 3)))': '(x - 1)^2 + (y - 1)^2 = 1',
  'centroid(Triangle(Point(0, 0), Point(4, 0), Point(0, 3)))': '(4/3, 1)', 'equation(Circle(Point(1, 2), 3))': '(x - 1)^2 + (y - 2)^2 = 9',
  'draw(Triangle(Point(0, 0), Point(4, 0), Point(0, 3)), Circle(Point(2, 3/2), 5/2))': '2 objects',
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

    test('advanced tools: knots, proofs, optimisation, plots', { skip: !exact }, async () => {
      const p = async (e, m = 'algebra') => { const r = await res(e, m); assert.ok(!r.error, `${e}: ${r.error}`); return r; };
      // knot invariants against the Rolfsen table (Alexander) and KnotAtlas (Jones, up to mirror image q ↔ 1/q)
      const table = { trefoil: ['t - 1 + 1/t', 3], figure8: ['-t + 3 - 1/t', 5], cinquefoil: ['t^2 - t + 1 - 1/t + t^(-2)', 5],
        threetwist: ['2*t - 3 + 2/t', 7], stevedore: ['-2*t + 5 - 2/t', 9] };
      for (const [k, [alex]] of Object.entries(table)) assert.equal(flat((await p(`alexander(${k})`)).plain), flat(`Δ(t) = ${alex}`), k);
      assert.equal(flat((await p('jones(cinquefoil)')).plain), flat('V(q) = q^(-2) + q^(-4) - 1/q^5 + q^(-6) - 1/q^7'));
      assert.equal(flat((await p('jones(stevedore)')).plain), flat('V(q) = q^2 - q + 2 - 2/q + q^(-2) - 1/q^3 + q^(-4)'));
      // proofs: a counterexample with the classic mistake named, interval arithmetic at a touching point
      assert.match((await p('prove((x+y)^2 = x^2 + y^2)')).plain, /^false — Powers do not distribute/);
      assert.match((await p('prove(sin(x)^2 + cos(x)^2 = 1)')).plain, /^proved/);
      assert.equal((await p('prove(exp(x) >= 1 + x, [x, -2, 2])')).plain, 'proved on the box');
      assert.equal((await p('prove(x^2 > 0)')).plain, 'false at x = 0');
      assert.match((await p('prove(x^2 + y^2 >= 2x*y)')).plain, /^proved/);
      // linear programming, closed interval method
      assert.equal((await p('maximize(3x + 2y, [x + y <= 4, x + 3y <= 6, x >= 0, y >= 0])', 'calculus')).plain, 'maximum 12 at x = 4, y = 0');
      assert.equal((await p('maximize(x^3 - 3x, [x, -2, 3])', 'calculus')).plain, 'maximum 18 at x = 3');
      // phi as a coordinate, not the golden ratio
      assert.equal(flat((await p('ricciscalar([[r^2, 0], [0, r^2 sin(phi)^2]], [phi, theta])', 'calculus')).plain), flat('2/r^2'));
      // three-qubit GHZ state
      assert.equal(flat((await p('circuit(3, H(0), CNOT(0, 1), CNOT(1, 2))')).plain), flat('sqrt(2)/2|000> + sqrt(2)/2|111>'));
      // a Bode plot is drawn
      const b = await p('bode(1/(s + 1), s)', 'calculus');
      assert.ok(await page.evaluate(id => !!document.getElementById(id).querySelector('.cell-plot.open canvas'), b.id), 'bode draws a plot');
    });

    test('named objects: random variables and geometric constructions', { skip: !exact }, async () => {
      const clear = () => page.evaluate(async () => { for (const c of [...window.CAS.cells]) await window.CAS.deleteCell(c); await window.CAS.idle(); });
      const p = async (e, m = 'algebra') => { const r = await res(e, m); assert.ok(!r.error, `${e}: ${r.error}`); return r; };
      await clear();
      assert.equal((await p('X ~ Normal(100, 15)', 'stats')).plain, 'X ~ Normal(100, 15)');
      assert.equal((await p('P(X > 130)', 'stats')).plain, '1/2 - erf(sqrt(2))/2 ≈ 0.02275013195');   // 2σ above the mean
      assert.equal((await p('Var(2*X + 3)', 'stats')).plain, '900');
      assert.equal((await p('Y = Binomial(20, 0.3)', 'stats')).plain, 'Y ~ Binomial(20, 3/10)');
      assert.equal((await p('E(Y)', 'stats')).plain, '6');
      // geometry objects, a construction defined from another, and a constraint solved for a point
      await p('A = Point(0, 0)'); await p('B = Point(6, 0)'); await p('C = Point(2, 4)');
      assert.equal((await p('T = Triangle(A, B, C)')).plain, 'T: triangle (0, 0), (6, 0), (2, 4)');
      assert.equal((await p('area(T)')).plain, '12');
      assert.equal((await p('c = circumcircle(T)')).plain, 'c: (x - 3)^2 + (y - 1)^2 = 10');
      await p('P = Point(a, b)');
      assert.equal(flat((await p('solve([distance(P, A) = 5, distance(P, B) = 5], [a, b])', 'solve')).plain), flat('a=3, b=-4  or  a=3, b=4'));
      // editing a point re-runs everything built from it
      const bId = await page.evaluate(() => window.CAS.cells.find(c => c.expr === 'B = Point(6, 0)').id);
      await page.evaluate(async id => { await window.CAS.editCell(window.CAS.cells.find(c => c.id === id), 'B = Point(4, 0)'); await window.CAS.idle(); }, bId);
      const areaPlain = await page.evaluate(() => document.getElementById(window.CAS.cells.find(c => c.expr === 'area(T)').id).dataset.plain);
      assert.equal(areaPlain, '8');
      await clear();
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
