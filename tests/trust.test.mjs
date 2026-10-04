// Trust: results are independently verified, never silently wrong, and free-form input is read
// correctly. Each case here was a wrong or unhelpful answer before; most need the exact engine.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, run, hasWheels, latexProblems } from './harness.mjs';

const flat = (s) => s.replace(/\s+/g, '');

describe('trust: exact engine', { skip: !hasWheels() && 'SymPy wheels missing: run `npm run test:setup`' }, () => {
  let app, page;
  before(async () => { app = await openApp(); page = app.page; await app.waitForEngine(); });
  after(async () => { await app?.close(); });

  // Run in a fresh workspace and return { plain, check, understood, error }.
  async function go(expr, mode = 'algebra') {
    const r = await run(page, expr, mode);
    const info = await page.evaluate((id) => {
      const c = window.CAS.cells.find(c => c.id === id);
      return c && c.res ? { check: c.res.check?.status || null, how: c.res.check?.how || null, understood: c.res.understood || null } : {};
    }, r.id);
    return { ...r, ...info };
  }
  const plainOf = async (expr, mode) => { const r = await go(expr, mode); assert.ok(!r.error, `${expr}: ${r.error}`); return r; };
  async function is(expr, mode, want, { check = 'verified' } = {}) {
    const r = await plainOf(expr, mode);
    assert.ok([].concat(want).some(w => flat(r.plain) === flat(w)), `${expr}: got ${r.plain}, want ${want}`);
    if (check !== 'any') assert.equal(r.check, check, `${expr}: check ${r.check} (${r.how})`);
    return r;
  }
  const fresh = () => page.evaluate(async () => { for (const c of [...window.CAS.cells]) await window.CAS.deleteCell(c); await window.CAS.idle(); });

  test('infinity can be written inf, oo, ∞ or Infinity', async () => {
    await fresh();
    await is('limit((1+1/n)^n, n, inf)', 'calculus', 'e ≈ 2.718281828');
    await is('limit((1+1/x)^x, x, oo)', 'calculus', 'e ≈ 2.718281828');
    await is('sum(1/k^2, k, 1, oo)', 'calculus', 'pi^2/6 ≈ 1.644934067');
    await is('sum(1/k^2, k, 1, ∞)', 'calculus', 'pi^2/6 ≈ 1.644934067');
    await is('integrate(exp(-x^2), x, -inf, inf)', 'calculus', 'sqrt(pi) ≈ 1.772453851');
  });

  test('divergence is reported, not NaN', async () => {
    await is('integrate(1/x, x, -1, 1)', 'calculus', 'diverges; Cauchy principal value 0', { check: null });
    await is('integrate(1/x^2, x, -1, 1)', 'calculus', 'diverges to Infinity', { check: null });
    await is('sum(1/k, k, 1, oo)', 'calculus', 'diverges to Infinity', { check: null });
  });

  test('results carry an independent verification', async () => {
    await is('integrate(x*sin(x), x)', 'calculus', '-x*cos(x) + sin(x) + C');
    await is('integrate(sin(x), x, 0, pi)', 'calculus', '2');
    await is('derivative(x^3*sin(x), x)', 'calculus', ['x^2*(x*cos(x) + 3*sin(x))']);
    await is('limit(sin(x)/x, x, 0)', 'calculus', '1');
    await is('sum(k^2, k, 1, n)', 'calculus', ['n*(n + 1)*(2*n + 1)/6', 'n*(2*n^2 + 3*n + 1)/6']);
    await is('simplify(sin(x)^4 - cos(x)^4)', 'algebra', '-cos(2*x)');
    await is('factor(x^4 - 1)', 'algebra', '(x - 1)*(x + 1)*(x^2 + 1)');
    await is('solve(x^2 - 5x + 6 = 0, x)', 'solve', 'x = 2, x = 3');
    await is('solve([x + y = 10, 2x - y = 2], [x, y])', 'solve', 'x=4, y=6');
    await is("dsolve(y'' + y = 0, y(x), y(0) = 1, y'(0) = 0)", 'calculus', 'y(x) = cos(x)');
    await is('eigs([[2, 1], [1, 2]])', 'matrix', 'λ = [3, 1]');
    const r = await go('integrate(x^2, x, 0, 1)', 'calculus');
    assert.match(r.how, /quadrature/);
  });

  test('antiderivatives SymPy misses are found by substitution and verified', async () => {
    const r = await plainOf('integrate(sqrt(tan(x)), x)', 'calculus');
    assert.doesNotMatch(r.plain, /no closed form/);
    assert.equal(r.check, 'verified');
    const none = await plainOf('integrate(exp(x^2)/log(x), x)', 'calculus');
    assert.match(none.plain, /no closed form found .*does not prove none exists/);
  });

  test('solution sets read the way they are written by hand', async () => {
    await is('solve(sin(x) = 1/2, x)', 'solve', 'x = 2*pi*n + pi/6 or x = 2*pi*n + 5*pi/6, n ∈ ℤ');
    await is('solve(abs(x - 3) < 2, x)', 'solve', '1 < x < 5');
    await is('solve(x^2 >= 4, x)', 'solve', 'x <= -2 or x >= 2');
    await is('solve(x^2 + 1 < 0, x)', 'solve', 'no solutions in ℝ');
  });

  test('bare equations and inequalities are solved', async () => {
    await fresh();
    await is('2x^2 + 3x = 5', 'algebra', 'x = -5/2, x = 1');
    await is('x^2 > 4', 'algebra', 'x < -2 or x > 2');
    await is('|x - 1| + |x + 1| = 4', 'algebra', 'x = -2, x = 2');
    await is('1 + 1 = 2', 'algebra', 'true', { check: 'any' });
    const circle = await plainOf('x^2 + y^2 = 25', 'algebra');
    assert.match(flat(circle.plain), /y=-?sqrt\(25-x\^2\)/);
    assert.equal(await page.evaluate(() => !!document.querySelector('.cell:last-child .cell-plot .js-plotly-plot, .cell:last-child .cell-plot canvas')), true);
    await is('solve(x + y = 10, x - y = 2)', 'solve', 'x=6, y=4');
    await is('solve(x^2 - 4)', 'solve', 'x = -2, x = 2');
  });

  test('free-form input: English, Leibniz, Mathematica, LaTeX', async () => {
    await fresh();
    const read = async (input, mode, want, understood) => {
      const r = await plainOf(input, mode);
      assert.equal(flat(r.plain), flat(want), `${input}: ${r.plain}`);
      if (understood) assert.equal(flat(r.understood || ''), flat(understood), `${input} read as ${r.understood}`);
    };
    await read('d/dx x^3', 'calculus', '3*x^2', 'derivative(x^3, x)');
    await read('integral of x^2 from 0 to 1', 'calculus', '1/3', 'integrate(x^2, x, 0, 1)');
    await read('what is the limit of sin(x)/x as x -> 0?', 'calculus', '1');
    await read('D[Sin[x]^2, x]', 'calculus', 'sin(2*x)');
    await read('Integrate[x Exp[x], x]', 'calculus', '(x - 1)*exp(x) + C');
    await read('\\int_0^1 x^2 \\, dx', 'calculus', '1/3');
    await read('\\frac{d}{dx} \\sin x', 'calculus', 'cos(x)');
    await read('simplify(sin^2 x + cos^2 x)', 'algebra', '1');
    await read('x := 3', 'algebra', 'x = 3');
    await read('x + 1', 'algebra', '4');
    await fresh();
  });

  test('unknown functions get a suggestion instead of an echo', async () => {
    const r = await go('eigenvalz([[2, 1], [1, 2]])', 'matrix');
    assert.match(r.error, /Unknown function "eigenvalz"\. Did you mean eigs/);
    await is('eigenvals([[2, 1], [1, 2]])', 'matrix', 'λ = [3, 1]');
    await is('eigenvalues([[2, 0], [0, 5]])', 'matrix', 'λ = [2, 5]');
  });

  test('abstract functions, assumptions, substitution, primes', async () => {
    await fresh();
    const pr = await plainOf('diff(f(x)*g(x), x)', 'calculus');
    assert.match(await page.evaluate(id => document.getElementById(id).dataset.latex, pr.id), /f'\\left\(x\\right\)/);
    await is('simplify(sqrt(x^2))', 'algebra', 'sqrt(x^2)', { check: 'any' });
    await is('assume(x > 0)', 'algebra', 'assume x: positive', { check: 'any' });
    await is('simplify(sqrt(x^2))', 'algebra', 'x');
    await is('subs(x^2 + 3x, x, 2)', 'algebra', '10', { check: 'any' });
    await is('g(t) = t^3 - 2t', 'algebra', 'g(t) = t^3 - 2t', { check: 'any' });
    await is("g'(2)", 'calculus', '10', { check: 'any' });
    await is("g'(t)", 'calculus', '3*t^2 - 2');
    await fresh();
    await is('simplify(sqrt(x^2))', 'algebra', 'sqrt(x^2)', { check: 'any' });   // assumptions go with their cell
  });

  test('worked solutions show the method a teacher would', async () => {
    const stepsOf = async (expr, mode) => {
      const r = await plainOf(expr, mode);
      return page.evaluate(id => window.CAS.cells.find(c => c.id === id).res.steps.map(s => `${s.d} | ${s.tex || ''}`).join('\n'), r.id);
    };
    const has = async (expr, mode, ...patterns) => {
      const text = await stepsOf(expr, mode);
      for (const p of patterns) assert.match(text, p, `${expr} steps:\n${text}`);
    };
    await has('derivative(x^2*sin(x), x)', 'calculus', /Product rule/, /Power rule/, /Derivative of sine/);
    await has('derivative(sin(x)/(x + 1), x)', 'calculus', /Quotient rule/);
    await has('derivative(exp(x^2), x)', 'calculus', /Chain rule/);
    await has('limit((x^2 - 1)/(x - 1), x, 1)', 'calculus', /indeterminate/, /Factor numerator and denominator/, /Cancel the common factor/);
    await has('limit(sin(x)/x, x, 0)', 'calculus', /L'Hôpital/);
    await has('limit((3x^2 + 1)/(x^2 - x), x, Infinity)', 'calculus', /Divide numerator and denominator by x\^2/);
    await has('solve(3x + 4 = 10, x)', 'solve', /Isolate the x term/, /Divide both sides by 3/);
    await has('solve(2x^2 + 3x = 5, x)', 'solve', /Factor/, /product is zero/);
    await has('solve(x^2 + x + 1 = 0, x)', 'solve', /Discriminant/, /Quadratic formula/);
    await has('solve(sqrt(x + 3) = x - 3, x)', 'solve', /Square both sides/, /extraneous/);
    await has('solve(x^2 > 4, x)', 'solve', /Critical points/, /Sign in each interval/);
    await has('integrate(x*exp(x), x)', 'calculus', /Integration by parts with u = x/);
    await has('integrate(x*cos(x^2), x)', 'calculus', /Substitute u = x\^2/);
    await has('factor(2x^3 - 8x)', 'algebra', /common factor 2\*x/, /Difference of squares/);
  });

  test('second bug hunt: each of these was wrong or rejected', async () => {
    await fresh();
    // extraneous candidates are rejected, not listed with a failed check
    await is('log(x) + log(x - 3) = log(10)', 'algebra', 'x = 5');
    await is('solve(x^(2/3) = 4, x)', 'solve', 'x = 8');
    // a line that mentions its own undefined name is an equation (was "x = 8192*x - 24573")
    await is('x = x + 1', 'algebra', 'no solutions in ℝ', { check: 'any' });
    await is('x = 2x - 3', 'algebra', 'x = 3');
    // circular definitions are reported instead of expanding forever
    await fresh();
    await plainOf('p = q + 1');
    assert.match((await go('q = p + 1')).error, /Circular definition/);
    await fresh();
    // infinite sums: conditions, divergence, numerical values (was "SymPy still loading")
    await is('sum(x^n, n, 0, oo)', 'calculus', '1/(1 - x) for abs(x) < 1', { check: 'any' });
    assert.match((await plainOf('sum((-1)^n, n, 0, oo)', 'calculus')).plain, /diverges/);
    assert.match((await plainOf('sum(1/(k^3 + k + 1), k, 1, oo)', 'calculus')).plain, /^0\.49472491964567588\d*\s+\(numerical; no closed form found\)$/);
    assert.match((await plainOf('product(1 - 1/k^2, k, 2, oo)', 'calculus')).plain, /^0\.5\d*\s+\(numerical; matches 1\/2 to 20 digits/);
    await is('sum(1/(k(k+1)), k, 1, oo)', 'calculus', '1');
    // |x| over the reals (was an unreadable Piecewise with re/im)
    await is('diff(abs(x), x)', 'calculus', 'sign(x)');
    await is('integrate(abs(x), x)', 'calculus', 'x*abs(x)/2 + C');
    await is('diff(x*abs(x), x)', 'calculus', '2*abs(x)');
    // poles inside the interval (sec² on [0, π] used to time out after 20 s)
    assert.equal((await plainOf('integrate(sec(x)^2, x, 0, pi)', 'calculus')).plain, 'diverges to Infinity');
    assert.equal((await plainOf('integrate(1/x^2, x, -1, 1)', 'calculus')).plain, 'diverges to Infinity');
    // an oscillatory integral whose quadrature cannot be trusted is not marked "failed"
    await is('integrate(sin(x^2), x, 0, oo)', 'calculus', 'sqrt(2)*sqrt(pi)/4 ≈ 0.6266570687', { check: null });
    // numbers in simplest form
    await is('(1 + i)^8', 'algebra', '16', { check: null });
    await is('(sqrt(3) + sqrt(2))*(sqrt(3) - sqrt(2))', 'algebra', '1', { check: null });
    // free-form input that used to be rejected or misread
    await is('log_2(8)', 'algebra', '3', { check: null });
    await is('5 choose 2', 'algebra', '10', { check: null });
    await is('lim x->0 (1-cos(x))/x^2', 'calculus', '1/2');
    await is('x^2 + y at x = 1, y = 2', 'algebra', '3', { check: null });
    await is('50% of 80', 'algebra', '40', { check: null });
    await is('partial fractions of 1/(x^2 + 3x + 2)', 'algebra', ['-1/(x + 2) + 1/(x + 1)', '1/(x + 1) - 1/(x + 2)']);
    await is('trigexpand(sin(2x))', 'algebra', '2*sin(x)*cos(x)');
    // systems and differential equations typed bare
    await is('x^2 + y^2 = 25, x + y = 7', 'algebra', 'x=3, y=4  or  x=4, y=3');
    await is('x + y = 7 and x - y = 1', 'algebra', 'x=4, y=3');
    await is("y' = x*y", 'calculus', 'y(x) = C1*exp(x^2/2)');
    await is("y'' + y = 0, y(0) = 0, y'(0) = 1", 'calculus', 'y(x) = sin(x)');
    await is("dsolve(y'' - 3y' + 2y = 0)", 'calculus', ['y(x) = (C1 + C2*exp(x))*exp(x)', 'y(x) = C1*exp(x) + C2*exp(2*x)']);
    // sequential redefinition still works
    await fresh();
    await plainOf('n = 1');
    await is('n = n + 1', 'algebra', 'n = 2', { check: null });
  });

  test('every rendered result is well-formed LaTeX; no page errors', async () => {
    assert.deepEqual(await latexProblems(page), []);
    assert.deepEqual(app.errors, []);
  });
});
