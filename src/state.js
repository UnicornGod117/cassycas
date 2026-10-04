// Shared application state. Modules mutate these objects in place (never rebind them).
export const CONSTANT_NAMES = ['pi', 'e', 'phi', 'tau'];
export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const FORBIDDEN_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

export const state = {
  exactMode: true,
  angleMode: 'rad',
  darkTheme: true,
  autoPlot: true,
  engineEnabled: true,        // SymPy exact engine (lazy-loaded)
  curMode: 'algebra',
  // Workspace values that predate this session's cells (storage / loaded files).
  // Recomputing the notebook always starts from this snapshot, so it is idempotent.
  baseScope: {},
};

// Numeric workspace (mathjs values and callable user functions).
export const scope = { pi: Math.PI, e: Math.E, phi: (1 + Math.sqrt(5)) / 2, tau: 2 * Math.PI };
// User functions: name → { params, body, compiled }.
export const userFns = {};
// Symbolic definitions: variable name → source of its right-hand side, so exact
// computations can use `a = sqrt(2)` as √2 rather than 1.41421356…
export const varDefs = {};
// Assumptions placed on symbols by assume(...) cells: name → ['positive', 'integer', …].
// Sent with every exact-engine request; rebuilt from the cells on each recomputation.
export const assumptions = {};
// Named objects (X = Normal(0, 1), A = Point(0, 0)): name → expression tree of the constructor,
// sent with every exact-engine request and built there on first use.
export const objects = {};
export const OBJECT_CTORS = ['Normal', 'Uniform', 'Exponential', 'Poisson', 'Binomial', 'Bernoulli', 'Geometric', 'Die', 'Coin',
  'Gamma', 'Beta', 'ChiSquared', 'StudentT', 'LogNormal', 'Cauchy', 'Laplace', 'Weibull', 'Rayleigh', 'Erlang', 'Pareto',
  'Hypergeometric', 'NegativeBinomial', 'Point', 'Line', 'Segment', 'Ray', 'Circle', 'Ellipse', 'Triangle', 'Polygon',
  'circumcircle', 'incircle', 'perpendicular', 'parallel', 'midpoint', 'centroid'];
