# CassyCAS — Symbolic Workstation

A precision, browser-native instrument for symbolic mathematics. Single HTML file, no install, no backend, no telemetry — everything runs client-side and works offline once cached.

---

## What it does now (Level 0 — the baseline)

| Domain | Capabilities |
|--------|-------------|
| **Algebra** | Simplify, expand (binomial theorem + iterative distribution), factor (rational-root construction with leading-coefficient verification), collect, rationalize |
| **Calculus** | Symbolic differentiation (nth order), antiderivatives (60+ patterns + integration by parts), definite integration (Simpson's rule, n=1000), numerical limits (two-sided ε scan), sums, products, **Taylor / Maclaurin series** to arbitrary order |
| **Solving** | Quadratic formula via second-derivative coefficients (exact), numerical root finding (sign-change scan + bisection refinement, ±100 000 range), nonlinear systems (Newton–Raphson with finite-difference Jacobian) |
| **Linear Algebra** | Determinant, inverse, transpose, eigenvalues/vectors, trace, rank, cross/dot products, vector and matrix norms |
| **Statistics** | Mean, std, variance, median, MAD, quantiles, correlation, skew/kurtosis (via MathJS) |
| **Trigonometry** | All standard / inverse / hyperbolic functions, automatic degree↔radian wrapping based on global mode |
| **Units** | Full dimensional analysis, SI/imperial/temperature conversion, prefix handling |
| **Logic** | Boolean, bitwise, combinatorics (`combinations`, `permutations`, factorial) |
| **Visualization** | Inline 2D plots per cell, full 2D/3D graph tab, multi-trace, PNG export |

**Interface**: Monaco editor with custom CAS language tokens, MathLive visual input, live LaTeX preview, command palette (`⌘K`), step-by-step breakdowns, session save/load (`.cas` JSON), dark/light themes, accent palette, density modes.

---

## Usage

```
Enter           evaluate
Shift+Enter     newline in editor
⌘K / Ctrl+K     command palette (search functions, constants, modes)
Tab             autocomplete
Alt+↑/↓         input history
```

Definitions persist across cells:
```
a = 5
f(x) = a*x^2 + 3*x - 1
derivative(f(x), x)              # 2*a*x + 3
solve(f(x) = 0, x)               # exact symbolic + numeric
series(sin(x), x, 0, 8)          # Maclaurin to 8th order
integrate(x*sin(x), x)           # by parts
factor(x^3 - 6*x^2 + 11*x - 6)   # (x-1)(x-2)(x-3)
```

---

## Tech stack

| Layer | Library | Role |
|-------|---------|------|
| Math kernel | **MathJS 12** | Parse, simplify, derivative, evaluate, units |
| Visual input | **MathLive** | LaTeX ↔ ASCII math input |
| Render | **MathJax 3** | High-quality LaTeX in output cells |
| Plots | **Plotly.js** | 2D/3D interactive graphs |
| Editor | **Monaco** | Code input with custom CAS language |

No bundler, no transpiler, no `node_modules`. CDN scripts, plain JS, hand-rolled CSS variables for theming.

---

# Deep expansion roadmap

The architecture is intentionally minimal — single HTML file, no build step. That constraint defines the ceiling. Below is a 10-level roadmap, ordered by depth and implementation cost. Each item names the specific algorithm or technique that would implement it, so the work is concretely scoped rather than aspirational.

The biggest single leap in **practical utility** would come from items **1.1 + 1.2 + 2.1** together (polynomial engine + partial fractions + ODEs) — that covers most undergraduate mathematics. The biggest leap in **theoretical capability** would come from **1.4 + 5.1** (Risch + Gröbner bases). The biggest leap in **interface coolness** is **6.x + 8.x** (visualization + AI augmentation).

---

## Level 1 — Symbolic engine foundations

The current `simplify`, `expand`, and `factor` are best-effort: they work for textbook cases and degrade gracefully on harder ones. A proper algebraic foundation would replace "best-effort" with "complete decision procedure."

### 1.1 Univariate polynomial engine over `Z[x]`, `Q[x]`, `Q(α)[x]`

Represent polynomials as dense coefficient arrays, indexed by degree. Build the standard arithmetic stack:

| Operation | Algorithm | Complexity |
|-----------|-----------|-----------|
| Multiplication | Karatsuba (then FFT for n > 256) | `O(n^1.58)` → `O(n log n)` |
| GCD | Subresultant pseudo-remainder sequence | `O(n²)` |
| Squarefree decomposition | Yun's algorithm | `O(n²)` |
| Factorization over `Z[x]` | Berlekamp–Zassenhaus + LLL lifting | exponential worst case, fast in practice |
| Factorization over `F_p[x]` | Cantor–Zassenhaus | `O(n² log p)` |
| Real root isolation | Sturm sequences + Descartes' rule of signs | `O(n³)` |
| Complex root finding | Aberth–Ehrlich method | `O(n²)` per iteration, quadratic convergence |
| Resultants | Subresultant or modular FFT-based | `O(n²)` |

This single module unlocks: reliable factor, reliable polynomial GCD, partial fractions, exact real-root counting, resultant-based elimination.

### 1.2 Multivariate polynomial engine `Z[x_1, ..., x_n]`

Sparse distributed representation (term-list with monomial keys). Required for:
- Multivariate GCD (EZ-GCD or sparse interpolation)
- Multivariate factorization (Wang's algorithm with Hensel lifting)
- Polynomial reduction modulo an ideal (foundation for Gröbner bases)
- Symbolic determinants of matrices with polynomial entries

### 1.3 Partial fraction decomposition — `apart(f, x)`

Once 1.1 lands, this is mechanical:
```
apart((x^2 + 1) / (x^3 - x), x)
  → -1/x + 1/(x-1) + 1/(x+1)
```
Algorithm: factor denominator → solve linear system for residues → reconstruct. Essential for integral calculus, Laplace inversion, control theory transfer functions, and signal processing.

### 1.4 The complete Risch algorithm for elementary integration

The single hardest item on this roadmap, and the reason every serious CAS exists. Risch is a *decision procedure*: given an elementary function, it either returns its elementary antiderivative or proves no such antiderivative exists. Components:

- **Risch differential equation** in transcendental field extensions
- **Trager's algorithm** for the algebraic case
- **Hermite reduction** for rational integrands (the easy entry point)
- **Lazard–Rioboo–Trager algorithm** for the rational logarithmic part
- **Bronstein's improvements** for purely transcendental towers

Implementing the rational case alone (Hermite + LRT) handles the vast majority of integrals that appear in textbooks. Full Risch with algebraic extensions is a multi-year effort.

### 1.5 Symbolic limit engine

Replace numerical ε-evaluation with a symbolic engine:

- **Gruntz algorithm** — the modern complete algorithm for limits of meromorphic functions, based on most-rapidly-varying subexpression analysis
- **L'Hôpital's rule** as automatic fallback for 0/0 and ∞/∞
- **Asymptotic expansion** at infinity via leading-term analysis
- **One-sided limits** with directional `+`/`-` argument
- **Returns** exact symbols (`pi/2`, `Infinity`, `Undefined`) with a justification chain, not floats

### 1.6 Closed-form symbolic summation

Currently `sum()` expands terms numerically. Symbolic summation:

- **Faulhaber's formulas** for `sum(k^p, k, 1, n)` returning Bernoulli-polynomial closed forms
- **Gosper's algorithm** for indefinite hypergeometric summation
- **Zeilberger's creative telescoping** for definite hypergeometric sums and identities
- **Abramov's algorithm** for rational summation
- **Petkovšek's algorithm** for hypergeometric solutions to recurrences

```
sum(k^3, k, 1, n)        →  n^2*(n+1)^2/4
sum(C(n,k), k, 0, n)     →  2^n
sum(1/(k*(k+1)), k, 1, ∞)→  1
```

### 1.7 Symbolic equation solving

Beyond the current quadratic-via-second-derivative trick:

- **Cubic and quartic** via Cardano and Ferrari (closed-form exists; degrees ≥5 don't, by Abel–Ruffini)
- **Galois group computation** to *prove* a quintic is unsolvable by radicals
- **Resolvent cubic / quartic** machinery
- **Tschirnhaus transformations** to depress polynomials before solving
- **Trigonometric form** of cubic roots when discriminant is negative
- **Numerical fallback** with certified bounds (interval arithmetic) when symbolic fails

---

## Level 2 — New mathematical domains

### 2.1 Differential equations — `dsolve()`

The flagship feature. Implementation roadmap, easy to hard:

| Class | Method | Effort |
|-------|--------|--------|
| Separable | Direct integration | trivial |
| First-order linear | Integrating factor `μ = exp(∫P dx)` | low |
| Exact | Test `∂M/∂y = ∂N/∂x` | low |
| Bernoulli | Substitution `u = y^(1-n)` | low |
| Homogeneous | Substitution `u = y/x` | low |
| Riccati | Reduction to second-order linear | medium |
| Const-coef linear (any order) | Characteristic polynomial | medium |
| Cauchy–Euler | Substitution `t = log(x)` | medium |
| Variable-coef linear | Frobenius / power series | high |
| Systems of linear ODEs | Matrix exponential, Jordan form | high |
| PDEs (separable) | Separation of variables | high |
| Sturm–Liouville | Eigenfunction expansion | very high |

Initial conditions support: `dsolve(f''(x) + f(x) = 0, f, x, [f(0)=0, f'(0)=1])`.

### 2.2 Number theory mode

Self-contained module, no external deps:

```
isprime(n)              Miller–Rabin + Baillie–PSW for certainty < 2^64
nextprime(n)            sieve + isprime
factor(n)               trial / Pollard ρ / Pollard p−1 / ECM / quadratic sieve
totient(n), sigma(n,k)  multiplicative function tables
divisors(n)             enumerate
moebius(n)              μ(n)
modinv(a, m)            extended Euclidean
modpow(a, e, m)         fast exponentiation
crt([r], [m])           Chinese remainder theorem
discrete_log(b, h, p)   Pohlig–Hellman + baby-step giant-step
jacobi(a, n)            Jacobi symbol
order(a, m)             multiplicative order
primitive_root(p)       smallest g generating (Z/pZ)*
continued_fraction(x)   regular CF expansion
convergents(cf)         best rational approximations
```

### 2.3 Multivariate calculus

```
grad(f, [x,y,z])             gradient ∇f
div(F, vars)                 divergence ∇·F
curl(F, vars)                curl ∇×F
laplacian(f, vars)           ∇²f
jacobian(F, vars)            Jacobian matrix
hessian(f, vars)             Hessian (and classify critical points)
directional(f, dir, vars)    ∇f·d̂
line_integral(F, path, t, a, b)
surface_integral(F, parametrization, u, v, ...)
```

### 2.4 Vector calculus & differential forms

Move beyond components to coordinate-free notation:

- **Differential forms** as first-class objects: `dx`, `dy ∧ dz`
- **Exterior derivative** `d`
- **Wedge product** `∧`
- **Hodge star** `*` (requires a metric)
- **Stokes' theorem** as a single primitive `∫∫ω = ∫dω`
- **De Rham cohomology** computation for simple manifolds

### 2.5 Integral transforms

| Transform | Method |
|-----------|--------|
| Laplace `laplace(f, t, s)` | Table lookup + linearity + shift theorems |
| Inverse Laplace | Partial fractions → table |
| Fourier `fourier(f, t, ω)` | Distribution-aware table |
| Inverse Fourier | Same |
| Mellin | Less common but mechanical once Laplace is in |
| Z-transform | Discrete analog of Laplace |
| DFT/FFT (numeric) | Cooley–Tukey, already easy in JS |

### 2.6 Probability & statistics as objects

Distributions become first-class symbolic objects, not just samplers:

```
X = Normal(μ, σ^2)
pdf(X, x), cdf(X, x), mgf(X, t), cf(X, t)
E[X^2 + 3*X], Var[X], Skew[X], Kurt[X]
Y = X^2                       # transformation
Z = sum_iid(X, n)             # convolution → Normal(nμ, nσ²)
```

Catalog: Bernoulli, Binomial, Poisson, Geometric, Exponential, Normal, Uniform, Gamma, Beta, Chi², Student-t, F, Cauchy, Pareto, LogNormal, multivariate Gaussian.

### 2.7 Optimization

```
minimize(f, vars, constraints=[])
maximize(f, vars, constraints=[])
```

- **Unconstrained**: gradient descent, BFGS, Newton, conjugate gradient
- **Constrained**: KKT system, Lagrange multipliers (symbolic), interior point (numeric)
- **Linear programming**: simplex method, interior point
- **Convex optimization**: CVX-style problem specification
- **Calculus of variations**: Euler–Lagrange equations from a functional
- **Optimal control**: Pontryagin's maximum principle (sketch level)

### 2.8 Signal processing

```
convolve(f, g, t)          continuous or discrete
correlate(f, g)
spectrogram(signal, window)
filter_design(spec)        Butterworth, Chebyshev I/II, elliptic
sample(f, t, fs)           with anti-aliasing
```

### 2.9 Stochastic calculus

Itô integrals, stochastic differential equations (SDEs), Brownian motion, geometric Brownian motion, Black–Scholes derivation. Numerical schemes: Euler–Maruyama, Milstein.

### 2.10 Tensor algebra & general relativity

For physics users:
- Christoffel symbols `Γ^k_{ij}` from a metric
- Riemann curvature `R^a_{bcd}`
- Ricci tensor and scalar
- Einstein tensor `G_{μν}`
- Geodesic equation generation
- Common metrics built-in: Schwarzschild, Kerr, FRW, Minkowski

---

## Level 3 — Numeric & precision

### 3.1 Exact rational arithmetic everywhere

JavaScript's `Number` introduces float noise into every algebraic step. Replace with a `Rational` class backed by `BigInt` numerator/denominator. MathJS's `Fraction` covers some cases; this would be pervasive.

### 3.2 Algebraic numbers as exact objects

Represent `√2`, `(1+√5)/2`, `cube_root(2)` as roots of minimal polynomials, not floats. Operations defined modulo the minimal polynomial.

```
factor(x^2 - 2, over=Q)       → x^2 - 2 (irreducible)
factor(x^2 - 2, over=Q(√2))   → (x - √2)(x + √2)
factor(x^4 - 4, over=Q)       → (x^2 - 2)(x^2 + 2)
factor(x^4 - 4, over=Q(√2,i)) → (x - √2)(x + √2)(x - i√2)(x + i√2)
```

### 3.3 Algebraic number fields

Extensions `Q(α₁, ..., αₙ)`. Required for:
- Galois theory computations
- Number-field sieve (factoring large integers)
- Class field theory in number theory mode
- Algebraic geometry over non-algebraically-closed fields

### 3.4 Multi-precision arithmetic

Replace `Number` with a `BigDecimal` (e.g. ported from `decimal.js`) in numeric mode:
- `pi` to 10 000 digits via Chudnovsky's series
- `e^(iπ) + 1` returning exact `0` not `1.2e-16`
- Verified `gamma()`, `zeta()`, `bessel*` to user-specified precision
- Spigot algorithms for individual digits of π, e, log2

### 3.5 Interval arithmetic & rigorous numerics

Every numerical result is an interval `[lo, hi]` guaranteed to contain the true value:
- **Krawczyk operator** for verified root finding
- **Taylor models** for verified ODE integration
- **Mean-value form** for tight enclosures of `f([a,b])`
- **Affine arithmetic** to reduce dependency-induced overestimation

This makes the plot system *certified*: no missed features (bumps, asymptotes, near-singularities) due to undersampling.

### 3.6 Symbolic-numeric hybrid algorithms

When pure symbolic fails, compute with high precision and recognise:
- **PSLQ / LLL** for constant recognition (`1.6449340668...` → `π²/6`)
- **Padé approximants** for rational reconstruction from a series
- **Hermite–Padé** for algebraic and differential approximants

```
recognize(1.6449340668482264)   → π²/6 (zeta(2))
recognize(0.9159655941772190)   → Catalan's constant
```

### 3.7 GPU acceleration via WebGL/WebGPU

For numerical heavy hitters:
- Matrix multiplication (already trivial in WebGL via texture sampling)
- ODE integration in parallel (parameter sweeps)
- Numerical contour integration on a grid
- Density plots, complex-domain colouring
- Mandelbrot / Julia / Newton fractal renderers

---

## Level 4 — Architecture & performance

### 4.1 Web Workers for non-blocking computation

Push every solve, integrate, factor into a worker. The UI never freezes, the user can cancel a runaway computation, results stream back as steps complete.

### 4.2 WebAssembly hot-paths

Compile the polynomial engine, BigInt arithmetic, and Risch core to WASM (Rust or AssemblyScript). 10–100× speedups on hot operations. The HTML stays as-is; WASM loads as an additional module.

### 4.3 Embed SymPy or Sage subset via Pyodide

Pyodide (CPython compiled to WASM) loads in ~6 MB. SymPy in Pyodide gives access to a battle-tested CAS instantly. CassyCAS becomes a beautiful, fast UI in front of an industrial back-end. The trade-off: heavier first load, but optional and lazy.

### 4.4 Just-in-time compilation of expressions

For tight numerical loops (plotting, root finding, integration), compile expressions to optimised JavaScript using `new Function(...)` with common-subexpression elimination, constant folding, and strength reduction. 10× speedup over `math.compile`.

### 4.5 Persistent data structures

Replace `Object.assign({}, scope)` (used everywhere for evaluation contexts) with structurally shared persistent maps. Reduces allocator pressure dramatically when summing thousands of terms.

### 4.6 Incremental & reactive evaluation

The current notebook re-runs cells linearly. A reactive kernel:
- Tracks `(read-set, write-set)` for each cell
- Builds a dependency DAG over scope variables
- When a cell changes, invalidates and re-runs only its transitive closure
- Marks downstream cells "stale" visually until rerun

This is the model that makes Observable Notebooks feel alive. Implementable cleanly here since the scope and AST are accessible.

### 4.7 Plug-in & extension API

Define `cas.register({ name, parser, evaluator, formatter })` so third-party authors can add custom operations (e.g. a `quaternion()` plug-in, a `lattice()` plug-in for cryptography).

### 4.8 IndexedDB-backed sessions

Replace localStorage (5 MB cap) with IndexedDB (effectively unlimited). Store full notebook history with timestamps, branching, and undo across reloads.

---

## Level 5 — Notebook & interface

### 5.1 LaTeX document export

Convert a notebook into compilable `.tex`:
- Cells → `align*` environments, automatically aligned at `=`
- Text blocks → `\section`, `\subsection`, prose
- Plots → embedded TikZ (vector) or `\includegraphics{cell-N.png}`
- Function definitions → `\newcommand`
- Bibliography support

### 5.2 Shareable URLs

Compress notebook state to a base64 URL fragment (`#state=...`). Round-trip preserves the entire session — no server. Enables sharing problems, demonstrations, and homework solutions as a single link.

### 5.3 Branching & version history

Every cell change creates a versioned snapshot. `git`-style branching: fork a notebook to try an alternative approach, merge or discard. Visual diff view of two notebook states.

### 5.4 Custom function library

Users write `.cas` modules that define helper functions, persisted in IndexedDB and loadable via `import "fourier_tools"`. Turns CassyCAS into an extensible personal mathematics environment.

### 5.5 Annotated step-by-step derivations

Replace the current step list with rendered LaTeX equations annotated by rule:

```
   x^2 + 5x + 6 = 0
↓  (quadratic formula, a=1, b=5, c=6)
   x = (-5 ± √(25 - 24)) / 2
↓  (simplify radicand)
   x = (-5 ± 1) / 2
↓  (split ±)
   x = -2  ∨  x = -3
```

Each step expandable, exportable as a standalone proof document.

### 5.6 Notebook templates

Curated starter notebooks: "Fourier series tutorial", "ODE cookbook", "Linear algebra refresher", "Number theory playground". Loadable with one click, fully editable.

### 5.7 Themes & accessibility

- High-contrast theme for low vision
- Dyslexia-friendly font stack
- Full keyboard navigation (no mouse required)
- Screen reader–friendly LaTeX (MathML output mode)
- ARIA labels on every interactive element
- Localisation framework (i18n)

### 5.8 Collaborative editing (CRDT-based)

Two users on the same notebook URL → real-time co-editing via Y.js or Automerge. Cursor presence, conflict-free merges, offline-tolerant. Pure peer-to-peer via WebRTC, no server.

---

## Level 6 — Visualization frontier

### 6.1 Phase portraits & vector fields

For ODE systems `dx/dt = f(x, y), dy/dt = g(x, y)`:
- Streamline rendering
- Nullclines (`f=0`, `g=0`)
- Fixed-point classification (stable node, saddle, spiral, …) via Jacobian eigenvalues
- Trajectory tracing from clicked initial conditions

### 6.2 Slope fields for first-order ODEs

`dy/dx = f(x, y)` → arrow grid. Drop a point, watch the solution curve appear via numeric integration in a worker.

### 6.3 Complex domain colouring

For a complex function `f: C → C`:
- Hue ↔ `arg(f(z))`
- Brightness ↔ `|f(z)|`
- Reveals zeros, poles, branch cuts visually

### 6.4 Riemann surfaces

For multi-valued functions like `√z` or `log(z)`:
- 3D surface where height encodes branch
- Animated branch-cut traversal

### 6.5 Implicit surface plotting

Marching cubes for `f(x, y, z) = 0`. Plots manifolds defined by equations like `x² + y² + z² - 1 = 0` (sphere) or `(x²+y²+z²+R²-r²)² = 4R²(x²+y²)` (torus).

### 6.6 Parameter-sweep animations

Annotate any cell with `@animate(a, 0, 10, frames=60)` and the system renders an MP4/GIF of the result varying with `a`. Backed by `MediaRecorder` API.

### 6.7 Live equation morphing

Drag a slider for any constant in any expression; plots, definitions, and downstream cells update at 60 FPS. Powered by the JIT compiler (4.4) feeding into an animation loop.

### 6.8 Manifold visualization

For surfaces with non-trivial topology (Klein bottle, projective plane, hyperbolic plane). Geodesic tracing, curvature visualisation, parallel transport animation.

### 6.9 Statistical & data visualization

Beyond Plotly's defaults:
- Violin / box / strip / swarm plots
- Density plots (KDE)
- Q-Q plots
- Pair plots for multivariate
- Probability density vs. CDF overlay
- Hypothesis test visualizations

### 6.10 Network / graph plots

For graph-theoretic objects: force-directed, hierarchical, radial layouts. Spectral embedding when an adjacency matrix is available.

### 6.11 Expression tree visualization

Render the AST of any expression as a clickable tree. Rotate sub-trees, see how operators bind, debug parser issues. Educational tool for understanding precedence and associativity.

---

## Level 7 — Verification & rigor

### 7.1 Property-based testing of rewrite rules

Every simplification rule should be a *theorem*. Use a property-based testing framework (fast-check) to verify on millions of random inputs that `simplify(f) == f` numerically over a sample domain. Catches incorrect rules immediately.

### 7.2 Differential testing against SymPy / Mathematica

Run identical inputs through CassyCAS and a reference CAS (via Pyodide+SymPy or a hosted Mathematica endpoint). Flag disagreements. Builds confidence that the CassyCAS engine is correct.

### 7.3 Formal proof export to Lean 4

For derivations that should be trusted (homework being graded, published results):
- Translate the step list into a Lean proof script
- Hand to `lean4` (compiled to WASM) for verification
- Display ✓ or ✗ next to each step

### 7.4 Certified plotting

Use interval arithmetic (3.5) to *prove* a plot doesn't miss features. A pixel is "on the curve" only if `0 ∈ f([x_lo, x_hi])`. No surprise dips between sample points.

### 7.5 Provenance tracking

Every result carries a chain: input → applied rules → output. Hover over any number to see exactly how it was derived. Equivalent to a lightweight proof certificate.

### 7.6 Symbolic dimension/unit checking

Every formula gets a unit-aware type. `f(x) = x + 5` errors if `x` has units of metres and `5` is dimensionless. Catches physics homework mistakes before they propagate.

---

## Level 8 — AI / ML augmentation

### 8.1 Natural-language → expression

A small fine-tuned model (or an API call to a frontier LLM) converts:
> "what's the derivative of x squared plus three x with respect to x"

into `derivative(x^2 + 3*x, x)`. Lowers the barrier dramatically for non-technical users.

### 8.2 Equation OCR via vision

Webcam, photo, or screenshot of a hand-written equation → parsed expression. Use MathLive's OCR, or call a vision API. Massively useful for students copying problems from textbooks.

### 8.3 Step-by-step explanation generation

Existing step lists are mechanical ("Apply rule X"). An LLM-augmented version generates pedagogical prose:
> *"We use the product rule because the integrand is `x · sin(x)` — a product of two functions. Setting `u = x` and `dv = sin(x) dx`, we get `du = dx` and `v = -cos(x)`..."*

### 8.4 Smart autocomplete by context

Train a tiny neural net on a corpus of mathematical expressions to predict the next token given the surrounding cells, the current mode, and the last few results. Goes beyond keyword matching.

### 8.5 Common-error detection

When a user types something that *looks* mathematically intended but parses to nonsense, suggest the likely intended expression. Detect classic mistakes ("sin x" → "sin(x)", "lnx" → "ln(x)", missing parens around fractions).

### 8.6 Auto-grading mode

Teacher provides expected output; student's notebook is checked for *mathematical equivalence* (not string equality) — verified via symbolic-numeric hybrid checking. CassyCAS becomes a homework-grading tool.

### 8.7 Theorem search / formula recall

> "what's the formula for area of a triangle given three sides"

→ Heron's formula, with derivation and an interactive cell. Backed by a vector embedding of a curated formula database.

---

## Level 9 — Collaboration & ecosystem

### 9.1 Notebook gallery

Public, indexable repository of community-contributed notebooks. Each one runs in-browser at a click. Categorised by topic, level, language. Likes, forks, attribution.

### 9.2 Citation export

A "cite this" button per notebook generates BibTeX. Encourages academic use. Long-term: assign DOIs via Zenodo integration.

### 9.3 LSP-style language server

Expose CassyCAS as a Language Server (over WebSocket) so VS Code, Vim, Emacs can edit `.cas` files with full autocomplete, hover docs, go-to-definition for user functions.

### 9.4 REST API mode

Run CassyCAS in headless mode behind an HTTP endpoint. POST an expression, get JSON back. Enables programmatic use from other apps.

### 9.5 Embed widget

A `<cassycas-cell expr="...">` web component anyone can drop into a blog post or course site. Live, evaluated, editable in place.

### 9.6 Markdown / Quarto / Pandoc bridge

Convert between CassyCAS notebook format and Markdown / Jupyter / Quarto / RMarkdown. Lossless round-trip for math-heavy documents.

---

## Level 10 — Research frontier

### 10.1 Gröbner bases

The Buchberger algorithm and its modern descendants (F4, F5) compute Gröbner bases for polynomial ideals. With them, CassyCAS gains:
- Exact polynomial system solving over `C`
- Ideal membership decision
- Dimension and degree of varieties
- Implicitization of parametric curves and surfaces
- Algorithmic algebraic geometry

Implementation: Buchberger first (educational, slow), then F4 (fast in practice), then F5 (asymptotically optimal). All doable in JavaScript with reasonable performance for problems of degree ≤ 30.

### 10.2 Differential algebra

The Ritt–Kolchin theory: differential ideals, characteristic sets, the Rosenfeld–Gröbner algorithm. Decides consistency of systems of differential polynomial equations. Foundation for symbolic ODE/PDE solving beyond the textbook cases.

### 10.3 Galois theory

Compute the Galois group of a polynomial. Decide solvability by radicals. Construct splitting fields. For low-degree polynomials this is tractable; the classical *resolvent cubic* technique handles up to degree 6 cleanly.

### 10.4 Holonomic / D-finite functions

A function is *holonomic* if it satisfies a linear ODE with polynomial coefficients. This class is closed under +, ×, integration, differentiation, composition with algebraic functions. Algorithms (Chyzak, Salvy, Zeilberger):
- Closure properties algorithmically
- Definite integration of holonomic functions (creative telescoping)
- Asymptotic analysis (singularity analysis)
- Special function identities discovered automatically

### 10.5 Symbolic tensor calculus & differential geometry

For general relativity, gauge theory, continuum mechanics:
- Einstein summation convention
- Covariant derivatives, Christoffel symbols
- Riemann, Ricci, Weyl, Einstein tensors
- Lie derivatives along vector fields
- Connection 1-forms, curvature 2-forms
- Hodge decomposition for compact manifolds
- Common metrics (Schwarzschild, Kerr, FRW) and their curvature tensors precomputed

### 10.6 Constraint geometry

Define geometric constructions by constraints (point on circle, line tangent to two circles), let the system solve symbolically. Classical compass-and-straightedge constructions become first-class. Ties into 1.7 (polynomial system solving) for the constraint-resolution step.

### 10.7 Quantum computing simulation

State vectors as symbolic objects, gates as symbolic matrices. Simulate small circuits, compute amplitudes exactly, derive symbolic probabilities. Bridges to graphing the Bloch sphere.

### 10.8 Lattice algorithms & cryptography

LLL lattice reduction (already needed for Berlekamp–Zassenhaus in 1.1) opens:
- Cryptanalysis demos (Coppersmith's attack on RSA with small d)
- Lattice-based crypto (NTRU, learning-with-errors)
- Constant recognition (PSLQ/LLL) as in 3.6
- Closest-vector and shortest-vector problems

### 10.9 Knot theory & topological invariants

Tangle calculus, Jones polynomial, Alexander polynomial, HOMFLY. Niche but striking — and computable from a planar diagram input.

### 10.10 Automated theorem proving

The end-game. Embed a tactic-based prover (a Lean 4 or Coq kernel via WASM) and let users prove, not just compute. CassyCAS becomes a notebook *and* a proof assistant in one tab.

---

## Cross-cutting design principles

These shape every decision:

1. **Single-file simplicity is sacred.** No `npm install`. The whole app downloads in one HTML file. Optional WASM modules and Pyodide load lazily when the user opts in.
2. **Client-side only.** No telemetry, no backend, no auth. The user's mathematics never leaves their browser.
3. **Layered escape hatches.** Symbolic first, numeric fallback, never silent failure. Every result carries provenance.
4. **Exact when possible, approximate by toggle.** Float noise is the enemy. The Exact/Approx toggle is a top-level UI control for a reason.
5. **Composability over monolithic features.** Each capability is a function, callable from any other. `solve(integrate(derivative(f, x), x, 0, t) = 1, t)` should just work.
6. **Discoverability.** ⌘K reveals every feature. No hidden menus. The system should teach itself.
7. **Pedagogical transparency.** Every result expandable into steps. The CAS as a teaching tool, not a black box.
8. **Performance budget.** Cold load < 3 s, evaluation < 100 ms for trivial inputs, never block the UI thread.
9. **Aesthetic precision.** Typography, spacing, contrast as deliberate as the mathematics. Code is craftsmanship.
10. **Backward compatibility forever.** A `.cas` notebook saved today should open in CassyCAS five years from now.

---

## Recommended sequencing

If this were a real multi-quarter plan, the dependency graph dictates:

```
Q1: 1.1 (poly engine) → 1.2 (multivariate) → 1.3 (apart)
Q2: 1.5 (limits) + 1.6 (sums)
Q3: 2.1 (ODEs, modular: separable → linear → const-coef)
Q4: 4.1 (workers) + 4.6 (reactive) + 5.5 (annotated steps)
Y2: 3.1–3.5 (exact arithmetic + intervals)
Y2: 1.4 (Risch, rational case first)
Y3: 6.x (visualization frontier) + 8.x (AI augmentation)
Y3+: 10.x (research frontier, opportunistically)
```

Total: a credible roadmap to a system that meets or exceeds undergraduate-CAS commercial offerings within three years, with a viable path to research-grade capability beyond. The baseline (Level 0) is already useful today.

---

## Contributing

Issues and PRs welcome. The codebase is one HTML file — pop it open and read it top-to-bottom in an afternoon. Areas where help is most appreciated:

- Symbolic integration patterns (more rules in `symbolicIntegrate`)
- Polynomial engine prototypes (Level 1.1)
- Visualization plug-ins (Level 6)
- Notebook examples for the gallery (Level 9.1)
- Bug reports with minimal reproducible expressions

Build philosophy: small commits, tests for new rules, no unnecessary dependencies, no build step that doesn't survive `view-source:`.
