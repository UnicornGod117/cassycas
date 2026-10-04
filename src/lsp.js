// Language analysis for editors (bin/cassycas-lsp.mjs): diagnostics, hover and completion for
// CassyCAS input outside the browser. A document is either plain CAS input (one cell per line,
// "#" lines are notes) or Markdown/Quarto, where only ```cas blocks are read (workspace.js).
// Pure functions of the text, so they are tested in Node without an editor.
import { ACD } from './modes.js';
import { TOOLS } from './tools.js';
import { canonical, math, parseTopLevelArgs, xarg } from './expr.js';
import { OBJECT_CTORS } from './state.js';

const BUILTIN_HEADS = new Set([
  ...ACD.map(d => d.n), ...Object.keys(TOOLS), ...OBJECT_CTORS,
  'plot', 'slopefield', 'vectorfield', 'domaincolor', 'dsolve', 'assume', 'Point', 'Line', 'Segment', 'Circle', 'Triangle', 'Polygon',
  // engine.js ALGEBRA_OPS / CALCULUS_OPS (kept in step by tests/lsp.test.mjs)
  'simplify', 'expand', 'factor', 'collect', 'apart', 'together', 'cancel', 'rationalize', 'trigsimp', 'expand_trig', 'polydiv',
  'derivative', 'diff', 'integrate', 'limit', 'sum', 'product', 'series', 'taylor', 'gradient', 'ode',
  'histogram', 'boxplot', 'scatter', 'graph', 'shortestpath', 'tree', 'plot3d', 'riemann', 'sdepaths', 'P', 'E', 'Var', 'N', 'subs',
]);
const isBuiltin = (n) => BUILTIN_HEADS.has(n) || typeof math[n] === 'function';
const DOC = new Map(ACD.filter(d => d && d.n).map(d => [d.n, { sig: d.s, desc: d.d || '' }]));
for (const [n, t] of Object.entries(TOOLS)) DOC.set(n, { sig: t.sig, desc: t.desc || '' });

// The lines of a document that are CAS input: [{ line, text }].
export function cellsOf(text, { markdown = false } = {}) {
  const lines = text.split(/\r?\n/), out = [];
  let inBlock = !markdown;
  lines.forEach((l, i) => {
    if (markdown && /^\s*```/.test(l)) { inBlock = /^\s*```\s*(\{\.cas|cas\b)/.test(l) && !inBlock; return; }
    if (!inBlock || !l.trim() || l.trim().startsWith('#') || l.trim().startsWith('//')) return;
    out.push({ line: i, text: l });
  });
  return out;
}

// Names the document defines: f(x) = …, a = …, X ~ Normal(…).
export function definitions(cells) {
  const fns = new Map(), vars = new Map();
  for (const { line, text } of cells) {
    let m = text.match(/^\s*([A-Za-z_]\w*)\s*\(([^()]*)\)\s*=(?!=)/);
    if (m) { fns.set(m[1], { line, params: m[2].split(',').map(s => s.trim()).filter(Boolean), text: text.trim() }); continue; }
    m = text.match(/^\s*([A-Za-z_]\w*)\s*(?:=(?!=)|~)/);
    if (m) vars.set(m[1], { line, text: text.trim() });
  }
  return { fns, vars };
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function suggest(name) {
  let best = null, bd = 3;
  for (const n of BUILTIN_HEADS) { const k = editDistance(name.toLowerCase(), n.toLowerCase()); if (k < bd) { bd = k; best = n; } }
  return best;
}
function arity(name) {
  const spec = TOOLS[name];
  if (!spec || !spec.args) return null;
  const kinds = spec.args.split(',');
  const min = kinds.filter(k => !k.endsWith('*') && !k.endsWith('?') && !k.includes('=')).length;
  const max = kinds.some(k => k.endsWith('*')) ? Infinity : kinds.length;
  return { min, max, sig: spec.sig };
}

// Diagnostics: [{ line, start, end, severity: 1 error | 2 warning, message }].
export function diagnose(text, opts = {}) {
  const cells = cellsOf(text, opts);
  const { fns } = definitions(cells);
  const out = [];
  for (const { line, text: src } of cells) {
    const diag = (start, end, severity, message) => out.push({ line, start, end, severity, message });
    // brackets, on the text as typed
    const stack = [];
    let bad = false;
    for (let i = 0; i < src.length && !bad; i++) {
      const c = src[i];
      if ('([{'.includes(c)) stack.push([c, i]);
      else if (')]}'.includes(c)) {
        const top = stack.pop();
        if (!top || '([{'.indexOf(top[0]) !== ')]}'.indexOf(c)) { diag(i, i + 1, 1, top ? `"${c}" does not match "${top[0]}"` : `Unmatched "${c}"`); bad = true; }
      }
    }
    if (bad) continue;
    if (stack.length) { const [c, i] = stack[stack.length - 1]; diag(i, i + 1, 1, `"${c}" is never closed`); continue; }
    let can;
    try { can = canonical(src); } catch (e) { diag(0, src.length, 1, e.message); continue; }
    // calls: unknown functions and argument counts
    const re = /([A-Za-z_]\w*)\s*\(/g;
    let m;
    while ((m = re.exec(can))) {
      const name = m[1];
      if (/\w/.test(can[m.index - 1] || '') || can[m.index - 1] === '.') continue;
      const at = src.search(new RegExp(`\\b${name}\\s*\\(`));
      const [s, e] = at >= 0 ? [at, at + name.length] : [0, src.length];
      if (!isBuiltin(name) && !fns.has(name) && name.length > 1 && !/^[A-Z]$/.test(name)) {
        const isDef = new RegExp(`^\\s*${name}\\s*\\([^()]*\\)\\s*=`).test(can);
        if (!isDef) { const sug = suggest(name); diag(s, e, 2, `Unknown function ${name}${sug ? ` — did you mean ${sug}?` : ''}`); }
        continue;
      }
      const ar = arity(name);
      if (ar) {
        let n;
        try { n = parseTopLevelArgs(xarg(can.slice(m.index), name)).length; } catch { continue; }
        if (n < ar.min || n > ar.max) diag(s, e, 1, `${name} takes ${ar.max === Infinity ? `at least ${ar.min}` : ar.min === ar.max ? ar.min : `${ar.min}–${ar.max}`} argument${ar.max === 1 ? '' : 's'}: ${ar.sig}`);
      }
      const f = fns.get(name);
      if (f && !isBuiltin(name)) {
        let n;
        try { n = parseTopLevelArgs(xarg(can.slice(m.index), name)).length; } catch { continue; }
        const isOwnDef = f.line === line;
        if (!isOwnDef && n !== f.params.length) diag(s, e, 1, `${name} takes ${f.params.length} argument${f.params.length === 1 ? '' : 's'} (line ${f.line + 1}: ${f.text})`);
      }
    }
  }
  return out;
}

const wordAt = (lineText, ch) => {
  let a = ch, b = ch;
  while (a > 0 && /\w/.test(lineText[a - 1])) a--;
  while (b < lineText.length && /\w/.test(lineText[b])) b++;
  return a < b ? { word: lineText.slice(a, b), start: a, end: b } : null;
};

// Hover text (Markdown) for the word at a position, or null.
export function hover(text, line, ch, opts = {}) {
  const l = text.split(/\r?\n/)[line] || '';
  const w = wordAt(l, ch);
  if (!w) return null;
  const { fns, vars } = definitions(cellsOf(text, opts));
  if (fns.has(w.word)) return { ...w, contents: `\`${fns.get(w.word).text}\`\n\nDefined on line ${fns.get(w.word).line + 1}.` };
  if (vars.has(w.word)) return { ...w, contents: `\`${vars.get(w.word).text}\`\n\nDefined on line ${vars.get(w.word).line + 1}.` };
  const d = DOC.get(w.word);
  if (d) return { ...w, contents: `\`${d.sig}\`${d.desc ? `\n\n${d.desc}` : ''}` };
  return null;
}

// Completion items for the prefix before a position.
export function complete(text, line, ch, opts = {}) {
  const l = (text.split(/\r?\n/)[line] || '').slice(0, ch);
  const prefix = (l.match(/[A-Za-z_]\w*$/) || [''])[0];
  const { fns, vars } = definitions(cellsOf(text, opts));
  const items = [
    ...[...fns].map(([n, f]) => ({ label: n, kind: 3, detail: f.text, insertText: n + '(' })),
    ...[...vars].map(([n, v]) => ({ label: n, kind: 6, detail: v.text })),
    ...[...DOC].map(([n, d]) => ({ label: n, kind: 3, detail: d.sig, documentation: d.desc, insertText: n + '(' })),
  ];
  const seen = new Set();
  return items.filter(i => i.label.startsWith(prefix) && !seen.has(i.label) && seen.add(i.label)).slice(0, 200);
}
