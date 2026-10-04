// Compile a mathjs expression tree into a plain JavaScript function of real numbers, for the
// grapher's hot loops (an implicit curve needs ~100 000 evaluations per frame; the mathjs
// interpreter is 20–50× slower than native code).
//
// Only a whitelist of node types, operators, functions and names is translated; anything else
// makes compileReal return null and the caller falls back to mathjs. Variable names never reach
// the generated source (they become v0, v1, …), and numbers are emitted with Number→String, so
// user input cannot inject code.
import { math, stripParens } from '../expr.js';

// Real power: negative bases with odd-denominator rational exponents give the real root
// (Desmos-style cube roots), everything else follows Math.pow.
function rpow(a, b) {
  if (a >= 0 || Number.isInteger(b)) return Math.pow(a, b);
  for (let q = 3; q <= 15; q += 2) {
    const p = b * q;
    if (Math.abs(p - Math.round(p)) < 1e-9) return (Math.round(p) % 2 === 0 ? 1 : -1) * Math.pow(-a, b);
  }
  return NaN;
}
function erf(x) {   // Abramowitz–Stegun 7.1.26, |error| < 1.5e-7 (plenty for pixels)
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function gamma(x) {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}
const H = {
  rpow, erf, gamma,
  log: (x, b) => b === undefined ? Math.log(x) : Math.log(x) / Math.log(b),
  mod: (a, b) => a - b * Math.floor(a / b),
  nthRoot: (x, n) => rpow(x, 1 / n),
  sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
  asec: (x) => Math.acos(1 / x), acsc: (x) => Math.asin(1 / x), acot: (x) => Math.atan(1 / x),
  sech: (x) => 1 / Math.cosh(x), csch: (x) => 1 / Math.sinh(x), coth: (x) => 1 / Math.tanh(x),
  heaviside: (x) => x > 0 ? 1 : x < 0 ? 0 : 0.5,
  factorial: (n) => gamma(n + 1),
  round: (x) => Math.round(x),
};
const MATH_FN = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'exp', 'sqrt', 'abs', 'floor', 'ceil', 'sign', 'cbrt', 'atan2', 'max', 'min', 'log10', 'log2', 'hypot'];
const H_FN = ['log', 'mod', 'nthRoot', 'sec', 'csc', 'cot', 'asec', 'acsc', 'acot', 'sech', 'csch', 'coth', 'heaviside', 'factorial', 'erf', 'gamma', 'round'];
const CONSTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2, Infinity: Infinity };
const BIN = { add: '+', subtract: '-', multiply: '*', divide: '/' };
const CMP = { smaller: '<', larger: '>', smallerEq: '<=', largerEq: '>=', equal: '===', unequal: '!==' };

class Unsupported extends Error {}

function emit(node, vars) {
  const n = stripParens(node);
  if (n.isConstantNode) {
    if (typeof n.value !== 'number') throw new Unsupported();
    return Number.isFinite(n.value) ? `(${String(n.value)})` : (n.value > 0 ? 'Infinity' : '(-Infinity)');
  }
  if (n.isSymbolNode) {
    const i = vars.indexOf(n.name);
    if (i >= 0) return `v${i}`;
    if (n.name in CONSTS) return `(${String(CONSTS[n.name])})`;
    throw new Unsupported();
  }
  if (n.isOperatorNode) {
    const a = n.args.map(x => emit(x, vars));
    if (n.fn === 'unaryMinus') return `(-${a[0]})`;
    if (n.fn === 'unaryPlus') return a[0];
    if (n.fn === 'pow' || n.fn === 'dotPow') return `H.rpow(${a[0]},${a[1]})`;
    if (n.fn === 'mod') return `H.mod(${a[0]},${a[1]})`;
    if (n.fn === 'factorial') return `H.factorial(${a[0]})`;
    const op = BIN[n.fn] || BIN[n.fn.replace(/^dot/, '').toLowerCase()];
    if (op) return `(${a.join(op)})`;
    if (CMP[n.fn] && a.length === 2) return `((${a[0]}${CMP[n.fn]}${a[1]})?1:0)`;
    throw new Unsupported();
  }
  if (n.isConditionalNode) return `((${emit(n.condition, vars)})?(${emit(n.trueExpr, vars)}):(${emit(n.falseExpr, vars)}))`;
  if (n.isFunctionNode && n.fn.isSymbolNode) {
    const name = n.fn.name, a = n.args.map(x => emit(x, vars));
    if (MATH_FN.includes(name)) return `Math.${name}(${a.join(',')})`;
    if (H_FN.includes(name)) return `H.${name}(${a.join(',')})`;
    throw new Unsupported();
  }
  throw new Unsupported();
}

// node: mathjs node (or source); vars: names of the arguments, in order.
// Returns (…numbers) => number, or null when the expression needs the mathjs interpreter.
export function compileReal(node, vars) {
  try {
    const tree = typeof node === 'string' ? math.parse(node) : node;
    const body = emit(tree, vars);
    const args = vars.map((_, i) => `v${i}`).join(',');
    // eslint-disable-next-line no-new-func
    return new Function('H', `"use strict";return (${args})=>{const r=${body};return typeof r==='number'?r:NaN;}`)(H);
  } catch (e) {
    if (e instanceof Unsupported || e instanceof SyntaxError) return null;
    throw e;
  }
}

// A real-valued function of `vars`: the JIT version when possible, else mathjs (complex results
// with a negligible imaginary part count as real).
export function realFunction(node, vars, scope = {}) {
  const fast = compileReal(node, vars);
  if (fast) return fast;
  const compiled = (typeof node === 'string' ? math.parse(node) : node).compile();
  return (...xs) => {
    const loc = Object.assign({}, scope);
    vars.forEach((v, i) => { loc[v] = xs[i]; });
    try {
      const y = compiled.evaluate(loc);
      if (typeof y === 'number') return y;
      if (y && y.isComplex) return Math.abs(y.im) < 1e-9 * (1 + Math.abs(y.re)) ? y.re : NaN;
      if (typeof y === 'boolean') return y ? 1 : 0;
      return NaN;
    } catch { return NaN; }
  };
}
