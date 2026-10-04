// Evaluator: routes each input to the exact SymPy engine when it is available and falls back
// to the verified JavaScript engine (mathjs + Algebrite + numerics) otherwise.
import {
  math, freeSymbols, parseTopLevelArgs, xarg, splitRelation, normalise, canonical, inlineUserFns,
  prettify, texOf, escTex, isIdent, stripParens,
} from './expr.js';
import { fmtN, fmtNum, texNum, toTex, fmtR, fmtComplexDec as fmtComplex, texComplexDec as texComplex, asRational, toReal } from './format.js';
import { state, scope, userFns, varDefs, assumptions, objects, OBJECT_CTORS, CONSTANT_NAMES, IDENT_RE, FORBIDDEN_NAMES } from './state.js';
import { ALIASES } from './syntax.js';
import { ctx, workerEval } from './kernel/mathjs-client.js';
import { numInt, numLim, rk4Solve, findRoots, solveSys } from './kernel/numeric.js';
import { JS_NUMBER_THEORY, NotCertain } from './kernel/numtheory.js';
import {
  alg, toAlgebrite, numericallyEqual, symbolicIntegrate, partialFractions, doFactor, doExpand,
} from './kernel/fallback.js';
import { sympy, engineReady, engine, EngineUnavailable, EngineTimeout } from './sympy/client.js';
import { toAst, expandPrimes, UnsupportedForSympy } from './sympy/ast.js';
import { TOOLS, toolSpec } from './tools.js';
import { PLUGINS } from './plugins.js';
import { parsePlotItems, plotSpecTex } from './plotspec.js';
import { evalStatPlot, evalGraph, evalTree, evalPlot3d, evalSdePaths } from './viz.js';

// ── Result constructors ───────────────────────────────
// A result may carry `expr` (a mathjs-parseable plain expression) which the renderer makes
// clickable, wrapped in `prefix`/`suffix` LaTeX.
function exprResult(plain, { prefix = '', suffix = '', copy, steps, plot, engine: eng = 'js', note } = {}) {
  return { type: 'sym', expr: plain, prefix, suffix, out: prefix + texOf(plain) + suffix,
           plain: copy ?? plain, steps: steps || null, plot: plot ?? null, engine: eng, note };
}
function texResult(tex, plain, { steps, plot, engine: eng = 'js', note, check } = {}) {
  return { type: 'sym', out: tex, plain, steps: steps || null, plot: plot ?? null, engine: eng, note, check: check || null };
}
function valResult(value, expr) {
  const plottable = typeof value === 'number' || (value && value.isComplex);
  return { type: 'val', value, out: toTex(value), plain: fmtR(value), engine: 'js',
           plot: plottable && freeSymbols(expr).includes('x') ? { expr, v: 'x' } : null };
}
// Plot candidate: an expression in exactly one free variable.
function plotFor(plain) {
  try {
    const fs = freeSymbols(plain).filter(s => scope[s] === undefined && !varDefs[s]);
    return fs.length === 1 ? { expr: plain, v: fs[0] } : null;
  } catch { return null; }
}

// ── Exact-engine helpers ──────────────────────────────
// Replace workspace names by their definitions (exact where possible) before sending to SymPy.
function numberNode(v) {
  if (Number.isInteger(v)) return new math.ConstantNode(v);
  const r = asRational(v);
  return r ? math.parse(`(${r.n}/${r.d})`) : new math.ConstantNode(v);
}
export function substituteWorkspace(exprStr, keep = []) {
  const sub = (node, stack) => node.transform((n, path, parent) => {
    if (!n.isSymbolNode || (parent && parent.isFunctionNode && path === 'fn') || keep.includes(n.name)) return n;
    if (varDefs[n.name] !== undefined) {
      if (stack.includes(n.name)) throw new Error(`Circular definition: ${[...stack.slice(stack.indexOf(n.name)), n.name].join(' → ')}.`);
      return new math.ParenthesisNode(sub(math.parse(varDefs[n.name]), [...stack, n.name]));
    }
    const v = scope[n.name];
    if (CONSTANT_NAMES.includes(n.name) || v === undefined || typeof v === 'function') return n;
    if (typeof v === 'number') return numberNode(v);
    if (v && v.isComplex) return math.parse(`(${v.re} + ${v.im} * i)`);
    if (v && (v.isMatrix || Array.isArray(v))) {
      const arr = v.isMatrix ? v.toArray() : v;
      if (JSON.stringify(arr).match(/^[\d\s.,\[\]eE+-]+$/)) return math.parse(JSON.stringify(arr));
    }
    return n;
  });
  return sub(math.parse(exprStr), []);
}
// Does an expression mention a variable (2x - 3 mentions x; sin(y) and xy do not mention x)?
function mentionsName(text, name) {
  try {
    let found = false;
    math.parse(text.replace(/(?<![<>!=])=(?!=)/g, '==')).traverse((n, path, parent) => {
      if (n.isSymbolNode && n.name === name && !(parent && parent.isFunctionNode && path === 'fn')) found = true;
    });
    return found;
  } catch { return new RegExp(`(?<![A-Za-z_.])${name}(?![\\w(])`).test(text); }
}
function ast(exprStr, keep = []) { return toAst(substituteWorkspace(exprStr, keep)); }

// Set when SymPy timed out during the current dispatch (evaluations are serialised).
let timedOut = false;
// Run a SymPy op; returns null when the exact engine cannot be used for this input
// (not loaded, timed out, or the expression uses something only mathjs understands).
async function exact(op, payload) {
  if (!state.engineEnabled || !engineReady()) return null;
  try { return await sympy(op, payload); }
  catch (e) {
    if (e instanceof EngineTimeout) timedOut = true;
    if (e instanceof EngineUnavailable || e instanceof UnsupportedForSympy) return null;
    return { error: e.message };
  }
}
function tryAst(exprStr, keep) { try { return ast(exprStr, keep); } catch (e) { if (e instanceof UnsupportedForSympy) return null; throw e; } }
// Why a symbolic result came from the fallback engine (shown as a badge; cells are upgraded
// automatically once SymPy finishes loading).
function fallbackNote() {
  if (!state.engineEnabled) return null;
  if (timedOut) return 'timeout';
  if (engine.status === 'loading' || engine.status === 'restarting') return 'pending';
  return null;
}
// Suffix for errors raised when only the exact engine can answer.
function needsExactHint() {
  if (!state.engineEnabled) return ' (SymPy), which is turned off in Tweaks';
  if (timedOut) return ' (SymPy), which timed out on this input';
  if (engine.status === 'failed') return ' (SymPy), which could not be loaded';
  return ' (SymPy, still loading — this cell will update automatically)';
}
const stepList = (steps) => (steps || []).map(s => ({ d: s.d, tex: s.tex, depth: s.depth || 0 }));
// The engine's caveats ("variables treated as real") are shown as a final step.
const noteStep = (steps, r) => r && r.note ? [...steps, { d: 'Note', e: r.note }] : steps;

// Attach the exact engine's verification verdict ({status: 'verified'|'failed', how}) to a result.
function checked(res, r) { if (r && r.check) res.check = r.check; return res; }

// Present a SymPy value: exact form, plus ≈ decimal when it is an irrational number.
function presentValue(v, { prefix = '', suffix = '', steps, eng = 'sympy', plotVar } = {}) {
  // undefined / complex infinity, and forms mathjs cannot represent (Derivative, Piecewise, …)
  if (v.special || v.texOnly) return texResult(prefix + v.latex + suffix, v.plain, { steps, engine: eng });
  const isRational = /^-?\d+(\/\d+)?$/.test(v.plain.replace(/\s/g, ''));
  if (v.approx && !isRational) {
    const [re, im] = v.approx;
    const numPlain = fmtComplex(re, im), numTex = texComplex(re, im);
    if (!state.exactMode) return exprResult(numPlain.replace(/i$/, '*i'), { prefix, suffix, steps, engine: eng, copy: numPlain });
    const r = exprResult(v.plain, { prefix, suffix: `${suffix} \\approx ${numTex}`, steps, engine: eng, copy: `${v.plain} ≈ ${numPlain}` });
    return r;
  }
  if (v.matrix) return texResult(prefix + v.latex + suffix, v.plain, { steps, engine: eng });
  let parsed = true; try { math.parse(v.plain); } catch { parsed = false; }
  if (!parsed) return texResult(prefix + v.latex + suffix, v.plain, { steps, engine: eng });
  return exprResult(v.plain, { prefix, suffix, steps, engine: eng, plot: plotVar === false ? null : plotFor(v.plain) });
}
const approxText = (v) => v.approx ? fmtComplex(v.approx[0], v.approx[1]) : v.plain;
const approxTex = (v) => v.approx ? texComplex(v.approx[0], v.approx[1]) : v.latex;

// ══════════════════════════════════════════════════════
//  DEFINITIONS
// ══════════════════════════════════════════════════════
const FN_DEF_RE = /^([a-zA-Z_]\w*)\s*\(([^)]*)\)\s*=(?!=)\s*(.+)$/;
const VAR_DEF_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=(?!=)\s*(.+)$/;
function isDefinableName(name) {
  return IDENT_RE.test(name) && !FORBIDDEN_NAMES.has(name) && !CONSTANT_NAMES.includes(name)
    && typeof math[name] !== 'function';
}
// assume(x > 0), assume(x, positive), assume(n, integer), assume(x > 0, y < 0), assume(x) (real)
const ASSUME_WORDS = ['real', 'positive', 'negative', 'nonnegative', 'nonpositive', 'nonzero', 'integer', 'rational', 'complex'];
const ASSUME_REL = { '>': 'positive', '>=': 'nonnegative', '<': 'negative', '<=': 'nonpositive', '!=': 'nonzero' };
export function parseAssume(expr) {
  const m = expr.match(/^assume\s*\((.*)\)$/s);
  if (!m) return null;
  const args = parseTopLevelArgs(m[1]);
  if (!args.length) throw new Error('Use assume(x > 0), assume(x, positive) or assume(n, integer).');
  const flags = {};
  const add = (name, flag) => {
    if (!IDENT_RE.test(name) || CONSTANT_NAMES.includes(name)) throw new Error(`Cannot place an assumption on "${name}".`);
    (flags[name] ||= []).includes(flag) || flags[name].push(flag);
  };
  let last = null;
  for (const a of args) {
    const r1 = a.match(/^([A-Za-z_]\w*)\s*(>=|<=|!=|>|<)\s*0$/), r2 = a.match(/^0\s*(>=|<=|!=|>|<)\s*([A-Za-z_]\w*)$/);
    if (r1 || r2) {
      const flip = { '>': '<', '<': '>', '>=': '<=', '<=': '>=', '!=': '!=' };
      const [name, op] = r1 ? [r1[1], r1[2]] : [r2[2], flip[r2[1]]];
      add(name, ASSUME_REL[op]); last = name; continue;
    }
    if (ASSUME_WORDS.includes(a) && last) { add(last, a); continue; }
    if (IDENT_RE.test(a)) { last = a; flags[a] ||= []; continue; }
    throw new Error(`assume() understands x > 0, x >= 0, x < 0, x != 0 and the words ${ASSUME_WORDS.join(', ')}.`);
  }
  for (const k of Object.keys(flags)) if (!flags[k].length) flags[k].push('real');
  return flags;
}
export function classifyDef(expr) {
  if (/^assume\s*\(/.test(expr)) {
    try { const flags = parseAssume(expr); const names = Object.keys(flags); return { kind: 'assume', name: names[0], names, flags }; }
    catch { return null; }
  }
  const fn = expr.match(FN_DEF_RE);
  if (fn) {
    const params = fn[2].split(',').map(s => s.trim()).filter(Boolean);
    if (isDefinableName(fn[1]) && params.every(p => IDENT_RE.test(p))) return { kind: 'fn', name: fn[1], params, rhs: fn[3].trim() };
    return null;
  }
  const va = expr.match(VAR_DEF_RE);
  // X = Normal(0, 1), A = Point(0, 0), c = Circle(A, 2): a named object
  if (va && isDefinableName(va[1])) {
    const head = (va[2].trim().match(/^([A-Za-z]\w*)\s*\(/) || [])[1];
    if (head && OBJECT_CTORS.includes(head) && isWholeCall(va[2].trim(), head)) return { kind: 'object', name: va[1], rhs: va[2].trim() };
  }
  // x = 2x - 3 with x undefined is an equation to solve; n = n + 1 after n = 1 redefines n
  const defined = (n) => scope[n] !== undefined || varDefs[n] !== undefined;
  if (va && isDefinableName(va[1]) && (defined(va[1]) || !mentionsName(va[2], va[1]))) return { kind: 'var', name: va[1], rhs: va[2].trim() };
  return null;
}
// Names a cell reads (for the dependency graph).
export function cellUses(rawExpr) {
  const expr = canonical(rawExpr);
  const def = classifyDef(expr);
  const src = def ? def.rhs : expr;
  const out = new Set();
  try {
    const node = math.parse(src.replace(/(?<![<>!=])=(?!=)/g, '=='));
    node.traverse(n => { if (n.isSymbolNode) out.add(n.name); });
  } catch {
    (src.match(/[A-Za-z_]\w*/g) || []).forEach(n => out.add(n));
  }
  if (def && def.kind === 'fn') def.params.forEach(p => out.delete(p));
  return out;
}

export async function applyDefinition(def) {
  if (def.kind === 'object') {
    const a = tryAst(def.rhs);
    if (!a) throw new Error(`Could not read ${def.rhs}.`);
    if (!engineReady()) throw new Error(`Distributions and geometric objects need the exact engine${needsExactHint()}.`);
    const before = objects[def.name];
    objects[def.name] = a;
    const r = await exact('object', { name: def.name });
    if (!r || r.error) { if (before) objects[def.name] = before; else delete objects[def.name]; throw new Error(r ? r.error : 'The exact engine is unavailable.'); }
    delete userFns[def.name]; delete varDefs[def.name]; delete scope[def.name];
    const res = texResult(r.display.latex, r.display.plain, { engine: 'sympy', steps: stepList(r.steps) });
    Object.assign(res, { type: 'objdef', name: def.name, ast: a });
    if (r.plotSpec) {
      res.plotSpec = { items: r.plotSpec.items, range: r.plotSpec.range ? { v: 'x', a: r.plotSpec.range[0], b: r.plotSpec.range[1] } : null };
      res.openPlot = true;
    }
    return res;
  }
  if (def.kind === 'assume') {
    for (const [name, flags] of Object.entries(def.flags)) assumptions[name] = flags;
    const words = Object.entries(def.flags).map(([n, fs]) => `${n}: ${fs.join(', ')}`);
    const REL = { positive: '> 0', negative: '< 0', nonnegative: '\\ge 0', nonpositive: '\\le 0', nonzero: '\\ne 0' };
    const tex = Object.entries(def.flags).flatMap(([n, fs]) => fs.map(f => REL[f] ? `${n} ${REL[f]}` : `${n} \\in ${{ real: '\\mathbb{R}', integer: '\\mathbb{Z}', rational: '\\mathbb{Q}', complex: '\\mathbb{C}' }[f]}`));
    return { type: 'assume', names: def.names, flags: def.flags, out: `\\text{assume}\\quad ${tex.join(',\\ ')}`, plain: `assume ${words.join('; ')}` };
  }
  if (def.kind === 'fn') {
    const { name, params, rhs: body } = def;
    const compiled = math.compile(body);
    userFns[name] = { params, body, compiled };
    delete varDefs[name];
    scope[name] = (...args) => { const loc = ctx(); params.forEach((p, i) => { loc[p] = args[i]; }); return compiled.evaluate(loc); };
    return { type: 'funcdef', name, params, body };
  }
  const rhs = inlineUserFns(def.rhs);
  let resolved = null;
  try { resolved = substituteWorkspace(rhs, []).toString(); } catch (e) { if (/Circular/.test(e.message)) throw e; }
  // a = b + 1 after b = a + 1: the definition would refer to itself
  if (resolved !== null && mentionsName(resolved, def.name)) {
    const via = freeSymbols(rhs).filter(n => varDefs[n] !== undefined);
    throw new Error(`Circular definition: ${def.name} would depend on itself${via.length ? ' through ' + via.join(', ') : ''}.`);
  }
  let value, symbolic = false;
  try { value = await workerEval(rhs); }
  catch (e) {
    // Symbolic definition (y = x^2 + 1 with x free): kept for exact computations.
    if (!/Undefined symbol/i.test(e.message) || resolved === null) throw e;
    symbolic = true;
  }
  delete userFns[def.name];
  if (resolved !== null) varDefs[def.name] = resolved; else delete varDefs[def.name];
  if (symbolic) { delete scope[def.name]; } else scope[def.name] = value;
  // Exact display (a = sqrt(2) shows √2, not 1.414…)
  let shown = null;
  if (state.exactMode || symbolic) {
    const a = resolved !== null ? tryAst(resolved) : null;
    const r = a ? await exact('eval', { expr: a, deg: state.angleMode === 'deg' }) : null;
    if (r && !r.error) shown = r.value;
  }
  return { type: 'vardef', name: def.name, value, symbolic, shown, expr: resolved };
}

// ══════════════════════════════════════════════════════
//  DISPATCH
// ══════════════════════════════════════════════════════
export async function dispatch(rawExpr, mode) {
  timedOut = false;
  const expr = canonical(rawExpr);
  const res = await dispatchCanonical(expr, mode);
  // Show how free-form input was read ("integral of x^2 from 0 to 1" → integrate(x^2, x, 0, 1)).
  const flat = (t) => t.replace(/\s+/g, '');
  if (res && flat(normalise(rawExpr.trim())) !== flat(expr)) res.understood = expr;
  return res;
}
async function dispatchCanonical(expr, mode) {
  const def = classifyDef(expr);
  if (def) return applyDefinition(def);
  if (/^assume\s*\(/.test(expr)) parseAssume(expr);     // reports what was wrong with it
  const e = inlineUserFns(expr);
  if (/^dsolve\s*\(/.test(e)) return evalDsolve(e);
  if (/\bto\b/.test(e) && mode !== 'calculus' && !/^(integrate|limit|sum|product|plot|solve)\s*\(/.test(e)) return evalUnits(e);
  const head = (e.match(/^([A-Za-z_]\w*)\s*\(/) || [])[1];
  if (head === 'plot' && isWholeCall(e, head)) return evalPlot(parseTopLevelArgs(xarg(e, head)));
  if (['slopefield', 'vectorfield', 'domaincolor'].includes(head) && isWholeCall(e, head)) return evalPlot([e]);
  // riemann([[metric]], [coords]) is the curvature tensor (a tool); riemann(f(z)) the Riemann surface
  if (head && VIZ_HEADS.includes(head) && isWholeCall(e, head) && !(head === 'riemann' && /^riemann\s*\(\s*\[/.test(e))) return evalViz(head, parseTopLevelArgs(xarg(e, head)));
  if (head && PLUGINS[head] && isWholeCall(e, head)) return evalPlugin(head, parseTopLevelArgs(xarg(e, head)));
  if (head && TOOLS[head] && isWholeCall(e, head)) return evalTool(head, parseTopLevelArgs(xarg(e, head)), e);
  if (head && ALGEBRA_OPS[head]) return ALGEBRA_OPS[head](e);
  if (head && CALCULUS_OPS[head]) return CALCULUS_OPS[head](e);
  if (head === 'solve' || head === 'zeros' || head === 'roots') return evalSolve(e, head);
  if (head && MATRIX_OPS[head]) { const r = await MATRIX_OPS[head](e); if (r) return r; }
  const parts = parseTopLevelArgs(e);
  // y' = x*y, y(0) = 1: a differential equation (with conditions)
  if (topLevelRelation(parts[0]) && odeFunction(parts[0])) return evalDsolve(`dsolve(${e})`);
  // x + y = 7, x - y = 1: a system
  if (parts.length >= 2 && parts.every(p => isRelation(p) && splitRelation(p).rel === '=')) return evalSystem(parts);
  if (topLevelRelation(e)) return evalRelation(e);
  return evalExpression(e);
}
// The unknown function of a differential equation written with primes (y'' + y = 0, f'(t) = f(t)):
// {name, var}, or null. Names the workspace defines as functions are derivatives, not unknowns.
function odeFunction(eq) {
  const m = eq.match(/(?<![\w.])([A-Za-z])('+)(?:\s*\(\s*([A-Za-z])\s*\))?/);
  if (!m || userFns[m[1]]) return null;
  const v = m[3] || (new RegExp(`(?<![\\w.])${m[1]}\\s*\\(\\s*([A-Za-z])\\s*\\)`).exec(eq) || [])[1]
    || (/(?<![\w.])x(?![\w(])/.test(eq) ? 'x' : /(?<![\w.])t(?![\w(])/.test(eq) ? 't' : 'x');
  return { name: m[1], var: v };
}

// ── Bare equations and inequalities: 2x^2 + 3x = 5, x^2 < 4, x^2 + y^2 = 25 ──
function topLevelRelation(e) {
  let depth = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && /[=<>]/.test(c) && !(c === '=' && /[<>!=]/.test(e[i - 1] || ''))) return true;
    else if (depth === 0 && c === '!' && e[i + 1] === '=') return true;
  }
  return false;
}
// Unknowns of an expression: free names the workspace does not define.
function unknowns(text) {
  try { return freeSymbols(substituteWorkspace(text.replace(/(?<![<>!=])=(?!=)/g, '=='), [])).filter(s => scope[s] === undefined && !varDefs[s] && !objects[s]); }
  catch { return []; }
}
const PREFERRED_VARS = ['x', 'y', 'z', 't', 'n', 'k'];
function pickVar(names) {
  return PREFERRED_VARS.find(v => names.includes(v)) || [...names].sort()[0];
}
async function evalRelation(e) {
  const vars = unknowns(e);
  const { lhs, rhs, rel } = splitRelation(e);
  if (!vars.length) {     // 1 + 1 = 2, 3 < 5: a comparison
    const op = rel === '=' ? '==' : rel;
    return valResult(await workerEval(`(${lhs}) ${op} (${rhs})`), e);
  }
  // A curve in x and y (x^2 + y^2 = 25): solve for y and draw it.
  if (rel === '=' && vars.length === 2 && vars.includes('x') && vars.includes('y')) {
    const res = await evalSolve(`solve(${e}, y)`, 'solve');
    res.plotSpec = { items: [{ kind: 'implicit', expr: `(${lhs}) - (${rhs})`, label: e }], range: null };
    return res;
  }
  return evalSolve(`solve(${e}, ${pickVar(vars)})`, 'solve');
}

// Unknown function names get a "did you mean" instead of an echo of the input.
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? d[i - 2][j - 2] + 1 : Infinity);
  return d[a.length][b.length];
}
function knownFunctionNames() {
  return [...new Set([...Object.keys(TOOLS), ...Object.keys(ALGEBRA_OPS), ...Object.keys(CALCULUS_OPS), ...Object.keys(MATRIX_OPS),
    'solve', 'plot', 'dsolve', 'assume', ...Object.keys(ALIASES), ...Object.keys(userFns),
    ...Object.keys(math).filter(k => typeof math[k] === 'function' && /^[a-z][A-Za-z0-9]*$/.test(k) && k.length <= 14)])];
}
export function unknownFunctionError(name) {
  const lower = name.toLowerCase();
  const scored = knownFunctionNames().map(k => ({ k, d: k.toLowerCase() === lower ? 0 : editDistance(lower, k.toLowerCase()) }))
    .filter(({ k, d }) => d <= (name.length <= 4 ? 1 : 2) || (name.length >= 4 && k.toLowerCase().startsWith(lower)))
    .sort((a, b) => a.d - b.d || a.k.length - b.k.length).slice(0, 3).map(({ k }) => ALIASES[k] || k);
  const hint = [...new Set(scored)];
  return new Error(`Unknown function "${name}".${hint.length ? ` Did you mean ${hint.join(', ')}?` : ' Define it first, e.g. ' + name + '(x) = x^2.'}`);
}
const ABSTRACT_FN = /^[A-Za-z][0-9]?$/;

// ── General expressions ───────────────────────────────
async function evalExpression(expr) {
  let value = null, mjError = null;
  try { value = await workerEval(expr); } catch (err) {
    if (/timed out/i.test(err.message)) throw err;
    mjError = err;
  }
  const numeric = value !== null && (typeof value === 'number' || (value && (value.isComplex || value.isMatrix)));
  // A call to a function nobody defined (eigenvalz(A)) is a mistake, not a symbolic expression;
  // one-letter names (f(x), g(t)) are abstract functions.
  const undefFn = mjError && (mjError.message.match(/Undefined function "?([A-Za-z_]\w*)/) || [])[1];
  // Exact engine: exact numbers in Exact mode, and symbolic expressions in any mode.
  if ((numeric && state.exactMode) || mjError) {
    const a = tryAst(expr);
    const r = a ? await exact('eval', { expr: a, deg: state.angleMode === 'deg' }) : null;
    if (r && !r.error) {
      const res = checked(presentValue(r.value, { steps: r.steps ? stepList(r.steps) : undefined }), r);
      if (mjError && !r.value.texOnly && freeSymbols(r.value.plain).includes('x')) res.plot = plotFor(r.value.plain);
      return res;
    }
    // Unknown to SymPy and mathjs alike (mathjs-only functions such as std() answer below).
    const unknown = mjError && /Undefined (symbol|function)/i.test(mjError.message) && r && r.error && (r.error.match(/^Unknown function: (\w+)/) || [])[1];
    if (unknown && !ABSTRACT_FN.test(unknown) && typeof math[unknown] !== 'function') throw unknownFunctionError(unknown);
  }
  if (!mjError) return valResult(value, expr);
  // Only an unknown name makes an expression symbolic; any other evaluation error is real.
  if (!/Undefined (symbol|function)/i.test(mjError.message)) throw mjError;
  if (undefFn && !ABSTRACT_FN.test(undefFn)) {
    if (engineReady() && state.engineEnabled) throw unknownFunctionError(undefFn);
    throw new Error(`${undefFn}() is not known to the JavaScript engine; it may need the exact engine${needsExactHint()}.`);
  }
  // Symbolic fallback: mathjs simplification
  const node = math.parse(expr);
  let s = node; try { s = math.simplify(node); } catch {}
  const res = exprResult(prettify(s.toString()), { plot: plotFor(s.toString()) });
  res.note = fallbackNote();
  return res;
}

// ── Algebra ───────────────────────────────────────────
function transformOp(kind, jsFallback) {
  return async (e) => {
    const args = parseTopLevelArgs(xarg(e, kind));
    const f = args[0];
    if (!f) throw new Error(`Use ${kind}(expression${['collect', 'apart'].includes(kind) ? ', x' : ''}).`);
    const v = args[1] || freeSymbols(f).filter(s => scope[s] === undefined)[0] || 'x';
    if (!isIdent(v)) throw new Error('The variable must be a name.');
    const a = tryAst(f, [v]);
    const r = a ? await exact('transform', { kind, expr: a, var: v }) : null;
    if (r && !r.error) {
      const steps = r.steps && r.steps.length ? stepList(r.steps) : [{ d: 'Input', e: f }, { d: `${kind} (SymPy)`, e: r.value.plain }];
      return checked(presentValue(r.value, { steps }), r);
    }
    const res = jsFallback(f, v);
    res.note = res.note ?? fallbackNote();
    return res;
  };
}
function jsSimplify(inner) {
  let best = math.simplify(math.parse(inner), {}, { exactFractions: true }).toString();
  try {
    const alt = alg(`simplify(${toAlgebrite(inner)})`);
    if (alt.length < best.length && numericallyEqual(alt, inner)) best = alt;
  } catch {}
  best = prettify(best);
  return exprResult(best, { steps: [{ d: 'Input', e: inner }, { d: 'Simplified', e: best }], plot: plotFor(best) });
}
function jsExpand(inner) {
  let out = null;
  try { const alt = alg(`expand(${toAlgebrite(inner)})`); if (numericallyEqual(alt, inner)) out = alt; } catch {}
  if (!out) { try { out = math.simplify(doExpand(inner), {}, { exactFractions: true }).toString(); } catch { out = inner; } }
  out = prettify(out);
  return exprResult(out, { steps: [{ d: 'Input', e: inner }, { d: 'Expanded', e: out }], plot: plotFor(out) });
}
// Number of top-level factors that depend on v (x^2 counts as two).
function factorCount(node, v) {
  while (node.isParenthesisNode || (node.isOperatorNode && node.fn === 'unaryMinus')) node = node.isParenthesisNode ? node.content : node.args[0];
  if (node.isOperatorNode && node.fn === 'multiply') return node.args.reduce((n, a) => n + factorCount(a, v), 0);
  if (!node.filter(n => n.isSymbolNode && n.name === v).length) return 0;
  if (node.isOperatorNode && node.fn === 'pow' && node.args[1].isConstantNode) return Number(node.args[1].value) || 1;
  return 1;
}
function jsFactor(inner, v) {
  const isProduct = (s) => { try { return factorCount(math.parse(s), v) >= 2; } catch { return false; } };
  let factored = null;
  try { const alt = alg(`factor(${toAlgebrite(inner)},${v})`); if (isProduct(alt) && numericallyEqual(alt, inner)) factored = alt; } catch {}
  if (!factored) { const f = doFactor(inner, v); if (f && isProduct(f) && numericallyEqual(f, inner)) factored = prettify(f); }
  if (factored) return exprResult(prettify(factored), { steps: [{ d: 'Input', e: inner }, { d: 'Factored over ℚ', e: prettify(factored) }] });
  // Without a rational root, a polynomial of degree ≤ 3 is irreducible over ℚ; beyond that
  // (e.g. a product of two quadratics) only the exact engine can tell.
  // The rational-root search covers |root| ≤ 100, so the claim also needs the Cauchy bound.
  let deg = NaN, bound = Infinity;
  try {
    const p = `expand(${toAlgebrite(inner)})`;
    deg = parseInt(alg(`deg(${p},${v})`), 10);
    const c = Array.from({ length: deg + 1 }, (_, i) => toReal(math.evaluate(alg(`coeff(${p},${v},${i})`))));
    bound = 1 + Math.max(...c.slice(0, deg).map(a => Math.abs(a / c[deg])));
  } catch {}
  const onlyV = freeSymbols(inner).every(s => s === v);
  if (!(deg <= 3) || !(bound <= 100) || !onlyV) throw new Error(`Could not factor this without the exact engine${needsExactHint()}.`);
  const s = prettify(math.simplify(math.parse(inner), {}, { exactFractions: true }).toString());
  return exprResult(s, { steps: [{ d: 'Input', e: inner }, { d: 'Irreducible over ℚ', e: s }] });
}
function jsCollect(f, v) {
  let out = null;
  try {
    const p = `expand(${toAlgebrite(f)})`;
    const d = parseInt(alg(`deg(${p},${v})`), 10);
    if (d >= 0 && d <= 50) {
      const terms = [];
      for (let k = d; k >= 0; k--) {
        const c = alg(`coeff(${p},${v},${k})`);
        if (c === '0') continue;
        const cNode = math.parse(c), mono = k === 0 ? null : math.parse(k === 1 ? v : `${v}^${k}`);
        terms.push(!mono ? cNode : c === '1' ? mono : new math.OperatorNode('*', 'multiply', [cNode, mono]));
      }
      const cand = terms.length ? terms.reduce((acc, t) => new math.OperatorNode('+', 'add', [acc, t])).toString() : '0';
      if (numericallyEqual(cand, f)) out = prettify(cand);
    }
  } catch {}
  if (!out) out = prettify(math.simplify(math.parse(f), {}, { exactFractions: true }).toString());
  return exprResult(out, { steps: [{ d: 'Input', e: f }, { d: `Collected in powers of ${v}`, e: out }] });
}
function jsApart(f, v) {
  const pf = partialFractions(f, v);
  if (!pf) throw new Error('Could not decompose — apart() needs a rational function with a factorable denominator.');
  return exprResult(pf.plain, { steps: [{ d: 'Input', e: f }, { d: 'Denominator factored over ℚ', e: pf.den }, { d: 'Partial fractions', e: pf.plain }] });
}
function jsUnsupported(kind) { return () => { throw new Error(`${kind}() needs the exact engine${engine.status === 'loading' ? ' (still loading…)' : ''}.`); }; }

async function evalPolydiv(e) {
  const args = parseTopLevelArgs(xarg(e, 'polydiv'));
  if (args.length < 2) throw new Error('polydiv(p, q, x) needs a dividend, a divisor and a variable.');
  const [p, q] = args, v = args[2] || freeSymbols(p)[0] || 'x';
  const ap = tryAst(p, [v]), aq = tryAst(q, [v]);
  let quo, rem, eng = 'sympy', note = null, check = null;
  const r = ap && aq ? await exact('polydiv', { p: ap, q: aq, var: v }) : null;
  if (r && !r.error) { quo = r.quotient.plain; rem = r.remainder.plain; check = r.check; }
  else {
    eng = 'js'; note = fallbackNote();
    const pa = toAlgebrite(p), qa = toAlgebrite(q);
    quo = alg(`quotient(${pa},${qa},${v})`);
    rem = alg(`expand((${pa})-(${qa})*(${toAlgebrite(quo)}))`);
    if (!numericallyEqual(`(${quo})*(${q})+(${rem})`, p)) throw new Error('Polynomial division failed verification.');
    check = { status: 'verified', how: 'compared quotient × divisor + remainder with the dividend at sample points' };
  }
  quo = prettify(quo); rem = prettify(rem);
  const tex = rem === '0' ? `\\frac{${texOf(p)}}{${texOf(q)}} = ${texOf(quo)}`
    : `\\frac{${texOf(p)}}{${texOf(q)}} = ${texOf(quo)} + \\frac{${texOf(rem)}}{${texOf(q)}}`;
  return texResult(tex, `quotient: ${quo}, remainder: ${rem}`, {
    engine: eng, note, check, steps: [{ d: 'Dividend', e: p }, { d: 'Divisor', e: q }, { d: 'Quotient', e: quo }, { d: 'Remainder', e: rem }] });
}

const ALGEBRA_OPS = {
  simplify: transformOp('simplify', jsSimplify),
  expand: transformOp('expand', jsExpand),
  factor: transformOp('factor', jsFactor),
  collect: transformOp('collect', jsCollect),
  apart: transformOp('apart', jsApart),
  together: transformOp('together', jsUnsupported('together')),
  cancel: transformOp('cancel', jsUnsupported('cancel')),
  rationalize: transformOp('rationalize', (f) => exprResult(prettify(math.rationalize(f).toString()))),
  trigsimp: transformOp('trigsimp', jsSimplify),
  expand_trig: transformOp('expand_trig', jsUnsupported('expand_trig')),
  polydiv: evalPolydiv,
};

// ── Calculus ──────────────────────────────────────────
async function evalDerivative(e) {
  const args = parseTopLevelArgs(xarg(e, 'derivative'));
  if (args.length >= 3 && args.slice(1).every(a => IDENT_RE.test(a))) return evalTool('pdiff', args);   // ∂²f/∂x∂y
  const f = args[0], v = args[1] || 'x', order = args[2] ? parseInt(args[2], 10) : 1;
  if (!f || !IDENT_RE.test(v)) throw new Error('Use derivative(f, x) or derivative(f, x, n).');
  if (!(order >= 1 && order <= 20)) throw new Error('derivative order must be an integer between 1 and 20.');
  const oTex = order > 1 ? `\\frac{d^{${order}}}{d${v}^{${order}}}` : `\\frac{d}{d${v}}`;
  const a = tryAst(f, [v]);
  const r = a ? await exact('diff', { expr: a, var: v, order }) : null;
  if (r && !r.error) return checked(presentValue(r.value, { prefix: `${oTex}\\left[${texOf(f)}\\right] = `, steps: noteStep(stepList(r.steps), r), plotVar: true }), r);
  const steps = [{ d: `f(${v}) = ${f}`, e: f }];
  let node = math.parse(f);
  for (let i = 0; i < order; i++) { node = math.derivative(node, v); steps.push({ d: `d/d${v} (order ${i + 1})`, e: node.toString() }); }
  const s = prettify(math.simplify(node).toString());
  return exprResult(s, { prefix: `${oTex}\\left[${texOf(f)}\\right] = `, steps, plot: plotFor(s), note: fallbackNote() });
}

async function evalIntegrate(e) {
  const args = parseTopLevelArgs(xarg(e, 'integrate'));
  if (args.length >= 2 && args.slice(1).every(a => /^\[.*\]$/s.test(a))) return evalTool('integrate_multi', args);  // ∫∫ f dx dy
  const f = args[0], v = args[1] || 'x';
  if (!f || !IDENT_RE.test(v)) throw new Error('Use integrate(f, x) or integrate(f, x, a, b).');
  const definite = args.length >= 4;
  const a = tryAst(f, [v]);
  if (definite) {
    const [lo, hi] = [args[2], args[3]];
    const pre = `\\int_{${texOf(lo)}}^{${texOf(hi)}} ${texOf(f)} \\, d${v} = `;
    const al = tryAst(lo), ah = tryAst(hi);
    const r = a && al && ah && state.angleMode === 'rad' ? await exact('integrate', { expr: a, var: v, a: al, b: ah }) : null;
    if (r && !r.error && r.diverges) {
      const lhs = pre.replace(/ = $/, '');
      const pv = r.pv ? `\\quad\\text{(Cauchy principal value: } ${r.pv.latex}\\text{)}` : '';
      return texResult(r.to ? `${lhs} = ${r.to.latex}\\quad\\text{(diverges)}${pv}` : `${lhs}\\ \\text{diverges}${pv}`,
        `diverges${r.to ? ' to ' + r.to.plain : ''}${r.pv ? `; Cauchy principal value ${r.pv.plain}` : ''}`,
        { engine: 'sympy', steps: [{ d: 'The integrand is not integrable on this interval', e: '' }] });
    }
    if (r && !r.error && r.value && !r.value.special && !/Integral/.test(r.value.plain)) {
      const res = checked(presentValue(r.value, { prefix: pre, steps: stepList(r.steps), plotVar: false }), r);
      if (!r.exact) res.note = 'numeric';
      return res;
    }
    const av = toReal(math.evaluate(lo, ctx())), bv = toReal(math.evaluate(hi, ctx()));
    if (isNaN(av) || isNaN(bv)) throw new Error('Integration bounds must be real numbers.');
    let val = numInt(math.compile(f), v, av, bv), method = 'Adaptive Simpson quadrature';
    if (isFinite(av) && isFinite(bv) && state.angleMode === 'rad') {
      const F = symbolicIntegrate(f, v);
      if (!F.noForm) {
        try {
          const Fc = math.compile(F.plain), at = x => toReal(Fc.evaluate(Object.assign({}, scope, { [v]: x })));
          const ex = at(bv) - at(av);
          if (isFinite(ex) && Math.abs(ex - val) <= 1e-6 * (1 + Math.abs(ex))) { val = ex; method = `F(${hi}) − F(${lo}),  F = ${F.plain}`; }
        } catch {}
      }
    }
    if (isNaN(val)) throw new Error('The integral does not converge numerically on this interval.');
    return texResult(pre + texNum(val), fmtNum(val), { steps: [{ d: 'Method', e: method }, { d: 'Result', e: fmtNum(val) }], note: fallbackNote() });
  }
  const pre = `\\int ${texOf(f)} \\, d${v} = `;
  const r = a ? await exact('integrate', { expr: a, var: v }) : null;
  if (r && !r.error) {
    if (r.noForm) return texResult(`\\int ${texOf(f)} \\, d${v} \\quad \\text{(no closed form found)}`,
      `∫ ${f} d${v} — no closed form found (SymPy and substitution heuristics failed; this does not prove none exists)`,
      { engine: 'sympy', steps: [...stepList(r.steps), { d: 'Tip', e: `integrate(${f}, ${v}, a, b) gives a numerical value` }] });
    const res = checked(presentValue(r.value, { prefix: pre, suffix: ' + C', steps: noteStep(stepList(r.steps), r) }), r);
    res.plain = `${r.value.plain} + C`;
    return res;
  }
  const F = symbolicIntegrate(f, v);
  if (F.noForm) {
    return texResult(`\\int ${texOf(f)} \\, d${v} \\quad \\text{(no elementary antiderivative found)}`,
      `∫ ${f} d${v} — no elementary antiderivative found. Try integrate(f, ${v}, a, b).`,
      { note: fallbackNote(), steps: [{ d: 'Tip', e: `Use integrate(${f}, ${v}, a, b) for a numerical value` }] });
  }
  const res = exprResult(F.plain, { prefix: pre, suffix: ' + C', copy: `${F.plain} + C`, plot: plotFor(F.plain), note: fallbackNote(),
    steps: [{ d: `Antiderivative (${F.method}, verified by differentiation)`, e: F.plain + ' + C' }] });
  res.check = { status: 'verified', how: 'differentiated the result and compared it with the integrand at sample points' };
  return res;
}

const fmtLim = (x) => isNaN(x) ? 'Undefined' : !isFinite(x) ? (x > 0 ? 'Infinity' : '-Infinity') : fmtNum(x);
async function evalLimit(e) {
  const args = parseTopLevelArgs(xarg(e, 'limit'));
  if (args.length < 3) throw new Error('Use limit(f, x, a) or limit(f, x, a, "+"/"-").');
  const [f, v, pt] = args;
  const dirArg = (args[3] || '').replace(/["']/g, '').trim().toLowerCase();
  const dir = ['+', 'right'].includes(dirArg) ? '+' : ['-', 'left'].includes(dirArg) ? '-' : '';
  const arrow = `${v}\\to ${texOf(pt)}${dir === '+' ? '^{+}' : dir === '-' ? '^{-}' : ''}`;
  const pre = `\\lim_{${arrow}} ${texOf(f)}`;
  const a = tryAst(f, [v]), ap = tryAst(pt);
  const r = a && ap ? await exact('limit', { expr: a, var: v, point: ap, dir }) : null;
  if (r && !r.error) {
    if (r.dne) {
      const why = r.oscillates
        ? [{ d: 'Oscillates between', tex: `${r.oscillates[0].latex} \\text{ and } ${r.oscillates[1].latex}` }]
        : [{ d: 'Left-hand limit', tex: r.left.latex }, { d: 'Right-hand limit', tex: r.right.latex }];
      return texResult(`${pre} \\ \\text{does not exist}`, 'does not exist', { engine: 'sympy', steps: [...stepList(r.steps), ...why] });
    }
    return checked(presentValue(r.value, { prefix: pre + ' = ', steps: stepList(r.steps), plotVar: false }), r);
  }
  const av = toReal(math.evaluate(pt, ctx()));
  if (isNaN(av)) throw new Error('The limit point must be a real number or ±Infinity.');
  const L = numLim(f, v, av, dir === '+' ? 1 : dir === '-' ? -1 : 0);
  const steps = [{ d: `Approach ${v} → ${pt}`, e: f }];
  if (L.left !== undefined) steps.push({ d: 'Left-hand limit', e: fmtLim(L.left) }, { d: 'Right-hand limit', e: fmtLim(L.right) });
  if (L.note) steps.push({ d: 'Note', e: L.note });
  if (L.dne) return texResult(`${pre} \\ \\text{does not exist}`, 'does not exist', { steps, note: fallbackNote() });
  if (isNaN(L.value) && !L.outside) throw new Error(`This limit could not be determined numerically; it needs the exact engine${needsExactHint()}.`);
  steps.push({ d: 'Numerical limit', e: fmtLim(L.value) });
  return texResult(`${pre} = ${texNum(L.value)}`, fmtLim(L.value), { steps, note: fallbackNote() });
}

function sumOp(kind) {
  return async (e) => {
    const args = parseTopLevelArgs(xarg(e, kind));
    if (args.length !== 4 || !IDENT_RE.test(args[1])) return evalExpression(e);
    const [f, v, lo, hi] = args;
    const sym = kind === 'sum' ? '\\sum' : '\\prod';
    const pre = `${sym}_{${v}=${texOf(lo)}}^{${texOf(hi)}} ${texOf(f)} = `;
    const a = tryAst(f, [v]), al = tryAst(lo), ah = tryAst(hi);
    const r = a && al && ah ? await exact(kind, { expr: a, var: v, a: al, b: ah }) : null;
    if (r && !r.error && r.diverges) {
      return texResult(`${pre.replace(/ = $/, '')}${r.to ? ' = ' + r.to.latex : ''}\\quad\\text{(diverges)}`,
        `diverges${r.to ? ' to ' + r.to.plain : ''}`, { engine: 'sympy' });
    }
    if (r && !r.error && r.when) {      // Σ x^n = 1/(1 − x) for |x| < 1
      const res = presentValue(r.value, { prefix: pre, suffix: `\\quad\\text{for } ${r.when.latex}`, plotVar: false });
      res.copy = res.plain = `${r.value.plain} for ${r.when.plain}`;
      return checked(res, r);
    }
    if (r && !r.error && r.numeric) {   // convergent, no closed form: the value to 25 digits
      const guess = r.looksLike ? `\\quad\\text{(numerical; matches } ${r.looksLike.latex} \\text{ to 20 digits — not a proof)}` : '\\quad\\text{(numerical; no closed form found)}';
      return texResult(`${pre}${r.value.latex}${guess}`, `${r.value.plain}  (numerical${r.looksLike ? `; matches ${r.looksLike.plain} to 20 digits — not a proof` : '; no closed form found'})`, { engine: 'sympy' });
    }
    if (r && !r.error && !r.noForm) return checked(presentValue(r.value, { prefix: pre, plotVar: true }), r);
    const bound = (s) => { try { return Math.round(toReal(math.evaluate(s, ctx()))); } catch { return NaN; } };
    const st = bound(lo), en = bound(hi);
    if ((!isFinite(st) || !isFinite(en)) && r) throw new Error(r.error ? `The exact engine could not evaluate this ${kind}: ${r.error}` : `No closed form found for this ${kind}.`);
    if (!isFinite(st) || !isFinite(en)) throw new Error(`Symbolic or infinite bounds need the exact engine${needsExactHint()}.`);
    if (Math.abs(en - st) > 100000) throw new Error(`Range too large (${st} to ${en}).`);
    const fn = math.compile(f), loc = ctx();
    let tot = kind === 'sum' ? 0 : 1;
    for (let i = st; i <= en; i++) { loc[v] = i; tot = kind === 'sum' ? math.add(tot, fn.evaluate(loc)) : math.multiply(tot, fn.evaluate(loc)); }
    return texResult(pre + toTex(tot), fmtR(tot), { note: fallbackNote(), steps: [{ d: `${kind} ${v}=${st}..${en}`, e: fmtR(tot) }] });
  };
}

async function evalSeries(e) {
  const args = parseTopLevelArgs(xarg(e, e.startsWith('taylor') ? 'taylor' : 'series'));
  if (args.length < 2 || !IDENT_RE.test(args[1])) throw new Error('Use series(f, x, a, n).');
  const f = args[0], v = args[1], aStr = args[2] || '0';
  const nOrd = args[3] ? Math.max(0, Math.min(parseInt(args[3], 10), 20)) : 6;
  const a = tryAst(f, [v]), ap = tryAst(aStr);
  const r = a && ap ? await exact('series', { expr: a, var: v, point: ap, order: nOrd }) : null;
  if (r && !r.error) {
    const res = exprResult(prettify(r.value.plain), { suffix: ` + ${r.orderTex}`, copy: `${r.value.plain} + ${r.orderPlain}`, engine: 'sympy' });
    res.plot = plotFor(r.value.plain);
    return res;
  }
  // Fallback: numeric Taylor coefficients, rationalised
  const av = toReal(math.evaluate(aStr, scope));
  if (!isFinite(av)) throw new Error('The expansion point must be a finite real number.');
  const centered = Math.abs(av) > 1e-15;
  const xPlain = centered ? `(${v} - ${aStr})` : v;
  const at = (node, x) => { try { return toReal(node.evaluate(Object.assign({}, scope, { [v]: x }))); } catch { return NaN; } };
  let dNode = math.parse(f), factorial = 1;
  const terms = [];
  for (let k = 0; k <= nOrd; k++) {
    if (k > 0) { dNode = math.derivative(dNode, v); factorial *= k; }
    let val = at(dNode, av);
    if (!isFinite(val)) {
      const l1 = at(dNode, av + 1e-6), l2 = at(dNode, av - 1e-6);
      if (isFinite(l1) && isFinite(l2) && Math.abs(l1 - l2) < 1e-4 * (1 + Math.abs(l1))) val = (l1 + l2) / 2;
      else throw new Error(`${f} is not analytic at ${v} = ${aStr} (derivative ${k} is undefined) — no Taylor series there.`);
    }
    const c = val / factorial;
    if (Math.abs(c) < 1e-12) continue;
    const isInt = Math.abs(c - Math.round(c)) < 1e-10, rr = isInt ? null : asRational(c, 100000);
    const cStr = isInt ? String(Math.round(c)) : rr ? `${rr.n}/${rr.d}` : c.toPrecision(10);
    const mono = k === 0 ? '' : k === 1 ? xPlain : `${xPlain}^${k}`;
    terms.push(k === 0 ? cStr : cStr === '1' ? mono : cStr === '-1' ? `-${mono}` : `${cStr}*${mono}`);
  }
  const poly = prettify(terms.join(' + ').replace(/\+ -/g, '- ') || '0');
  return exprResult(poly, { suffix: ` + O\\!\\left(${texOf(xPlain)}^{${nOrd + 1}}\\right)`, copy: `${poly} + O(${xPlain}^${nOrd + 1})`, plot: plotFor(poly), note: fallbackNote() });
}

async function evalGradient(e) {
  const args = parseTopLevelArgs(xarg(e, 'gradient'));
  const gf = args[0], gvars = (args[1] || '').replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean);
  if (!gf || !gvars.length || !gvars.every(g => IDENT_RE.test(g))) throw new Error('Use gradient(f, [x, y, …]).');
  const a = tryAst(gf, gvars);
  const r = a ? await exact('gradient', { expr: a, vars: gvars }) : null;
  const parts = r && !r.error ? r.values.map(x => x.plain) : gvars.map(gv => prettify(math.simplify(math.derivative(math.parse(gf), gv)).toString()));
  return texResult(`\\nabla f = \\begin{pmatrix} ${parts.map(texOf).join(' \\\\ ')} \\end{pmatrix}`, `[${parts.join(', ')}]`,
    { engine: r && !r.error ? 'sympy' : 'js', steps: parts.map((p, i) => ({ d: `∂f/∂${gvars[i]}`, e: p })) });
}

async function evalOde(e) {
  const args = parseTopLevelArgs(xarg(e, 'ode'));
  if (args.length !== 6 || !IDENT_RE.test(args[1]) || !IDENT_RE.test(args[2])) throw new Error('Use ode(f(x, y), x, y, x0, y0, x1) for dy/dx = f(x, y).');
  const [of_, xv, yv, x0s, y0s, x1s] = args;
  const x0 = toReal(math.evaluate(x0s, ctx())), y0 = toReal(math.evaluate(y0s, ctx())), x1 = toReal(math.evaluate(x1s, ctx()));
  if (![x0, y0, x1].every(isFinite)) throw new Error('ODE initial values must be finite real numbers.');
  const { xs, ys } = rk4Solve(of_, xv, yv, x0, y0, x1);
  const yFinal = ys[ys.length - 1];
  if (!isFinite(yFinal)) throw new Error('The ODE solution blows up (or f is undefined) on this interval.');
  return {
    type: 'sym', engine: 'js', out: `${yv}(${texNum(x1)}) \\approx ${fmtN(yFinal)}`, plain: `${yv}(${fmtN(x1)}) ≈ ${fmtN(yFinal)}`,
    steps: [{ d: `ODE: d${yv}/d${xv} = ${of_}`, e: `IC: ${yv}(${fmtN(x0)}) = ${fmtN(y0)}` }, { d: 'Method', e: 'Classical RK4, 500 steps' }],
    odeData: { xs, ys, xv, yv },
  };
}

// dsolve(y'' + y = 0, y(x))   dsolve(y' = y, y(x), y(0) = 1, y'(0) = 2)
async function evalDsolve(e) {
  const args = parseTopLevelArgs(xarg(e, 'dsolve'));
  if (!args.length) throw new Error("Use dsolve(y'' + y = 0, y(x)) with optional conditions like y(0) = 1.");
  if (!args[1] || LONE_EQ.test(args[1])) {        // no y(x): infer it from the primes
    const f = odeFunction(args[0]);
    if (!f) throw new Error("Use dsolve(y'' + y = 0, y(x)) with optional conditions like y(0) = 1.");
    args.splice(1, 0, `${f.name}(${f.var})`);
  }
  const fm = args[1].match(/^([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*)\s*\)$/);
  if (!fm) throw new Error('The second argument must name the unknown function, e.g. y(x).');
  const [, fname, xname] = fm;
  const { lhs, rhs, rel } = splitRelation(args[0]);
  if (rel !== '=') throw new Error('dsolve needs an equation.');
  const ics = args.slice(2).map(c => {
    const m = c.match(new RegExp(`^${fname}('*)\\s*\\((.+)\\)\\s*=\\s*(.+)$`));
    if (!m) throw new Error(`Initial conditions look like ${fname}(0) = 1 or ${fname}'(0) = 2.`);
    return { order: m[1].length, at: toAst(m[2]), value: tryAst(m[3]) };
  });
  const conv = (s) => toAst(math.parse(expandPrimes(s, fname)));
  if (!engineReady()) throw new Error(`dsolve needs the exact engine${engine.status === 'loading' ? ' — it is still loading, the cell will update automatically' : ''}.`);
  const r = await exact('dsolve', { lhs: conv(lhs), rhs: conv(rhs), func: fname, var: xname, ics });
  if (!r || r.error) throw new Error(r ? r.error : 'The exact engine is unavailable.');
  const sol = r.solutions[0];
  const res = texResult(r.solutions.map(s => s.latex).join(',\\quad '), `${fname}(${xname}) = ${sol.plain}`, { engine: 'sympy', check: r.check });
  if (!/C\d/.test(sol.plain)) res.plot = plotFor(sol.plain);
  return res;
}

const CALCULUS_OPS = {
  derivative: evalDerivative, diff: (e) => evalDerivative(e.replace(/^diff/, 'derivative')),
  integrate: evalIntegrate, limit: evalLimit, sum: sumOp('sum'), product: sumOp('product'),
  series: evalSeries, taylor: evalSeries, gradient: evalGradient, ode: evalOde, dsolve: evalDsolve,
};

// ── Solving ───────────────────────────────────────────
const isList = (t) => /^\[.*\]$/s.test(t.trim());
const isRelation = (t) => !isList(t) && topLevelRelation(t);
// solve(eq, x)   solve(eq)   solve(x^2 < 4, x)   solve([eqs], [vars])   solve(eq1, eq2, [x, y])   solve(eq1, eq2, x, y)
async function evalSolve(e, head) {
  const args = parseTopLevelArgs(xarg(e, head));
  if (!args.length) throw new Error('Use solve(equation, x) or solve([eq1, eq2], [x, y]).');
  if (isList(args[0])) return evalSystem(parseTopLevelArgs(args[0].trim().slice(1, -1)), args[1]);
  const eqs = args.filter(isRelation), rest = args.filter(a => !isRelation(a));
  if (eqs.length >= 2) {
    if (rest.length > 1 && !rest.every(r => IDENT_RE.test(r))) throw new Error('List the unknowns as solve(eq1, eq2, [x, y]).');
    return evalSystem(eqs, rest.length === 1 ? rest[0] : rest.length ? `[${rest.join(', ')}]` : undefined);
  }
  let eq, v;
  if (args.length === 1) {
    eq = args[0];
    const names = unknowns(eq);
    if (!names.length) throw new Error('There is nothing to solve for: every name in this equation has a value.');
    v = pickVar(names);
  } else { v = args[args.length - 1]; eq = args.slice(0, -1).join(', '); }
  if (!IDENT_RE.test(v)) throw new Error('The last argument of solve() must be the unknown, e.g. solve(x^2 = 4, x).');
  const { lhs, rhs, rel } = splitRelation(eq);
  const al = tryAst(lhs, [v]), ar = tryAst(rhs, [v]);
  const r = al && ar ? await exact('solve', { lhs: al, rhs: ar, var: v, rel }) : null;
  if (r && !r.error) {
    const steps = stepList(r.steps);
    if (r.statement) return texResult(r.statement.latex, r.statement.plain, { engine: 'sympy', steps, check: r.check });
    if (r.solutions) {
      if (!r.solutions.length) return texResult('\\text{No solutions}', 'No solutions', { engine: 'sympy', steps, check: r.check });
      const real = (s) => s.approx && Math.abs(s.approx[1]) < 1e-12;
      const key = (s) => s.approx ? [real(s) ? 0 : 1, s.approx[0], s.approx[1]] : [2, 0, 0];
      const sols = [...r.solutions].sort((p, q) => { const a = key(p), b = key(q); return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; });
      const shown = sols.map(s => {
        const rational = /^-?\d+(\/\d+)?$/.test(s.plain.replace(/\s/g, ''));
        const simple = s.plain.length <= 80 && !/CRootOf|RootOf/.test(s.plain);
        if (!s.approx) return { tex: s.latex, plain: s.plain };
        if (!state.exactMode || !simple) return { tex: approxTex(s), plain: approxText(s) };
        if (rational || s.plain === approxText(s)) return { tex: s.latex, plain: s.plain };
        return { tex: `${s.latex} \\approx ${approxTex(s)}`, plain: `${s.plain} ≈ ${approxText(s)}` };
      });
      const nonReal = sols.filter(s => s.approx && !real(s)).length;
      if (nonReal) steps.push({ d: 'Note', e: `${nonReal} complex root(s)` });
      return texResult(shown.map((s, i) => `${v}_{${i + 1}} = ${s.tex}`).join(',\\quad '), shown.map(s => `${v} = ${s.plain}`).join(', '), { engine: 'sympy', steps, check: r.check });
    }
  }
  if (rel !== '=') throw new Error(`Inequalities need the exact engine${needsExactHint()}.`);
  return jsSolve(lhs, rhs, v);
}
async function jsSolve(lhs, rhs, v) {
  const f = `(${lhs})-(${rhs})`;
  const steps = [{ d: 'Rewrite as f = 0', e: `${lhs} - (${rhs}) = 0` }];
  const fKnown = substituteWorkspace(f, [v]).toString({ implicit: 'show' });
  const params = freeSymbols(fKnown).filter(s => s !== v && scope[s] === undefined);
  let exactRoots = null;
  try {
    const raw = alg(`roots(${toAlgebrite(fKnown)},${v})`);
    // a repeated root is listed once ((x² + y² − 4)² = 0 has each root twice)
    exactRoots = [...new Set((/^\[.*\]$/.test(raw) ? parseTopLevelArgs(raw.slice(1, -1)) : [raw]).map(prettify))];
  } catch {}
  if (exactRoots && exactRoots.length) {
    const vals = exactRoots.map(r => { let num = null; if (!params.length) { try { num = math.evaluate(r); } catch {} } return { expr: r, num }; })
      .filter(r => { if (r.num === null) return true; try { return math.abs(math.evaluate(fKnown, Object.assign({}, scope, { [v]: r.num }))) < 1e-6 * (1 + math.abs(r.num)); } catch { return false; } });
    const isReal = r => r.num !== null && (typeof r.num === 'number' || Math.abs(r.num.im) < 1e-12);
    const key = r => r.num === null ? [2, 0] : isReal(r) ? [0, toReal(r.num)] : [1, r.num.re, r.num.im];
    vals.sort((p, q) => { const a = key(p), b = key(q); return a[0] - b[0] || a[1] - b[1] || (a[2] || 0) - (b[2] || 0); });
    const shown = vals.map(r => {
      if (r.num === null) return { tex: texOf(r.expr), plain: r.expr };
      const val = isReal(r) ? toReal(r.num) : r.num, numPlain = fmtR(val), numTex = toTex(val);
      const compact = r.expr.replace(/\s/g, ''), simple = r.expr.length <= 60 && !/\(-1\)\s*\^/.test(r.expr);
      if (!state.exactMode || !simple) return { tex: numTex, plain: numPlain };
      if (compact === numPlain.replace(/\s/g, '') || /^-?\d+(\/\d+)?$/.test(compact)) return { tex: texOf(r.expr), plain: r.expr };
      return { tex: `${texOf(r.expr)} \\approx ${numTex}`, plain: `${r.expr} ≈ ${numPlain}` };
    });
    if (!shown.length) return texResult('\\text{No solutions}', 'No solutions', { steps, note: fallbackNote() });
    return texResult(shown.map((s, i) => `${v}_{${i + 1}} = ${s.tex}`).join(',\\quad '), shown.map(s => `${v} = ${s.plain}`).join(', '), { steps, note: fallbackNote() });
  }
  if (params.length) throw new Error(`Cannot solve for ${v} symbolically; assign values to ${params.join(', ')} for a numerical solution.`);
  const { roots, truncated } = findRoots(fKnown, v);
  steps.push({ d: 'Numerical root search', e: roots.length ? `${roots.length} root(s)${truncated ? ' (20 nearest the origin)' : ''}` : 'none found in [-10000, 10000]' });
  if (!roots.length) return texResult('\\text{No real roots found}', 'No real roots found', { steps, note: fallbackNote() });
  // A numerical search finds real roots in a window; it cannot promise there are no others.
  return texResult(roots.map((r, i) => `${v}_{${i + 1}}=${texNum(r)}`).join(',\\quad ') + (truncated ? ',\\ \\ldots' : '') + '\\quad\\text{(real roots found numerically)}',
    roots.map(r => `${v} = ${fmtNum(r)}`).join(', ') + '  (real roots found numerically)', { steps, note: fallbackNote() });
}
async function evalSystem(eqs, varsText) {
  let vars = varsText ? (isList(varsText) ? parseTopLevelArgs(varsText.trim().slice(1, -1)) : [varsText.trim()]) : null;
  if (!vars) {
    const all = [...new Set(eqs.flatMap(unknowns))];
    vars = [...PREFERRED_VARS.filter(v => all.includes(v)), ...all.filter(v => !PREFERRED_VARS.includes(v)).sort()];
    if (vars.length > eqs.length) vars = vars.slice(0, eqs.length);
  }
  if (!vars.length || !vars.every(v => IDENT_RE.test(v))) throw new Error('Unknowns must be variable names.');
  const asts = eqs.map(q => { const { lhs, rhs } = splitRelation(q); const l = tryAst(lhs, vars), r = tryAst(rhs, vars); return l && r ? { lhs: l, rhs: r } : null; });
  const r = asts.every(Boolean) ? await exact('solveSystem', { eqs: asts, vars }) : null;
  if (r && !r.error && !r.systems.length) return texResult('\\text{No solutions}', 'No solutions', { engine: 'sympy', steps: [{ d: 'System of equations', e: eqs.join(', ') }] });
  if (r && !r.error && r.systems.length) {
    const rows = r.systems.map(sol => sol.map(s => {
      const rational = /^-?\d+(\/\d+)?$/.test(s.plain.replace(/\s/g, ''));
      const t = !state.exactMode && s.approx ? approxTex(s) : (s.approx && !rational && state.exactMode ? `${s.latex} \\approx ${approxTex(s)}` : s.latex);
      const p = !state.exactMode && s.approx ? approxText(s) : s.plain;
      return { tex: `${s.var} = ${t}`, plain: `${s.var}=${p}` };
    }));
    return texResult(rows.map(row => row.map(x => x.tex).join(',\\ ')).join('\\quad\\text{or}\\quad '),
      rows.map(row => row.map(x => x.plain).join(', ')).join('  or  '), { engine: 'sympy', check: r.check, steps: [{ d: 'System of equations', e: eqs.join(', ') }, { d: 'Solved exactly', e: `${r.systems.length} solution(s)` }] });
  }
  const sol = solveSys(eqs, vars);
  const warn = sol[0]?.warn ? `\\ \\small{\\color{orange}{\\text{⚠ may not have converged, residual ≈ ${sol[0].residual?.toExponential(2)}}}}` : '';
  // Newton's method finds one solution; only a linear system is known to have no others.
  const linear = eqs.every(q => { try { const { lhs, rhs } = splitRelation(q); const f = math.parse(`(${lhs}) - (${rhs})`); return vars.every(a => vars.every(b => math.simplify(math.derivative(math.derivative(f, a), b)).toString() === '0')); } catch { return false; } });
  const maybeMore = linear ? '' : '  (found numerically; there may be other solutions)';
  return texResult(sol.map(s => `${s.v} = ${texNum(s.x)}`).join(',\\quad ') + warn + (maybeMore ? '\\quad\\text{(found numerically; there may be other solutions)}' : ''), sol.map(s => `${s.v}=${fmtNum(s.x)}`).join(', ') + maybeMore,
    { note: fallbackNote(), steps: [{ d: 'System of equations', e: eqs.join(', ') }, { d: "Newton's method (multi-start)", e: sol.map(s => `${s.v}=${fmtN(s.x)}`).join(', ') }] });
}

// ── Matrices (exact via SymPy, numeric via mathjs) ────
function matrixOp(kind) {
  return async (e) => {
    const inner = xarg(e, kind);
    const a = tryAst(inner);
    if (a && ['eigs', 'rref', 'nullspace', 'charpoly'].includes(kind)) {
      const r = await exact('matrix', { kind, expr: a });
      if (r && !r.error) {
        if (r.value) return checked(presentValue(r.value, { prefix: `\\operatorname{${kind}}\\left(${texOf(inner)}\\right) = `, plotVar: false }), r);
        const vals = r.values;
        const steps = (r.vectors || []).map(ev => ({ d: `λ = ${ev.value.plain}`, tex: `v = ${ev.vectors.map(x => x.latex).join(',\\ ')}` }));
        const list = vals.map(x => state.exactMode ? x.latex : approxTex(x)).join(',\\ ');
        return texResult(kind === 'eigs' ? `\\lambda = ${list}` : `\\left\\{${vals.map(x => x.latex).join(',\\ ')}\\right\\}`,
          `${kind === 'eigs' ? 'λ = ' : ''}[${vals.map(x => state.exactMode ? x.plain : approxText(x)).join(', ')}]`, { engine: 'sympy', steps, check: r.check });
      }
    }
    if (kind === 'eigs') {
      const A = await workerEval(inner);
      const res = math.eigs(A);
      const vecSteps = (res.eigenvectors || []).map(ev => ({ d: `λ = ${fmtR(ev.value)}`, e: `v = ${fmtR(ev.vector)}` }));
      return texResult(`\\lambda = ${toTex(res.values)}`, `λ = ${fmtR(res.values)}`, { steps: vecSteps, note: fallbackNote() });
    }
    return null;   // det/inv/… : general expression path (exact via SymPy eval in Exact mode)
  };
}
const MATRIX_OPS = { eigs: matrixOp('eigs'), rref: matrixOp('rref'), nullspace: matrixOp('nullspace'), charpoly: matrixOp('charpoly') };

// ── Tools (named SymPy capabilities, see tools.js / sympy/tools.py) ──
function isWholeCall(e, head) {
  return e.trim().replace(/\s+/g, '') === `${head}(${xarg(e, head)})`.replace(/\s+/g, '');
}
const LONE_EQ = /(?<![<>!=])=(?!=)/;
// "lhs = rhs" → "(lhs) == (rhs)" so it reaches SymPy as an equation.
function relationText(s) {
  if (!LONE_EQ.test(s)) return s;
  const { lhs, rhs, rel } = splitRelation(s);
  if (rel !== '=') throw new Error('Expected an equation with "=".');
  return `(${lhs}) == (${rhs})`;
}
const listItems = (s) => /^\[.*\]$/s.test(s) ? parseTopLevelArgs(s.slice(1, -1)) : [s];
// x' = y in a system of ODEs → diff(x(t), t, 1) = y(t): every name written with a prime anywhere
// in the system is an unknown function of t.
function odeSystemText(eq, system, t) {
  const fns = [...new Set([...system.matchAll(/(?<![\w.])([A-Za-z])'+/g)].map(m => m[1]))];
  let s = eq;
  for (const f of fns) {
    s = s.replace(new RegExp(`(?<![\\w.])${f}('+)(?:\\s*\\(\\s*${t}\\s*\\))?`, 'g'), (m, p) => `diff(${f}(${t}), ${t}, ${p.length})`)
      .replace(new RegExp(`(?<![\\w.])${f}(?![\\w(])`, 'g'), `${f}(${t})`);
  }
  return s;
}
// Match argument strings to a tool's kinds; returns [{kind, text}] with defaults filled in.
function matchToolArgs(name, spec, args) {
  const kinds = spec.args.split(',');
  const out = [];
  let i = 0;
  for (const k of kinds) {
    const base = k[0], rep = k.endsWith('*'), opt = k.endsWith('?'), def = k.includes('=') ? k.split('=')[1] : null;
    if (rep) { while (i < args.length) out.push({ kind: base, text: args[i++] }); continue; }
    if (i < args.length) out.push({ kind: base, text: args[i++] });
    else if (def) out.push({ kind: base, text: def });
    else if (!opt) throw new Error(`Use ${spec.sig || name + '(…)'}.`);
  }
  if (i < args.length) throw new Error(`Too many arguments. Use ${spec.sig || name + '(…)'}.`);
  return out;
}
// A JavaScript plug-in (plugins.js): run(args, helpers) returns { latex, plain }.
async function evalPlugin(name, args) {
  const helpers = { evaluate: (t) => math.evaluate(t, ctx()), sympy, math };
  const r = await PLUGINS[name].run(args, helpers);
  if (!r || typeof r !== 'object' || typeof r.latex !== 'string') throw new Error(`The plug-in ${name} returned nothing to show.`);
  const res = texResult(r.latex, String(r.plain ?? r.latex), { note: r.note || `plug-in ${name}` });
  return res;
}
async function evalTool(name, args, whole) {
  const spec = toolSpec(name);
  const parts = matchToolArgs(name, spec, args);
  const keep = new Set();
  for (const { kind, text } of parts) {
    if (kind === 'v' || kind === 'V') listItems(text).forEach(t => { if (!IDENT_RE.test(t)) throw new Error(`"${t}" should be a variable name. Use ${spec.sig}.`); keep.add(t); });
    if (kind === 'R') { const [v] = listItems(text); if (!IDENT_RE.test(v || '')) throw new Error('Each range looks like [x, a, b].'); keep.add(v); }
    if (kind === 'f') { const m = text.match(/^[A-Za-z_]\w*\s*\(\s*([A-Za-z_]\w*)\s*\)$/); if (!m) throw new Error(`Name the sequence like a(n). Use ${spec.sig}.`); keep.add(m[1]); }
  }
  const unavailable = () => {
    if (spec.fallback === 'mathjs' && whole) return evalExpression(whole);
    const js = JS_TOOLS[name];
    if (js) {
      try {
        const res = js(parts.map(p => p.text), parts);
        res.note = res.note ?? fallbackNote();
        return res;
      } catch (err) { if (!(err instanceof NotCertain)) throw err; }
    }
    throw new Error(`${name}() needs the exact engine${needsExactHint()}.`);
  };
  if (!state.engineEnabled || !engineReady()) return unavailable();
  for (const { kind, text } of parts) if (kind === 'L') listItems(text).forEach(t => { if (IDENT_RE.test(t) && !CONSTANT_NAMES.includes(t)) keep.add(t); });
  const tVar = (parts.find(p => p.kind === 'v' && name === 'diffelim') || {}).text || 't';
  const argText = ({ kind, text }) => kind === 'r' ? relationText(text)
    : kind === 'q' ? (LONE_EQ.test(text) ? relationText(text) : text)
    : kind === 'L' ? `__list(${listItems(text).map(t => LONE_EQ.test(t) ? relationText(t) : t).join(', ')})`
    : kind === 'D' ? `__list(${listItems(text).map(t => relationText(odeSystemText(t, text, tVar))).join(', ')})`
    : text;
  let payload;
  try { payload = parts.map(p => ast(argText(p), [...keep])); }
  catch (err) { if (err instanceof UnsupportedForSympy) return unavailable(); throw err; }
  const r = await exact('tool', { name, args: payload, vars: [...keep] });
  if (!r) return unavailable();
  if (r.error) throw new Error(r.error);
  const steps = stepList(r.steps);
  const argTex = parts.map(({ kind, text }) => { try { return math.parse(kind === 'r' ? relationText(text) : text).toTex({ parenthesis: 'auto' }); } catch { return `\\text{${escTex(text)}}`; } });
  let res;
  if (r.display) res = checked(texResult(r.display.latex, r.display.plain, { engine: 'sympy', steps }), r);
  else {
    const prefix = r.prefix ?? `\\operatorname{${escTex(name)}}\\left(${argTex.join(',\\ ')}\\right) = `;
    res = checked(presentValue(r.value, { prefix, steps, plotVar: false }), r);
    if (r.numeric) res.note = 'numeric';
  }
  if (r.plotSpec) {        // tools that draw (bode): shown open, like plot(...)
    const rg = r.plotSpec.range;
    res.plotSpec = { items: r.plotSpec.items.map(it => ({ ...it, v: it.v || r.plotSpec.v })), range: rg ? { v: r.plotSpec.v, a: rg[0], b: rg[1] } : null };
    res.type = 'plot';
  }
  if (r.lean) res.lean = r.lean;
  if (Array.isArray(r.plot) && r.plot.length) {
    const v = r.plotVar || 'x';
    res.plot = r.plot.length === 1 ? { expr: r.plot[0], v } : null;
    if (r.plot.length > 1) res.plotSpec = { items: r.plot.map(expr => ({ kind: 'fn', expr, label: expr })), v };
  }
  return res;
}

// Tools the JavaScript engine can answer with certainty while SymPy is unavailable.
const substituted = (text, keep = []) => substituteWorkspace(text, keep).toString();
const JS_TOOLS = {
  ...Object.fromEntries(Object.entries(JS_NUMBER_THEORY).map(([n, fn]) => [n, (texts) => {
    const r = fn(texts.map(t => substituted(t)));
    return texResult(r.latex, r.plain, { engine: 'js' });
  }])),
  // subs(f, x, a) with a numeric value: evaluate f there.
  subs: (texts) => {
    const [f, ...rest] = texts;
    if (/\bdiff\s*\(/.test(f)) throw new NotCertain('derivatives need the exact engine');
    const pairs = [];
    for (let i = 0; i + 1 < rest.length; i += 2) pairs.push([rest[i], rest[i + 1]]);
    const at = Object.fromEntries(pairs.map(([v, a]) => [v, math.evaluate(a, ctx())]));
    const val = substituteWorkspace(f, pairs.map(p => p[0])).compile().evaluate(ctx(at));
    if (typeof val !== 'number' && !(val && val.isComplex)) throw new NotCertain('not a number');
    return texResult(`\\left. ${texOf(f)} \\right|_{${pairs.map(([v, a]) => `${v} = ${texOf(a)}`).join(',\\ ')}} = ${toTex(val)}`, fmtR(val), { engine: 'js' });
  },
  // ∫∫ f over [x, a, b], [y, c(x), d(x)], …: nested adaptive quadrature (innermost range first).
  integrate_multi: (texts) => {
    const ranges = texts.slice(1).map(listItems);
    if (ranges.length > 3) throw new NotCertain('more than three nested integrals');
    const vars = ranges.map(r => r[0]);
    let inner = substituteWorkspace(texts[0], vars).compile();
    for (const [v, a, b] of ranges) {
      const prev = inner, ca = substituteWorkspace(a, vars).compile(), cb = substituteWorkspace(b, vars).compile();
      inner = { evaluate: (loc) => numInt(prev, v, toReal(ca.evaluate(loc)), toReal(cb.evaluate(loc)), loc, ranges.length > 1 ? 1e-10 : 1e-11) };
    }
    const val = inner.evaluate(ctx());
    if (!isFinite(val)) throw new NotCertain('the integral did not converge numerically');
    const pre = ranges.slice().reverse().map(([, a, b]) => `\\int_{${texOf(a)}}^{${texOf(b)}}`).join('') + ` ${texOf(texts[0])}\\, ` + vars.map(v => `d${v}`).join('\\,') + ' = ';
    const res = texResult(pre + texNum(val), fmtNum(val), { engine: 'js', steps: [{ d: 'Method', e: 'Nested adaptive Simpson quadrature' }] });
    res.note = 'numeric';
    return res;
  },
};

// histogram, boxplot, scatter, graph, shortestpath, tree, plot3d, riemann (see viz.js)
const VIZ_HEADS = ['histogram', 'boxplot', 'scatter', 'graph', 'shortestpath', 'tree', 'plot3d', 'riemann', 'sdepaths'];
// Every function name the router handles itself (the language server must know them all).
export const opHeads = () => [...Object.keys(ALGEBRA_OPS), ...Object.keys(CALCULUS_OPS), ...VIZ_HEADS];
function evalViz(head, args) {
  const evaluate = (t) => math.evaluate(inlineUserFns(normalise(t)), ctx());
  if (['histogram', 'boxplot', 'scatter'].includes(head)) return evalStatPlot(head, args, evaluate);
  if (head === 'graph' || head === 'shortestpath') return evalGraph(head, args, evaluate);
  if (head === 'tree') return evalTree(args);
  if (head === 'sdepaths') return evalSdePaths(args, evaluate);
  return evalPlot3d(head, args, evaluate);
}

// plot(sin(x), x^2 + y^2 = 4, [cos(t), sin(t)], r = 1 + cos(theta), [x, -5, 5])
function evalPlot(args) {
  const spec = parsePlotItems(args);
  const res = texResult(plotSpecTex(spec), `plot(${args.join(', ')})`, { engine: null });
  res.type = 'plot';
  res.plotSpec = spec;
  return res;
}

// ── Units ─────────────────────────────────────────────
async function evalUnits(expr) {
  const r = await workerEval(expr);
  const plain = r && r.isUnit ? math.format(r, { precision: 10 }) : fmtR(r);
  return { type: 'unit', out: `\\text{${escTex(plain)}}`, plain, engine: 'js' };
}

// Apply a transformation to a sub-expression (used by click-to-explore).
export async function transformSub(kind, sub, v) {
  if (kind === 'approx') {
    const val = await workerEval(sub);
    return fmtR(val);
  }
  const fn = kind === 'derivative' ? evalDerivative : ALGEBRA_OPS[kind];
  const res = await fn(kind === 'derivative' ? `derivative(${sub}, ${v})` : `${kind}(${sub})`);
  if (res.expr) return res.expr;
  throw new Error('Could not transform this part');
}
