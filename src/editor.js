// Input editor (CodeMirror 6): CAS syntax highlighting, autocomplete, history, Enter to run.
import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap, acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { ACD } from './modes.js';
import { scope, userFns } from './state.js';
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

function completions(context) {
  const word = context.matchBefore(/[A-Za-z_]\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const options = [
    ...ACD.map(d => ({ label: d.n, type: 'function', detail: d.s, apply: d.n + '(' })),
    ...Object.keys(userFns).map(k => ({ label: k, type: 'function', detail: `${k}(${userFns[k].params.join(', ')})`, apply: k + '(' })),
    ...Object.keys(scope).filter(k => typeof scope[k] !== 'function').map(k => ({ label: k, type: 'variable', detail: fmtR(scope[k]).slice(0, 24) })),
  ];
  return { from: word.from, options, validFor: /^\w*$/ };
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
