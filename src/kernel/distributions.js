// Probability distributions (calculator-style names), installed into every mathjs instance so
// they work with or without the exact engine. Built on the regularised incomplete gamma and
// beta functions (continued fractions, Numerical Recipes §6.2/6.4), accurate to ~1e-14.

const EPS = 1e-16, FPMIN = 1e-300;

function lgamma(x) {   // Lanczos (g = 7, n = 9)
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Regularised lower incomplete gamma P(a, x).
function gammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 1000; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * EPS) break; }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  return 1 - gammaQcf(a, x);
}
function gammaQcf(a, x) {
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
const gammaQ = (a, x) => x <= 0 ? 1 : x < a + 1 ? 1 - gammaP(a, x) : gammaQcf(a, x);

// Regularised incomplete beta I_x(a, b).
function betaI(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(x, a, b) / a : 1 - bt * betacf(1 - x, b, a) / b;
}
function betacf(x, a, b) {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 1000; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

// Standard normal CDF via erfc = Q(1/2, x²), accurate in both tails.
function Phi(z) {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  const q = 0.5 * gammaQ(0.5, z * z / 2);
  return z >= 0 ? 1 - q : q;
}
function invPhi(p) {   // Acklam's approximation, then two Newton steps
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  let x;
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else { const q = p - 0.5, r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  for (let i = 0; i < 2; i++) x -= (Phi(x) - p) / (Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI));
  return x;
}

const tcdf1 = (t, df) => { const ib = betaI(df / (df + t * t), df / 2, 0.5); return t >= 0 ? 1 - ib / 2 : ib / 2; };
function invT(p, df) {   // bisection on the monotone CDF, bracketed from the normal quantile
  let lo = -1e3, hi = 1e3;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (tcdf1(m, df) < p) lo = m; else hi = m; if (hi - lo < 1e-15 * (1 + Math.abs(m))) break; }
  return (lo + hi) / 2;
}

// ── argument checks ──
const num = (v, what) => {
  const x = typeof v === 'number' ? v : v && typeof v.toNumber === 'function' ? v.toNumber() : Number(v);
  if (typeof x !== 'number' || Number.isNaN(x)) throw new Error(`${what} must be a real number`);
  return x;
};
const pos = (v, what) => { const x = num(v, what); if (!(x > 0)) throw new Error(`${what} must be positive`); return x; };
const prob = (v, what = 'p') => { const x = num(v, what); if (!(x >= 0 && x <= 1)) throw new Error(`${what} must be between 0 and 1`); return x; };
const count = (v, what) => { const x = num(v, what); if (!Number.isInteger(x) || x < 0) throw new Error(`${what} must be a whole number`); return x; };

export const DISTRIBUTIONS = {
  normalpdf: (x, mu = 0, sigma = 1) => { const s = pos(sigma, 'σ'), z = (num(x, 'x') - num(mu, 'μ')) / s; return Math.exp(-z * z / 2) / (s * Math.sqrt(2 * Math.PI)); },
  // normalcdf(x) = P(X ≤ x);  normalcdf(a, b[, μ, σ]) = P(a ≤ X ≤ b)
  normalcdf: (a, b, mu = 0, sigma = 1) => {
    const m = num(mu, 'μ'), s = pos(sigma, 'σ');
    if (b === undefined) return Phi((num(a, 'x') - m) / s);
    return Phi((num(b, 'b') - m) / s) - Phi((num(a, 'a') - m) / s);
  },
  invnorm: (p, mu = 0, sigma = 1) => num(mu, 'μ') + pos(sigma, 'σ') * invPhi(prob(p)),
  binompdf: (n, p, k) => {
    const N = count(n, 'n'), P = prob(p), K = num(k, 'k');
    if (!Number.isInteger(K) || K < 0 || K > N) return 0;
    if (P === 0) return K === 0 ? 1 : 0;
    if (P === 1) return K === N ? 1 : 0;
    return Math.exp(lgamma(N + 1) - lgamma(K + 1) - lgamma(N - K + 1) + K * Math.log(P) + (N - K) * Math.log(1 - P));
  },
  binomcdf: (n, p, k) => {
    const N = count(n, 'n'), P = prob(p), K = Math.floor(num(k, 'k'));
    if (K < 0) return 0;
    if (K >= N) return 1;
    return betaI(1 - P, N - K, K + 1);
  },
  poissonpdf: (lambda, k) => { const l = pos(lambda, 'λ'), K = num(k, 'k'); return Number.isInteger(K) && K >= 0 ? Math.exp(K * Math.log(l) - l - lgamma(K + 1)) : 0; },
  poissoncdf: (lambda, k) => { const l = pos(lambda, 'λ'), K = Math.floor(num(k, 'k')); return K < 0 ? 0 : gammaQ(K + 1, l); },
  geometpdf: (p, k) => { const P = prob(p), K = num(k, 'k'); return Number.isInteger(K) && K >= 1 ? P * (1 - P) ** (K - 1) : 0; },
  geometcdf: (p, k) => { const P = prob(p), K = Math.floor(num(k, 'k')); return K < 1 ? 0 : 1 - (1 - P) ** K; },
  tpdf: (x, df) => { const v = pos(df, 'df'), t = num(x, 'x'); return Math.exp(lgamma((v + 1) / 2) - lgamma(v / 2) - 0.5 * Math.log(v * Math.PI) - (v + 1) / 2 * Math.log(1 + t * t / v)); },
  tcdf: (a, b, df) => {
    if (df === undefined) { const v = pos(b, 'df'); return tcdf1(num(a, 'x'), v); }
    const v = pos(df, 'df'); return tcdf1(num(b, 'b'), v) - tcdf1(num(a, 'a'), v);
  },
  invt: (p, df) => { const P = prob(p), v = pos(df, 'df'); return P === 0 ? -Infinity : P === 1 ? Infinity : invT(P, v); },
  chi2pdf: (x, df) => { const v = pos(df, 'df'), X = num(x, 'x'); return X <= 0 ? 0 : Math.exp((v / 2 - 1) * Math.log(X) - X / 2 - (v / 2) * Math.LN2 - lgamma(v / 2)); },
  chi2cdf: (a, b, df) => {
    const P = (x, v) => x <= 0 ? 0 : gammaP(v / 2, x / 2);
    if (df === undefined) return P(num(a, 'x'), pos(b, 'df'));
    const v = pos(df, 'df'); return P(num(b, 'b'), v) - P(num(a, 'a'), v);
  },
  expcdf: (x, lambda) => { const l = pos(lambda, 'λ'), X = num(x, 'x'); return X <= 0 ? 0 : 1 - Math.exp(-l * X); },
};

export function installDistributions(math) {
  math.import(DISTRIBUTIONS, { override: true });
}

export const DISTRIBUTION_DOCS = [
  { n: 'normalpdf', s: 'normalpdf(x, μ, σ)', desc: 'Normal density' },
  { n: 'normalcdf', s: 'normalcdf(a, b, μ, σ)', desc: 'P(a ≤ X ≤ b), normal (normalcdf(x) = P(X ≤ x))' },
  { n: 'invnorm', s: 'invnorm(p, μ, σ)', desc: 'Normal quantile' },
  { n: 'binompdf', s: 'binompdf(n, p, k)', desc: 'P(X = k), binomial' },
  { n: 'binomcdf', s: 'binomcdf(n, p, k)', desc: 'P(X ≤ k), binomial' },
  { n: 'poissonpdf', s: 'poissonpdf(λ, k)', desc: 'P(X = k), Poisson' },
  { n: 'poissoncdf', s: 'poissoncdf(λ, k)', desc: 'P(X ≤ k), Poisson' },
  { n: 'geometpdf', s: 'geometpdf(p, k)', desc: 'P(first success on trial k)' },
  { n: 'geometcdf', s: 'geometcdf(p, k)', desc: 'P(first success by trial k)' },
  { n: 'tpdf', s: 'tpdf(x, df)', desc: 'Student t density' },
  { n: 'tcdf', s: 'tcdf(a, b, df)', desc: 'P(a ≤ T ≤ b), Student t' },
  { n: 'invt', s: 'invt(p, df)', desc: 'Student t quantile' },
  { n: 'chi2pdf', s: 'chi2pdf(x, df)', desc: 'χ² density' },
  { n: 'chi2cdf', s: 'chi2cdf(a, b, df)', desc: 'P(a ≤ X ≤ b), χ²' },
  { n: 'expcdf', s: 'expcdf(x, λ)', desc: 'P(X ≤ x), exponential' },
];
