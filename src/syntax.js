// Input front end: whatever people type → CassyCAS input.
// Runs before everything else and understands, in this order:
//   plain English        "integral of x^2 from 0 to 1", "limit of sin(x)/x as x -> 0"
//   Mathematica          D[x^3, x], Integrate[f, {x, 0, 1}], Solve[x^2 == 4, x]
//   LaTeX (pasted)       \frac{d}{dx} x^2, \int_0^1 x^2 \, dx, \sqrt{2}, \lim_{x \to 0}
//   Leibniz and ∫        d/dx x^3, d^2/dx^2 sin(x), ∫ x^2 dx, ∫_0^1 x dx
//   everyday notation    sin x, sin^2(x), sin^-1 x, |x - 3|, x², √x, 2·3, f'(x), x := 3
// Every rewrite produces ordinary CassyCAS calls, so the result is shown (and can be edited)
// in canonical form. Nothing here evaluates anything.
import { userFns } from './state.js';

const FUNCS = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'asec', 'acsc', 'acot',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'log', 'ln', 'exp', 'sqrt', 'abs', 'lg'];
const TRIG_INVERSE = { sin: 'asin', cos: 'acos', tan: 'atan', sec: 'asec', csc: 'acsc', cot: 'acot', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh' };
const GREEK = { α: 'alpha', β: 'beta', γ: 'gamma_', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota',
  κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', ρ: 'rho', σ: 'sigma', ς: 'sigma', υ: 'upsilon', χ: 'chi', ψ: 'psi', ω: 'omega',
  Δ: 'Delta', Ω: 'Omega', Σ: 'Sigma', Γ: 'Gamma', Λ: 'Lambda', Φ: 'Phi', Ψ: 'Psi', Θ: 'Theta', φ: 'phi', ϕ: 'phi', π: 'pi', τ: 'tau' };
const SUPERSCRIPT = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+', 'ⁿ': 'n', 'ˣ': 'x' };

// Other names people use for the same functions (applied unless the user defined that name).
export const ALIASES = {
  eigenvals: 'eigs', eigenvalues: 'eigs', eigenvects: 'eigs', eigenvectors: 'eigs', eig: 'eigs', eigen: 'eigs',
  determinant: 'det', inverse: 'inv', integral: 'integrate', int: 'integrate', antiderivative: 'integrate',
  deriv: 'derivative', differentiate: 'derivative', lim: 'limit', factorise: 'factor', simplfy: 'simplify',
  nCr: 'combinations', choose: 'combinations', binom: 'combinations', nPr: 'permutations', gcf: 'gcd', hcf: 'gcd',
  arcsec: 'asec', arccsc: 'acsc', arccot: 'acot', root: 'nthRoot', partialfractions: 'apart', taylorseries: 'series',
  trigexpand: 'expand_trig', expandtrig: 'expand_trig', trigreduce: 'trigsimp', nthroot: 'nthRoot',
};

// ── helpers ──────────────────────────────────────────────────────────────
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Index of the bracket that closes the one at `open`, or -1.
export function matchBracket(s, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const want = pairs[s[open]];
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return c === want ? i : -1; }
  }
  return -1;
}
function splitArgs(inner) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= inner.length; i++) {
    const c = i < inner.length ? inner[i] : ',';
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { out.push(inner.slice(start, i).trim()); start = i + 1; }
  }
  return out.filter((a, i, all) => a !== '' || all.length > 1);
}
const wrap = (s) => /^[\w.]+$/.test(s.trim()) ? s.trim() : `(${s.trim()})`;

// The operand of a function written without parentheses ("sin 2x", "log x^2"): a call, a
// parenthesised group, or [coefficient][name][^power]. Returns its end index.
function operandEnd(s, i) {
  while (s[i] === ' ') i++;
  const start = i;
  if (s[i] === '(') { const j = matchBracket(s, i); return j < 0 ? -1 : j + 1; }
  const m = s.slice(i).match(/^(\d+(?:\.\d+)?)?\s*([A-Za-z_]\w*)?/);
  if (!m || !m[0].trim()) return -1;
  i += m[0].length;
  if (m[2] && s[i] === '(') { const j = matchBracket(s, i); if (j < 0) return -1; i = j + 1; }
  const p = s.slice(i).match(/^\^(\d+|[A-Za-z]\w*|\([^()]*\))/);
  if (p) i += p[0].length;
  return i > start ? i : -1;
}

// ── plain English ────────────────────────────────────────────────────────
const VAR_PHRASE = '(?:with respect to|wrt|w\\.r\\.t\\.?|in|for)\\s+([A-Za-z_]\\w*)';
function guessVar(expr) {
  const names = (expr.match(/[A-Za-z_]\w*/g) || []).filter(n => !FUNCS.includes(n) && !['pi', 'e', 'i', 'Infinity', 'oo', 'inf', 'dx', 'dy', 'dt'].includes(n));
  if (names.includes('x')) return 'x';
  const uniq = [...new Set(names)];
  return uniq.length === 1 ? uniq[0] : 'x';
}
const ORDINAL = { second: 2, third: 3, fourth: 4, fifth: 5, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 };
const POINT_WORDS = '(?:->|→|to|approaches|goes to|tends to|tending to|approaching)';

export function fromEnglish(raw) {
  let s = raw.trim().replace(/\?+$/, '').replace(/(?<=[A-Za-z])\.$/, '').trim();
  s = s.replace(/^(?:please\s+)?(?:what\s+is|what's|whats|calculate|compute|evaluate|find|determine|give me|show me|work out)\s+(?:the\s+)?/i, '');
  let m;
  // derivative
  if ((m = s.match(new RegExp(`^(?:the\\s+)?(?:(second|third|fourth|fifth|2nd|3rd|4th|5th)\\s+)?(?:derivative|differential)\\s+of\\s+(.+?)(?:\\s+${VAR_PHRASE})?$`, 'i')))) {
    const v = m[3] || guessVar(m[2]);
    return `derivative(${m[2]}, ${v}${m[1] ? ', ' + ORDINAL[m[1].toLowerCase()] : ''})`;
  }
  if ((m = s.match(new RegExp(`^differentiate\\s+(.+?)(?:\\s+${VAR_PHRASE})?(?:\\s+(twice|three times))?$`, 'i')))) {
    const v = m[2] || guessVar(m[1]);
    return `derivative(${m[1]}, ${v}${m[3] ? ', ' + (m[3].toLowerCase() === 'twice' ? 2 : 3) : ''})`;
  }
  // integral
  if ((m = s.match(/^(?:the\s+)?(?:definite\s+|indefinite\s+)?(?:integral|antiderivative|integrate)\s+(?:of\s+)?(.+?)(?:\s*d([A-Za-z]))?(?:\s+(?:with respect to|wrt|w\.r\.t\.?)\s+([A-Za-z_]\w*))?(?:\s+(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+))?$/i))) {
    const f = m[1].trim(), v = m[2] || m[3] || guessVar(f);
    return m[4] !== undefined ? `integrate(${f}, ${v}, ${m[4].trim()}, ${m[5].trim()})` : `integrate(${f}, ${v})`;
  }
  if ((m = s.match(/^(?:the\s+)?area\s+under\s+(.+?)\s+(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+)$/i))) {
    const f = m[1].replace(/^(?:the\s+curve\s+)?(?:y\s*=\s*)?/i, '');
    return `integrate(${f}, ${guessVar(f)}, ${m[2]}, ${m[3]})`;
  }
  // limit
  if ((m = s.match(/^lim(?:it)?\s*_?\s*\{?\s*([A-Za-z])\s*(?:->|→|⟶|to)\s*([^\s{}]+?)\s*(\^?[+-])?\s*\}?\s+(.+)$/i))) {
    const side = m[3] ? `, "${m[3].replace('^', '')}"` : '';
    return `limit(${m[4]}, ${m[1]}, ${m[2]}${side})`;
  }
  if ((m = s.match(new RegExp(`^(?:the\\s+)?(?:limit|lim)\\s+(?:as|when)\\s+([A-Za-z_]\\w*)\\s*${POINT_WORDS}\\s*(.+?)\\s+of\\s+(.+)$`, 'i'))))
    return `limit(${m[3]}, ${m[1]}, ${m[2].trim()})`;
  if ((m = s.match(new RegExp(`^(?:the\\s+)?(?:limit|lim)\\s+(?:of\\s+)?(.+?)\\s+(?:as|when|for)\\s+([A-Za-z_]\\w*)\\s*${POINT_WORDS}\\s*(.+?)(?:\\s+from\\s+(?:the\\s+)?(left|right|below|above))?\\s*([+-])?$`, 'i')))) {
    const side = m[4] ? (/left|below/i.test(m[4]) ? '"-"' : '"+"') : m[5] ? `"${m[5]}"` : null;
    return `limit(${m[1]}, ${m[2]}, ${m[3].trim()}${side ? ', ' + side : ''})`;
  }
  // solving; "x + y = 7 and x - y = 1" is a system
  if (/=.*\s+and\s+.*=/i.test(s) && s.split(/\s+and\s+/i).every(p => /(?<![<>!=])=(?!=)/.test(p)))
    s = s.split(/\s+and\s+/i).join(', ');
  if ((m = s.match(/^solve\s+(.+?)\s+for\s+([A-Za-z_]\w*)$/i))) return `solve(${m[1]}, ${m[2]})`;
  if ((m = s.match(/^solve\s+(?!\()(.+)$/i)) && !/^\(/.test(m[1])) return `solve(${m[1]})`;
  if ((m = s.match(/^(?:the\s+)?(?:roots|zeros|zeroes|solutions)\s+of\s+(.+)$/i))) {
    const f = m[1];
    return /(?<![<>!=])=(?!=)/.test(f) ? `solve(${f})` : `solve(${f} = 0, ${guessVar(f)})`;
  }
  // series
  if ((m = s.match(/^(?:the\s+)?(?:taylor|maclaurin|power)\s+(?:series|expansion|polynomial)\s+(?:of|for)\s+(.+?)(?:\s+(?:at|around|about|near)\s+(?:([A-Za-z_]\w*)\s*=\s*)?([^\s]+))?(?:\s+(?:to|up to|of)\s+(?:order|degree)\s+(\d+))?$/i))) {
    const f = m[1], v = m[2] || guessVar(f);
    return `series(${f}, ${v}, ${m[3] || 0}${m[4] ? ', ' + m[4] : ''})`;
  }
  // sums and products
  if ((m = s.match(/^(?:the\s+)?(sum|product)\s+of\s+(.+?)\s+(?:for|from|as)\s+([A-Za-z_]\w*)\s*(?:=|from)\s*(.+?)\s+to\s+(.+)$/i)))
    return `${m[1].toLowerCase()}(${m[2]}, ${m[3]}, ${m[4]}, ${m[5]})`;
  // algebra verbs
  if ((m = s.match(/^(simplify|expand|factor|factorise|factorize|rationalize|apart)\s+(?!\()(.+)$/i))) {
    const verb = { factorise: 'factor', factorize: 'factor' }[m[1].toLowerCase()] || m[1].toLowerCase();
    if (verb === 'factor' && /^\s*-?\d+\s*$/.test(m[2])) return `factorint(${m[2].trim()})`;
    return `${verb}(${m[2]})`;
  }
  if ((m = s.match(/^(?:the\s+)?(?:prime\s+)?factori[sz]ation\s+of\s+(-?\d+)$/i))) return `factorint(${m[1]})`;
  if ((m = s.match(/^(?:the\s+)?partial[\s-]+fractions?\s+(?:decomposition\s+)?(?:of\s+)?(.+)$/i))) return `apart(${m[1]})`;
  if ((m = s.match(/^is\s+(\d+)\s+(?:a\s+)?prime(?:\s+number)?$/i))) return `isprime(${m[1]})`;
  if ((m = s.match(/^(?:the\s+)?(gcd|lcm|greatest common divisor|least common multiple|highest common factor)\s+of\s+(.+?)\s+and\s+(.+)$/i))) {
    const fn = /lcm|least/i.test(m[1]) ? 'lcm' : 'gcd';
    return `${fn}(${m[2]}, ${m[3]})`;
  }
  // graphs
  if ((m = s.match(/^(?:plot|graph|draw|sketch)\s+(?:the\s+)?(?:graph\s+of\s+)?(.+?)(?:\s+(?:from|for)\s+(?:([A-Za-z_]\w*)\s*=\s*)?(.+?)\s+to\s+(.+))?$/i))) {
    const f = m[1];
    return m[3] !== undefined ? `plot(${f}, [${m[2] || guessVar(f)}, ${m[3]}, ${m[4]}])` : `plot(${f})`;
  }
  // evaluation at a point
  if ((m = s.match(/^(.+?)\s+(?:at|when|for|where)\s+([A-Za-z_]\w*\s*=.+)$/i)) && !/^(solve|limit|integrate|plot)\b/i.test(m[1])) {
    const pairs = splitArgs(m[2].replace(/\s+and\s+/gi, ', ')).map(p => p.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/));
    if (pairs.every(Boolean)) return `subs(${m[1]}, ${pairs.map(p => `${p[1]}, ${p[2].trim()}`).join(', ')})`;
  }
  if ((m = s.match(/^(?:the\s+)?(?:square\s+root|sqrt)\s+of\s+(.+)$/i))) return `sqrt(${m[1]})`;
  if ((m = s.match(/^(?:the\s+)?(?:absolute value|modulus)\s+of\s+(.+)$/i))) return `abs(${m[1]})`;
  return s;
}

// ── Mathematica ──────────────────────────────────────────────────────────
const MMA_FUNCS = {
  Sin: 'sin', Cos: 'cos', Tan: 'tan', Sec: 'sec', Csc: 'csc', Cot: 'cot', ArcSin: 'asin', ArcCos: 'acos', ArcTan: 'atan',
  Sinh: 'sinh', Cosh: 'cosh', Tanh: 'tanh', ArcSinh: 'asinh', ArcCosh: 'acosh', ArcTanh: 'atanh',
  Exp: 'exp', Log: 'log', Sqrt: 'sqrt', Abs: 'abs', Floor: 'floor', Ceiling: 'ceil', Round: 'round', Sign: 'sign',
  Factorial: 'factorial', Gamma: 'gamma', Erf: 'erf', Binomial: 'combinations', Mod: 'mod', GCD: 'gcd', LCM: 'lcm',
  Re: 're', Im: 'im', Conjugate: 'conj', Arg: 'arg', Max: 'max', Min: 'min',
  Simplify: 'simplify', FullSimplify: 'simplify', Expand: 'expand', Factor: 'factor', Together: 'together', Apart: 'apart',
  Cancel: 'cancel', Collect: 'collect', TrigReduce: 'trigsimp', TrigExpand: 'expand_trig',
  Det: 'det', Inverse: 'inv', Transpose: 'transpose', Tr: 'trace', MatrixRank: 'rank', Eigenvalues: 'eigs', Eigensystem: 'eigs',
  RowReduce: 'rref', NullSpace: 'nullspace', CharacteristicPolynomial: 'charpoly', Cross: 'cross', Dot: 'dot', Norm: 'norm',
  PrimeQ: 'isprime', FactorInteger: 'factorint', Prime: 'prime', NextPrime: 'nextprime', PrimePi: 'primepi', Divisors: 'divisors',
  EulerPhi: 'totient', MoebiusMu: 'mobius', PowerMod: 'powmod', ChineseRemainder: 'crt', Fibonacci: 'fibonacci',
  LucasL: 'lucas', CatalanNumber: 'catalan', BernoulliB: 'bernoulli', PartitionsP: 'partition', ContinuedFraction: 'contfrac',
  Resultant: 'resultant', Discriminant: 'discriminant', Exponent: 'degree', CoefficientList: 'coeffs', GroebnerBasis: 'groebner',
  LaplaceTransform: 'laplace', InverseLaplaceTransform: 'invlaplace', FourierTransform: 'fourier', InverseFourierTransform: 'invfourier',
  Residue: 'residue', Grad: 'gradient', Div: 'divergence', Curl: 'curl', Laplacian: 'laplacian', JacobianMatrix: 'jacobian',
  N: 'N', ComplexExpand: 'rect', PolynomialQuotient: 'polydiv',
};
const MMA_CONST = { Pi: 'pi', E: 'e', I: 'i', Infinity: 'Infinity', GoldenRatio: 'phi', Degree: 'deg' };
const isMma = (s) => /\b[A-Z][A-Za-z]*\[/.test(s) || /^\s*[A-Za-z]\w*\[[^\]]*_\]\s*:=/.test(s);

// {x, a, b} → [x, a, b] pieces
const listParts = (s) => { s = s.trim(); return s.startsWith('{') && s.endsWith('}') ? splitArgs(s.slice(1, -1)) : null; };

export function fromMathematica(raw) {
  if (!isMma(raw)) return raw;
  let s = raw.replace(/\s*:=\s*/, ' = ').replace(/\b([A-Za-z]\w*)('+)\[([A-Za-z]\w*)\]/g, '$1$2($3)');
  // f[x_] := body → f(x) = body
  s = s.replace(/^([A-Za-z]\w*)\[([^\]]*_[^\]]*)\]\s*=(?!=)/, (m, f, ps) => `${f}(${ps.replace(/_/g, '')}) =`);
  const conv = (str) => {
    let out = '', i = 0;
    while (i < str.length) {
      const m = str.slice(i).match(/^([A-Za-z][A-Za-z0-9]*)\[/);
      if (m && (i === 0 || !/[\w.]/.test(str[i - 1]))) {
        const open = i + m[1].length, close = matchBracket(str, open);
        if (close < 0) { out += str.slice(i); break; }
        const args = splitArgs(str.slice(open + 1, close)).map(conv);
        out += call(m[1], args);
        i = close + 1;
        continue;
      }
      if (str[i] === '{') {
        const close = matchBracket(str, i);
        if (close > 0) { out += '[' + splitArgs(str.slice(i + 1, close)).map(conv).join(', ') + ']'; i = close + 1; continue; }
      }
      out += str[i++];
    }
    return out;
  };
  const range = (a) => { const p = listParts(a.replace(/^\[/, '{').replace(/\]$/, '}')); return p; };
  function call(head, args) {
    const r = (k) => range(args[k] || '');
    switch (head) {
      case 'D': {
        const [f, ...vs] = args;
        if (vs.length === 1 && r(1)) { const [v, n] = r(1); return `derivative(${f}, ${v}, ${n})`; }
        return `derivative(${f}, ${vs.join(', ')})`;
      }
      case 'Integrate': case 'NIntegrate': {
        const [f, ...vs] = args;
        if (vs.length === 1 && !r(1)) return `integrate(${f}, ${vs[0]})`;
        if (vs.length === 1) { const [v, a, b] = r(1); return `integrate(${f}, ${v}, ${a}, ${b})`; }
        return `integrate(${f}, ${vs.map(v => `[${(range(v) || [v]).join(', ')}]`).join(', ')})`;
      }
      case 'Limit': {
        const m = (args[1] || '').match(/^\s*([A-Za-z]\w*)\s*->\s*(.+)$/);
        if (!m) return `limit(${args.join(', ')})`;
        const dir = (args[2] || '').match(/Direction\s*->\s*("?)(FromAbove|FromBelow|-1|1|"\+"|"-")/);
        const side = dir ? (/FromAbove|-1|\+/.test(dir[2]) ? ', "+"' : ', "-"') : '';
        return `limit(${args[0]}, ${m[1]}, ${m[2]}${side})`;
      }
      case 'Series': { const [v, a, n] = r(1) || []; return `series(${args[0]}, ${v}, ${a}, ${n})`; }
      case 'Sum': case 'Product': {
        const [v, a, b] = r(1) || [];
        return `${head.toLowerCase()}(${args[0]}, ${v}, ${b === undefined ? 1 : a}, ${b === undefined ? a : b})`;
      }
      case 'Solve': case 'NSolve': case 'Reduce': {
        const eq = args[0].replace(/&&/g, ',');
        const eqs = listParts(eq.replace(/^\[/, '{').replace(/\]$/, '}'));
        const vars = args[1] ? (range(args[1]) || [args[1]]) : null;
        if (eqs && eqs.length > 1) return `solve([${eqs.join(', ')}]${vars ? `, [${vars.join(', ')}]` : ''})`;
        return `solve(${eqs ? eqs[0] : eq}${vars ? `, ${vars.join(', ')}` : ''})`;
      }
      case 'DSolve': {
        const eq = args[0].replace(/^\[|\]$/g, '');
        const parts = splitArgs(eq);
        const fn = (args[1] || '').match(/^([A-Za-z]\w*)\[([A-Za-z]\w*)\]$/) || (args[1] || '').match(/^([A-Za-z]\w*)\(([A-Za-z]\w*)\)$/);
        const f = fn ? fn[1] : 'y', x = fn ? fn[2] : (args[2] || 'x');
        return `dsolve(${parts.map(p => p.replace(/==/g, '=')).join(', ')}, ${f}(${x}))`.replace(/, (\w+\(\w+\)\)$)/, ', $1');
      }
      case 'Plot': { const [v, a, b] = r(1) || ['x', -10, 10]; return `plot(${args[0]}, [${v}, ${a}, ${b}])`; }
      case 'N': return args.length > 1 ? `N(${args[0]}, ${args[1]})` : `N(${args[0]}, 15)`;
      case 'Log': return args.length === 2 ? `log(${args[1]}, ${args[0]})` : `log(${args[0]})`;
      case 'Det': case 'Inverse': case 'Transpose': case 'Eigenvalues': case 'RowReduce': case 'MatrixRank':
        return `${MMA_FUNCS[head]}(${args.join(', ')})`;
      default:
        if (MMA_FUNCS[head]) return `${MMA_FUNCS[head]}(${args.join(', ')})`;
        if (/^[a-z]/.test(head) || userFns[head]) return `${head}(${args.join(', ')})`;
        return `${head}(${args.join(', ')})`;
    }
  }
  s = conv(s);
  s = s.replace(/\b(Pi|E|I|Infinity|GoldenRatio|Degree)\b/g, (m) => MMA_CONST[m]);
  // y''[x] → y''(x)  and y[x] already converted by conv; == inside solve stays as relation
  return s.replace(/==/g, '=');
}

// ── LaTeX ────────────────────────────────────────────────────────────────
const TEX_NAMES = { cdot: '*', times: '*', div: '/', pm: '+', infty: 'Infinity', infin: 'Infinity', le: '<=', leq: '<=', ge: '>=', geq: '>=',
  ne: '!=', neq: '!=', to: '->', rightarrow: '->', ln: 'log', lg: 'log10', exp: 'exp', arcsin: 'asin', arccos: 'acos', arctan: 'atan',
  operatorname: '', mathrm: '', mathit: '', displaystyle: '', textstyle: '', left: '', right: '', bigl: '', bigr: '', Bigl: '', Bigr: '',
  big: '', Big: '', limits: '', nolimits: '', quad: ' ', qquad: ' ', cdots: '', ldots: '', dots: '' };
const TEX_GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu',
  'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Sigma', 'Phi', 'Psi', 'Omega'];

// Read a LaTeX group: {…} or a single token. Returns [content, endIndex].
function texGroup(s, i) {
  while (s[i] === ' ') i++;
  if (s[i] === '{') { const j = matchBracket(s, i); return j < 0 ? [s.slice(i + 1), s.length] : [s.slice(i + 1, j), j + 1]; }
  if (s[i] === '\\') { const m = s.slice(i).match(/^\\[A-Za-z]+/); if (m) return [m[0], i + m[0].length]; }
  return [s[i] || '', i + 1];
}

export function fromLatex(raw) {
  if (!/\\[A-Za-z]|\^\{|_\{/.test(raw)) return raw;
  let s = raw.replace(/\$+/g, '').replace(/\\[,;:! ]/g, ' ').replace(/\\(?:mathrm|text|operatorname)\{d\}/g, 'd');
  s = s.replace(/\\left\s*\|/g, '\\lvert ').replace(/\\right\s*\|/g, '\\rvert ');
  const conv = (str) => {
    let out = '', i = 0;
    while (i < str.length) {
      const c = str[i];
      if (c === '\\') {
        const m = str.slice(i).match(/^\\([A-Za-z]+)/);
        if (!m) { i += 2; continue; }
        const name = m[1];
        i += m[0].length;
        if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
          const [a, i1] = texGroup(str, i); const [b, i2] = texGroup(str, i1); i = i2;
          // Leibniz: \frac{d}{dx}, \frac{d^2}{dx^2}, \frac{\partial}{\partial x}
          const lb = a.trim().match(/^(?:d|\\partial)(?:\^\{?(\d+)\}?)?$/), lv = b.trim().match(/^(?:d|\\partial)\s*([A-Za-z])(?:\^\{?(\d+)\}?)?$/);
          if (lb && lv) {
            const [body, i3] = texOperand(str, i); i = i3;
            out += `derivative(${conv(body)}, ${lv[1]}${lb[1] ? ', ' + lb[1] : ''})`;
            continue;
          }
          out += `((${conv(a)})/(${conv(b)}))`;
          continue;
        }
        if (name === 'sqrt') {
          let n = null;
          if (str[i] === '[') { const j = str.indexOf(']', i); n = str.slice(i + 1, j); i = j + 1; }
          const [a, i1] = texGroup(str, i); i = i1;
          out += n ? `nthRoot(${conv(a)}, ${conv(n)})` : `sqrt(${conv(a)})`;
          continue;
        }
        if (name === 'int' || name === 'iint') {
          const lim = texLimits(str, i); i = lim.end;
          const rest = str.slice(i);
          const dm = rest.match(/^(.*?)\s*(?:\\,|\s)*d\s*([A-Za-z])\s*(?=$|[)\]=+\-]|\\)/s);
          if (dm) {
            const body = conv(dm[1]), v = dm[2];
            i += dm[0].length;
            out += lim.lo !== null ? `integrate(${body}, ${v}, ${conv(lim.lo)}, ${conv(lim.hi)})` : `integrate(${body}, ${v})`;
          } else out += 'integrate(';
          continue;
        }
        if (name === 'sum' || name === 'prod') {
          const lim = texLimits(str, i); i = lim.end;
          const [body, i1] = texOperand(str, i, true); i = i1;
          const lm = (lim.lo || '').match(/^\s*([A-Za-z]\w*)\s*=\s*(.+)$/);
          out += lm ? `${name === 'sum' ? 'sum' : 'product'}(${conv(body)}, ${lm[1]}, ${conv(lm[2])}, ${conv(lim.hi)})` : conv(body);
          continue;
        }
        if (name === 'lim') {
          const lim = texLimits(str, i); i = lim.end;
          const lm = (lim.lo || '').match(/^\s*([A-Za-z]\w*)\s*(?:\\to|\\rightarrow|->)\s*(.+?)\s*(?:\^\{?([+-])\}?)?\s*$/);
          const [body, i1] = texOperand(str, i, true); i = i1;
          out += lm ? `limit(${conv(body)}, ${lm[1]}, ${conv(lm[2])}${lm[3] ? `, "${lm[3]}"` : ''})` : conv(body);
          continue;
        }
        if (name === 'log' && str[i] === '_') {
          const [base, i1] = texGroup(str, i + 1); const [arg, i2] = texOperand(str, i1); i = i2;
          out += `log(${conv(arg)}, ${conv(base)})`;
          continue;
        }
        if (name === 'lvert' || name === 'vert') { out += 'abs('; continue; }
        if (name === 'rvert') { out += ')'; continue; }
        if (name === 'text' || name === 'mathrm' || name === 'mathit' || name === 'mathbf' || name === 'operatorname') {
          const [a, i1] = texGroup(str, i); i = i1; out += a.replace(/\s+/g, ''); continue;
        }
        if (name in TEX_NAMES) { out += TEX_NAMES[name]; continue; }
        if (TEX_GREEK.includes(name)) { out += ' ' + name.replace(/^var/, '') + ' '; continue; }
        out += ' ' + name + ' ';
        continue;
      }
      if (c === '^' || c === '_') {
        const [g, j] = texGroup(str, i + 1);
        i = j;
        out += c === '_' ? conv(g).replace(/\W/g, '') : /^\w$/.test(g) ? '^' + g : `^(${conv(g)})`;
        continue;
      }
      if (c === '{') { out += '('; i++; continue; }
      if (c === '}') { out += ')'; i++; continue; }
      out += c; i++;
    }
    return out;
  };
  return conv(s).replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}
// _{lo}^{hi} after \int, \sum, \lim
function texLimits(s, i) {
  let lo = null, hi = null;
  for (let k = 0; k < 2; k++) {
    while (s[i] === ' ') i++;
    if (s[i] === '_') { const [g, j] = texGroup(s, i + 1); lo = g; i = j; }
    else if (s[i] === '^') { const [g, j] = texGroup(s, i + 1); hi = g; i = j; }
  }
  return { lo, hi, end: i };
}
// The operand of \frac{d}{dx}, \sum, \lim: a bracketed group or everything up to a top-level + or -.
function texOperand(s, i, greedy = false) {
  while (s[i] === ' ') i++;
  if (s[i] === '(' || s[i] === '{' || s[i] === '[') {
    const j = matchBracket(s, i);
    if (j > 0 && (!greedy || j === s.length - 1)) return [s.slice(i + 1, j), j + 1];
  }
  if (s.slice(i, i + 5) === '\\left') {
    const k = s.indexOf('(', i), j = k < 0 ? -1 : matchBracket(s.replace(/\\right\)/g, ' )'), k);
    if (j > 0) return [s.slice(k + 1, j).replace(/\\right\s*$/, ''), j + 1];
  }
  let depth = 0, j = i;
  for (; j < s.length; j++) {
    const c = s[j];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    else if (depth === 0 && !greedy && (c === '+' || c === '-' || c === '=') && j > i) break;
    else if (depth === 0 && c === '=') break;
  }
  return [s.slice(i, j), j];
}

// ── Leibniz, ∫, Unicode and everyday notation ───────────────────────────
export function fromNotation(raw) {
  let s = raw;
  // Unicode symbols
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺ⁿˣ]+/g, (m) => '^' + (m.length > 1 ? '(' : '') + [...m].map(c => SUPERSCRIPT[c]).join('') + (m.length > 1 ? ')' : ''));
  s = s.replace(/[·⋅∙×]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=')
    .replace(/∞/g, 'Infinity').replace(/→|⟶/g, '->');
  s = s.replace(/[αβγδεζηθικλμνξρσςυχψωΔΩΣΓΛΦΨΘφϕπτ]/g, (c) => ` ${GREEK[c]} `).replace(/ +/g, ' ');
  s = s.replace(/√\s*([A-Za-z_]\w*|\d+(?:\.\d+)?)/g, 'sqrt($1)').replace(/∛\s*([A-Za-z_]\w*|\d+(?:\.\d+)?)/g, 'cbrt($1)').replace(/√\s*\(/g, 'sqrt(').replace(/∛\s*\(/g, 'cbrt(');
  // x := 3   2 + 2 = ?   trailing "="
  s = s.replace(/^\s*([A-Za-z_]\w*(?:\([^)]*\))?)\s*:=/, '$1 =').replace(/\s*=\s*\?\s*$/, '').replace(/([^=<>!])\s*=\s*$/, '$1');
  // ∫ f dx   ∫_a^b f dx   ∫ from a to b f dx
  s = s.replace(/∫\s*(?:_\s*\{?([^{}^\s]+)\}?\s*\^\s*\{?([^{}\s]+)\}?)?\s*(.+?)\s*d([A-Za-z])\b(?=\s*$|\s*[)\]=,])/g,
    (m, a, b, f, v) => a !== undefined ? `integrate(${f}, ${v}, ${a}, ${b})` : `integrate(${f}, ${v})`);
  // Leibniz: d/dx f, d^2/dx^2 f, d/dx(f), ∂/∂x f, (d/dx) f
  s = leibniz(s);
  // |x - 3| → abs(x - 3)
  s = absBars(s);
  // sin^2(x) → sin(x)^2, sin^-1(x) → asin(x), sin x → sin(x)
  s = fnPowers(s);
  s = s.replace(/\bgolden ratio\b/gi, 'phi');
  // 15% of 80 → (15/100)*80
  s = s.replace(/(\d+(?:\.\d+)?)\s*%\s*of\s+/gi, '($1/100)*');
  s = implicitCalls(s);
  // log_2(8), log_{b}(x), log_2 8 → log(8, 2)
  s = logBase(s);
  // 5 choose 2 → binomial(5, 2)
  s = s.replace(/(\b\w+|\([^()]*\))\s+choose\s+(\w+\b|\([^()]*\))/g, 'binomial($1, $2)');
  // f'(x), f''(2) for user-defined f → derivative / subs
  s = s.replace(/\b([A-Za-z_]\w*)('+)\s*\(([^()]*)\)/g, (m, f, primes, arg) => {
    if (!userFns[f] || userFns[f].params.length !== 1) return m;
    const order = primes.length > 1 ? ', ' + primes.length : '';
    if (/^[A-Za-z_]\w*$/.test(arg.trim())) return `derivative(${f}(${arg.trim()}), ${arg.trim()}${order})`;
    return `subs(diff(${f}(x_), x_${order}), x_, ${arg.trim()})`;
  });
  return s;
}
// One-letter names before "(" are functions (f(x), y(0)) unless the same letter is also used
// as a plain variable: then k(k + 1) and x(x - 2) mean multiplication. Differential equations
// (y'' + y = 0, y(0) = 1) and workspace functions are left alone.
function implicitCalls(s) {
  if (/'/.test(s) || /^\s*dsolve\s*\(/.test(s)) return s;
  const letters = new Set([...s.matchAll(/(?<![A-Za-z_.])([A-Za-z])\s*\(/g)].map(m => m[1]));
  for (const L of letters) {
    if (userFns[L]) continue;
    if (!new RegExp(`(?<![A-Za-z_.])${L}(?![\\w(]|\\s*\\()`).test(s)) continue;
    s = s.replace(new RegExp(`(?<![A-Za-z_.])${L}\\s*\\(`, 'g'), `${L}*(`);
  }
  return s;
}
function logBase(s) {
  for (let guard = 0; guard < 20; guard++) {
    const m = /\blog_\s*(?:\{([^{}]+)\}|([A-Za-z0-9.]+))\s*/.exec(s);
    if (!m) return s;
    const base = (m[1] ?? m[2]).trim(), at = m.index + m[0].length;
    let arg, end;
    if (s[at] === '(') { end = matchBracket(s, at); if (end < 0) return s; arg = s.slice(at + 1, end); end++; }
    else { end = operandEnd(s, at); arg = s.slice(at, end); }
    if (!arg.trim()) return s;
    s = s.slice(0, m.index) + `log(${arg.trim()}, ${base})` + s.slice(end);
  }
  return s;
}
function leibniz(s) {
  const re = /(?:\(\s*)?(?:d|∂)(?:\^\s*(\d+))?\s*\/\s*(?:d|∂)\s*([A-Za-z])(?:\s*\^\s*(\d+))?(?:\s*\))?\s*/g;
  let out = '', last = 0, m;
  while ((m = re.exec(s))) {
    const before = s.slice(0, m.index);
    if (/[\w.)\]]$/.test(before) && !/\(\s*$/.test(m[0].slice(0, 1))) continue;   // part of a larger product, e.g. 2d/dx
    const start = m.index + m[0].length;
    let end;
    if (s[start] === '(' || s[start] === '[') { end = matchBracket(s, start); if (end < 0) continue; end++; }
    else { end = termEnd(s, start); }
    if (end <= start) continue;
    let body = s.slice(start, end).trim();
    if (/^[([]/.test(body) && matchBracket(body, 0) === body.length - 1) body = body.slice(1, -1);
    out += s.slice(last, m.index) + `derivative(${body}, ${m[2]}${m[1] && m[1] !== '1' ? ', ' + m[1] : ''})`;
    last = end;
    re.lastIndex = end;
  }
  return out + s.slice(last);
}
// End of the term starting at i (stops at a top-level + or - after the first character, or at =, ',', or a closing bracket).
function termEnd(s, i) {
  let depth = 0, j = i;
  for (; j < s.length; j++) {
    const c = s[j];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    else if (depth === 0 && j > i && (c === '+' || c === '-' || c === '=' || c === ',' || c === '<' || c === '>') && !/[*/^(eE]\s*$/.test(s.slice(i, j))) break;
  }
  return j;
}
function absBars(s) {
  const count = (s.match(/\|/g) || []).length;
  if (!count || count % 2 || s.includes('||')) return s;
  const stack = [], pairs = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '|') continue;
    const prev = s.slice(0, i).trimEnd().slice(-1);
    if (stack.length && /[\w)\]!']/.test(prev)) pairs.push([stack.pop(), i]);
    else stack.push(i);
  }
  if (stack.length) return s;
  const chars = s.split('');
  for (const [a, b] of pairs) { chars[a] = 'abs('; chars[b] = ')'; }
  return chars.join('');
}
function fnPowers(s) {
  const names = FUNCS.join('|');
  // sin^-1(x) / sin^{-1} x → asin
  s = s.replace(new RegExp(`\\b(${Object.keys(TRIG_INVERSE).join('|')})\\s*\\^\\s*\\(?\\s*-\\s*1\\s*\\)?(?=\\s*[\\w(])`, 'g'), (m, f) => TRIG_INVERSE[f]);
  // sin^2(x) → (sin(x))^2 ; sin^2 x → (sin(x))^2
  let re = new RegExp(`\\b(${names})\\s*\\^\\s*(\\d+|\\(\\d+\\))\\s*`, 'g'), m, out = '', last = 0;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length, end = operandEnd(s, start);
    if (end < 0) continue;
    let arg = s.slice(start, end).trim();
    if (arg.startsWith('(') && matchBracket(arg, 0) === arg.length - 1) arg = arg.slice(1, -1);
    out += s.slice(last, m.index) + `${m[1]}(${arg})^${m[2]}`;
    last = end; re.lastIndex = end;
  }
  s = out + s.slice(last);
  // sin x, ln 2x, sin 2x cos x → sin(x), log(2x), …
  re = new RegExp(`\\b(${names})\\s+(?=[\\w(])`, 'g'); out = ''; last = 0;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    if (s[start] === '(') continue;
    const end = operandEnd(s, start);
    if (end < 0) continue;
    out += s.slice(last, m.index) + `${m[1]}(${s.slice(start, end).trim()})`;
    last = end; re.lastIndex = end;
  }
  return out + s.slice(last);
}

// ── aliases ──────────────────────────────────────────────────────────────
export function applyAliases(s) {
  return s.replace(/\b([A-Za-z_]\w*)(\s*\()/g, (m, name, paren, offset) => {
    if (userFns[name]) return m;
    if (offset > 0 && s[offset - 1] === '.') return m;
    const a = ALIASES[name] ?? ALIASES[name.toLowerCase()];
    return a ? a + paren : m;
  }).replace(/\b(?:oo|inf|infinity|infty)\b/gi, (m, offset, str) => (str[offset + m.length] === '(' ? m : 'Infinity'));
}

// The full pipeline. Inputs that are already canonical pass through unchanged.
export function translateInput(raw) {
  let s = String(raw).trim();
  if (!s) return s;
  if (s.startsWith('#')) return s;
  s = fromEnglish(s);
  s = fromMathematica(s);
  s = fromLatex(s);
  s = fromNotation(s);
  s = applyAliases(s);
  return s.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}
