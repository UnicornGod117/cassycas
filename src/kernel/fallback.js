// JavaScript symbolic fallback: used while the SymPy engine loads, when it is unavailable
// (offline / disabled) or when it times out. Every symbolic answer is verified numerically.
import Algebrite from 'algebrite';
import { math, stripParens, freeSymbols, dependsOn, prettify, splitTopLevel, texOf } from '../expr.js';
import { asRational, toReal } from '../format.js';
import { scope } from '../state.js';
import { findRoots, solveL } from './numeric.js';

export function algebriteRun(cmd) {
  const out = Algebrite.run(cmd);
  if (!out || /Stop|Unsupported|error|nil/i.test(out)) throw new Error(out || 'Algebrite could not evaluate this');
  return out;
}
// mathjs syntax → Algebrite syntax (explicit products, e → exp(1), reciprocal trig).
export function toAlgebrite(str) {
  const recip = { sec: 'cos', csc: 'sin', cot: 'tan' };
  return math.parse(str).transform((n, path, parent) => {
    if (n.isSymbolNode && n.name === 'e' && !(parent && parent.isFunctionNode && path === 'fn')) return math.parse('exp(1)');
    if (n.isFunctionNode && recip[n.fn.name] && n.args.length === 1)
      return new math.OperatorNode('/', 'divide', [new math.ConstantNode(1), new math.FunctionNode(recip[n.fn.name], n.args)]);
    if (n.isFunctionNode && n.fn.name === 'log10' && n.args.length === 1) return math.parse(`log(${n.args[0]})/log(10)`);
    return n;
  }).toString({ implicit: 'show' });
}
export function fromAlgebrite(s) {
  return s.replace(/\barcsinh\b/g, 'asinh').replace(/\barccosh\b/g, 'acosh').replace(/\barctanh\b/g, 'atanh')
    .replace(/\barcsin\b/g, 'asin').replace(/\barccos\b/g, 'acos').replace(/\barctan\b/g, 'atan');
}
export const alg = (cmd) => prettify(fromAlgebrite(algebriteRun(cmd)));

// True when two expressions agree at several sample points (every free symbol is sampled).
// Symbolic results are always in radians, so this deliberately ignores degree mode.
export function numericallyEqual(a, b) {
  let ca, cb;
  try { ca = math.compile(a); cb = math.compile(b); } catch { return false; }
  const syms = [...new Set([...freeSymbols(a), ...freeSymbols(b)])];
  const pts = [0.37, 0.61, -0.83, 0.21, -0.47, 1.31, 2.17, -1.7, 3.3];
  let good = 0;
  for (let t = 0; t < pts.length; t++) {
    const loc = Object.assign({}, scope);
    syms.forEach((s, i) => { loc[s] = pts[(t + 2 * i) % pts.length] + 0.013 * i; });
    let va, vb;
    try { va = toReal(ca.evaluate(loc)); vb = toReal(cb.evaluate(loc)); } catch { continue; }
    if (!isFinite(va) || !isFinite(vb)) continue;
    if (Math.abs(va - vb) > 1e-7 * (1 + Math.abs(va))) return false;
    good++;
  }
  return good >= 3;
}
export function niceNumber(c) {
  if (Math.abs(c - Math.round(c)) < 1e-8) return String(Math.round(c));
  const r = asRational(c, 100000);
  return r ? `${r.n}/${r.d}` : null;
}

// ── Antiderivatives ──────────────────────────────────
function linearCoeff(u, v) {
  try {
    const d = math.simplify(math.derivative(u, v));
    if (dependsOn(d, v)) return null;
    if (d.isConstantNode && Number(d.value) === 0) return null;
    return d.toString();
  } catch { return null; }
}
function integrateTree(node, v) {
  node = stripParens(node);
  const s = node.toString();
  if (!dependsOn(node, v)) return `(${s}) * ${v}`;
  if (node.isSymbolNode) return `${v}^2 / 2`;
  if (node.isOperatorNode) {
    const [a, b] = node.args;
    switch (node.fn) {
      case 'unaryPlus': return integrateTree(a, v);
      case 'unaryMinus': { const r = integrateTree(a, v); return r && `-(${r})`; }
      case 'add': case 'subtract': {
        const ra = integrateTree(a, v), rb = integrateTree(b, v);
        return ra && rb && `(${ra}) ${node.op} (${rb})`;
      }
      case 'multiply':
        if (!dependsOn(a, v)) { const r = integrateTree(b, v); return r && `(${a}) * (${r})`; }
        if (!dependsOn(b, v)) { const r = integrateTree(a, v); return r && `(${b}) * (${r})`; }
        return null;
      case 'divide': {
        if (!dependsOn(b, v)) { const r = integrateTree(a, v); return r && `(${r}) / (${b})`; }
        if (!dependsOn(a, v)) {
          const den = stripParens(b), k = linearCoeff(den, v);
          if (k) return `(${a}) * log(abs(${den})) / (${k})`;
          if (den.isOperatorNode && den.fn === 'pow' && !dependsOn(den.args[1], v))
            return integrateTree(math.parse(`(${a}) * (${den.args[0]})^(-(${den.args[1]}))`), v);
        }
        return null;
      }
      case 'pow': {
        const base = stripParens(a);
        if (!dependsOn(b, v)) {
          const k = linearCoeff(base, v);
          if (!k) return null;
          let n = null; try { n = toReal(b.evaluate({})); } catch {}
          if (n === -1) return `log(abs(${base})) / (${k})`;
          return `(${base})^((${b}) + 1) / (((${b}) + 1) * (${k}))`;
        }
        if (!dependsOn(base, v)) {
          const k = linearCoeff(stripParens(b), v);
          return k && `(${base})^(${b}) / ((${k}) * log(${base}))`;
        }
        return null;
      }
    }
    return null;
  }
  if (node.isFunctionNode && node.args.length === 1) {
    const u = stripParens(node.args[0]), k = linearCoeff(u, v);
    if (!k) return null;
    const U = `(${u})`;
    const table = {
      sin: `-cos(${U})`, cos: `sin(${U})`, tan: `-log(abs(cos(${U})))`,
      sec: `log(abs(sec(${U}) + tan(${U})))`, csc: `-log(abs(csc(${U}) + cot(${U})))`, cot: `log(abs(sin(${U})))`,
      sinh: `cosh(${U})`, cosh: `sinh(${U})`, tanh: `log(cosh(${U}))`,
      exp: `exp(${U})`, log: `${U} * log(${U}) - ${U}`, sqrt: `2/3 * ${U}^(3/2)`,
      asin: `${U} * asin(${U}) + sqrt(1 - ${U}^2)`, acos: `${U} * acos(${U}) - sqrt(1 - ${U}^2)`,
      atan: `${U} * atan(${U}) - log(1 + ${U}^2) / 2`, abs: `${U} * abs(${U}) / 2`,
    };
    return node.fn.name in table ? `(${table[node.fn.name]}) / (${k})` : null;
  }
  return null;
}
const INTEGRAL_FORMS = [
  ['sec(x)^2', 'tan(x)'], ['csc(x)^2', '-cot(x)'], ['sec(x)*tan(x)', 'sec(x)'], ['csc(x)*cot(x)', '-csc(x)'],
  ['sin(x)^2', 'x/2 - sin(2*x)/4'], ['cos(x)^2', 'x/2 + sin(2*x)/4'], ['tan(x)^2', 'tan(x) - x'],
  ['1/(1+x^2)', 'atan(x)'], ['1/sqrt(1-x^2)', 'asin(x)'], ['-1/sqrt(1-x^2)', 'acos(x)'],
  ['1/(x*sqrt(x^2-1))', 'asec(abs(x))'], ['x*exp(x)', '(x-1)*exp(x)'], ['x*sin(x)', 'sin(x) - x*cos(x)'],
  ['x*cos(x)', 'cos(x) + x*sin(x)'], ['x*log(x)', 'x^2/2*log(x) - x^2/4'], ['x^2*exp(x)', '(x^2 - 2*x + 2)*exp(x)'],
].map(([f, F]) => [math.parse(f).toString(), F]);
function integralForm(f, v) {
  let key;
  try {
    if (v !== 'x' && freeSymbols(f).includes('x')) return null;
    key = math.parse(f).transform(n => n.isSymbolNode && n.name === v ? new math.SymbolNode('x') : n).toString();
  } catch { return null; }
  const hit = INTEGRAL_FORMS.find(([k]) => k === key);
  return hit ? math.parse(hit[1]).transform(n => n.isSymbolNode && n.name === 'x' ? new math.SymbolNode(v) : n).toString() : null;
}
export function verifyAntiderivative(F, f, v) {
  try { return numericallyEqual(math.derivative(F, v).toString(), f); } catch { return false; }
}
export function symbolicIntegrate(f, v) {
  const candidates = [];
  try { const r = integrateTree(math.parse(f), v); if (r) candidates.push([r, 'structural rules']); } catch {}
  const form = integralForm(f, v); if (form) candidates.push([form, 'table of standard forms']);
  try { candidates.push([fromAlgebrite(algebriteRun(`integral(${toAlgebrite(f)},${v})`)), 'Algebrite']); } catch {}
  for (const [c, method] of candidates) {
    let node; try { node = math.parse(c); } catch { continue; }
    let simp = null; try { simp = math.simplify(node); } catch {}
    for (const cand of [simp, node]) {
      if (cand && verifyAntiderivative(cand, f, v)) return { tex: cand.toTex(), plain: prettify(cand.toString()), method };
    }
  }
  return { noForm: true };
}

// ── Partial fractions ────────────────────────────────
function flattenProduct(node, out = []) {
  node = stripParens(node);
  if (node.isOperatorNode && node.fn === 'multiply') node.args.forEach(a => flattenProduct(a, out));
  else if (node.isOperatorNode && node.fn === 'unaryMinus') flattenProduct(node.args[0], out);
  else out.push(node);
  return out;
}
export function partialFractions(f, v) {
  let rat;
  try { rat = math.rationalize(math.parse(f), {}, true); } catch { return null; }
  if (!rat.denominator) return null;
  const num = rat.numerator.toString(), den = rat.denominator.toString();
  try {
    const quo = alg(`quotient(${toAlgebrite(num)},${toAlgebrite(den)},${v})`);
    const fac = fromAlgebrite(algebriteRun(`factor(${toAlgebrite(den)},${v})`));
    const groups = [];
    for (const factor of flattenProduct(math.parse(fac))) {
      if (!dependsOn(factor, v)) continue;
      let base = factor, mult = 1;
      if (factor.isOperatorNode && factor.fn === 'pow') { base = stripParens(factor.args[0]); mult = toReal(factor.args[1].evaluate({})); }
      if (!Number.isInteger(mult) || mult < 1) return null;
      const d = parseInt(algebriteRun(`deg(${toAlgebrite(base.toString())},${v})`), 10);
      if (!(d >= 1)) return null;
      groups.push([base.toString(), mult, d]);
    }
    const basis = [];
    groups.forEach(([b, m, d], g) => { for (let j = 1; j <= m; j++) for (let p = 0; p < d; p++) basis.push({ b, j, p, g }); });
    if (!basis.length || basis.length > 24) return null;
    const target = math.compile(`(${num})/(${den}) - (${quo})`);
    const cBasis = basis.map(t => math.compile(`${v}^${t.p} / (${t.b})^${t.j}`));
    const A = [], rhs = [];
    for (let i = 0; A.length < basis.length && i < basis.length * 4; i++) {
      const loc = Object.assign({}, scope, { [v]: 0.5 + i * 0.7314 + (i % 3) * 0.1177 });
      const row = cBasis.map(c => toReal(c.evaluate(loc))), y = toReal(target.evaluate(loc));
      if (row.every(isFinite) && isFinite(y)) { A.push(row); rhs.push(y); }
    }
    const sol = solveL(A, rhs);
    if (!sol) return null;
    const coeffs = sol.map(niceNumber);
    if (coeffs.some(c => c === null)) return null;
    const parts = [];
    if (quo !== '0') parts.push(quo);
    const byGroupPower = {};
    basis.forEach((t, i) => {
      if (coeffs[i] === '0') return;
      const key = `${t.g}:${t.j}`;
      (byGroupPower[key] = byGroupPower[key] || { b: t.b, j: t.j, terms: [] }).terms.unshift(
        t.p === 0 ? coeffs[i] : `${coeffs[i]} * ${v}${t.p > 1 ? '^' + t.p : ''}`);
    });
    Object.values(byGroupPower).forEach(({ b, j, terms }) => {
      parts.push(`(${terms.join(' + ').replace(/\+ -/g, '- ')}) / (${b})${j > 1 ? '^' + j : ''}`);
    });
    const result = parts.join(' + ') || '0';
    if (!numericallyEqual(result, f)) return null;
    const pretty = prettify(result);
    return { plain: pretty, tex: texOf(pretty), den: prettify(fac) };
  } catch { return null; }
}

// ── Factor / expand fallbacks ────────────────────────
export function doExpand(inner) {
  const binom = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); };
  const pm = inner.trim().match(/^\((.+)\)\^(\d+)$/);
  if (pm) {
    const base = pm[1], n = parseInt(pm[2], 10);
    if (n >= 2 && n <= 15) {
      const ts = splitTopLevel(base);
      if (ts.length === 2) {
        const a = ts[0].sign === '-' ? `-(${ts[0].expr})` : ts[0].expr;
        const bSign = ts[1].sign === '-' ? '-' : '', bExpr = ts[1].expr.trim();
        const termParts = [];
        for (let k = 0; k <= n; k++) {
          const c = binom(n, k), ap = n - k, bp = k, parts = [];
          if (c !== 1) parts.push(String(c));
          if (ap === 1) parts.push(`(${a})`); else if (ap > 1) parts.push(`(${a})^${ap}`);
          if (bp === 1) parts.push(`(${bSign}${bExpr})`); else if (bp > 1) parts.push(`(${bSign}${bExpr})^${bp}`);
          termParts.push(parts.length ? parts.join('*') : '1');
        }
        try { return math.parse(termParts.join('+')); } catch {}
      }
    }
  }
  const rules = [
    { l: 'n1*(n2+n3)', r: 'n1*n2+n1*n3' }, { l: '(n1+n2)*n3', r: 'n1*n3+n2*n3' },
    { l: 'n1*(n2-n3)', r: 'n1*n2-n1*n3' }, { l: '(n1-n2)*n3', r: 'n1*n3-n2*n3' },
  ];
  let node = math.parse(inner), prev = '';
  for (let i = 0; i < 12; i++) {
    const s = node.toString();
    if (s === prev) break;
    prev = s;
    try { node = math.simplify(node, rules, {}, { exactFractions: true }); } catch { break; }
  }
  return node;
}
export function doFactor(inner, v) {
  const { roots } = findRoots(`(${inner})`, v, -100, 100);
  if (!roots.length) return null;
  const ratRoots = [];
  for (const r of roots) {
    const s = niceNumber(r);
    if (s === null) continue;
    const rat = math.evaluate(s);
    if (!ratRoots.some(x => Math.abs(x - rat) < 1e-9)) ratRoots.push(rat);
  }
  if (!ratRoots.length) return null;
  const gcdInt = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
  const factors = ratRoots.map(r => {
    if (Math.abs(r) < 1e-12) return `(${v})`;
    const q = asRational(r, 100000);
    if (!q) { const n = Math.round(r); return n > 0 ? `(${v}-${n})` : `(${v}+${-n})`; }
    const g = gcdInt(q.n, q.d), p = q.n / g, d = q.d / g;
    return p > 0 ? `(${d}*${v}-${p})` : `(${d}*${v}+${-p})`;
  });
  const factorExpr = factors.join('*');
  const loc = t => Object.assign({}, scope, { [v]: t });
  try {
    const lc = toReal(math.evaluate(inner, loc(5.77))) / toReal(math.evaluate(factorExpr, loc(5.77)));
    const lcs = niceNumber(lc);
    if (lcs === null) return null;
    const full = lcs === '1' ? factorExpr : lcs === '-1' ? `-(${factorExpr})` : `(${lcs})*(${factorExpr})`;
    return numericallyEqual(full, inner) ? full : null;
  } catch { return null; }
}
