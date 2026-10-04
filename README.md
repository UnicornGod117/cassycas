# CassyCAS — Symbolic Workstation

A browser-native computer algebra system that checks its own answers. Exact results come from **SymPy running in your browser** (WebAssembly, via Pyodide), every result that can be checked independently is checked, and the check is shown next to the answer. There is no server, no account and no telemetry.

| | |
|---|---|
| **Trust** | 0 wrong answers on the [scoreboard](#scoreboard); results carry a **✓ verified** badge when an independent check confirms them, and say so when it does not |
| **Speed** | Interface ready in ~0.15 s and the exact engine in under 1 s on return visits (it restores a memory snapshot instead of starting Python and importing SymPy, which took 7–9 s); median answer 25 ms |
| **Input** | Type maths the way you write it: `integral of x^2 from 0 to 1`, `d/dx x^3`, `sin^2 x`, `\|x - 3\| < 2`, `x²`, pasted LaTeX, Mathematica syntax, or a photo |
| **Steps** | Worked solutions the way they are taught: product/quotient/chain rule, factor-and-cancel, L'Hôpital, quadratic formula, extraneous roots, sign charts, substitution, parts |
| **Graphing** | Pan/zoom canvas grapher: asymptotes handled, **interval-certified** implicit curves, shaded inequalities, slope and vector fields, GPU domain colouring, 3D and Riemann surfaces, networks, statistical plots, clickable roots/extrema/intersections, animated sliders |
| **Proof** | `prove(…)` proves identities and inequalities (canonical forms, Sturm sequences, interval branch-and-bound) and writes polynomial statements in Lean 4; `ieval` gives guaranteed enclosures |
| **Workspace** | Version history and undo on this device, a function library, a gallery of templates, Markdown/Quarto round trips, peer-to-peer collaboration, plug-ins, a command line, a local API and a language server |

---

## What it does

| Domain | Capabilities |
|--------|-------------|
| **Algebra** | Exact arithmetic and radicals, simplify, expand, factor (with steps), collect, partial fractions, together/cancel, polynomial division, completing the square, discriminants, resultants, Gröbner bases, rewriting, log/power combining, polar/rectangular forms, `subs(expr, x, a)`, `assume(x > 0)` |
| **Calculus** | Derivatives (product/quotient/chain-rule steps), antiderivatives (SymPy, then inverse substitutions it does not try — `∫√tan x dx`), definite, improper and multiple integrals (divergence reported, with the Cauchy principal value), limits (one/two-sided, oscillation), series, Fourier series, closed-form sums and products, extrema, tangents, implicit differentiation, residues |
| **Solving** | Bare equations and inequalities are solved as typed (`2x^2 + 3x = 5`, `x^2 > 4`); solution sets read like handwriting (`1 < x < 5`, `x = π/6 + 2πn, n ∈ ℤ`); systems, complex roots, numeric roots to any precision |
| **Differential equations, transforms** | ODEs with initial conditions, recurrences, Laplace and Fourier transforms |
| **Linear algebra** | Determinant, inverse, eigenvalues/vectors (checked against det(A − λI)), RREF, rank, diagonalization, Jordan form, LU/QR, matrix exponential, pseudo-inverse, `linsolve` |
| **Number theory** | Primality, factorization, divisors, totient, Möbius, modular inverse/power, CRT, continued fractions, Diophantine equations, special sequences, `identify(decimal)` |
| **Probability, statistics, units, logic** | Normal/binomial/Poisson/t/χ²/exponential distributions, statistics, unit conversion and dimensional analysis, bitwise and boolean logic |
| **Algebraic numbers, Galois theory, lattices** | `minpoly(sqrt(2) + sqrt(3))`, factoring over number fields `nfactor(x^2 - 2, sqrt(2))`, Galois groups up to degree 6 (and whether a polynomial is solvable by radicals), LLL lattice reduction, holonomic ODEs `holonomic(exp(x^2), x)` |
| **Signals, optimisation, stochastic calculus** | Z-transform and its inverse, exact DFT, convolution, Bode plots; global extrema on intervals, Lagrange multipliers and linear programming (`maximize(x*y, [x + y = 10])`); Itô's lemma, closed-form SDE solutions, simulated sample paths |
| **Geometry, tensors, forms** | Named objects (`A = Point(0, 0)`, `c = Circle(A, 2)`, `T = Triangle(…)`) with intersections, distances, tangents, circumcircle and incircle, drawn together; metrics → Christoffel symbols, Riemann/Ricci/Einstein tensors, geodesics; curvature of curves and surfaces; differential forms (`wedge`, exterior derivative, Hodge star); differential elimination |
| **Random variables, quantum, knots** | `X ~ Normal(0, 1)` then `P(X > 1)`, `E(X^2)`, `Var(…)`; exact quantum circuit simulation `circuit(2, H(0), CNOT(0, 1))`; Alexander and Jones polynomials of standard knots |
| **Proof and grading** | `prove(x^4 - 4x^3 + 6x^2 - 4x + 1 >= 0)` proves identities and polynomial and transcendental inequalities (Sturm sequences, interval branch-and-bound with Taylor forms), gives a counterexample when there is one, and writes polynomial statements in Lean 4; `ieval(expr, [x, a, b])` gives a guaranteed enclosure; `grade(answer, key)` marks answers (equivalent, correct up to a constant, simplified or not) |
| **Graphing** | `plot(tan(x), x^2 + y^2 = 16, y < x^2 - 2, r = 2 + 2cos(theta), [cos(3t), sin(2t)], point(1, 2))`, `slopefield(x - y)`, `vectorfield([-y, x])`, `domaincolor((z^2 - 1)/(z^2 + 1))` (WebGL), `plot3d(x^2 + y^2 + z^2 = 1)`, `riemann(sqrt(z))`, `histogram`, `boxplot`, `scatter` (with least squares), `graph([[1, 2], [2, 3], …])` (degrees, components, colouring, `shortestpath`), `tree(expr)`, `sdepaths(…)`. Implicit curves are traced with outward-rounded interval arithmetic, so no piece of a curve is missed, and isolated points are shown |

**Notebook.** Cells form a dependency graph: editing a definition re-runs only the cells that use it. Numeric definitions get sliders; plot parameters get sliders with ▶ to animate; worked solutions play as an animation in which each step morphs into the next. Click any part of a result to differentiate, integrate, factor or plot it. Notebooks are kept in the browser, exported as `.cas`, LaTeX, Markdown, Quarto or text, shared as a link (compressed into the URL fragment, so it never reaches a server), or **embedded** in another page (`?embed`).

**Workspace** (the ⋯ menu).
- **Version history**: every change is kept on this device in IndexedDB, with named checkpoints and restore. Unchanged cells are stored once and shared between versions. Ctrl+Z and Ctrl+Shift+Z undo and redo outside the input line.
- **Function library**: ★ on any definition makes it available in every notebook.
- **Gallery**: twelve example notebooks and templates.
- **Formula search** in the palette: 47 formulas from geometry, finance, physics and calculus.
- **Markdown/Quarto import and export**: ```` ```cas ```` blocks, with results as display maths.
- **Citations**: BibTeX and APA, for CassyCAS and the libraries that do the mathematics.
- **Collaboration**: edit one notebook together, browser to browser over WebRTC, with no server of ours. One person makes an invite code and the other answers it; the codes travel by any chat. Concurrent edits converge (each cell carries a Lamport version).
  - On one network, the peers' local addresses are enough.
  - Connecting across networks uses a public STUN server, only if you opt in, because it sees your IP address.
  - There is no relay (TURN), so very restrictive NATs cannot connect.

**Plug-ins.** Add a JavaScript tool (`CAS.plugins.register({ name, run(args, helpers) })`) or a SymPy tool (`CAS.plugins.registerPython(name, 'def t_name(e): …')`) from the console. Plug-ins appear in autocomplete and the palette. Built-in names cannot be replaced, and nothing is ever loaded from a URL.

**Accessibility.**
- Cells are focusable and labelled, and results are announced to screen readers in words ("x squared plus 1").
- Dialogs trap focus and close with Escape, and the menus work from the keyboard.
- A skip link, visible focus rings, and respect for reduced-motion settings.
- Autocomplete is context-aware. Inside `integrate(x*y^2, |` it offers the variables of the first argument, and after `X ~` it offers distributions. It also offers named objects and user functions, and the current mode's functions rank first.

---

## Usage

```
a = 5
f(x) = a*x^2 + 3*x - 1
f'(x)                                  # 10x + 3              (read as derivative(f(x), x))
2x^2 + 3x = 5                          # x = -5/2, x = 1       ✓ verified
integral of x*sin(x)                   # -x cos(x) + sin(x) + C
limit of (1 + 1/n)^n as n -> inf       # e
solve(sin(x) = 1/2, x)                 # x = 2πn + π/6, x = 2πn + 5π/6, n ∈ ℤ
solve(abs(x - 3) < 2, x)               # 1 < x < 5
integrate(1/x, x, -1, 1)               # diverges; Cauchy principal value 0
sum(1/k^2, k, 1, oo)                   # π²/6
D[Sin[x]^2, x]                         # sin(2x)               (Mathematica syntax)
\int_0^1 x^2 \, dx                     # 1/3                   (pasted LaTeX)
assume(x > 0)
simplify(sqrt(x^2))                    # x
eigenvalz([[2, 1], [1, 2]])            # Unknown function "eigenvalz". Did you mean eigs?
```

```
Enter           evaluate              ⌘K / Ctrl+K   command palette
Shift+Enter     newline               Tab           autocomplete
Alt+↑/↓         input history
```

**Outside the browser.** The same app runs headless for scripts and editors:

```bash
npx cassycas "integrate(x^2 sin(x), x)" "solve(x^2 = 2, x)"      # one result per line (✓ when verified)
echo "factor(x^4 - 1)" | npx cassycas --json                     # JSON: plain, LaTeX, engine, check
npx cassycas --serve 8787                                        # POST /eval {"expr", "mode"}, POST /batch, GET /health
npx cassycas-lsp                                                 # language server (stdio) for VS Code, Neovim, Helix…
```

The command line and the local API drive the built app in headless Chromium, so their answers, checks and steps are the app's own. The API listens on 127.0.0.1 only and refuses cross-origin requests from web pages. The language server reads one cell per line, or the ```` ```cas ```` blocks of Markdown/Quarto files. It reports unknown functions with suggestions, unbalanced brackets and wrong argument counts, and offers hover documentation and completion.

**Read as.** When input is written in free form, the cell shows the canonical form it was read as, so you can see (and correct) the interpretation.

**Verification.** A result is checked independently of the method that produced it: antiderivatives are differentiated back; definite integrals and infinite series are compared with high-precision quadrature and accelerated summation; limits are approached numerically; solutions are substituted back (each candidate of a radical equation, each member of a periodic family); simplifications are compared at sample points; ODE solutions are substituted into the equation; eigenvalues are checked against the characteristic polynomial. Hover the badge to see which check ran. A result with no applicable check has no badge — it never claims one.

**Exact vs Approx.** *Exact* shows closed forms, with a decimal alongside irrational values; *Approx* shows decimals. **Degree mode** affects numerical evaluation; symbolic calculus is always in radians.

### Optional Claude assistant

Paste an Anthropic API key under *Tweaks* to ask in plain English, or to read the maths in a **photo or screenshot**. Claude proposes CassyCAS input; the CAS then runs it in a dry run and shows the result (and its verification) before you press Enter — if the CAS rejects a suggestion, Claude is asked once to correct it. *Explain* on a result produces a plain-language explanation grounded in the engine's own steps and check. The key is stored only in this browser's `localStorage` and is sent only to `api.anthropic.com`; the SDK is not even loaded without a key. Without a key, nothing is sent anywhere. (The free-form input above is understood offline, without the assistant.)

---

## Scoreboard

`npm run bench` runs 139 textbook problems whose expected answers come from tables and hand derivation — not from SymPy, so the engine under test cannot agree with itself. A problem is *solved*, *declined* (an error or an honest "cannot"), or *wrong*.

| Category | Problems | Exact engine | JavaScript engine alone |
|---|---|---|---|
| Free-form input (English, LaTeX, Mathematica, Leibniz, Unicode) | 20 | 20 | — |
| Algebra, equations and inequalities | 32 | 32 | |
| Derivatives, antiderivatives, definite and improper integrals | 38 | 38 | |
| Limits, series and sums | 24 | 24 | |
| ODEs and transforms, linear algebra, number theory | 25 | 25 | |
| **Total** | **139** | **139 solved, 0 wrong** (median 25 ms) | **89 solved, 50 declined, 0 wrong** |

`tests/bench.test.mjs` fails the build on any wrong answer from either engine. The JavaScript engine (used while SymPy loads, or if it is switched off) is built to decline rather than guess: numerical integrals that do not converge give no value, numerical root searches are labelled as such, and Newton's method on a non-linear system says there may be other solutions.

---

## Architecture

```
src/
  main.js, notebook.js, editor.js,   UI, reactive notebook, CodeMirror
  render.js
  syntax.js                          input front end: English, Mathematica, LaTeX, Leibniz, Unicode → canonical input
  engine.js                          evaluator: SymPy first, JavaScript fallback; bare equations, assume(), "did you mean"
  graph/grapher.js, graph/jit.js     canvas grapher; expressions compiled to native functions for plotting
  plot.js, plotspec.js               plot(...) parsing, sliders, Plotly for 3D (loaded on demand)
  sympy/                             exact engine: Pyodide worker (memory snapshot), JSON bridge (bridge.py:
                                     operations + verification), named tools (tools.py), worked solutions (steps.py)
  tools.js                           registry of named tools: signatures, argument kinds, examples
  kernel/                            fallback engine: MathJS worker, Algebrite, numerics, BigInt number theory,
                                     probability distributions
  sympy/advanced.py                  number fields to knots: the advanced tools, named objects, prove/ieval/grade
  graph/interval.js, graph/glsl.js   interval arithmetic (outward rounding) for certified curves; WebGL domain colouring
  viz.js, morph.js                   statistical plots, networks, trees, 3D/Riemann surfaces; step animations
  store.js, workspace.js, dialogs.js IndexedDB, version history, undo, library, Markdown/Quarto, citations, dialogs
  gallery.js, formulas.js            example notebooks; formula search
  collab.js, plugins.js, speech.js   peer-to-peer collaboration; plug-in API; results in words
  lsp.js                             analysis behind the language server
  assistant.js                       optional Claude assistant (loaded only when used)
bin/                                 command line and local API (cassycas.mjs), language server (cassycas-lsp.mjs)
public/                              manifest, icon, service worker
tests/                               end-to-end suites, differential corpus, scoreboard (tests/bench)
```

**Two engines.** SymPy 1.14 on Pyodide 314 runs in a Web Worker. On the first visit it downloads the Python runtime and SymPy from jsDelivr (≈18 MB; every wheel is checked against the SHA-256 in Pyodide's lockfile), imports and warms up SymPy, and saves a **memory snapshot** of the interpreter (≈18 MB gzipped, in Cache Storage). Later visits restore the snapshot and re-unpack the wheels into the (JavaScript-side) file system in ~0.75 s, instead of re-importing SymPy (~5 s); a self-test of lazily imported modules runs first, and a snapshot that fails it is discarded. Snapshots are tied to the Pyodide version and the bridge source, and are discarded if a restore fails. (Compiled extensions cannot be snapshotted, so SymPy runs with pure-Python integers rather than gmpy2.) Until SymPy is ready — or if it is switched off, times out, or cannot be downloaded — the JavaScript engine answers, its results are marked, and those cells are re-run once SymPy is ready.

**No code injection.** User input never becomes Python source: the JavaScript side sends a JSON expression tree, and `bridge.py` checks every node type, operator and function name against whitelists. The plotting JIT (`graph/jit.js`) emits JavaScript only from a whitelist of node types and functions, with variables renamed and numbers re-serialised; anything else falls back to the mathjs interpreter.

**Adding a capability.** A named tool is one entry in `src/tools.js` and one whitelisted function in `src/sympy/tools.py`; it appears in autocomplete, the palette and the tests (every example must have a verified result in `tests/tools.test.mjs`).

**Builds.** `npm run build` produces a code-split `dist/` for hosting: the shell loads ~1.9 MB of JavaScript; Plotly (3D), MathLive (visual input) and the Claude SDK load on demand, and the service worker precaches all of it (and the Pyodide files) so the app works offline after one visit. `npm run build:single` produces `dist-single/index.html`, the whole app in one file (≈8 MB) that works opened from disk; GitHub Pages publishes it as `cassycas.html`.

**Why SymPy (and not also Giac).** Giac would be a valuable second, independent engine, but its npm package is native C++ source rather than WebAssembly, no reproducible WebAssembly build is published, and it is GPL-3.0. Independence comes instead from the verification layer, which checks SymPy's results numerically with mpmath rather than with SymPy's own symbolic algorithms.

---

## Development

```bash
npm install
npm run test:setup     # Pyodide's SymPy/mpmath wheels into tests/.wheels (hash-checked), Playwright's Chromium
npm run dev            # Vite dev server
npm run build          # dist/ (code-split)
npm run build:single   # dist-single/index.html (one file)
npm test               # all suites (build first)
npm run bench          # the scoreboard (CAS_ENGINES=fallback for the JavaScript engine)
```

The browser tests load `dist/` in headless Chromium; Pyodide is served from the `pyodide` npm package and the wheels from `tests/.wheels`, so the suite runs offline. Set `CHROMIUM_PATH` to use an existing Chromium binary and `CAS_ENGINES=exact` or `CAS_ENGINES=fallback` to test one engine.

- `tests/syntax.test.mjs` — the input front end (Node, no browser).
- `tests/trust.test.mjs` — verification badges, divergence, solution sets, bare equations, free-form input, assumptions, worked solutions.
- `tests/cas.test.mjs` — behaviour of the app, run once per engine.
- `tests/tools.test.mjs` — every named tool, distributions, the grapher, the plotting JIT.
- `tests/corpus.test.mjs` — the differential corpus: 540 generated problems with references from CPython SymPy (regenerate with `python tests/corpus/generate.py` after `pip install --no-deps sympy==1.14.0 mpmath==1.4.1`; CI checks it is up to date).
- `tests/bench.test.mjs` — the scoreboard: no wrong answers from either engine.
- `tests/offline.test.mjs` — the service worker serves the app and SymPy offline; the engine restarts from its snapshot.
- `tests/versions.test.mjs` — the Pyodide version is pinned consistently; engine packages are snapshot-safe.
- `tests/property.test.mjs` — property-based tests: seeded random expressions, each answer checked by an oracle that shares no code with the engine (finite differences, Simpson's rule, substitution in mathjs). `PROPERTY_SEED` and `PROPERTY_CASES` replay or widen a run.
- `tests/viz.test.mjs` — interval enclosures (randomised), GLSL compilation, every visualisation.
- `tests/workspace.test.mjs` — every gallery notebook and formula runs; history, undo, library, Markdown/Quarto, plug-ins, the dialogs, accessibility, collaboration between two pages.
- `tests/cli.test.mjs` — the language server (analysis and protocol), the command line and the local API.

The collaboration test joins its two pages with an in-memory channel by default. Headless Chromium on some hosts cannot complete ICE without trickle, even between two bare `RTCPeerConnection`s. `CAS_WEBRTC=1` uses real data channels instead.

---

## Roadmap status

The original 10-level roadmap was written before the move to SymPy. Its status today: **✓** delivered, **◐** partly, **SymPy** provided by the engine (no plan to reimplement it in JavaScript), **○** open.

| Level | Items |
|---|---|
| **1 Engine foundations** | 1.1–1.3 polynomial engines, partial fractions — SymPy · 1.4 Risch — SymPy (heuristic Risch) plus inverse-substitution fallback ✓ · 1.5 limits (Gruntz) — SymPy · 1.6 summation — SymPy · 1.7 solving — SymPy (solveset), readable solution sets ✓ |
| **2 Domains** | 2.1 ODEs ✓ · 2.2 number theory ✓ · 2.3 multivariable calculus ✓ · 2.4 vector calculus and differential forms ✓ · 2.5 Laplace/Fourier/Z-transforms ✓ · 2.6 distributions and random variables as objects ✓ · 2.7 optimisation: extrema, Lagrange multipliers, linear programming ✓ · 2.8 signal processing (DFT, convolution, Bode) ✓ · 2.9 stochastic calculus (Itô, SDEs, sample paths) ✓ · 2.10 tensors and relativity ✓ |
| **3 Numerics** | 3.1 exact rationals ✓ · 3.2 algebraic numbers ✓ · 3.3 number fields (`minpoly`, `nfactor`) ✓ · 3.4 arbitrary precision ✓ · 3.5 interval arithmetic and rigorous numerics (`ieval`, `prove`) ✓ · 3.6 symbolic–numeric hybrids (verification layer, `identify`, `holonomic`) ✓ · 3.7 GPU (WebGL domain colouring) ✓ |
| **4 Architecture** | 4.1 workers ✓ · 4.2 WebAssembly ✓ (Pyodide) · 4.3 SymPy via Pyodide ✓, memory-snapshot start ✓ · 4.4 JIT compilation of expressions ✓ (plotting) · 4.5 persistent data structures (content-addressed versions sharing cells) ✓ · 4.6 reactive evaluation ✓ · 4.7 plug-in API ✓ · 4.8 IndexedDB sessions ✓ |
| **5 Notebook** | 5.1 LaTeX export ✓ · 5.2 share links ✓ · 5.3 version history ✓ · 5.4 function library ✓ · 5.5 step-by-step derivations ✓ · 5.6 templates ✓ · 5.7 themes and accessibility ✓ · 5.8 collaborative editing (peer to peer) ✓ |
| **6 Visualisation** | 6.1 vector fields and phase portraits ✓ · 6.2 slope fields ✓ · 6.3 domain colouring ✓ · 6.4 Riemann surfaces ✓ · 6.5 implicit surfaces ✓ · 6.6 parameter animations ✓ · 6.7 equation morphing ✓ · 6.8 manifolds (parametric surfaces, curvature, geodesics) ✓ · 6.9 statistical plots ✓ · 6.10 network plots ✓ · 6.11 expression trees ✓ |
| **7 Verification** | 7.1 property-based testing ✓ · 7.2 differential testing ✓ · 7.3 Lean export ◐ (statements, not proofs; not compiled by Lean here) · 7.4 certified plotting ✓ (implicit curves) · 7.5 provenance ✓ (engine badge, "read as", verification method) · 7.6 unit checking ✓ |
| **8 AI** | 8.1 natural language ✓ (offline parser and Claude) · 8.2 equation OCR ✓ (photo input) · 8.3 explanations ✓ (grounded in steps and checks) · 8.4 context-aware autocomplete ✓ · 8.5 common-error detection ✓ ("did you mean", extraneous roots, `grade`) · 8.6 auto-grading ✓ · 8.7 formula search ✓ |
| **9 Ecosystem** | 9.1 gallery ✓ · 9.2 citation export ✓ · 9.3 language server ✓ · 9.4 API ✓ (a local command line and HTTP API, not a hosted service, in keeping with the no-server design) · 9.5 embed widget ✓ · 9.6 Markdown/Quarto bridge ✓ |
| **10 Research** | 10.1 Gröbner bases ✓ · 10.2 differential algebra (`diffelim`) ✓ · 10.3 Galois theory ✓ · 10.4 holonomic functions ✓ · 10.5 symbolic differential geometry ✓ · 10.6 constraint geometry (named objects) ✓ · 10.7 quantum simulation ✓ · 10.8 lattices (LLL) ✓ · 10.9 knot invariants ✓ · 10.10 theorem proving (`prove`) ✓ |

**Limits, stated plainly.**
- **Lean.** `prove` writes a Lean 4 statement for the polynomial identities and inequalities it proves, but the proof itself comes from CassyCAS's own method (Sturm sequences or interval bounds), and nothing here compiles the statement with Lean.
- **Interval arithmetic.** Interval enclosures in JavaScript round outwards by one unit in the last place for each operation. The elementary functions (`sin`, `exp`, …) are trusted to be accurate to within that margin, which IEEE does not guarantee. The Python enclosures use mpmath's interval arithmetic.
- **Galois groups** are computed up to degree 6, and **knot invariants** for a table of standard knots.
- **Collaboration** cannot connect through NATs that need a relay (TURN).

Possible next steps: compiling the Lean output in CI, TURN support for collaboration, and Galois groups beyond degree 6.

---

## Contributing

Issues and PRs welcome. Start with `src/engine.js` (how inputs are routed), `src/syntax.js` (how they are read) and `src/sympy/bridge.py` (what SymPy is asked to do and how the answer is checked). Every new capability needs a test, and every new kind of answer a verification or a scoreboard problem with an independently known result.
