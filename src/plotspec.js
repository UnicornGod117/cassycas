// Parse plot requests shared by plot(...) cells and the Graph view:
//   sin(x), x^2            functions of x (or of their one free variable)
//   x^2 + y^2 = 4          implicit curves in x and y
//   [cos(t), sin(2t)]      parametric curves in t
//   r = 1 + cos(theta)     polar curves in theta (or t)
//   [x, -5, 5]             optional final range for x, t or theta
import { math, parseTopLevelArgs, splitRelation, freeSymbols, normalise } from './expr.js';
import { IDENT_RE } from './state.js';

const LONE_EQ = /(?<![<>!=])=(?!=)/;
const bracket = (s) => /^\[.*\]$/s.test(s.trim()) ? parseTopLevelArgs(s.trim().slice(1, -1)) : null;
const check = (s) => { math.parse(s); return s; };

function isRange(s) {
  const items = bracket(s);
  if (!items || items.length !== 3 || !IDENT_RE.test(items[0])) return null;
  try {
    const a = math.evaluate(items[1]), b = math.evaluate(items[2]);
    if (typeof a === 'number' && typeof b === 'number' && isFinite(a) && isFinite(b) && a < b) return { v: items[0], a, b };
  } catch {}
  return null;
}

export function parsePlotItems(args) {
  args = args.map(a => normalise(a.trim())).filter(Boolean);
  let range = null;
  if (args.length > 1 && isRange(args[args.length - 1])) range = isRange(args.pop());
  if (!args.length) throw new Error('Nothing to plot. Try plot(sin(x), x^2 + y^2 = 4, [cos(t), sin(t)]).');
  if (args.length > 8) throw new Error('At most 8 curves per plot.');
  const items = args.map(s => {
    const pair = bracket(s);
    if (pair) {
      if (pair.length !== 2) throw new Error(`A parametric curve looks like [x(t), y(t)]: ${s}`);
      const v = freeSymbols(`${pair[0]} + ${pair[1]}`).filter(n => n !== 'x' && n !== 'y')[0] || 't';
      return { kind: 'param', x: check(pair[0]), y: check(pair[1]), v, label: s };
    }
    if (LONE_EQ.test(s)) {
      const { lhs, rhs, rel } = splitRelation(s);
      if (rel !== '=') throw new Error('Inequalities cannot be plotted yet.');
      if (lhs === 'r') {
        const v = freeSymbols(rhs).includes('t') && !freeSymbols(rhs).includes('theta') ? 't' : 'theta';
        return { kind: 'polar', r: check(rhs), v, label: s };
      }
      if (lhs === 'y' && !freeSymbols(rhs).includes('y')) return { kind: 'fn', expr: check(rhs), v: 'x', label: s };
      return { kind: 'implicit', expr: check(`(${lhs}) - (${rhs})`), label: s };
    }
    if (splitRelation(s).rel !== '=') throw new Error('Inequalities cannot be plotted yet.');
    const fs = freeSymbols(s);
    const v = fs.includes('x') ? 'x' : fs.length === 1 ? fs[0] : 'x';
    return { kind: 'fn', expr: check(s), v, label: s };
  });
  return { items, range };
}

// LaTeX summary shown as the cell result.
export function plotSpecTex(spec) {
  const tex = (s) => { try { return math.parse(s).toTex({ parenthesis: 'auto' }); } catch { return `\\text{${s}}`; } };
  const one = (it) => it.kind === 'fn' ? `y = ${tex(it.expr)}`
    : it.kind === 'implicit' ? `${tex(it.label.split('=')[0])} = ${tex(it.label.split('=').slice(1).join('='))}`
    : it.kind === 'param' ? `\\left(${tex(it.x)},\\ ${tex(it.y)}\\right)`
    : `r = ${tex(it.r)}`;
  return `\\text{plot}\\quad ${spec.items.map(one).join(',\\quad ')}`;
}
