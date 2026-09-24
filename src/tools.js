// Registry of named SymPy tools (implemented in src/sympy/tools.py).
// args: comma-separated argument kinds, matched in order —
//   e  expression            r  equation (lhs = rhs) or expression
//   v  variable name         V  variable or list of variables, e.g. [x, y]
//   f  sequence form a(n)    R  range [x, a, b]
// A kind may end in ? (optional), * (repeats, zero or more) or =name (a variable with a default).
// Variables named by v/V/f/R arguments are kept symbolic even if the workspace defines them.
// fallback: 'mathjs' lets the numeric engine answer when SymPy is unavailable.
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
};

// Internal tools reached through other syntax (integrate with ranges, mixed partials).
export const HIDDEN_TOOLS = {
  integrate_multi: { args: 'e,R,R*' },
  pdiff: { args: 'e,v,v*' },
};

export const toolSpec = (name) => TOOLS[name] || HIDDEN_TOOLS[name];
