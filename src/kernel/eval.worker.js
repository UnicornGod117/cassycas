// mathjs evaluation kernel (runs off the main thread; terminated on timeout).
import { create, all } from 'mathjs';
import { makeDegFns } from './degree.js';

const math = create(all, { number: 'number' });
const DEG = makeDegFns(math);
const revive = (k, v) => (v && v.mathjs === 'number') ? Number(v.value) : math.reviver(k, v);

self.onmessage = (e) => {
  const { id, expr, scopeJSON, fns, deg } = e.data;
  try {
    const local = Object.assign(JSON.parse(scopeJSON, revive), deg ? DEG : null);
    for (const name in fns) {
      const { params, body } = fns[name];
      const compiled = math.compile(body);
      local[name] = (...args) => {
        const loc = Object.assign({}, local);
        params.forEach((p, i) => { loc[p] = args[i]; });
        return compiled.evaluate(loc);
      };
    }
    let res = math.evaluate(expr, local);
    if (res && res.isResultSet) res = res.entries[res.entries.length - 1];
    if (typeof res === 'function') throw new Error('Expression evaluates to a function, not a value');
    self.postMessage({ id, json: JSON.stringify(res === undefined ? null : res, math.replacer) });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
