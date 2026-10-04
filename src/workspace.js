// Notebook persistence, version history, undo/redo, the function library, Markdown/Quarto
// export and import, and citations. Storage is IndexedDB (store.js); everything stays on the
// device.
import * as store from './store.js';
import { PYODIDE_VERSION } from './sympy/version.js';

// ── current notebook and version history ─────────────
const MAX_VERSIONS = 300;
const cellKey = (c) => JSON.stringify(c.type === 'text' ? ['t', c.content] : ['m', c.mode, c.expr]);
let lastSaved = null, timer = null, pending = null;

// Save the notebook now (current) and, after a pause in editing, as a new version.
export function saveNotebook(data, { immediate = false } = {}) {
  pending = data;
  store.put('notebooks', data, 'current').catch(() => {});
  clearTimeout(timer);
  if (immediate) return recordVersion();
  timer = setTimeout(recordVersion, 1500);
}
export async function loadCurrent() {
  try { return (await store.get('notebooks', 'current')) || null; } catch { return null; }
}
async function recordVersion(label = '') {
  const data = pending;
  if (!data) return null;
  const keys = [];
  for (const c of data.cells) {
    const text = cellKey(c), h = store.hash(text);
    keys.push(h);
    if (!(await store.get('cells', h))) await store.put('cells', c, h);    // shared by every version that has it
  }
  const sig = JSON.stringify([keys, data.exactMode, data.angleMode]);
  if (sig === lastSaved && !label) return null;
  lastSaved = sig;
  const id = await store.put('versions', { time: Date.now(), label, cells: keys, exactMode: data.exactMode, angleMode: data.angleMode, scope: data.scope || {} });
  const all = await store.getAll('versions');
  if (all.length > MAX_VERSIONS) for (const v of all.filter(v => !v.label).slice(0, all.length - MAX_VERSIONS)) await store.del('versions', v.id);
  return id;
}
export async function checkpoint(data, label) { pending = data; return recordVersion(label || 'checkpoint'); }
export async function listVersions() {
  const all = await store.getAll('versions');
  return all.sort((a, b) => b.time - a.time);
}
export async function loadVersion(id) {
  const v = (await store.getAll('versions')).find(x => x.id === id);
  if (!v) throw new Error('That version no longer exists');
  const cells = [];
  for (const h of v.cells) { const c = await store.get('cells', h); if (c) cells.push(c); }
  return { version: 4, exactMode: v.exactMode, angleMode: v.angleMode, scope: v.scope, cells };
}
export async function labelVersion(id, label) {
  const v = (await store.getAll('versions')).find(x => x.id === id);
  if (v) await store.put('versions', { ...v, label });
}
// How two versions differ, by cells added and removed.
export function diffCells(a, b) {
  const A = new Map(), B = new Map();
  a.forEach(k => A.set(k, (A.get(k) || 0) + 1)); b.forEach(k => B.set(k, (B.get(k) || 0) + 1));
  let added = 0, removed = 0;
  for (const [k, n] of B) added += Math.max(0, n - (A.get(k) || 0));
  for (const [k, n] of A) removed += Math.max(0, n - (B.get(k) || 0));
  return { added, removed };
}

// ── undo / redo (in memory; snapshots share their cell objects) ──
const undoStack = [], redoStack = [];
let current = null;
export function trackForUndo(data) {
  const sig = JSON.stringify(data.cells.map(cellKey));
  if (current && current.sig === sig) return;
  if (current) { undoStack.push(current); if (undoStack.length > 100) undoStack.shift(); }
  current = { sig, data };
  redoStack.length = 0;
}
export function undo() {
  if (!undoStack.length) return null;
  redoStack.push(current); current = undoStack.pop();
  return current.data;
}
export function redo() {
  if (!redoStack.length) return null;
  undoStack.push(current); current = redoStack.pop();
  return current.data;
}
export const canUndo = () => undoStack.length > 0, canRedo = () => redoStack.length > 0;

// ── function library ─────────────────────────────────
export const BUILTIN_LIBRARY = [
  { name: 'sigmoid', def: 'sigmoid(x) = 1/(1 + exp(-x))', desc: 'Logistic function' },
  { name: 'gauss', def: 'gauss(x, mu, s) = exp(-(x - mu)^2/(2 s^2))/(s sqrt(2 pi))', desc: 'Normal density' },
  { name: 'sinc', def: 'sinc(x) = sin(x)/x', desc: 'Unnormalised sinc' },
  { name: 'relu', def: 'relu(x) = (x + abs(x))/2', desc: 'Rectified linear unit' },
  { name: 'softplus', def: 'softplus(x) = log(1 + exp(x))', desc: 'Smooth ReLU' },
  { name: 'lerp', def: 'lerp(a, b, t) = a + (b - a) t', desc: 'Linear interpolation' },
  { name: 'compound', def: 'compound(P, r, n, t) = P (1 + r/n)^(n t)', desc: 'Compound interest' },
  { name: 'dist2', def: 'dist2(x1, y1, x2, y2) = sqrt((x2 - x1)^2 + (y2 - y1)^2)', desc: 'Distance between two points' },
  { name: 'hav', def: 'hav(t) = sin(t/2)^2', desc: 'Haversine' },
  { name: 'logistic', def: 'logistic(t, K, r, P0) = K/(1 + (K - P0)/P0 exp(-r t))', desc: 'Logistic growth' },
];
export async function libraryList() {
  const mine = await store.getAll('library');
  return [...mine.map(f => ({ ...f, mine: true })), ...BUILTIN_LIBRARY.filter(b => !mine.some(m => m.name === b.name))];
}
export async function librarySave(name, def, desc = '') { await store.put('library', { name, def, desc, time: Date.now() }); }
export async function libraryRemove(name) { await store.del('library', name); }

// ── Markdown / Quarto ────────────────────────────────
// Math cells become ```cas blocks (the mode in braces) followed by their result as display math;
// text cells are Markdown. fromMarkdown reads the same format back (outputs are recomputed).
export function toMarkdown(data, outputs, { quarto = false, title = 'CassyCAS notebook' } = {}) {
  const lines = [];
  if (quarto) lines.push('---', `title: "${title.replace(/"/g, "'")}"`, 'format: html', `date: ${new Date().toISOString().slice(0, 10)}`, '---', '');
  data.cells.forEach((c, i) => {
    if (c.type === 'text') { lines.push(c.content, ''); return; }
    lines.push(quarto ? '```{.cas mode="' + c.mode + '"}' : '```cas {mode=' + c.mode + '}', c.expr, '```');
    const out = outputs[i];
    if (out && out.latex) lines.push('', `$$${out.latex}$$`);
    lines.push('');
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
export function fromMarkdown(text) {
  const cells = [];
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  const re = /```\s*(?:\{\.cas([^}]*)\}|cas\s*(\{[^}]*\})?)[^\n]*\n([\s\S]*?)```/g;
  let last = 0, m;
  const prose = (s) => {
    const t = s.replace(/\$\$[\s\S]*?\$\$/g, '').trim();      // outputs are recomputed, not imported
    if (t) cells.push({ type: 'text', content: t });
  };
  while ((m = re.exec(body))) {
    prose(body.slice(last, m.index));
    const attrs = (m[1] || m[2] || '').match(/mode\s*=\s*"?([a-z]+)"?/);
    for (const line of m[3].split('\n').map(l => l.trim()).filter(Boolean)) cells.push({ type: 'math', mode: attrs ? attrs[1] : 'algebra', expr: line });
    last = re.lastIndex;
  }
  prose(body.slice(last));
  if (!cells.some(c => c.type === 'math')) throw new Error('No ```cas blocks found in this Markdown file');
  return { version: 4, exactMode: true, angleMode: 'rad', scope: {}, cells };
}

// ── citations ────────────────────────────────────────
export function citations({ link } = {}) {
  const year = new Date().getFullYear(), today = new Date().toISOString().slice(0, 10);
  const bib = `@software{cassycas,
  title  = {CassyCAS: a browser-native symbolic workstation},
  author = {{CassyCAS contributors}},
  year   = {${year}},
  url    = {https://github.com/UnicornGod117/cassycas},
  note   = {Exact engine: SymPy on Pyodide ${PYODIDE_VERSION}. Accessed ${today}}
}

@article{sympy,
  title   = {SymPy: symbolic computing in Python},
  author  = {Meurer, Aaron and Smith, Christopher P. and Paprocki, Mateusz and {\\v{C}}ert{\\'i}k, Ond{\\v{r}}ej and Kirpichev, Sergey B. and Rocklin, Matthew and Kumar, AMiT and Ivanov, Sergiu and Moore, Jason K. and Singh, Sartaj and others},
  journal = {PeerJ Computer Science},
  volume  = {3},
  pages   = {e103},
  year    = {2017},
  doi     = {10.7717/peerj-cs.103}
}

@software{mpmath,
  title  = {mpmath: a Python library for arbitrary-precision floating-point arithmetic},
  author = {{The mpmath development team}},
  url    = {https://mpmath.org/}
}

@software{pyodide,
  title   = {Pyodide},
  author  = {{The Pyodide development team}},
  version = {${PYODIDE_VERSION}},
  url     = {https://pyodide.org/}
}${link ? `

@misc{notebook,
  title = {CassyCAS notebook},
  year  = {${year}},
  url   = {${link.length > 2000 ? link.slice(0, 2000) + '…' : link}},
  note  = {Accessed ${today}}
}` : ''}
`;
  const apa = [
    `CassyCAS contributors. (${year}). CassyCAS: a browser-native symbolic workstation [Computer software]. https://github.com/UnicornGod117/cassycas`,
    'Meurer, A., Smith, C. P., Paprocki, M., Čertík, O., Kirpichev, S. B., Rocklin, M., … Scopatz, A. (2017). SymPy: symbolic computing in Python. PeerJ Computer Science, 3, e103. https://doi.org/10.7717/peerj-cs.103',
    `The Pyodide development team. Pyodide (Version ${PYODIDE_VERSION}) [Computer software]. https://pyodide.org/`,
  ];
  return { bib, apa };
}
