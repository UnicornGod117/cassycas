// Differential test: every problem in tests/corpus/corpus.json (references computed by CPython
// SymPy, see tests/corpus/generate.py) is run through the evaluator of the built app.
//   exact engine    — must agree with the reference on every problem;
//   fallback engine — may decline (error, "no elementary antiderivative", …) but never be wrong.
// Answers are compared numerically with mathjs, so formatting differences do not matter.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { create, all } from 'mathjs';
import { openApp, hasWheels } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus', 'corpus.json'), 'utf8'));
const ENGINES = (process.env.CAS_ENGINES || 'exact,fallback').split(',');
const math = create(all);

const TOL = 1e-6;
const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) <= TOL * (1 + Math.hypot(b[0], b[1]));
const pair = (v) => typeof v === 'number' ? [v, 0] : v && v.isComplex ? [v.re, v.im] : null;
const lhs = (s) => s.split('≈')[0].trim();
const rhs = (s) => (s.split('≈')[1] || '').trim();
function num(s, scope = {}) {
  for (const cand of [lhs(s), rhs(s)]) {
    if (!cand) continue;
    try { const v = pair(math.evaluate(cand, scope)); if (v && v.every(Number.isFinite)) return v; } catch {}
  }
  return null;
}
const valuesAt = (expr, points) => points.map(p => { try { return pair(math.evaluate(expr, { x: p })); } catch { return null; } });

// Top-level factors that depend on x (a product has at least two, counting powers).
function xFactors(node) {
  while (node.isParenthesisNode || (node.isOperatorNode && node.fn === 'unaryMinus')) node = node.args ? node.args[0] : node.content;
  if (node.isOperatorNode && node.fn === 'multiply') return node.args.reduce((n, a) => n + xFactors(a), 0);
  const hasX = node.filter(n => n.isSymbolNode && n.name === 'x').length > 0;
  if (!hasX) return 0;
  if (node.isOperatorNode && node.fn === 'pow' && node.args[1].isConstantNode) return Number(node.args[1].value);
  return 1;
}

// → 'ok' | 'declined' | 'wrong: …'
function judge(item, r) {
  if (r.error) return 'declined';
  const plain = r.plain.replace(/\s*\+\s*C$/, '');
  switch (item.kind) {
    case 'value': {
      if (/no closed form|does not converge|diverges/i.test(plain)) return 'declined';
      const v = num(plain);
      if (!v) return `wrong: unparseable ${plain}`;
      if (!near(v, item.value)) return `wrong: ${plain} ≠ ${item.value[0]}`;
      return 'ok';
    }
    case 'function': case 'form': {
      const got = valuesAt(lhs(plain), item.points);
      const bad = got.findIndex((v, i) => !v || !near(v, item.values[i]));
      if (bad >= 0) return `wrong: ${plain} at x=${item.points[bad]} gives ${got[bad]}, want ${item.values[bad]}`;
      if (item.shape === 'product' && xFactors(math.parse(plain)) < 2) return `wrong: not factored: ${plain}`;
      if (item.shape === 'expanded' && /\(/.test(plain)) return `wrong: not expanded: ${plain}`;
      return 'ok';
    }
    case 'antiderivative': {
      if (/no elementary|no closed form/i.test(plain)) return 'declined';
      const h = 1e-5;
      for (const [i, p] of item.points.entries()) {
        const [a, b] = valuesAt(plain, [p + h, p - h]);
        if (!a || !b) return `wrong: F = ${plain} undefined near x=${p}`;
        const d = [(a[0] - b[0]) / (2 * h), (a[1] - b[1]) / (2 * h)];
        if (Math.abs(d[0] - item.values[i][0]) + Math.abs(d[1] - item.values[i][1]) > 1e-5 * (1 + Math.abs(item.values[i][0])))
          return `wrong: d/dx(${plain}) at x=${p} is ${d[0]}, want ${item.values[i][0]}`;
      }
      return 'ok';
    }
    case 'limit': {
      if (item.limit === 'dne') return plain === 'does not exist' ? 'ok' : `wrong: ${plain}, want does not exist`;
      if (typeof item.limit === 'string') return plain === item.limit ? 'ok' : `wrong: ${plain}, want ${item.limit}`;
      const v = num(plain);
      return v && near(v, [item.limit, 0]) ? 'ok' : `wrong: ${plain}, want ${item.limit}`;
    }
    case 'roots': {
      const parts = plain.split(/,\s*(?=x\s*=)/).map(s => s.replace(/^x\s*=\s*/, ''));
      const got = parts.map(s => num(s)).filter(Boolean).filter(v => Math.abs(v[1]) < 1e-9).map(v => v[0]).sort((a, b) => a - b);
      if (got.length !== item.roots.length || got.some((v, i) => !near([v, 0], [item.roots[i], 0])))
        return `wrong: ${plain}, want ${item.roots.join(', ')}`;
      return 'ok';
    }
  }
  return `wrong: unknown kind ${item.kind}`;
}

for (const name of ENGINES) {
  const exact = name === 'exact';
  describe(`corpus: ${name} engine`, { skip: exact && !hasWheels() && 'SymPy wheels missing: run `npm run test:setup`' }, () => {
    let app;
    before(async () => {
      app = await openApp({ engine: exact });
      if (exact) await app.waitForEngine();
      await app.page.evaluate(async () => { await window.CAS.setExact(true); await window.CAS.setAngle('rad'); });
    });
    after(async () => { await app?.close(); });

    test(`${CORPUS.length} problems`, { timeout: 30 * 60 * 1000 }, async () => {
      const results = await app.page.evaluate(async (items) => {
        const out = [];
        for (const it of items) {
          try { const r = await window.CAS.dispatch(it.input, it.mode); out.push({ plain: String(r.plain ?? '') }); }
          catch (e) { out.push({ error: String(e && e.message || e) }); }
        }
        return out;
      }, CORPUS);
      const verdicts = CORPUS.map((item, i) => ({ id: item.id, input: item.input, ...results[i], verdict: judge(item, results[i]) }));
      const wrong = verdicts.filter(v => v.verdict.startsWith('wrong'));
      const declined = verdicts.filter(v => v.verdict === 'declined');
      fs.writeFileSync(path.join(HERE, 'corpus', `last-${name}.json`), JSON.stringify(verdicts, null, 1));
      console.log(`# ${name}: ${verdicts.length - wrong.length - declined.length} agree, ${declined.length} declined, ${wrong.length} wrong`);
      const show = (list) => list.slice(0, 25).map(v => `  #${v.id} ${v.input}\n     ${v.verdict === 'declined' ? 'declined: ' + (v.error || v.plain) : v.verdict}`).join('\n');
      assert.equal(wrong.length, 0, `wrong answers:\n${show(wrong)}`);
      if (exact) assert.equal(declined.length, 0, `the exact engine declined:\n${show(declined)}`);
    });
  });
}
