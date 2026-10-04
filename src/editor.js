// Input editor (CodeMirror 6): CAS syntax highlighting, autocomplete, history, Enter to run.
import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap, acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { ACD } from './modes.js';
import { scope, userFns, objects, state, OBJECT_CTORS } from './state.js';
import { PLUGINS } from './plugins.js';
import { TOOLS } from './tools.js';
import { fmtR } from './format.js';

const KEYWORDS = new Set(ACD.map(d => d.n).concat(['sqrt', 'exp', 'log', 'abs', 'to', 'unit', 'dsolve']));
const CONSTANTS = new Set(['pi', 'e', 'phi', 'tau', 'i', 'Infinity', 'true', 'false', 'NaN']);

const casLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match('#')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/^\d+\.?\d*([eE][+-]?\d+)?/)) return 'number';
    if (stream.match(/^"[^"]*"?/)) return 'string';
    const w = stream.match(/^[A-Za-z_]\w*/);
    if (w) {
      const word = w[0];
      if (CONSTANTS.has(word)) return 'atom';
      if (KEYWORDS.has(word)) return 'keyword';
      if (stream.match(/^\s*\(/, false)) return 'function';
      return 'variableName';
    }
    if (stream.match(/^[=!<>]=?|^[+\-*/^%']/)) return 'operator';
    stream.next();
    return 'punctuation';
  },
});
const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--a0)', fontWeight: '600' },
  { tag: t.atom, color: 'var(--warm)' },
  { tag: t.number, color: 'var(--cyan)' },
  { tag: t.string, color: 'var(--rose)' },
  { tag: [t.function(t.variableName), t.function], color: 'var(--violet)' },
  { tag: t.variableName, color: 'var(--t0)' },
  { tag: t.operator, color: 'var(--t2)' },
  { tag: t.comment, color: 'var(--t3)', fontStyle: 'italic' },
]);
const theme = EditorView.theme({
  '&': { fontSize: '13.5px', backgroundColor: 'transparent', color: 'var(--t0)' },
  '.cm-content': { fontFamily: 'var(--mono)', padding: '14px 0', caretColor: 'var(--a0)' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--a0)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--a-tint) !important' },
  '.cm-placeholder': { color: 'var(--t3)' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: '8px', fontFamily: 'var(--mono)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--s3)', color: 'var(--t0)' },
  '.cm-completionDetail': { color: 'var(--t2)', fontStyle: 'normal', marginLeft: '10px' },
});

// Context-aware: after "X ~" only distributions; inside a call, the variables of the first
// argument come first (integrate(x*y^2, |) offers x and y); the current mode's functions rank
// above the rest; named objects, user functions, variables and plug-ins are always offered.
const DISTS = new Set(OBJECT_CTORS.filter(n => ACD.some(d => d.n === n && d.t === 'stats')));
const modeMatch = (t) => t && state.curMode && (state.curMode.startsWith(t) || t.startsWith(state.curMode));
function enclosingCall(before) {
  let depth = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const c = before[i];
    if (c === ')' || c === ']') depth++;
    else if (c === '(' || c === '[') {
      if (depth === 0) {
        if (c === '[') continue;
        const m = before.slice(0, i).match(/([A-Za-z_]\w*)\s*$/);
        return m ? { name: m[1], args: before.slice(i + 1) } : null;
      }
      depth--;
    }
  }
  return null;
}
function firstArgSymbols(args) {
  let depth = 0, end = args.length;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { end = i; break; }
  }
  if (end === args.length) return [];          // still typing the first argument
  const names = args.slice(0, end).match(/[A-Za-z_]\w*/g) || [];
  return [...new Set(names.filter(n => !KEYWORDS.has(n) && !CONSTANTS.has(n) && !userFns[n] && !objects[n]))];
}
export function completions(context) {
  const word = context.matchBefore(/[A-Za-z_]\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const before = context.state.sliceDoc(0, word.from);
  if (/~\s*$/.test(before)) {
    return { from: word.from, validFor: /^\w*$/,
      options: ACD.filter(d => DISTS.has(d.n)).map(d => ({ label: d.n, type: 'class', detail: d.s, info: d.d, apply: d.n + '(', boost: 5 })) };
  }
  const call = enclosingCall(before);
  const argVars = call ? firstArgSymbols(call.args) : [];
  const fn = (d) => ({ label: d.n, type: 'function', detail: d.s, info: d.d, apply: d.n + '(', boost: modeMatch(d.t) ? 2 : 0 });
  const options = [
    ...argVars.map(v => ({ label: v, type: 'variable', detail: `in ${call.name}'s first argument`, boost: 10 })),
    ...ACD.filter(d => !PLUGINS[d.n]).map(fn),
    ...Object.entries(PLUGINS).map(([n, p]) => ({ label: n, type: 'function', detail: p.sig, info: p.desc, apply: n + '(', boost: 1 })),
    ...Object.entries(TOOLS).filter(([, t]) => t.python).map(([n, t]) => ({ label: n, type: 'function', detail: t.sig, info: t.desc, apply: n + '(', boost: 1 })),
    ...Object.keys(objects).map(k => ({ label: k, type: 'constant', detail: 'object', boost: 3 })),
    ...Object.keys(userFns).map(k => ({ label: k, type: 'function', detail: `${k}(${userFns[k].params.join(', ')})`, apply: k + '(', boost: 3 })),
    ...Object.keys(scope).filter(k => typeof scope[k] !== 'function' && !argVars.includes(k)).map(k => ({ label: k, type: 'variable', detail: fmtR(scope[k]).slice(0, 24), boost: 3 })),
  ];
  const seen = new Set();
  return { from: word.from, options: options.filter(o => !seen.has(o.label) && seen.add(o.label)), validFor: /^\w*$/ };
}

export function createEditor(parent, { onRun, onChange }) {
  const hist = [];
  let histIdx = -1;
  const setDoc = (view, text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
  const runKeys = Prec.highest(keymap.of([
    { key: 'Tab', run: acceptCompletion },
    { key: 'Enter', run: (view) => { if (completionStatus(view.state) === 'active') return false; onRun(); return true; } },
    { key: 'Shift-Enter', run: (view) => { view.dispatch(view.state.replaceSelection('\n')); return true; } },
    { key: 'Alt-ArrowUp', run: (view) => { if (histIdx < hist.length - 1) { histIdx++; setDoc(view, hist[histIdx]); } return true; } },
    { key: 'Alt-ArrowDown', run: (view) => { if (histIdx > 0) { histIdx--; setDoc(view, hist[histIdx]); } else { histIdx = -1; setDoc(view, ''); } return true; } },
  ]));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '',
      extensions: [
        runKeys, history(), drawSelection(), bracketMatching(),
        keymap.of([...completionKeymap, ...historyKeymap, ...defaultKeymap]),
        autocompletion({ override: [completions], activateOnTyping: true, maxRenderedOptions: 12 }),
        casLanguage, syntaxHighlighting(highlight), theme, EditorView.lineWrapping,
        placeholder('Type an expression…  e.g.  integrate(x*sin(x), x)'),
        EditorView.updateListener.of(u => { if (u.docChanged) onChange(u.state.doc.toString()); }),
        EditorView.domEventHandlers({
          focus: () => parent.closest('.input-wrap')?.classList.add('focused'),
          blur: () => parent.closest('.input-wrap')?.classList.remove('focused'),
        }),
      ],
    }),
  });
  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (text) => setDoc(view, text),
    insert: (text) => { view.dispatch(view.state.replaceSelection(text)); view.focus(); },
    focus: () => view.focus(),
    pushHistory: (text) => { hist.unshift(text); histIdx = -1; },
  };
}
