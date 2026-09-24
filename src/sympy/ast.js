// mathjs expression → JSON tree for the SymPy bridge. Only structural data crosses the
// boundary; the Python side re-validates every node type, operator and name.
import { math, stripParens } from '../expr.js';
import { IDENT_RE } from '../state.js';

const OPS = {
  add: '+', subtract: '-', multiply: '*', divide: '/', pow: '^', mod: '%',
  equal: '==', unequal: '!=', smaller: '<', larger: '>', smallerEq: '<=', largerEq: '>=',
  and: 'and', or: 'or', xor: 'xor', dotMultiply: '*', dotDivide: '/', dotPow: '^',
};
const UNARY = { unaryMinus: 'neg', unaryPlus: 'pos', not: 'not', factorial: '!' };

export class UnsupportedForSympy extends Error {}

export function toAst(input) {
  const node = typeof input === 'string' ? math.parse(input) : input;
  let count = 0;
  const walk = (n) => {
    if (++count > 4000) throw new UnsupportedForSympy('expression too large');
    n = stripParens(n);
    if (n.isConstantNode) {
      if (typeof n.value === 'number') {
        if (!isFinite(n.value)) return { t: 'sym', n: 'Infinity' };
        // Keep the literal's own spelling so 0.1 stays exactly 1/10.
        const raw = String(n.value).replace(/^\+/, '');
        return { t: 'num', v: raw };
      }
      if (typeof n.value === 'boolean') return { t: 'sym', n: String(n.value) };
      throw new UnsupportedForSympy('strings are not supported by the exact engine');
    }
    if (n.isSymbolNode) {
      if (!IDENT_RE.test(n.name)) throw new UnsupportedForSympy('invalid symbol');
      return { t: 'sym', n: n.name };
    }
    if (n.isOperatorNode) {
      if (UNARY[n.fn] && n.args.length === 1) return { t: 'op', op: UNARY[n.fn], args: [walk(n.args[0])] };
      const op = OPS[n.fn];
      if (!op) throw new UnsupportedForSympy('operator ' + n.op + ' is not supported by the exact engine');
      // mathjs flattens a+b+c into one node with 3 args
      const args = n.args.map(walk);
      return args.slice(1).reduce((acc, a) => ({ t: 'op', op, args: [acc, a] }), args[0]);
    }
    if (n.isFunctionNode) {
      if (!n.fn.isSymbolNode) throw new UnsupportedForSympy('unsupported call');
      return { t: 'fn', n: n.fn.name, args: n.args.map(walk) };
    }
    if (n.isArrayNode) {
      if (n.items.length && n.items.every(i => stripParens(i).isArrayNode))
        return { t: 'mat', rows: n.items.map(r => stripParens(r).items.map(walk)) };
      return { t: 'vec', items: n.items.map(walk) };
    }
    throw new UnsupportedForSympy(`${n.type} is not supported by the exact engine`);
  };
  return walk(node);
}

// y'' + y = 0  →  __deriv(y, 2) + y = 0   (for dsolve; the bridge resolves the variable)
export function expandPrimes(expr, fname) {
  return expr.replace(new RegExp(`\\b${fname}('+)(\\(\\s*[A-Za-z_]\\w*\\s*\\))?`, 'g'), (m, primes) => `__deriv(${fname}, ${primes.length})`)
             .replace(new RegExp(`\\b${fname}\\s*\\(\\s*[A-Za-z_]\\w*\\s*\\)`, 'g'), fname);
}
