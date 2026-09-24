// Expression utilities shared by every engine: parsing helpers, free symbols, normalisation.
import { create, all } from 'mathjs';
import { CONSTANT_NAMES, IDENT_RE, userFns } from './state.js';

export const math = create(all, { number: 'number' });

export function stripParens(n) { while (n && n.isParenthesisNode) n = n.content; return n; }
const isFnName = (path, parent) => parent && parent.isFunctionNode && path === 'fn';

// Free (non-function, non-constant) symbols of an expression.
export function freeSymbols(expr) {
  const out = new Set();
  const node = typeof expr === 'string' ? math.parse(expr) : expr;
  node.traverse((n, path, parent) => {
    if (!n.isSymbolNode || isFnName(path, parent)) return;
    if (CONSTANT_NAMES.includes(n.name) || ['i', 'Infinity', 'NaN', 'true', 'false', 'null', 'deg'].includes(n.name)) return;
    if (n.name in math && typeof math[n.name] !== 'function' && typeof math[n.name] !== 'object') return;
    out.add(n.name);
  });
  return [...out];
}
// Names of functions called in an expression.
export function calledFunctions(expr) {
  const out = new Set();
  const node = typeof expr === 'string' ? math.parse(expr) : expr;
  node.traverse(n => { if (n.isFunctionNode && n.fn && n.fn.isSymbolNode) out.add(n.fn.name); });
  return [...out];
}
export function dependsOn(node, v) {
  let d = false;
  node.traverse((n, path, parent) => { if (n.isSymbolNode && n.name === v && !isFnName(path, parent)) d = true; });
  return d;
}

// Split "a, b, c" at top-level commas (respects nested parens/brackets).
export function parseTopLevelArgs(inner) {
  const args = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= inner.length; i++) {
    const c = i < inner.length ? inner[i] : ',';
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      const arg = inner.slice(start, i).trim();
      if (arg) args.push(arg);
      start = i + 1;
    }
  }
  return args;
}
// Argument text of the first call to fn(…) in expr.
export function xarg(expr, fn) {
  const i = expr.indexOf(fn + '('); if (i === -1) return expr;
  let d = 0; const s = i + fn.length + 1;
  for (let j = s; j < expr.length; j++) {
    if (expr[j] === '(' || expr[j] === '[') d++;
    else if (expr[j] === ')' || expr[j] === ']') { if (d === 0) return expr.slice(s, j); d--; }
  }
  return expr.slice(s);
}
// Split an equation or inequality at its single top-level relation.
export function splitRelation(eq) {
  const m = eq.match(/^(.*?)(<=|>=|!=|==|(?<![<>!=])=(?!=)|<|>)(.*)$/s);
  if (!m) return { lhs: eq.trim(), rhs: '0', rel: '=' };
  const rest = m[3];
  if (/(?<![<>!=])=(?!=)/.test(rest) && m[2] === '=') throw new Error('An equation may contain only one "=".');
  return { lhs: m[1].trim(), rhs: rest.trim(), rel: m[2] === '==' ? '=' : m[2] };
}
export function splitEquation(eq) {
  const { lhs, rhs, rel } = splitRelation(eq);
  if (rel !== '=') throw new Error('Expected an equation (=).');
  return [lhs, rhs];
}

// A +/- is unary (not a term separator) after an operator/opening bracket or inside 1e-5.
function isUnarySign(expr, i) {
  const before = expr.slice(0, i).trimEnd();
  if (!before || /[*/^(,=]$/.test(before)) return true;
  return /(^|[^\w.])\d+(\.\d*)?[eE]$/.test(before);
}
export function splitTopLevel(expr) {
  const terms = [];
  let depth = 0, start = 0, sign = '+';
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === '+' || c === '-') && i > 0 && !isUnarySign(expr, i)) {
      const t = expr.slice(start, i).trim();
      if (t) terms.push({ sign, expr: t });
      sign = c; start = i + 1;
    }
  }
  const t = expr.slice(start).trim();
  if (t) terms.push({ sign, expr: t });
  return terms.length > 1 ? terms : [];
}

// ── Input normaliser ─────────────────────────────────
export function normalise(raw) {
  return raw
    .replace(/\bln\s*\(/g, 'log(')
    .replace(/\blg\s*\(/g, 'log10(')
    .replace(/\bLog\s*\(/g, 'log(')
    .replace(/\bLn\s*\(/g, 'log(')
    .replace(/\barc(sin|cos|tan|sinh|cosh|tanh)\b/gi, (m, fn) => 'a' + fn.toLowerCase())
    .replace(/°/g, ' deg')
    .replace(/τ/g, 'tau').replace(/π/g, 'pi').replace(/√\s*\(/g, 'sqrt(').replace(/∞/g, 'Infinity')
    .replace(/\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]/g, '($1:$2)')     // [1..10] → 1:10
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
    .replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=');
}

// Substitute user-defined function bodies into an expression, so symbolic operations can
// see through f(x). Recursive definitions are left alone.
export function inlineUserFns(expr) {
  const names = Object.keys(userFns);
  if (!names.length) return expr;
  const re = new RegExp(`\\b(${names.join('|')})\\s*\\(`);
  let out = expr;
  for (let pass = 0; pass < 64; pass++) {
    const m = re.exec(out);
    if (!m) return out;
    const open = m.index + m[0].length;
    let depth = 0, close = -1;
    for (let j = open; j < out.length; j++) {
      const c = out[j];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') { if (depth === 0) { close = j; break; } depth--; }
    }
    if (close < 0) return expr;
    const fn = userFns[m[1]], args = parseTopLevelArgs(out.slice(open, close));
    if (args.length !== fn.params.length) return expr;
    let body;
    try {
      body = math.parse(fn.body).transform((n, path, parent) => {
        if (n.isSymbolNode && !isFnName(path, parent)) {
          const i = fn.params.indexOf(n.name);
          if (i >= 0) return new math.ParenthesisNode(math.parse(args[i]));
        }
        return n;
      }).toString();
    } catch { return expr; }
    out = out.slice(0, m.index) + `(${body})` + out.slice(close + 1);
  }
  return expr;
}

// Pretty-print an expression string through mathjs (u^(1/2) → sqrt(u), minimal parentheses).
export function prettify(str) {
  try {
    return math.parse(str).transform(n => {
      if (n.isOperatorNode && n.fn === 'pow') {
        const ex = stripParens(n.args[1]);
        let half = false;
        try { half = !freeSymbols(ex).length && ex.evaluate({}) === 0.5; } catch {}
        if (half) return new math.FunctionNode('sqrt', [stripParens(n.args[0])]);
      }
      return n;
    }).toString({ parenthesis: 'auto' });
  } catch { return str; }
}
export function escTex(s) { return String(s).replace(/[\\{}$&#^_%~]/g, c => '\\' + c); }
export function texOf(str) { try { return math.parse(str).toTex({ parenthesis: 'auto' }); } catch { return `\\text{${escTex(str)}}`; } }
export function isIdent(s) { return IDENT_RE.test(s); }
