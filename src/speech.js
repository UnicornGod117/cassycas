// Results read aloud: a plain-text expression in words, for screen readers
// ("x^2 + 1" → "x squared plus 1", "sqrt(2)/2" → "the square root of 2, over 2").
import { math, stripParens } from './expr.js';

const FN = { sqrt: 'the square root of', cbrt: 'the cube root of', sin: 'sine of', cos: 'cosine of', tan: 'tangent of', log: 'log of',
  exp: 'e to the', abs: 'the absolute value of', asin: 'arc sine of', acos: 'arc cosine of', atan: 'arc tangent of', erf: 'the error function of' };
const SYM = { pi: 'pi', e: 'e', i: 'i', Infinity: 'infinity', theta: 'theta', phi: 'phi', alpha: 'alpha', beta: 'beta', lambda: 'lambda' };
const simple = (n) => { n = stripParens(n); return n.isSymbolNode || n.isConstantNode; };

function words(node) {
  const n = stripParens(node);
  if (n.isConstantNode) return String(n.value);
  if (n.isSymbolNode) return SYM[n.name] || n.name.replace(/_/g, ' sub ');
  if (n.isOperatorNode) {
    const [a, b] = n.args;
    switch (n.fn) {
      case 'unaryMinus': return `minus ${words(a)}`;
      case 'add': return n.args.map(words).join(' plus ');
      case 'subtract': return `${words(a)} minus ${words(b)}`;
      case 'multiply': return n.args.map(words).join(simple(a) && n.implicit ? ' ' : ' times ');
      case 'divide': return simple(a) && simple(b) ? `${words(a)} over ${words(b)}` : `${words(a)}, over ${words(b)}`;
      case 'pow': {
        const e = stripParens(b);
        if (e.isConstantNode && e.value === 2) return `${words(a)} squared`;
        if (e.isConstantNode && e.value === 3) return `${words(a)} cubed`;
        return `${words(a)} to the power ${words(b)}`;
      }
      case 'factorial': return `${words(a)} factorial`;
      case 'equal': case 'smaller': case 'larger': case 'smallerEq': case 'largerEq': {
        const rel = { equal: 'equals', smaller: 'is less than', larger: 'is greater than', smallerEq: 'is at most', largerEq: 'is at least' }[n.fn];
        return `${words(a)} ${rel} ${words(b)}`;
      }
    }
    return n.args.map(words).join(` ${n.op} `);
  }
  if (n.isFunctionNode) {
    const f = n.fn.name, args = n.args.map(words);
    if (FN[f]) return `${FN[f]} ${args.join(' and ')}`;
    return `${f} of ${args.join(', ')}`;
  }
  if (n.isArrayNode) return `the list ${n.items.map(words).join(', ')}`;
  if (n.isAssignmentNode) return `${words(n.object)} equals ${words(n.value)}`;
  return n.toString();
}

export function speak(plain) {
  if (!plain) return '';
  return plain.split(/,\s*(?=[A-Za-z]\w* =)|\s+or\s+/).map(part => {
    const t = part.replace(/≈.*/, '').trim();
    const eq = t.match(/^([A-Za-z]\w*)\s*=\s*(.+)$/);
    try {
      return eq ? `${SYM[eq[1]] || eq[1]} equals ${words(math.parse(eq[2]))}` : words(math.parse(t));
    } catch { return t; }
  }).join(', or ');
}
