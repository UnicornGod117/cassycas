// The CassyCAS scoreboard: textbook problems with independently known answers (from tables
// and hand derivation, not from SymPy), so a wrong answer cannot be "agreed with" by the very
// engine under test. Run with `npm run bench`; tests/bench.test.mjs enforces zero wrong answers.
//
// expect:
//   { value: n }               a number (real); complex as [re, im]
//   { equiv: 'expr', v }       equal to expr as a function of v (default x) at sample points
//   { anti: 'f', v }           an antiderivative of f (checked by numerical differentiation)
//   { roots: [..] }            exactly these solutions (order-free); complex as [re, im]
//   { match: /re/ }            the plain-text result matches (whitespace is ignored)
// A series is checked as the polynomial before its O(…) term.
// Inputs deliberately mix canonical syntax with the free-form notations people type.
export const PROBLEMS = [
  // ── input understanding ──
  ['parsing', 'd/dx x^3', 'calculus', { equiv: '3x^2' }],
  ['parsing', 'derivative of x^2 sin x', 'calculus', { equiv: '2x sin(x) + x^2 cos(x)' }],
  ['parsing', 'integral of x^2 from 0 to 3', 'calculus', { value: 9 }],
  ['parsing', 'limit of (1 + 1/n)^n as n -> infinity', 'calculus', { value: Math.E }],
  ['parsing', 'solve x^2 - 5x + 6 = 0', 'solve', { roots: [2, 3] }],
  ['parsing', 'Integrate[x Exp[x], {x, 0, 1}]', 'calculus', { value: 1 }],
  ['parsing', 'D[Sin[x]^2, x]', 'calculus', { equiv: 'sin(2x)' }],
  ['parsing', 'Limit[Sin[x]/x, x -> 0]', 'calculus', { value: 1 }],
  ['parsing', '\\int_0^1 x^2 \\, dx', 'calculus', { value: 1 / 3 }],
  ['parsing', '\\frac{d}{dx} \\sin x', 'calculus', { equiv: 'cos(x)' }],
  ['parsing', '\\sum_{k=1}^{\\infty} \\frac{1}{k^2}', 'calculus', { value: Math.PI ** 2 / 6 }],
  ['parsing', '∫_0^π sin x dx', 'calculus', { value: 2 }],
  ['parsing', '2x^2 + 3x = 5', 'algebra', { roots: [-2.5, 1] }],
  ['parsing', '|x - 3| = 2', 'algebra', { roots: [1, 5] }],
  ['parsing', 'sin^2 x + cos^2 x', 'algebra', { value: 1 }],
  ['parsing', 'sum of k^2 for k = 1 to 10', 'calculus', { value: 385 }],
  ['parsing', 'roots of x^3 - 6x^2 + 11x - 6', 'solve', { roots: [1, 2, 3] }],
  ['parsing', 'factor 360', 'numtheory', { match: /^2\^3 \* 3\^2 \* 5$/ }],
  ['parsing', 'is 97 prime', 'numtheory', { match: /^true$/ }],
  ['parsing', 'x² + 2x + 1 = 0', 'algebra', { roots: [-1] }],

  // ── arithmetic and algebra ──
  ['algebra', '1/3 + 1/6', 'algebra', { value: 0.5 }],
  ['algebra', 'sqrt(8) + sqrt(2)', 'algebra', { value: 3 * Math.SQRT2 }],
  ['algebra', '(1 + sqrt(5))^2', 'algebra', { value: (1 + Math.sqrt(5)) ** 2 }],
  ['algebra', 'simplify((x^2 - 1)/(x - 1))', 'algebra', { equiv: 'x + 1' }],
  ['algebra', 'simplify(sin(x)^4 - cos(x)^4)', 'algebra', { equiv: '-cos(2x)' }],
  ['algebra', 'expand((x + 1)^5)', 'algebra', { equiv: 'x^5 + 5x^4 + 10x^3 + 10x^2 + 5x + 1' }],
  ['algebra', 'factor(x^4 - 16)', 'algebra', { equiv: '(x - 2)(x + 2)(x^2 + 4)' }],
  ['algebra', 'factor(x^3 - 3x^2 + 3x - 1)', 'algebra', { equiv: '(x - 1)^3' }],
  ['algebra', 'apart(1/(x^2 - 1), x)', 'algebra', { equiv: '1/(2(x - 1)) - 1/(2(x + 1))' }],
  ['algebra', 'together(1/x + 1/(x + 1))', 'algebra', { equiv: '(2x + 1)/(x*(x + 1))' }],
  ['algebra', 'rewrite(cos(x), exp)', 'algebra', { equiv: 'cos(x)' }],
  ['algebra', 'logcombine(log(x) + log(y))', 'algebra', { match: /log\(x\s*\*\s*y\)/ }],
  ['algebra', 'discriminant(x^2 + 3x + 1, x)', 'algebra', { value: 5 }],
  ['algebra', 'completesquare(x^2 + 6x + 5, x)', 'algebra', { equiv: '(x + 3)^2 - 4' }],

  // ── equations and inequalities ──
  ['solve', 'solve(3x + 4 = 10, x)', 'solve', { roots: [2] }],
  ['solve', 'solve(x^2 + 1 = 0, x)', 'solve', { roots: [[0, -1], [0, 1]] }],
  ['solve', 'solve(x^3 = 8, x)', 'solve', { roots: [2, [-1, -Math.sqrt(3)], [-1, Math.sqrt(3)]] }],
  ['solve', 'solve(x^4 - 5x^2 + 4 = 0, x)', 'solve', { roots: [-2, -1, 1, 2] }],
  ['solve', 'solve(exp(x) = 5, x)', 'solve', { roots: [Math.log(5)] }],
  ['solve', 'solve(log(x) = 2, x)', 'solve', { roots: [Math.E ** 2] }],
  ['solve', 'solve(2^x = 32, x)', 'solve', { roots: [5] }],
  ['solve', 'solve(sqrt(x + 3) = x - 3, x)', 'solve', { roots: [6] }],
  ['solve', 'solve(1/x + 1/(x + 1) = 1, x)', 'solve', { roots: [(1 - Math.sqrt(5)) / 2, (1 + Math.sqrt(5)) / 2] }],
  ['solve', 'solve(x/(x - 1) = 1/(x - 1), x)', 'solve', { match: /^no (real )?(solutions|roots)/i }],
  ['solve', 'solve(x^2 < 4, x)', 'solve', { match: /^-2 < x < 2$/ }],
  ['solve', 'solve(x^2 - x - 6 >= 0, x)', 'solve', { match: /^x <= -2 or x >= 3$/ }],
  ['solve', 'solve(abs(2x - 1) < 3, x)', 'solve', { match: /^-1 < x < 2$/ }],
  ['solve', 'solve(sin(x) = 0, x)', 'solve', { match: /pi\*n/ }],
  ['solve', 'solve([x + y = 10, x - y = 2], [x, y])', 'solve', { match: /^x=6, y=4$/ }],
  ['solve', 'solve([x^2 + y^2 = 25, x - y = 1], [x, y])', 'solve', { match: /x=-3, y=-4.*x=4, y=3/ }],
  ['solve', 'solve(x^5 - x + 1 = 0, x)', 'solve', { roots: [-1.1673039782614187, [-0.18123244446987538, -1.0839541013177107], [-0.18123244446987538, 1.0839541013177107], [0.7648844336005847, -0.35247154603172626], [0.7648844336005847, 0.35247154603172626]] }],
  ['solve', 'nsolve(cos(x) = x, x, 1, 20)', 'solve', { match: /^x = 0\.7390851332151606/ }],

  // ── derivatives ──
  ['derivatives', 'derivative(x^3 sin(x), x)', 'calculus', { equiv: '3x^2 sin(x) + x^3 cos(x)' }],
  ['derivatives', 'derivative(exp(x^2), x)', 'calculus', { equiv: '2x exp(x^2)' }],
  ['derivatives', 'derivative(log(cos(x)), x)', 'calculus', { equiv: '-tan(x)' }],
  ['derivatives', 'derivative(x^x, x)', 'calculus', { equiv: 'x^x * (log(x) + 1)' }],
  ['derivatives', 'derivative(atan(x), x)', 'calculus', { equiv: '1/(1 + x^2)' }],
  ['derivatives', 'derivative(sin(x)/x, x)', 'calculus', { equiv: '(x cos(x) - sin(x))/x^2' }],
  ['derivatives', 'derivative(sin(x), x, 4)', 'calculus', { equiv: 'sin(x)' }],
  ['derivatives', 'derivative(asin(x), x)', 'calculus', { equiv: '1/sqrt(1 - x^2)', points: [0.1, 0.3, 0.5, 0.7] }],
  ['derivatives', 'derivative(x^2 y^3, x, y)', 'calculus', { equiv: '6x y^2', vars: { y: 1.3 } }],
  ['derivatives', 'idiff(x^2 + y^2 = 25, y, x)', 'calculus', { equiv: '-x/y', vars: { y: 2.1 } }],

  // ── antiderivatives (checked by differentiation) ──
  ['integrals', 'integrate(x*sin(x), x)', 'calculus', { anti: 'x sin(x)' }],
  ['integrals', 'integrate(x*exp(x), x)', 'calculus', { anti: 'x exp(x)' }],
  ['integrals', 'integrate(x^2*log(x), x)', 'calculus', { anti: 'x^2 log(x)', points: [0.5, 1.3, 2.2] }],
  ['integrals', 'integrate(1/(x^2 + 4), x)', 'calculus', { anti: '1/(x^2 + 4)' }],
  ['integrals', 'integrate(1/(x^4 + 1), x)', 'calculus', { anti: '1/(x^4 + 1)' }],
  ['integrals', 'integrate(sec(x)^3, x)', 'calculus', { anti: 'sec(x)^3', points: [0.2, 0.6, 1.1] }],
  ['integrals', 'integrate(sqrt(1 - x^2), x)', 'calculus', { anti: 'sqrt(1 - x^2)', points: [0.1, 0.4, 0.8] }],
  ['integrals', 'integrate(exp(x)*cos(x), x)', 'calculus', { anti: 'exp(x) cos(x)' }],
  ['integrals', 'integrate(1/(x*log(x)), x)', 'calculus', { anti: '1/(x log(x))', points: [1.5, 2.5, 4] }],
  ['integrals', 'integrate(x/(x^2 + 1), x)', 'calculus', { anti: 'x/(x^2 + 1)' }],
  ['integrals', 'integrate(sqrt(tan(x)), x)', 'calculus', { anti: 'sqrt(tan(x))', points: [0.2, 0.5, 1.0] }],
  ['integrals', 'integrate(1/(1 + sqrt(x)), x)', 'calculus', { anti: '1/(1 + sqrt(x))', points: [0.5, 1.5, 3] }],
  ['integrals', 'integrate(x^3*exp(x^2), x)', 'calculus', { anti: 'x^3 exp(x^2)' }],
  ['integrals', 'integrate(sin(x)^2, x)', 'calculus', { anti: 'sin(x)^2' }],
  ['integrals', 'integrate(1/(x^3 - 1), x)', 'calculus', { anti: '1/(x^3 - 1)', points: [1.5, 2.5, 4] }],
  ['integrals', 'integrate(exp(-x^2), x)', 'calculus', { anti: 'exp(-x^2)' }],

  // ── definite and improper integrals ──
  ['definite', 'integrate(x^2, x, 0, 1)', 'calculus', { value: 1 / 3 }],
  ['definite', 'integrate(sin(x), x, 0, pi)', 'calculus', { value: 2 }],
  ['definite', 'integrate(exp(-x^2), x, -oo, oo)', 'calculus', { value: Math.sqrt(Math.PI) }],
  ['definite', 'integrate(1/(1 + x^2), x, -inf, inf)', 'calculus', { value: Math.PI }],
  ['definite', 'integrate(log(x), x, 0, 1)', 'calculus', { value: -1 }],
  ['definite', 'integrate(1/sqrt(x), x, 0, 1)', 'calculus', { value: 2 }],
  ['definite', 'integrate(x*exp(-x), x, 0, oo)', 'calculus', { value: 1 }],
  ['definite', 'integrate(sin(x)/x, x, 0, oo)', 'calculus', { value: Math.PI / 2 }],
  ['definite', 'integrate(1/x, x, -1, 1)', 'calculus', { match: /diverges/ }],
  ['definite', 'integrate(1/x^2, x, -1, 1)', 'calculus', { match: /diverges/ }],
  ['definite', 'integrate(x*y, [y, 0, x], [x, 0, 1])', 'calculus', { value: 1 / 8 }],
  ['definite', 'integrate(sqrt(1 - x^2), x, -1, 1)', 'calculus', { value: Math.PI / 2 }],

  // ── limits ──
  ['limits', 'limit(sin(x)/x, x, 0)', 'calculus', { value: 1 }],
  ['limits', 'limit((1 - cos(x))/x^2, x, 0)', 'calculus', { value: 0.5 }],
  ['limits', 'limit((x^2 - 1)/(x - 1), x, 1)', 'calculus', { value: 2 }],
  ['limits', 'limit((1 + 1/x)^x, x, inf)', 'calculus', { value: Math.E }],
  ['limits', 'limit((1 + 2/x)^x, x, oo)', 'calculus', { value: Math.E ** 2 }],
  ['limits', 'limit(x*log(x), x, 0, "+")', 'calculus', { value: 0 }],
  ['limits', 'limit((3x^2 + 1)/(x^2 - x), x, oo)', 'calculus', { value: 3 }],
  ['limits', 'limit(sqrt(x^2 + x) - x, x, oo)', 'calculus', { value: 0.5 }],
  ['limits', 'limit(x^(1/x), x, oo)', 'calculus', { value: 1 }],
  ['limits', 'limit(1/x, x, 0)', 'calculus', { match: /does not exist/ }],
  ['limits', 'limit(sin(1/x), x, 0)', 'calculus', { match: /does not exist/ }],
  ['limits', 'limit(1/x, x, 0, "+")', 'calculus', { match: /^Infinity$/ }],
  ['limits', 'limit((exp(x) - 1 - x)/x^2, x, 0)', 'calculus', { value: 0.5 }],
  ['limits', 'limit((tan(x) - sin(x))/x^3, x, 0)', 'calculus', { value: 0.5 }],

  // ── series and sums ──
  ['series', 'sum(1/k^2, k, 1, oo)', 'calculus', { value: Math.PI ** 2 / 6 }],
  ['series', 'sum(1/2^k, k, 0, inf)', 'calculus', { value: 2 }],
  ['series', 'sum((-1)^(k+1)/k, k, 1, oo)', 'calculus', { value: Math.LN2 }],
  ['series', 'sum(k, k, 1, n)', 'calculus', { equiv: 'n*(n + 1)/2', v: 'n' }],
  ['series', 'sum(k^3, k, 1, n)', 'calculus', { equiv: '(n*(n + 1)/2)^2', v: 'n' }],
  ['series', 'sum(1/k, k, 1, oo)', 'calculus', { match: /diverges/ }],
  ['series', 'product(k, k, 1, 6)', 'calculus', { value: 720 }],
  ['series', 'series(exp(x), x, 0, 4)', 'calculus', { equiv: '1 + x + x^2/2 + x^3/6 + x^4/24' }],
  ['series', 'series(cos(x), x, 0, 4)', 'calculus', { equiv: '1 - x^2/2 + x^4/24' }],
  ['series', 'series(1/(1 - x), x, 0, 3)', 'calculus', { equiv: '1 + x + x^2 + x^3' }],

  // ── differential equations, transforms ──
  ['ode', "dsolve(y' = y, y(x), y(0) = 1)", 'calculus', { match: /^y\(x\) = exp\(x\)$/ }],
  ['ode', "dsolve(y'' + y = 0, y(x), y(0) = 0, y'(0) = 1)", 'calculus', { match: /^y\(x\) = sin\(x\)$/ }],
  ['ode', "dsolve(y'' - 3y' + 2y = 0, y(x), y(0) = 0, y'(0) = 1)", 'calculus', { equiv: 'exp(2x) - exp(x)' }],
  ['ode', 'laplace(t^2, t, s)', 'calculus', { equiv: '2/s^3', v: 's' }],
  ['ode', 'laplace(sin(3t), t, s)', 'calculus', { equiv: '3/(s^2 + 9)', v: 's' }],
  ['ode', 'invlaplace(1/(s^2 + 4), s, t)', 'calculus', { equiv: 'sin(2t)/2', v: 't' }],
  ['ode', 'rsolve(a(n+1) = 2a(n), a(n), a(0) = 3)', 'calculus', { match: /3\s*\*\s*2\^n/ }],

  // ── linear algebra ──
  ['linear', 'det([[1, 2], [3, 4]])', 'matrix', { value: -2 }],
  ['linear', 'det([[2, 0, 1], [1, 3, 2], [1, 1, 2]])', 'matrix', { value: 6 }],
  ['linear', 'eigs([[2, 1], [1, 2]])', 'matrix', { match: /3.*1|1.*3/ }],
  ['linear', 'eigenvalues([[4, 1], [2, 3]])', 'matrix', { match: /5.*2|2.*5/ }],
  ['linear', 'rank([[1, 2], [2, 4]])', 'matrix', { value: 1 }],
  ['linear', 'inv([[2, 1], [1, 1]])', 'matrix', { match: /\[\[1, -1\], \[-1, 2\]\]/ }],
  ['linear', 'linsolve([[1, 1], [1, -1]], [10, 2])', 'matrix', { match: /\[\[6\], \[4\]\]/ }],
  ['linear', 'trace([[1, 2], [3, 4]])', 'matrix', { value: 5 }],

  // ── number theory ──
  ['numtheory', 'factorint(2^32 + 1)', 'numtheory', { match: /^641 \* 6700417$/ }],
  ['numtheory', 'isprime(2^61 - 1)', 'numtheory', { match: /^true$/ }],
  ['numtheory', 'totient(100)', 'numtheory', { value: 40 }],
  ['numtheory', 'gcd(462, 1071)', 'numtheory', { value: 21 }],
  ['numtheory', 'modinv(3, 11)', 'numtheory', { value: 4 }],
  ['numtheory', 'powmod(2, 100, 13)', 'numtheory', { value: 3 }],
  ['numtheory', 'fibonacci(50)', 'numtheory', { value: 12586269025 }],
  ['numtheory', 'crt([1, 2], [3, 5])', 'numtheory', { match: /7 mod 15/ }],
  ['numtheory', 'prime(100)', 'numtheory', { value: 541 }],
  ['numtheory', 'partition(10)', 'numtheory', { value: 42 }],
];
