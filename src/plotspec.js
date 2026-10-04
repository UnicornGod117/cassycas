// Parse plot requests shared by plot(...) cells and the Graph view:
//   sin(x), x^2               functions of x (or of their one free variable)
//   y = 2x + 1                explicit functions written as equations
//   x^2 + y^2 = 4, x = 3      implicit curves in x and y
//   y < x^2, x^2 + y^2 <= 9   inequalities (shaded regions)
//   [cos(t), sin(2t)]         parametric curves in t
//   r = 1 + cos(theta)        polar curves in theta (or t)
//   point(1, 2)               points
//   slopefield(x - y)         slope field of y' = f(x, y)
//   vectorfield([-y, x])      vector field (P, Q)
//   domaincolor(z^2 - 1)      complex function, by domain colouring
//   [x, -5, 5]                optional final range for x, t or theta
import { math, parseTopLevelArgs, splitRelation, freeSymbols, normalise, xarg } from './expr.js';
import { IDENT_RE } from './state.js';

const LONE_EQ = /(?<![<>!=])=(?!=)/;
const bracket = (s) => /^\[.*\]$/s.test(s.trim()) ? parseTopLevelArgs(s.trim().slice(1, -1)) : null;
const check = (s) => { math.parse(s); return s; };
const FLIP = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' };

function isRange(s) {
  const items = bracket(s);
  if (!items || items.length !== 3 || !IDENT_RE.test(items[0])) return null;
  try {
    const a = math.evaluate(items[1]), b = math.evaluate(items[2]);
    if (typeof a === 'number' && typeof b === 'number' && isFinite(a) && isFinite(b) && a < b) return { v: items[0], a, b };
  } catch {}
  return null;
}
const call = (s, name) => new RegExp(`^${name}\\s*\\(`).test(s) ? parseTopLevelArgs(xarg(s, name)) : null;

function item(s) {
  let a;
  if ((a = call(s, 'point'))) {
    if (a.length !== 2) throw new Error('A point looks like point(1, 2).');
    return { kind: 'point', x: check(a[0]), y: check(a[1]), label: s };
  }
  if ((a = call(s, 'slopefield'))) return { kind: 'slope', expr: check(a[0]), label: `y′ = ${a[0]}` };
  if ((a = call(s, 'vectorfield'))) {
    const pq = a.length === 1 ? bracket(a[0]) : a;
    if (!pq || pq.length !== 2) throw new Error('A vector field looks like vectorfield([P, Q]).');
    return { kind: 'vector', P: check(pq[0]), Q: check(pq[1]), label: s };
  }
  if ((a = call(s, 'domaincolor'))) return { kind: 'domain', expr: check(a[0]), v: 'z', label: s };
  const pair = bracket(s);
  if (pair) {
    if (pair.length !== 2) throw new Error(`A parametric curve looks like [x(t), y(t)]: ${s}`);
    const v = freeSymbols(`${pair[0]} + ${pair[1]}`).filter(n => n !== 'x' && n !== 'y')[0] || 't';
    return { kind: 'param', x: check(pair[0]), y: check(pair[1]), v, label: s };
  }
  const { lhs, rhs, rel } = splitRelation(s);
  if (rel === '!=') throw new Error('≠ cannot be plotted.');
  if (LONE_EQ.test(s) || rel !== '=') {
    const has = (t, n) => freeSymbols(t).includes(n);
    if (rel === '=' && lhs === 'r') {
      const v = has(rhs, 't') && !has(rhs, 'theta') ? 't' : 'theta';
      return { kind: 'polar', r: check(rhs), v, label: s };
    }
    if (lhs === 'y' && !has(rhs, 'y')) return rel === '=' ? { kind: 'fn', expr: check(rhs), v: 'x', label: s } : { kind: 'ineq-fn', expr: check(rhs), rel, label: s };
    if (rhs === 'y' && !has(lhs, 'y')) return rel === '=' ? { kind: 'fn', expr: check(lhs), v: 'x', label: s } : { kind: 'ineq-fn', expr: check(lhs), rel: FLIP[rel], label: s };
    const expr = check(`(${lhs}) - (${rhs})`);
    return rel === '=' ? { kind: 'implicit', expr, label: s } : { kind: 'ineq', expr, rel, label: s };
  }
  const fs = freeSymbols(s);
  const v = fs.includes('x') ? 'x' : fs.length === 1 ? fs[0] : 'x';
  return { kind: 'fn', expr: check(s), v, label: s };
}

export function parsePlotItems(args) {
  args = args.map(a => normalise(a.trim())).filter(Boolean);
  let range = null;
  if (args.length > 1 && isRange(args[args.length - 1])) range = isRange(args.pop());
  if (!args.length) throw new Error('Nothing to plot. Try plot(sin(x), x^2 + y^2 = 4, [cos(t), sin(t)]).');
  if (args.length > 8) throw new Error('At most 8 items per plot.');
  return { items: args.map(item), range };
}

// LaTeX summary shown as the cell result.
export function plotSpecTex(spec) {
  const tex = (s) => { try { return math.parse(s).toTex({ parenthesis: 'auto' }); } catch { return `\\text{${s}}`; } };
  const REL = { '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge' };
  const one = (it) => {
    switch (it.kind) {
      case 'fn': return `y = ${tex(it.expr)}`;
      case 'ineq-fn': return `y ${REL[it.rel]} ${tex(it.expr)}`;
      case 'implicit': case 'ineq': {
        const { lhs, rhs, rel } = splitRelation(it.label);
        return `${tex(lhs)} ${rel === '=' ? '=' : REL[rel]} ${tex(rhs)}`;
      }
      case 'param': return `\\left(${tex(it.x)},\\ ${tex(it.y)}\\right)`;
      case 'polar': return `r = ${tex(it.r)}`;
      case 'point': return `\\left(${tex(it.x)},\\ ${tex(it.y)}\\right)`;
      case 'slope': return `y' = ${tex(it.expr)}`;
      case 'vector': return `\\vec F = \\left(${tex(it.P)},\\ ${tex(it.Q)}\\right)`;
      case 'domain': return `w = ${tex(it.expr)}`;
      default: return '';
    }
  };
  return `\\text{plot}\\quad ${spec.items.map(one).join(',\\quad ')}`;
}
