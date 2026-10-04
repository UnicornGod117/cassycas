// Plug-in API. Add a tool from the browser console or a script you trust:
//
//   CAS.plugins.register({
//     name: 'double', sig: 'double(x)', desc: 'Twice x', mode: 'algebra', ex: 'double(21)',
//     run(args, { evaluate }) { const v = evaluate(args[0]); return { latex: String(2 * v), plain: String(2 * v) }; },
//   });
//
//   await CAS.plugins.registerPython('cube', 'def t_cube(e):\n    return e**3', { sig: 'cube(x)', desc: 'x³' });
//
// A JavaScript plug-in receives its argument texts and returns { latex, plain } (or a promise of
// one). A Python plug-in defines t_<name>(...) in the SymPy worker: it receives SymPy objects,
// returns a SymPy object or show(latex, plain), exactly like the built-in tools in tools.py.
// Plug-ins appear in autocomplete and the palette. They run with the page's privileges, so only
// register code you would run yourself; nothing is ever loaded from a URL.
import { TOOLS } from './tools.js';
import { ACD } from './modes.js';

export const PLUGINS = {};
const listeners = [];
export const onPluginsChanged = (f) => listeners.push(f);
const changed = () => listeners.forEach(f => { try { f(); } catch {} });
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Names of built-in functions and tools: a plug-in must not shadow them.
const builtin = (name) => (TOOLS[name] && !TOOLS[name].python) || ACD.some(d => d.n === name && !PLUGINS[name] && !TOOLS[name]?.python)
  || ['sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'abs', 'solve', 'factor', 'expand', 'simplify', 'integrate', 'diff', 'limit', 'sum', 'plot'].includes(name);

export function registerPlugin(p) {
  if (!p || !NAME.test(p.name || '') || typeof p.run !== 'function') throw new Error('A plug-in needs a name and a run(args, helpers) function.');
  if (builtin(p.name)) throw new Error(`${p.name} is a built-in tool.`);
  PLUGINS[p.name] = { sig: `${p.name}(…)`, desc: 'Plug-in', mode: 'algebra', ...p };
  changed();
  return PLUGINS[p.name];
}
export function unregisterPlugin(name) { delete PLUGINS[name]; if (TOOLS[name]?.python) delete TOOLS[name]; changed(); }

// Python: send the source to the worker (op 'plugin'), then expose the name as a tool whose
// arguments are all expressions.
export async function registerPythonPlugin(name, source, { sig, desc, mode = 'algebra', args = 'e*' } = {}, sympy) {
  if (!NAME.test(name)) throw new Error('Plug-in names are identifiers.');
  if (builtin(name)) throw new Error(`${name} is a built-in tool.`);
  if (typeof source !== 'string' || !new RegExp(`def\\s+t_${name}\\s*\\(`).test(source)) throw new Error(`Define t_${name}(...) in the source.`);
  const r = await sympy('plugin', { name, source });
  if (!r || r.error) throw new Error(r ? r.error : 'The exact engine is unavailable.');
  TOOLS[name] = { args, mode, sig: sig || `${name}(…)`, desc: desc || 'Python plug-in', ex: `${name}(x)`, python: true };
  changed();
  return TOOLS[name];
}
