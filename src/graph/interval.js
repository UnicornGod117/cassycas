// Interval arithmetic for plotting: compile a mathjs expression into a function that maps
// interval arguments ([lo, hi] pairs) to an interval guaranteed to contain every value of the
// expression on that box. Every bound is pushed outward after each operation (by one ulp for
// + − × ÷ √, which IEEE 754 rounds correctly, and by a few ulps for Math.sin, Math.exp, … whose
// accuracy the platform does not promise to the last bit), so the enclosure holds up to that
// stated tolerance. Unsupported functions make compileInterval return null.
import { math, stripParens } from '../expr.js';

const buf = new DataView(new ArrayBuffer(8));
function nextUp(x) {
  if (Number.isNaN(x) || x === Infinity) return x;
  if (x === 0) return Number.MIN_VALUE;
  buf.setFloat64(0, x);
  let b = buf.getBigUint64(0);
  b = x > 0 ? b + 1n : b - 1n;
  buf.setBigUint64(0, b);
  return buf.getFloat64(0);
}
const nextDown = (x) => -nextUp(-x);
const ULPS = 4;      // margin for the elementary functions
const out = (lo, hi, k = 1) => { for (let i = 0; i < k; i++) { lo = nextDown(lo); hi = nextUp(hi); } return [lo, hi]; };
const ENTIRE = [-Infinity, Infinity];
const pt = (v) => [v, v];

const I = {
  add: (a, b) => out(a[0] + b[0], a[1] + b[1]),
  sub: (a, b) => out(a[0] - b[1], a[1] - b[0]),
  mul: (a, b) => {
    const p = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]].map(v => Number.isNaN(v) ? 0 : v);
    return out(Math.min(...p), Math.max(...p));
  },
  div: (a, b) => {
    if (b[0] <= 0 && b[1] >= 0) return ENTIRE;
    return I.mul(a, out(1 / b[1], 1 / b[0]));
  },
  neg: (a) => [-a[1], -a[0]],
  ipow: (a, n) => {
    if (n === 0) return [1, 1];
    if (n < 0) return I.div([1, 1], I.ipow(a, -n));
    const lo = a[0] ** n, hi = a[1] ** n;
    if (n % 2 === 1) return out(lo, hi, ULPS);
    if (a[0] >= 0) return out(lo, hi, ULPS);
    if (a[1] <= 0) return out(hi, lo, ULPS);
    return [0, nextUp(Math.max(lo, hi) * (1 + 1e-15))];
  },
  sqrt: (a) => a[1] < 0 ? null : out(Math.sqrt(Math.max(0, a[0])), Math.sqrt(a[1])),
  exp: (a) => out(Math.exp(a[0]), Math.exp(a[1]), ULPS),
  log: (a) => a[1] <= 0 ? null : out(a[0] <= 0 ? -Infinity : Math.log(a[0]), Math.log(a[1]), ULPS),
  abs: (a) => a[0] >= 0 ? a : a[1] <= 0 ? [-a[1], -a[0]] : [0, Math.max(-a[0], a[1])],
  atan: (a) => out(Math.atan(a[0]), Math.atan(a[1]), ULPS),
  tanh: (a) => out(Math.tanh(a[0]), Math.tanh(a[1]), ULPS),
  sinh: (a) => out(Math.sinh(a[0]), Math.sinh(a[1]), ULPS),
  cosh: (a) => { const m = I.abs(a); return out(Math.cosh(m[0]), Math.cosh(m[1]), ULPS); },
  sin: (a) => I.cos(I.sub(a, pt(Math.PI / 2))),
  cos: (a) => {
    if (!(a[1] - a[0] < 2 * Math.PI)) return [-1, 1];
    // extrema of cos are at kπ: max (1) at even k, min (−1) at odd k
    const k0 = Math.ceil(a[0] / Math.PI), k1 = Math.floor(a[1] / Math.PI);
    let lo = Math.min(Math.cos(a[0]), Math.cos(a[1])), hi = Math.max(Math.cos(a[0]), Math.cos(a[1]));
    for (let k = k0; k <= k1; k++) { if (k % 2 === 0) hi = 1; else lo = -1; }
    const r = out(lo, hi, ULPS);
    return [Math.max(-1, r[0]), Math.min(1, r[1])];
  },
  tan: (a) => {
    // poles at π/2 + kπ
    const k = Math.ceil((a[0] - Math.PI / 2) / Math.PI);
    if (Math.PI / 2 + k * Math.PI <= a[1]) return ENTIRE;
    return out(Math.tan(a[0]), Math.tan(a[1]), ULPS);
  },
  min: (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
  max: (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  floor: (a) => [Math.floor(a[0]), Math.floor(a[1])],
  ceil: (a) => [Math.ceil(a[0]), Math.ceil(a[1])],
};
I.pow = (a, b) => {
  if (b[0] === b[1] && Number.isInteger(b[0])) return I.ipow(a, b[0]);
  if (b[0] === b[1] && b[0] === 0.5) return I.sqrt(a);
  if (a[1] <= 0) return null;                       // real powers need a positive base
  return I.exp(I.mul(b, I.log([Math.max(a[0], Number.MIN_VALUE), a[1]])));
};
const UNARY = { sqrt: I.sqrt, exp: I.exp, log: I.log, abs: I.abs, sin: I.sin, cos: I.cos, tan: I.tan, atan: I.atan,
  sinh: I.sinh, cosh: I.cosh, tanh: I.tanh, floor: I.floor, ceil: I.ceil };
const CONSTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2 };

// mathjs node → (env) => interval | null. env maps variable names to intervals.
export function compileInterval(node, vars) {
  const walk = (n) => {
    n = stripParens(n);
    if (n.isConstantNode && typeof n.value === 'number') { const v = n.value; return () => (Number.isInteger(v) ? pt(v) : out(v, v)); }
    if (n.isSymbolNode) {
      if (vars.includes(n.name)) { const name = n.name; return (env) => env[name]; }
      if (n.name in CONSTS) { const v = CONSTS[n.name]; return () => out(v, v); }
      throw new Error('unknown symbol');
    }
    if (n.isOperatorNode) {
      const args = n.args.map(walk);
      const op = { add: I.add, subtract: I.sub, multiply: I.mul, divide: I.div, pow: I.pow, unaryMinus: I.neg, unaryPlus: (a) => a }[n.fn];
      if (!op) throw new Error('unsupported operator');
      if (n.fn === 'pow') {
        const e = stripParens(n.args[1]);
        if (e.isConstantNode && Number.isInteger(e.value)) { const k = e.value, base = args[0]; return (env) => { const a = base(env); return a && I.ipow(a, k); }; }
      }
      if (args.length === 1) return (env) => { const a = args[0](env); return a && op(a); };
      return (env) => {
        let acc = args[0](env);
        for (let i = 1; i < args.length && acc; i++) { const b = args[i](env); acc = b && op(acc, b); }
        return acc;
      };
    }
    if (n.isFunctionNode && n.fn.isSymbolNode) {
      const name = n.fn.name, args = n.args.map(walk);
      if (UNARY[name] && args.length === 1) return (env) => { const a = args[0](env); return a && UNARY[name](a); };
      if ((name === 'min' || name === 'max') && args.length === 2) return (env) => { const a = args[0](env), b = args[1](env); return a && b && I[name](a, b); };
      if (name === 'nthRoot' && args.length === 2) return (env) => { const a = args[0](env), k = args[1](env); return a && k && I.pow(a, I.div([1, 1], k)); };
      throw new Error('unsupported function ' + name);
    }
    throw new Error('unsupported');
  };
  try {
    const f = walk(typeof node === 'string' ? math.parse(node) : node);
    return (...ivs) => { const env = {}; vars.forEach((v, i) => { env[v] = ivs[i]; }); const r = f(env); return r && r.every(x => !Number.isNaN(x)) ? r : null; };
  } catch { return null; }
}
export { I as intervalOps, nextUp, nextDown };
