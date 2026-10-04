// Searchable formula library: each entry inserts a definition (or a ready-to-run line) into the
// notebook. Every definition is run by the test suite.
const F = (cat, name, def, keys = '') => ({ cat, name, def, keys });

export const FORMULAS = [
  // geometry
  F('Geometry', 'Area of a circle', 'A_circle(r) = pi r^2', 'disc disk'),
  F('Geometry', 'Circumference', 'C_circle(r) = 2 pi r', 'perimeter circle'),
  F('Geometry', 'Area of a triangle (Heron)', 'heron(a, b, c) = sqrt(((a + b + c)/2) ((a + b + c)/2 - a) ((a + b + c)/2 - b) ((a + b + c)/2 - c))', 'triangle sides'),
  F('Geometry', 'Volume of a sphere', 'V_sphere(r) = 4/3 pi r^3', 'ball'),
  F('Geometry', 'Surface area of a sphere', 'S_sphere(r) = 4 pi r^2', 'ball'),
  F('Geometry', 'Volume of a cylinder', 'V_cyl(r, h) = pi r^2 h'),
  F('Geometry', 'Volume of a cone', 'V_cone(r, h) = pi r^2 h/3'),
  F('Geometry', 'Pythagoras: hypotenuse', 'hyp(a, b) = sqrt(a^2 + b^2)', 'right triangle'),
  F('Geometry', 'Law of cosines', 'cosine_law(a, b, C) = sqrt(a^2 + b^2 - 2 a b cos(C))', 'triangle side angle'),
  F('Geometry', 'Distance between points', 'dist(x1, y1, x2, y2) = sqrt((x2 - x1)^2 + (y2 - y1)^2)'),
  // algebra
  F('Algebra', 'Quadratic formula', 'quad_roots(a, b, c) = [(-b + sqrt(b^2 - 4 a c))/(2 a), (-b - sqrt(b^2 - 4 a c))/(2 a)]', 'roots solve'),
  F('Algebra', 'Arithmetic series sum', 'arith_sum(a, d, n) = n/2 (2 a + (n - 1) d)', 'progression'),
  F('Algebra', 'Geometric series sum', 'geom_sum(a, r, n) = a (1 - r^n)/(1 - r)', 'progression'),
  F('Algebra', 'Binomial coefficient', 'nck(n, k) = n!/(k! (n - k)!)', 'choose combinations'),
  F('Algebra', 'Compound interest', 'compound(P, r, n, t) = P (1 + r/n)^(n t)', 'finance money'),
  F('Algebra', 'Continuous compounding', 'cont_comp(P, r, t) = P exp(r t)', 'finance money'),
  F('Algebra', 'Loan payment (annuity)', 'payment(P, r, n) = P r/(1 - (1 + r)^(-n))', 'mortgage finance'),
  // trigonometry identities (run as proofs)
  F('Trigonometry', 'Pythagorean identity', 'prove(sin(x)^2 + cos(x)^2 = 1)', 'identity'),
  F('Trigonometry', 'Double angle (sine)', 'prove(sin(2x) = 2 sin(x) cos(x))', 'identity'),
  F('Trigonometry', 'Double angle (cosine)', 'prove(cos(2x) = 1 - 2 sin(x)^2)', 'identity'),
  F('Trigonometry', 'Angle sum (sine)', 'prove(sin(a + b) = sin(a) cos(b) + cos(a) sin(b))', 'identity addition'),
  F('Trigonometry', 'Angle sum (cosine)', 'prove(cos(a + b) = cos(a) cos(b) - sin(a) sin(b))', 'identity addition'),
  F('Trigonometry', 'Tangent from sine and cosine', 'prove(tan(x) = sin(x)/cos(x))', 'identity'),
  // calculus
  F('Calculus', 'Taylor series of e^x', 'series(exp(x), x, 0, 6)', 'maclaurin'),
  F('Calculus', 'Arc length of a graph', 'arclength(x^2, x, 0, 1)', 'curve length'),
  F('Calculus', 'Gaussian integral', 'integrate(exp(-x^2), x, -oo, oo)', 'normal'),
  F('Calculus', 'Basel problem', 'sum(1/n^2, n, 1, oo)', 'zeta series'),
  F('Calculus', 'Definition of e', 'limit((1 + 1/n)^n, n, oo)', 'limit euler'),
  // physics
  F('Physics', 'Kinetic energy', 'KE(m, v) = m v^2/2', 'mechanics energy'),
  F('Physics', 'Gravitational potential energy', 'PE(m, h) = 9.81 m h', 'mechanics energy'),
  F('Physics', 'Projectile range', 'proj_range(v, theta) = v^2 sin(2 theta)/9.81', 'kinematics'),
  F('Physics', 'Projectile height', 'proj_y(v, theta, t) = v sin(theta) t - 9.81 t^2/2', 'kinematics'),
  F('Physics', 'Pendulum period', 'pendulum(L) = 2 pi sqrt(L/9.81)', 'oscillation'),
  F('Physics', 'Spring period', 'spring(m, k) = 2 pi sqrt(m/k)', 'oscillation harmonic'),
  F('Physics', "Coulomb's law", 'coulomb(q1, q2, r) = 8.9875517923e9 q1 q2/r^2', 'electric force'),
  F('Physics', "Newton's gravitation", 'gravity(m1, m2, r) = 6.6743e-11 m1 m2/r^2', 'force'),
  F('Physics', 'Ideal gas pressure', 'pressure(n, T, V) = n 8.314462618 T/V', 'thermodynamics'),
  F('Physics', 'Relativistic gamma', 'lorentz(v) = 1/sqrt(1 - v^2/299792458^2)', 'special relativity'),
  F('Physics', 'Photon energy', 'photon(f) = 6.62607015e-34 f', 'quantum planck'),
  F('Physics', 'Ohm\'s law (current)', 'current(V, R) = V/R', 'electric circuit'),
  // statistics
  F('Statistics', 'Normal density', 'normpdf(x, mu, s) = exp(-(x - mu)^2/(2 s^2))/(s sqrt(2 pi))', 'gaussian bell'),
  F('Statistics', 'z-score', 'zscore(x, mu, s) = (x - mu)/s', 'standardise'),
  F('Statistics', 'Binomial probability', 'binom_p(n, k, p) = combinations(n, k) p^k (1 - p)^(n - k)', 'bernoulli trials'),
  F('Statistics', 'Standard error of the mean', 'sem(s, n) = s/sqrt(n)', 'sampling'),
  F('Statistics', 'Bayes theorem', 'bayes(pBA, pA, pB) = pBA pA/pB', 'conditional probability'),
  // number theory
  F('Number theory', 'Euler totient of 360', 'totient(360)', 'phi'),
  F('Number theory', 'Mersenne prime test', 'isprime(2^127 - 1)', 'prime'),
];
