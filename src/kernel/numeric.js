// Numerical methods: quadrature, limits, root finding, nonlinear systems, ODEs.
import { math, splitEquation } from '../expr.js';
import { asRational, toReal } from '../format.js';
import { ctx } from './mathjs-client.js';

// Adaptive Simpson quadrature; infinite ranges are mapped onto finite ones. `base` supplies the
// values of outer variables (nested integrals); `tol` is the relative error target.
export function numInt(fn, v, a, b, base = null, tol = 1e-11) {
  const loc = base ? Object.assign({}, base) : ctx();
  let g = x => { loc[v] = x; try { return toReal(fn.evaluate(loc)); } catch { return NaN; } };
  let sign = 1;
  if (a > b) { [a, b] = [b, a]; sign = -1; }
  if (a === b) return 0;
  if (!isFinite(a) || !isFinite(b)) {
    const h = g;
    if (!isFinite(a) && !isFinite(b)) { g = t => { const x = t / (1 - t * t); return h(x) * (1 + t * t) / ((1 - t * t) ** 2); }; a = -1; b = 1; }
    else if (!isFinite(b)) { const a0 = a; g = t => h(a0 + t / (1 - t)) / ((1 - t) ** 2); a = 0; b = 1; }
    else { const b0 = b; g = t => h(b0 - (1 - t) / t) / (t * t); a = 0; b = 1; }
  }
  const width = b - a;
  const safe = x => {   // integrable end-point singularities: nudge the sample inwards
    let y = g(x);
    if (!isFinite(y)) { const d = width * 1e-10; y = g(x < a + width / 2 ? x + d : x - d); }
    return y;
  };
  let evals = 0;
  function rec(l, r, fl, fm, fr, whole, eps, depth) {
    const m = (l + r) / 2, lm = (l + m) / 2, rm = (m + r) / 2;
    const flm = safe(lm), frm = safe(rm); evals += 2;
    const left = (m - l) / 6 * (fl + 4 * flm + fm), right = (r - m) / 6 * (fm + 4 * frm + fr);
    const delta = left + right - whole;
    if (depth <= 0 || evals > 400000 || Math.abs(delta) <= 15 * eps) return left + right + delta / 15;
    return rec(l, m, fl, flm, fm, left, eps / 2, depth - 1) + rec(m, r, fm, frm, fr, right, eps / 2, depth - 1);
  }
  const panels = 16, hw = width / panels;
  let total = 0;
  for (let i = 0; i < panels; i++) {
    const l = a + i * hw, r = l + hw, fl = safe(l), fr = safe(r), fm = safe((l + r) / 2);
    total += rec(l, r, fl, fm, fr, hw / 6 * (fl + 4 * fm + fr), tol * Math.max(1, width), 40);
  }
  return sign * total;
}

// Numerical limit: one-sided sequences, continuity shortcut, divergence detection,
// and a two-sided comparison (a jump or a pole is reported as "does not exist").
export function numLim(expr, v, a, dir = 0) {
  const fn = math.compile(expr);
  const at = x => { const loc = ctx(); loc[v] = x; try { return toReal(fn.evaluate(loc)); } catch { return NaN; } };
  const snap = x => {
    if (!isFinite(x)) return x;
    if (Math.abs(x) < 1e-7) return 0;
    const n = Math.round(x);
    if (Math.abs(x - n) < 1e-7 * (1 + Math.abs(x))) return n;
    const r = asRational(x, 1000, 1e-7);
    return r ? r.n / r.d : x;
  };
  function sequence(s) {
    const hs = [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7];
    const xs = isFinite(a) ? hs.map(h => a + s * h) : hs.map(h => s / h * 10);
    const vals = xs.map(at);
    if (vals.every(isNaN)) return { value: NaN, outside: true };
    const tail = vals.slice(-4);
    const inf = tail.find(y => !isFinite(y) && !isNaN(y));
    if (inf !== undefined) return { value: inf };
    const diffs = tail.slice(1).map((y, i) => y - tail[i]);
    if (tail.every(isFinite) && diffs.every(d => Math.sign(d) === Math.sign(diffs[0]) && d !== 0)
        && Math.abs(diffs[2]) >= 0.5 * Math.abs(diffs[0]) && Math.abs(tail[3]) > 5) {
      return { value: diffs[0] > 0 ? Infinity : -Infinity };
    }
    let best = -1, bestD = Infinity;
    for (let i = 1; i < vals.length; i++) {
      if (!isFinite(vals[i]) || !isFinite(vals[i - 1])) continue;
      const d = Math.abs(vals[i] - vals[i - 1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && bestD <= 1e-6 * (1 + Math.abs(vals[best]))) return { value: snap(vals[best]) };
    const A = aitken(vals);
    if (!isNaN(A)) return { value: A };
    // Bounded values whose steps neither shrink nor keep one sign (sin(1/x) at 0): oscillation.
    const scale = Math.max(...vals.map(Math.abs));
    const steps = vals.slice(1).map((y, i) => y - vals[i]);
    if (vals.every(isFinite) && scale < 1e6 && steps.slice(-3).every(d => Math.abs(d) > 1e-2 * (1 + scale))
        && steps.slice(-4).some((d, i, a) => i > 0 && Math.sign(d) !== Math.sign(a[i - 1]))) return { value: NaN, oscillates: true };
    return { value: NaN };
  }
  // Slow convergence (e.g. x*log(x) as x → 0+): Aitken Δ² extrapolation over successive triples.
  // Only accepted when two consecutive estimates agree and snap to a simple number.
  function aitken(vals) {
    const est = [];
    for (let i = 0; i + 2 < vals.length; i++) {
      const [p, q, r] = vals.slice(i, i + 3);
      const den = (r - q) - (q - p);
      est.push([p, q, r].every(isFinite) && den !== 0 ? r - (r - q) ** 2 / den : NaN);
    }
    let A = NaN, bestD = Infinity;
    for (let i = 1; i < est.length; i++) {
      const d = Math.abs(est[i] - est[i - 1]);
      if (isFinite(d) && d < bestD) { bestD = d; A = est[i]; }
    }
    if (!isFinite(A) || bestD > 1e-4 * (1 + Math.abs(A))) return NaN;
    const tol = 1e-5 * (1 + Math.abs(A));
    if (Math.abs(A - Math.round(A)) <= tol) return Math.round(A) || 0;
    const r = asRational(A, 12, 1e-5);
    return r && Math.abs(A - r.n / r.d) <= tol ? r.n / r.d : NaN;
  }
  const oneSided = (S) => S.oscillates ? { dne: true, value: NaN, note: 'Oscillates without settling' } : { value: S.value };
  if (!isFinite(a)) return oneSided(sequence(a > 0 ? 1 : -1));
  if (dir) return oneSided(sequence(dir));
  const fa = at(a);
  if (isFinite(fa)) {
    const l = at(a - 1e-7), r = at(a + 1e-7);
    if (Math.abs(l - fa) < 1e-5 * (1 + Math.abs(fa)) && Math.abs(r - fa) < 1e-5 * (1 + Math.abs(fa))) return { value: fa };
  }
  const R = sequence(1), L = sequence(-1);
  if (L.outside && R.outside) return { value: NaN, outside: true };
  if (L.outside && !R.outside) return { value: R.value, note: 'Left side is outside the domain — one-sided (right) limit' };
  if (R.outside && !L.outside) return { value: L.value, note: 'Right side is outside the domain — one-sided (left) limit' };
  const same = (isFinite(R.value) && isFinite(L.value) && Math.abs(R.value - L.value) <= 1e-6 * (1 + Math.abs(R.value)))
            || (!isFinite(R.value) && !isNaN(R.value) && R.value === L.value);
  if (same) return { value: R.value, left: L.value, right: R.value };
  if (R.oscillates || L.oscillates) return { dne: true, value: NaN, left: L.value, right: R.value, note: 'Oscillates without settling' };
  // A side that did not converge numerically says nothing about existence.
  if (isNaN(R.value) || isNaN(L.value)) return { value: NaN, undetermined: true, left: L.value, right: R.value };
  return { dne: true, value: NaN, left: L.value, right: R.value };
}

export function rk4Solve(fExpr, xVar, yVar, x0, y0, x1, n = 500) {
  const fn = math.compile(fExpr);
  const h = (x1 - x0) / n;
  const xs = [x0], ys = [y0];
  const loc = ctx();
  const ev = (xi, yi) => { loc[xVar] = xi; loc[yVar] = yi; try { return toReal(fn.evaluate(loc)); } catch { return NaN; } };
  let y = y0;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * h;
    const k1 = ev(x, y), k2 = ev(x + h / 2, y + h / 2 * k1), k3 = ev(x + h / 2, y + h / 2 * k2), k4 = ev(x + h, y + h * k3);
    y += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
    xs.push(parseFloat((x0 + (i + 1) * h).toPrecision(12)));
    ys.push(y);
  }
  return { xs, ys };
}

// Real-root search: sign changes (bisection) and touching roots (minimisation of |f|),
// scanning outwards from the origin so the reported roots are the ones nearest zero.
export function findRoots(f, v, mn = -1e4, mx = 1e4) {
  let fn;
  try { fn = math.compile(f); } catch { return { roots: [], truncated: false }; }
  const loc = ctx();
  const at = x => { loc[v] = x; try { return toReal(fn.evaluate(loc)); } catch { return NaN; } };
  const roots = [];
  const add = r => {
    if (!isFinite(r)) return;
    const n = Math.round(r); if (Math.abs(r - n) < 1e-10 * (1 + Math.abs(r)) && at(n) === 0) r = n;
    if (!roots.some(q => Math.abs(q - r) < 1e-8 * (1 + Math.abs(r)))) roots.push(r);
  };
  const passes = [[-10, 10, 4000], [-100, 100, 8000], [-1000, 1000, 8000], [mn, mx, 20000]]
    .map(([l, r, n]) => [Math.max(l, mn), Math.min(r, mx), n]).filter(([l, r]) => l < r);
  for (const [lo, hi, steps] of passes) {
    const dx = (hi - lo) / steps;
    let px = lo, py = at(lo), ppy = NaN;
    for (let i = 1; i <= steps; i++) {
      const x = lo + i * dx, y = at(x);
      if (py === 0) add(px);
      else if (isFinite(py) && isFinite(y) && Math.sign(y) !== Math.sign(py) && y !== 0) {
        const r = bisect(at, px, x);
        if (r !== null && Math.abs(at(r)) <= Math.min(Math.abs(py), Math.abs(y))) add(r);   // poles are not roots
      } else if (isFinite(ppy) && isFinite(py) && isFinite(y) && Math.abs(py) < Math.abs(ppy) && Math.abs(py) <= Math.abs(y)) {
        const r = minimiseAbs(at, px - dx, x);
        if (r !== null && Math.abs(at(r)) < 1e-9 * (1 + Math.abs(py) + Math.abs(y))) add(r);
      }
      ppy = py; px = x; py = y;
    }
    if (roots.length >= 20) break;
  }
  roots.sort((p, q) => Math.abs(p) - Math.abs(q));
  const truncated = roots.length > 20;
  return { roots: roots.slice(0, 20).sort((p, q) => p - q).map(r => parseFloat(r.toPrecision(12))), truncated };
}
function bisect(at, a, b, it = 80) {
  let fa = at(a);
  for (let i = 0; i < it; i++) {
    const m = (a + b) / 2, fm = at(m);
    if (!isFinite(fm)) return null;
    if (fm === 0 || (b - a) / 2 < 1e-15 * (1 + Math.abs(m))) return m;
    if (Math.sign(fa) !== Math.sign(fm)) b = m; else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}
function minimiseAbs(at, a, b) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a);
  for (let i = 0; i < 100 && Math.abs(b - a) > 1e-14 * (1 + Math.abs(a)); i++) {
    if (Math.abs(at(c)) < Math.abs(at(d))) b = d; else a = c;
    c = b - g * (b - a); d = a + g * (b - a);
  }
  const r = (a + b) / 2;
  return isFinite(at(r)) ? r : null;
}
export function solveSys(eqs, vars) {
  const fns = eqs.map(eq => { const [l, r] = splitEquation(eq); return math.compile(`(${l})-(${r})`); });
  const base = ctx();
  const evalF = (fn, loc) => { try { return toReal(fn.evaluate(loc)); } catch { return NaN; } };
  function tryNewton(x0) {
    let xs = [...x0];
    for (let it = 0; it < 200; it++) {
      const loc = Object.assign({}, base);
      vars.forEach((v, i) => { loc[v] = xs[i]; });
      const F = fns.map(fn => evalF(fn, loc));
      if (F.some(isNaN)) return null;
      const J = fns.map(fn => vars.map((v2, j) => {
        const s1 = Object.assign({}, loc), s2 = Object.assign({}, loc), h = 1e-7 * (1 + Math.abs(xs[j]));
        s1[v2] = xs[j] + h; s2[v2] = xs[j] - h;
        return (evalF(fn, s1) - evalF(fn, s2)) / (2 * h);
      }));
      const dx = solveL(J, F.map(f => -f));
      if (!dx || dx.some(isNaN)) break;
      xs = xs.map((x, i) => x + dx[i]);
      if (dx.every((d, i) => Math.abs(d) < 1e-13 * (1 + Math.abs(xs[i])))) break;
    }
    const loc2 = Object.assign({}, base);
    vars.forEach((v, i) => { loc2[v] = xs[i]; });
    const residual = Math.sqrt(fns.reduce((s, fn) => { const y = evalF(fn, loc2); return s + (isFinite(y) ? y * y : 1e20); }, 0));
    return { xs, residual };
  }
  const starts = [vars.map(() => 1), vars.map(() => 0), vars.map(() => -1),
    vars.map((_, i) => (i + 1) * 2.7), vars.map((_, i) => -(i + 1) * 1.3), vars.map((_, i) => 10 * (i % 2 ? -1 : 1))];
  let best = null;
  for (const s0 of starts) {
    const res = tryNewton(s0);
    if (res && (best === null || res.residual < best.residual)) best = res;
    if (best && best.residual < 1e-10) break;
  }
  if (!best) return vars.map(v => ({ v, x: NaN, warn: true }));
  const converged = best.residual < 1e-6;
  return vars.map((v, i) => {
    let x = best.xs[i];
    const n = Math.round(x); if (Math.abs(x - n) < 1e-9 * (1 + Math.abs(x))) x = n;
    return { v, x: parseFloat(x.toPrecision(12)), warn: !converged, residual: best.residual };
  });
}
export function solveL(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let mx = col; for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[mx][col])) mx = r;
    [M[col], M[mx]] = [M[mx], M[col]]; if (Math.abs(M[col][col]) < 1e-15) return null;
    for (let r = col + 1; r < n; r++) { const f = M[r][col] / M[col][col]; for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { x[i] = M[i][n]; for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j]; x[i] /= M[i][i]; }
  return x;
}
