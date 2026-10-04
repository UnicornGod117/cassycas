// Registry of named SymPy tools (implemented in src/sympy/tools.py).
// args: comma-separated argument kinds, matched in order —
//   e  expression            r  equation (lhs = rhs) or expression
//   v  variable name         V  variable or list of variables, e.g. [x, y]
//   f  sequence form a(n)    R  range [x, a, b]
//   q  equation or inequality             L  list of constraints [x + y = 1, x >= 0] or a range
//   D  system of ODEs written with primes [x' = y, y' = -x]
// A kind may end in ? (optional), * (repeats, zero or more) or =name (a variable with a default).
// Variables named by v/V/f/R arguments are kept symbolic even if the workspace defines them.
// fallback: 'mathjs' lets the numeric engine answer when SymPy is unavailable; jsFallback: a
// JavaScript implementation (engine.js JS_TOOLS) answers the numeric cases.
export const TOOLS = {
  // ── number theory ──
  isprime: { args: 'e', mode: 'numtheory', sig: 'isprime(n)', desc: 'Primality test', ex: 'isprime(2^31 - 1)' },
  nextprime: { args: 'e', mode: 'numtheory', sig: 'nextprime(n)', desc: 'Smallest prime greater than n', ex: 'nextprime(1000)' },
  prevprime: { args: 'e', mode: 'numtheory', sig: 'prevprime(n)', desc: 'Largest prime less than n', ex: 'prevprime(1000)' },
  prime: { args: 'e', mode: 'numtheory', sig: 'prime(n)', desc: 'The n-th prime', ex: 'prime(1000)' },
  primepi: { args: 'e', mode: 'numtheory', sig: 'primepi(n)', desc: 'Number of primes ≤ n', ex: 'primepi(10^6)' },
  factorint: { args: 'e', mode: 'numtheory', sig: 'factorint(n)', desc: 'Prime factorization', ex: 'factorint(2^32 + 1)' },
  divisors: { args: 'e', mode: 'numtheory', sig: 'divisors(n)', desc: 'All positive divisors, τ(n) and σ(n)', ex: 'divisors(360)' },
  totient: { args: 'e', mode: 'numtheory', sig: 'totient(n)', desc: 'Euler’s totient φ(n)', ex: 'totient(360)' },
  mobius: { args: 'e', mode: 'numtheory', sig: 'mobius(n)', desc: 'Möbius function μ(n)', ex: 'mobius(30)' },
  modinv: { args: 'e,e', mode: 'numtheory', sig: 'modinv(a, m)', desc: 'Inverse of a modulo m', ex: 'modinv(17, 3120)' },
  powmod: { args: 'e,e,e', mode: 'numtheory', sig: 'powmod(a, b, m)', desc: 'a^b mod m (fast)', ex: 'powmod(2, 10^18, 10^9 + 7)' },
  crt: { args: 'e,e', mode: 'numtheory', sig: 'crt([r1, r2, …], [m1, m2, …])', desc: 'Chinese remainder theorem', ex: 'crt([2, 3, 2], [3, 5, 7])' },
  fibonacci: { args: 'e', mode: 'numtheory', sig: 'fibonacci(n)', desc: 'Fibonacci number F(n)', ex: 'fibonacci(100)' },
  lucas: { args: 'e', mode: 'numtheory', sig: 'lucas(n)', desc: 'Lucas number L(n)', ex: 'lucas(50)' },
  catalan: { args: 'e', mode: 'numtheory', sig: 'catalan(n)', desc: 'Catalan number C(n)', ex: 'catalan(20)', fallback: 'mathjs' },
  bernoulli: { args: 'e', mode: 'numtheory', sig: 'bernoulli(n)', desc: 'Bernoulli number B(n)', ex: 'bernoulli(12)' },
  partition: { args: 'e', mode: 'numtheory', sig: 'partition(n)', desc: 'Number of integer partitions p(n)', ex: 'partition(100)' },
  contfrac: { args: 'e,e?', mode: 'numtheory', sig: 'contfrac(x[, terms])', desc: 'Continued fraction (periodic for quadratic surds)', ex: 'contfrac(sqrt(7))' },
  identify: { args: 'e', mode: 'numtheory', sig: 'identify(decimal)', desc: 'Recognise a decimal as a closed form', ex: 'identify(0.7853981633974483)' },
  tobase: { args: 'e,e', mode: 'numtheory', sig: 'tobase(n, b)', desc: 'Write n in base b (2–36)', ex: 'tobase(255, 16)' },
  diophantine: { args: 'r', mode: 'numtheory', sig: 'diophantine(equation)', desc: 'Integer solutions', ex: 'diophantine(3x + 5y = 7)' },

  // ── calculus ──
  jacobian: { args: 'e,V', mode: 'calculus', sig: 'jacobian([f, g], [x, y])', desc: 'Jacobian matrix', ex: 'jacobian([x*y, x + y^2], [x, y])' },
  hessian: { args: 'e,V', mode: 'calculus', sig: 'hessian(f, [x, y])', desc: 'Hessian matrix', ex: 'hessian(x^3 + x*y^2, [x, y])' },
  laplacian: { args: 'e,V', mode: 'calculus', sig: 'laplacian(f, [x, y, z])', desc: 'Laplacian ∇²f', ex: 'laplacian(1/sqrt(x^2 + y^2 + z^2), [x, y, z])' },
  divergence: { args: 'e,V', mode: 'calculus', sig: 'divergence([P, Q, R], [x, y, z])', desc: 'Divergence ∇·F', ex: 'divergence([x^2, x*y, z], [x, y, z])' },
  curl: { args: 'e,V', mode: 'calculus', sig: 'curl([P, Q, R], [x, y, z])', desc: 'Curl ∇×F', ex: 'curl([-y, x, 0], [x, y, z])' },
  extrema: { args: 'e,V', mode: 'calculus', sig: 'extrema(f, x) or extrema(f, [x, y])', desc: 'Critical points, classified', ex: 'extrema(x^3 - 3x, x)' },
  tangent: { args: 'e,v,e', mode: 'calculus', sig: 'tangent(f, x, a)', desc: 'Tangent line at x = a', ex: 'tangent(x^2, x, 3)' },
  idiff: { args: 'r,v,v,e?', mode: 'calculus', sig: 'idiff(equation, y, x[, n])', desc: 'Implicit derivative dy/dx', ex: 'idiff(x^2 + y^2 = 25, y, x)' },
  laplace: { args: 'e,v=t,v=s', mode: 'calculus', sig: 'laplace(f, t, s)', desc: 'Laplace transform', ex: 'laplace(t^2*exp(-t), t, s)' },
  invlaplace: { args: 'e,v=s,v=t', mode: 'calculus', sig: 'invlaplace(F, s, t)', desc: 'Inverse Laplace transform', ex: 'invlaplace(1/(s^2 + 4), s, t)' },
  fourier: { args: 'e,v=x,v=k', mode: 'calculus', sig: 'fourier(f, x, k)', desc: 'Fourier transform', ex: 'fourier(exp(-x^2), x, k)' },
  invfourier: { args: 'e,v=k,v=x', mode: 'calculus', sig: 'invfourier(F, k, x)', desc: 'Inverse Fourier transform', ex: 'invfourier(exp(-k^2), k, x)' },
  fourierseries: { args: 'e,v,e?,e?,e?', mode: 'calculus', sig: 'fourierseries(f, x[, a, b][, n])', desc: 'Fourier series on [a, b] (default [−π, π])', ex: 'fourierseries(x, x, 4)' },
  residue: { args: 'e,v,e', mode: 'calculus', sig: 'residue(f, z, a)', desc: 'Residue at a pole', ex: 'residue(1/(z^2 + 1), z, i)' },
  arclength: { args: 'e,v,e,e', mode: 'calculus', sig: 'arclength(f, x, a, b)', desc: 'Length of a curve y = f(x)', ex: 'arclength(x^2, x, 0, 1)' },
  rsolve: { args: 'r,f,r*', mode: 'calculus', sig: 'rsolve(recurrence, a(n), a(0) = …)', desc: 'Solve a recurrence', ex: 'rsolve(a(n+2) = a(n+1) + a(n), a(n), a(0) = 0, a(1) = 1)', raw: true },
  nsolve: { args: 'r,v,e,e?', mode: 'solve', sig: 'nsolve(equation, x, x0[, digits])', desc: 'High-precision numeric root near x0', ex: 'nsolve(cos(x) = x, x, 1, 50)' },
  csolve: { args: 'r,v', mode: 'solve', sig: 'csolve(equation, x)', desc: 'All complex solutions', ex: 'csolve(x^5 = 1, x)' },
  N: { args: 'e,e?', mode: 'numeric', sig: 'N(expr[, digits])', desc: 'Evaluate to any number of digits', ex: 'N(pi, 100)' },

  // ── algebra ──
  subs: { args: 'e,v,e,v?,e?,v?,e?', mode: 'algebra', sig: 'subs(expr, x, value[, y, value…])', desc: 'Substitute a value (or expression) for a variable', ex: 'subs(x^2 + 3x, x, 2)', jsFallback: true },
  resultant: { args: 'e,e,v', mode: 'algebra', sig: 'resultant(p, q, x)', desc: 'Resultant of two polynomials', ex: 'resultant(x^2 - 2, x^3 - x - 1, x)' },
  discriminant: { args: 'e,v', mode: 'algebra', sig: 'discriminant(p, x)', desc: 'Polynomial discriminant', ex: 'discriminant(a*x^2 + b*x + c, x)' },
  degree: { args: 'e,v', mode: 'algebra', sig: 'degree(p, x)', desc: 'Degree in x', ex: 'degree((x^2 + 1)^3, x)' },
  coeffs: { args: 'e,v', mode: 'algebra', sig: 'coeffs(p, x)', desc: 'All coefficients, highest power first', ex: 'coeffs((x + 2)^4, x)' },
  groebner: { args: 'e,V', mode: 'algebra', sig: 'groebner([p1, p2, …], [x, y])', desc: 'Gröbner basis (lex order)', ex: 'groebner([x^2 + y^2 - 1, x - y], [x, y])' },
  completesquare: { args: 'e,v', mode: 'algebra', sig: 'completesquare(p, x)', desc: 'Vertex form a(x − h)² + k', ex: 'completesquare(2x^2 + 8x + 3, x)' },
  rewrite: { args: 'e,v', mode: 'algebra', sig: 'rewrite(expr, exp|sin|cos|log|…)', desc: 'Rewrite in terms of another function', ex: 'rewrite(cos(x), exp)' },
  logcombine: { args: 'e', mode: 'algebra', sig: 'logcombine(expr)', desc: 'Combine logarithms', ex: 'logcombine(log(x) + 2*log(y))' },
  expandlog: { args: 'e', mode: 'algebra', sig: 'expandlog(expr)', desc: 'Expand logarithms', ex: 'expandlog(log(x^2*y/z))' },
  powsimp: { args: 'e', mode: 'algebra', sig: 'powsimp(expr)', desc: 'Combine powers', ex: 'powsimp(x^a*x^b*y^a)' },
  polar: { args: 'e', mode: 'algebra', sig: 'polar(z)', desc: 'Polar form r·e^(iθ)', ex: 'polar(1 + sqrt(3)*i)' },
  rect: { args: 'e', mode: 'algebra', sig: 'rect(z)', desc: 'Rectangular form a + bi', ex: 'rect(2*exp(i*pi/3))' },

  // ── linear algebra ──
  diagonalize: { args: 'e', mode: 'matrix', sig: 'diagonalize(A)', desc: 'A = P D P⁻¹', ex: 'diagonalize([[2, 1], [1, 2]])' },
  jordan: { args: 'e', mode: 'matrix', sig: 'jordan(A)', desc: 'Jordan normal form', ex: 'jordan([[1, 1], [0, 1]])' },
  expm: { args: 'e', mode: 'matrix', sig: 'expm(A)', desc: 'Matrix exponential', ex: 'expm([[0, 1], [-1, 0]])', fallback: 'mathjs' },
  lu: { args: 'e', mode: 'matrix', sig: 'lu(A)', desc: 'LU decomposition', ex: 'lu([[2, 1], [4, 5]])' },
  qr: { args: 'e', mode: 'matrix', sig: 'qr(A)', desc: 'QR decomposition', ex: 'qr([[1, 1], [1, -1]])', fallback: 'mathjs' },
  adj: { args: 'e', mode: 'matrix', sig: 'adj(A)', desc: 'Adjugate matrix', ex: 'adj([[1, 2], [3, 4]])' },
  columnspace: { args: 'e', mode: 'matrix', sig: 'columnspace(A)', desc: 'Basis of the column space', ex: 'columnspace([[1, 2], [2, 4]])' },
  rowspace: { args: 'e', mode: 'matrix', sig: 'rowspace(A)', desc: 'Basis of the row space', ex: 'rowspace([[1, 2, 3], [2, 4, 6]])' },
  pinv: { args: 'e', mode: 'matrix', sig: 'pinv(A)', desc: 'Moore–Penrose pseudo-inverse', ex: 'pinv([[1, 2], [2, 4]])', fallback: 'mathjs' },
  linsolve: { args: 'e,e', mode: 'matrix', sig: 'linsolve(A, b)', desc: 'Solve A·x = b (parametric if underdetermined)', ex: 'linsolve([[1, 1], [2, 2]], [3, 6])' },
  lll: { args: 'e', mode: 'matrix', sig: 'lll(B)', desc: 'LLL-reduced basis of an integer lattice (rows)', ex: 'lll([[1, 1, 1], [-1, 0, 2], [3, 5, 6]])' },

  // ── number fields, Galois theory ── (src/sympy/advanced.py)
  minpoly: { args: 'e,v=x', mode: 'algebra', sig: 'minpoly(α[, x])', desc: 'Minimal polynomial of an algebraic number over ℚ', ex: 'minpoly(sqrt(2) + sqrt(3))' },
  nfactor: { args: 'e,e', mode: 'algebra', sig: 'nfactor(p, α) or nfactor(p, [α, β])', desc: 'Factor over the number field ℚ(α)', ex: 'nfactor(x^2 - 2, sqrt(2))' },
  galois: { args: 'e,v?', mode: 'algebra', sig: 'galois(p[, x])', desc: 'Galois group of an irreducible polynomial (degree ≤ 6); solvable by radicals?', ex: 'galois(x^5 - x - 1)' },

  // ── transforms, signals ──
  ztrans: { args: 'e,v=n,v=z', mode: 'calculus', sig: 'ztrans(f, n, z)', desc: 'Z-transform Σ f(n) z⁻ⁿ', ex: 'ztrans(2^n, n, z)' },
  iztrans: { args: 'e,v=z,v=n', mode: 'calculus', sig: 'iztrans(F, z, n)', desc: 'Inverse Z-transform of a rational function', ex: 'iztrans(z/(z^2 + 1), z, n)' },
  convolve: { args: 'e,e,v=t', mode: 'calculus', sig: 'convolve(f, g, t) or convolve([a…], [b…])', desc: 'Convolution ∫₀ᵗ f(τ)g(t−τ)dτ, or of two sequences', ex: 'convolve(exp(-t), exp(-2t), t)' },
  dft: { args: 'e', mode: 'calculus', sig: 'dft([x0, x1, …])', desc: 'Exact discrete Fourier transform', ex: 'dft([1, 2, 3, 4])' },
  idft: { args: 'e', mode: 'calculus', sig: 'idft([X0, X1, …])', desc: 'Inverse discrete Fourier transform', ex: 'idft([10, -2 + 2i, -2, -2 - 2i])' },
  bode: { args: 'e,v=s', mode: 'calculus', sig: 'bode(H, s)', desc: 'Bode plot (gain in dB and phase) of a transfer function', ex: 'bode(1/(s + 1), s)' },
  holonomic: { args: 'e,v=x', mode: 'calculus', sig: 'holonomic(f, x)', desc: 'Linear ODE with polynomial coefficients that f satisfies', ex: 'holonomic(exp(x^2), x)' },

  // ── optimisation ──
  maximize: { args: 'e,L?,V?', mode: 'calculus', sig: 'maximize(f, [constraints] or [x, a, b])', desc: 'Global maximum: closed interval, Lagrange multipliers or linear programming', ex: 'maximize(x*y, [x + y = 10])' },
  minimize: { args: 'e,L?,V?', mode: 'calculus', sig: 'minimize(f, [constraints] or [x, a, b])', desc: 'Global minimum: closed interval, Lagrange multipliers or linear programming', ex: 'minimize(x^2 + y^2, [x + 2y = 5])' },
  lagrange: { args: 'e,L,V', mode: 'calculus', sig: 'lagrange(f, [g = c, …], [x, y])', desc: 'Lagrange multiplier system and its solutions', ex: 'lagrange(x + y, [x^2 + y^2 = 1], [x, y])' },

  // ── stochastic calculus ──
  ito: { args: 'e,v,e,e,v=t', mode: 'calculus', sig: 'ito(f, X, μ, σ[, t])', desc: 'Itô’s lemma for f(t, X) with dX = μ dt + σ dW', ex: 'ito(X^2, X, 0, 1)' },
  sdesolve: { args: 'e,e,v,e=X_0,v=t', mode: 'calculus', sig: 'sdesolve(μ, σ, X[, X0, t])', desc: 'Solve dX = μ dt + σ dW (geometric BM, drifted BM, Ornstein–Uhlenbeck)', ex: 'sdesolve(2X, 3X, X)' },

  // ── differential geometry, relativity ──
  christoffel: { args: 'e,V', mode: 'calculus', sig: 'christoffel(g, [coords])', desc: 'Christoffel symbols of a metric', ex: 'christoffel([[1, 0], [0, r^2]], [r, theta])' },
  riemann: { args: 'e,V', mode: 'calculus', sig: 'riemann(g, [coords])', desc: 'Riemann curvature tensor (non-zero components)', ex: 'riemann([[r^2, 0], [0, r^2 sin(theta)^2]], [theta, phi])' },
  ricci: { args: 'e,V', mode: 'calculus', sig: 'ricci(g, [coords])', desc: 'Ricci tensor', ex: 'ricci([[r^2, 0], [0, r^2 sin(theta)^2]], [theta, phi])' },
  ricciscalar: { args: 'e,V', mode: 'calculus', sig: 'ricciscalar(g, [coords])', desc: 'Scalar curvature', ex: 'ricciscalar([[r^2, 0], [0, r^2 sin(theta)^2]], [theta, phi])' },
  einstein: { args: 'e,V', mode: 'calculus', sig: 'einstein(g, [coords])', desc: 'Einstein tensor G = Ric − ½Rg', ex: 'einstein([[-(1 - 2M/r), 0, 0, 0], [0, 1/(1 - 2M/r), 0, 0], [0, 0, r^2, 0], [0, 0, 0, r^2 sin(theta)^2]], [t, r, theta, phi])' },
  geodesic: { args: 'e,V,v=s', mode: 'calculus', sig: 'geodesic(g, [coords][, s])', desc: 'Geodesic equations', ex: 'geodesic([[1, 0], [0, r^2]], [r, theta])' },
  curvature: { args: 'e,v', mode: 'calculus', sig: 'curvature(f, x) or curvature([x(t), y(t)], t)', desc: 'Curvature of a curve', ex: 'curvature(x^2, x)' },
  surfcurv: { args: 'e,V', mode: 'calculus', sig: 'surfcurv([x, y, z], [u, v])', desc: 'Gaussian and mean curvature of a parametric surface', ex: 'surfcurv([sin(u) cos(v), sin(u) sin(v), cos(u)], [u, v])' },
  wedge: { args: 'e,e,e*', mode: 'calculus', sig: 'wedge(α, β, …)', desc: 'Exterior product of differential forms (write dx, dy, …)', ex: 'wedge(x*dx + y*dy, dz)' },
  extd: { args: 'e,V?', mode: 'calculus', sig: 'extd(ω[, [coords]])', desc: 'Exterior derivative dω', ex: 'extd(x*dy - y*dx)' },
  hodge: { args: 'e,V', mode: 'calculus', sig: 'hodge(ω, [coords])', desc: 'Hodge star (Euclidean metric)', ex: 'hodge(dx, [x, y, z])' },
  diffelim: { args: 'D,V,v=t', mode: 'calculus', sig: "diffelim([x' = …, y' = …], [keep], t)", desc: 'Differential elimination: an ODE for the kept functions only', ex: "diffelim([x' = y, y' = -x], [x], t)" },

  // ── quantum, knots ──
  circuit: { args: 'e,e*', mode: 'algebra', sig: 'circuit(n, H(0), CNOT(0, 1), …)', desc: 'Simulate a quantum circuit on n qubits (exact amplitudes)', ex: 'circuit(2, H(0), CNOT(0, 1))' },
  alexander: { args: 'e', mode: 'algebra', sig: 'alexander(knot)', desc: 'Alexander polynomial (trefoil, figure8, cinquefoil, threetwist, stevedore or a PD code)', ex: 'alexander(figure8)' },
  jones: { args: 'e', mode: 'algebra', sig: 'jones(knot)', desc: 'Jones polynomial via the Kauffman bracket', ex: 'jones(trefoil)' },

  // ── random variables (define with X = Normal(0, 1) or X ~ Normal(0, 1), or write inline) ──
  P: { args: 'q,q?', mode: 'stats', sig: 'P(condition[, given])', desc: 'Probability of an event, e.g. P(X > 1) after X = Normal(0, 1)', ex: 'P(Normal(0, 1) > 1)' },
  E: { args: 'e,q?', mode: 'stats', sig: 'E(expr[, given])', desc: 'Expected value', ex: 'E(Die(6))' },
  Var: { args: 'e', mode: 'stats', sig: 'Var(X)', desc: 'Variance of a random variable', ex: 'Var(Exponential(2))' },
  Std: { args: 'e', mode: 'stats', sig: 'Std(X)', desc: 'Standard deviation of a random variable', ex: 'Std(Uniform(0, 12))' },
  density: { args: 'e', mode: 'stats', sig: 'density(X)', desc: 'Density or probability mass function', ex: 'density(Exponential(2))' },
  cdf: { args: 'e', mode: 'stats', sig: 'cdf(X)', desc: 'Cumulative distribution function', ex: 'cdf(Uniform(0, 2))' },

  // ── geometry (define with A = Point(0, 0), c = Circle(A, 2), T = Triangle(A, B, C), …) ──
  intersect: { args: 'e,e', mode: 'algebra', sig: 'intersect(a, b)', desc: 'Intersection of lines, circles, segments, polygons', ex: 'intersect(Circle(Point(0, 0), 2), Line(Point(-3, 1), Point(3, 1)))' },
  distance: { args: 'e,e', mode: 'algebra', sig: 'distance(a, b)', desc: 'Distance between points, lines, …', ex: 'distance([0, 0], [3, 4])', fallback: 'mathjs' },
  midpoint: { args: 'e,e?', mode: 'algebra', sig: 'midpoint(A, B) or midpoint(segment)', desc: 'Midpoint', ex: 'midpoint(Point(0, 0), Point(4, 2))' },
  angle: { args: 'e,e,e?', mode: 'algebra', sig: 'angle(A, B, C) or angle(line1, line2)', desc: 'Angle ABC at B, or between two lines', ex: 'angle(Point(1, 0), Point(0, 0), Point(0, 1))' },
  area: { args: 'e', mode: 'algebra', sig: 'area(shape)', desc: 'Area of a polygon, triangle, circle or ellipse', ex: 'area(Triangle(Point(0, 0), Point(4, 0), Point(0, 3)))' },
  perimeter: { args: 'e', mode: 'algebra', sig: 'perimeter(shape)', desc: 'Perimeter or circumference', ex: 'perimeter(Triangle(Point(0, 0), Point(4, 0), Point(0, 3)))' },
  perpendicular: { args: 'e,e', mode: 'algebra', sig: 'perpendicular(line, P)', desc: 'Line through P perpendicular to a line', ex: 'perpendicular(Line(Point(0, 0), Point(1, 1)), Point(2, 0))' },
  parallel: { args: 'e,e', mode: 'algebra', sig: 'parallel(line, P)', desc: 'Line through P parallel to a line', ex: 'parallel(Line(Point(0, 0), Point(1, 2)), Point(0, 3))' },
  tangents: { args: 'e,e', mode: 'algebra', sig: 'tangents(circle, P)', desc: 'Tangent lines from a point to a circle', ex: 'tangents(Circle(Point(0, 0), 2), Point(4, 0))' },
  circumcircle: { args: 'e', mode: 'algebra', sig: 'circumcircle(T)', desc: 'Circle through the vertices of a triangle', ex: 'circumcircle(Triangle(Point(0, 0), Point(4, 0), Point(0, 3)))' },
  incircle: { args: 'e', mode: 'algebra', sig: 'incircle(T)', desc: 'Inscribed circle of a triangle', ex: 'incircle(Triangle(Point(0, 0), Point(4, 0), Point(0, 3)))' },
  centroid: { args: 'e', mode: 'algebra', sig: 'centroid(shape)', desc: 'Centroid', ex: 'centroid(Triangle(Point(0, 0), Point(4, 0), Point(0, 3)))' },
  equation: { args: 'e', mode: 'algebra', sig: 'equation(line or circle)', desc: 'Equation of a line, circle or ellipse', ex: 'equation(Circle(Point(1, 2), 3))' },
  draw: { args: 'e,e*', mode: 'algebra', sig: 'draw(A, c, T, …)', desc: 'Draw geometric objects together', ex: 'draw(Triangle(Point(0, 0), Point(4, 0), Point(0, 3)), Circle(Point(2, 3/2), 5/2))' },

  // ── rigorous numerics, proofs, grading ──
  ieval: { args: 'e,R*', mode: 'numeric', sig: 'ieval(expr[, [x, a, b], …])', desc: 'Guaranteed enclosure by interval arithmetic', ex: 'ieval(x^2 - 2x, [x, 0, 1])' },
  prove: { args: 'q,R*', mode: 'algebra', sig: 'prove(a = b) or prove(f > 0[, [x, a, b]])', desc: 'Prove an identity or inequality (canonical forms, Sturm sequences, interval arithmetic)', ex: 'prove(x^4 - 4x^3 + 6x^2 - 4x + 1 >= 0)' },
  grade: { args: 'e,e,v?', mode: 'algebra', sig: 'grade(answer, key[, x])', desc: 'Check an answer against a key (equivalence, up to a constant, simplified?)', ex: 'grade(x^3/3 + 5, x^3/3, x)' },
};

// Internal tools reached through other syntax (integrate with ranges, mixed partials).
export const HIDDEN_TOOLS = {
  integrate_multi: { args: 'e,R,R*' },
  pdiff: { args: 'e,v,v*' },
};

export const toolSpec = (name) => TOOLS[name] || HIDDEN_TOOLS[name];
