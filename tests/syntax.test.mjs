// The input front end (src/syntax.js): every notation people type becomes canonical input.
// Pure string rewriting, so this suite runs in Node without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateInput } from '../src/syntax.js';
import { userFns } from '../src/state.js';

const flat = (s) => s.replace(/\s+/g, '');
function cases(table) {
  for (const [input, want] of table) assert.equal(flat(translateInput(input)), flat(want), `${input}`);
}

test('canonical input passes through unchanged', () => {
  cases([
    ['integrate(x^2, x, 0, 1)', 'integrate(x^2, x, 0, 1)'], ['solve(x^2 = 4, x)', 'solve(x^2 = 4, x)'], ['f(x) = x^2', 'f(x) = x^2'],
    ['a = 5', 'a = 5'], ['100 km/h to m/s', '100 km/h to m/s'], ['[[1, 2], [3, 4]]', '[[1, 2], [3, 4]]'], ['3!', '3!'],
    ['plot(sin(x), [x, -5, 5])', 'plot(sin(x), [x, -5, 5])'], ["y'' + y = 0", "y'' + y = 0"], ['mean([1, 2, 3])', 'mean([1, 2, 3])'],
    ['5 | 3', '5 | 3'], ['e^(i*pi)', 'e^(i*pi)'], ['x^2 = 4', 'x^2 = 4'],
  ]);
});

test('infinity spellings and function aliases', () => {
  cases([
    ['limit((1+1/n)^n, n, inf)', 'limit((1+1/n)^n, n, Infinity)'], ['sum(1/k^2, k, 1, oo)', 'sum(1/k^2, k, 1, Infinity)'],
    ['integrate(exp(-x^2), x, -oo, oo)', 'integrate(exp(-x^2), x, -Infinity, Infinity)'], ['1/∞', '1/Infinity'],
    ['eigenvals([[2,1],[1,2]])', 'eigs([[2,1],[1,2]])'], ['eigenvalues([[1,0],[0,2]])', 'eigs([[1,0],[0,2]])'],
    ['nCr(5, 2)', 'combinations(5, 2)'], ['determinant([[1,2],[3,4]])', 'det([[1,2],[3,4]])'],
  ]);
});

test('Leibniz notation, ∫ and Unicode', () => {
  cases([
    ['d/dx x^3', 'derivative(x^3, x)'], ['d/dx (x^2 + 1)', 'derivative(x^2 + 1, x)'], ['d^2/dx^2 sin(x)', 'derivative(sin(x), x, 2)'],
    ['(d/dx) x^2', 'derivative(x^2, x)'], ['d/dt t*e^t', 'derivative(t*e^t, t)'], ['∂/∂y x*y^2', 'derivative(x*y^2, y)'],
    ['∫ x^2 dx', 'integrate(x^2, x)'], ['∫_0^1 x^2 dx', 'integrate(x^2, x, 0, 1)'],
    ['x² + 3x', 'x^2 + 3x'], ['√x + √(x+1)', 'sqrt(x) + sqrt(x+1)'], ['2·3', '2*3'], ['π/2', 'pi/2'], ['θ + 1', 'theta + 1'],
    ['x := 3', 'x = 3'], ['2 + 2 =', '2 + 2'], ['2 + 2 = ?', '2 + 2'],
  ]);
});

test('everyday function notation', () => {
  cases([
    ['sin x', 'sin(x)'], ['sin 2x cos x', 'sin(2x) cos(x)'], ['sin^2(x) + cos^2(x)', 'sin(x)^2 + cos(x)^2'], ['sin^2 x', 'sin(x)^2'],
    ['sin^-1(x)', 'asin(x)'], ['ln x', 'ln(x)'], ['|x - 3| < 2', 'abs(x - 3) < 2'], ['2|x| + 1', '2abs(x) + 1'],
  ]);
});

test('plain English', () => {
  cases([
    ['derivative of x^2 sin x', 'derivative(x^2 sin(x), x)'], ['second derivative of x^4', 'derivative(x^4, x, 2)'],
    ['differentiate x^3 with respect to x', 'derivative(x^3, x)'], ['integral of x^2 from 0 to 1', 'integrate(x^2, x, 0, 1)'],
    ['integrate x*e^x dx', 'integrate(x*e^x, x)'], ['antiderivative of 1/x', 'integrate(1/x, x)'],
    ['area under x^2 from 0 to 3', 'integrate(x^2, x, 0, 3)'], ['limit of sin(x)/x as x -> 0', 'limit(sin(x)/x, x, 0)'],
    ['lim (1+1/n)^n as n approaches infinity', 'limit((1+1/n)^n, n, Infinity)'],
    ['limit of 1/x as x goes to 0 from the left', 'limit(1/x, x, 0, "-")'], ['solve x^2 - 4 = 0 for x', 'solve(x^2 - 4 = 0, x)'],
    ['solve 2x+3=7', 'solve(2x+3=7)'], ['roots of x^2-5x+6', 'solve(x^2-5x+6 = 0, x)'],
    ['taylor series of e^x at x = 0 to order 5', 'series(e^x, x, 0, 5)'], ['sum of 1/k^2 for k = 1 to infinity', 'sum(1/k^2, k, 1, Infinity)'],
    ['factor x^2 - 1', 'factor(x^2 - 1)'], ['factor 360', 'factorint(360)'], ['is 97 prime?', 'isprime(97)'], ['gcd of 12 and 18', 'gcd(12, 18)'],
    ['plot sin(x) from -pi to pi', 'plot(sin(x), [x, -pi, pi])'], ['x^2 + 1 at x = 3', 'subs(x^2 + 1, x, 3)'], ['what is 2+2?', '2+2'],
    ['sqrt of 16', 'sqrt(16)'],
  ]);
});

test('Mathematica syntax', () => {
  cases([
    ['D[x^3, x]', 'derivative(x^3, x)'], ['D[Sin[x], {x, 2}]', 'derivative(sin(x), x, 2)'], ['Integrate[x^2, {x, 0, 1}]', 'integrate(x^2, x, 0, 1)'],
    ['Integrate[Exp[-x^2], {x, -Infinity, Infinity}]', 'integrate(exp(-x^2), x, -Infinity, Infinity)'], ['Solve[x^2 == 4, x]', 'solve(x^2 = 4, x)'],
    ['Limit[Sin[x]/x, x -> 0]', 'limit(sin(x)/x, x, 0)'], ['Series[Exp[x], {x, 0, 5}]', 'series(exp(x), x, 0, 5)'],
    ['Sum[1/k^2, {k, 1, Infinity}]', 'sum(1/k^2, k, 1, Infinity)'], ['Factor[x^4 - 1]', 'factor(x^4 - 1)'], ['N[Pi, 30]', 'N(pi, 30)'],
    ["DSolve[y''[x] + y[x] == 0, y[x], x]", "dsolve(y''(x) + y(x) = 0, y(x))"], ['Det[{{1, 2}, {3, 4}}]', 'det([[1, 2], [3, 4]])'],
    ['f[x_] := x^2 + 1', 'f(x) = x^2 + 1'], ['Solve[{x + y == 10, x - y == 2}, {x, y}]', 'solve([x + y = 10, x - y = 2], [x, y])'],
  ]);
});

test('LaTeX', () => {
  cases([
    ['\\frac{d}{dx} x^2', 'derivative(x^2, x)'], ['\\frac{d^2}{dx^2} \\sin x', 'derivative(sin(x), x, 2)'],
    ['\\int_0^1 x^2 \\, dx', 'integrate(x^2, x, 0, 1)'], ['\\int x e^{x} dx', 'integrate(x e^x, x)'],
    ['\\sqrt{2} + \\frac{1}{2}', 'sqrt(2) + ((1)/(2))'], ['\\sqrt[3]{x}', 'nthRoot(x, 3)'],
    ['\\lim_{x \\to 0} \\frac{\\sin x}{x}', 'limit(((sin(x))/(x)), x, 0)'], ['\\sum_{k=1}^{\\infty} \\frac{1}{k^2}', 'sum(((1)/(k^2)), k, 1, Infinity)'],
    ['\\left| x - 3 \\right| < 2', 'abs(x - 3) < 2'], ['x^{2} + 2x \\cdot 3', 'x^2 + 2x * 3'], ['\\sin^2 x + \\cos^2 x', 'sin(x)^2 + cos(x)^2'],
    ['\\log_{2}(8)', 'log(8, 2)'], ['$x^2 \\le 4$', 'x^2 <= 4'], ['\\pi \\theta', 'pi theta'],
  ]);
});

test('primes of user functions become derivatives', () => {
  userFns.f = { params: ['x'], body: 'x^3' };
  try {
    cases([["f'(x)", 'derivative(f(x), x)'], ["f''(x)", 'derivative(f(x), x, 2)'], ["f'(2)", 'subs(diff(f(x_), x_), x_, 2)'], ["f''(1)", 'subs(diff(f(x_), x_, 2), x_, 1)']]);
  } finally { delete userFns.f; }
});
