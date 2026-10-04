// Runs the scoreboard (problems.mjs) through the real app and grades every answer.
//   node tests/bench/run.mjs            exact engine; writes tests/bench/results.json and prints a table
//   CAS_ENGINES=fallback node …         the JavaScript engine alone
// A problem is "solved" (correct), "declined" (an error or an honest "cannot"), or "wrong".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { create, all } from 'mathjs';
import { PROBLEMS } from './problems.mjs';
import { openApp, run } from '../harness.mjs';

const math = create(all);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOL = 1e-6;
const SAMPLE = [0.37, 0.71, 1.13, 1.79, 2.41];

const pair = (v) => typeof v === 'number' ? [v, 0] : v && v.isComplex ? [v.re, v.im] : null;
const near = (a, b, tol = TOL) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol * (1 + Math.hypot(b[0], b[1]));
const want = (w) => Array.isArray(w) ? w : [w, 0];
function num(s, scope = {}) {
  for (const cand of s.split('≈').map(t => t.trim())) {
    try { const v = pair(math.evaluate(cand, scope)); if (v && v.every(Number.isFinite)) return v; } catch {}
  }
  return null;
}
// Honest non-answers: an error, "no closed form", or a result labelled as partial.
const DECLINE = /no closed form|no elementary|cannot|could not|needs the exact engine|not converge|may be other solutions|found numerically/i;
const squash = (s) => s.replace(/\s+/g, '');

// → { status: 'solved' | 'declined' | 'wrong', why }
export function judge(expect, r) {
  if (r.error) return { status: 'declined', why: r.error };
  const plain = r.plain.replace(/\s*\+\s*C$/, '');
  // regexes are compared without whitespace ("1/2*x^2" and "1 / 2 * x ^ 2" are the same answer)
  if (expect.match) return new RegExp(squash(expect.match.source), expect.match.flags).test(squash(r.plain)) ? { status: 'solved' } : { status: DECLINE.test(plain) ? 'declined' : 'wrong', why: plain };
  if (DECLINE.test(plain)) return { status: 'declined', why: plain };
  if ('value' in expect) {
    const v = num(plain);
    if (v) return near(v, want(expect.value)) ? { status: 'solved' } : { status: 'wrong', why: `${plain} ≠ ${expect.value}` };
    // an unsimplified but equal expression (sin(x)^2 + cos(x)^2 for 1) is correct, just not finished
    const same = SAMPLE.every(p => { const g = num(plain, { x: p }); return g && near(g, want(expect.value)); });
    return same ? { status: 'declined', why: `unsimplified: ${plain}` } : { status: 'wrong', why: `${plain} ≠ ${expect.value}` };
  }
  if (expect.equiv || expect.anti) {
    const v = expect.v || 'x', pts = expect.points || SAMPLE, extra = expect.vars || {};
    const lhs = plain.split('≈')[0].replace(/^[A-Za-z]\w*(\([^)]*\))?\s*=\s*/, '').replace(/\s*\+\s*O\(.*\)$/, '');
    for (const p of pts) {
      const scope = { ...extra, [v]: p };
      let got, ref;
      try {
        if (expect.anti) {
          const h = 1e-5;
          const a = pair(math.evaluate(lhs, { ...scope, [v]: p + h })), b = pair(math.evaluate(lhs, { ...scope, [v]: p - h }));
          got = [(a[0] - b[0]) / (2 * h), (a[1] - b[1]) / (2 * h)];
          ref = pair(math.evaluate(expect.anti, scope));
        } else {
          got = pair(math.evaluate(lhs, scope));
          ref = pair(math.evaluate(expect.equiv, scope));
        }
      } catch (e) { return { status: 'wrong', why: `cannot evaluate ${lhs}: ${e.message}` }; }
      if (!got || !ref || !near(got, ref, expect.anti ? 1e-4 : TOL)) return { status: 'wrong', why: `${lhs} at ${v}=${p}: ${got} vs ${ref}` };
    }
    return { status: 'solved' };
  }
  if (expect.roots) {
    const parts = plain.split(/,\s*(?=[A-Za-z]\w* = )/).map(s => s.replace(/^[A-Za-z]\w* = /, ''));
    const got = parts.map(s => num(s)).filter(Boolean);
    const exp = expect.roots.map(want);
    const ok = got.length === exp.length && exp.every(e => got.some(g => near(g, e)));
    return ok ? { status: 'solved' } : { status: 'wrong', why: `${plain} ≠ ${JSON.stringify(expect.roots)}` };
  }
  throw new Error('bad expectation');
}

export async function runBench(page) {
  const rows = [];
  for (const [category, input, mode, expect] of PROBLEMS) {
    await page.evaluate(async () => { for (const c of [...window.CAS.cells]) await window.CAS.deleteCell(c); await window.CAS.idle(); });
    const t = Date.now();
    const r = await run(page, input, mode);
    const ms = Date.now() - t;
    const verdict = judge(expect, r);
    rows.push({ category, input, ms, ...verdict, got: r.error || r.plain, engine: r.engine || null });
  }
  return rows;
}

export function summarize(rows) {
  const cats = {};
  for (const r of rows) {
    const c = cats[r.category] ||= { total: 0, solved: 0, declined: 0, wrong: 0, ms: [] };
    c.total++; c[r.status]++; c.ms.push(r.ms);
  }
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const table = Object.entries(cats).map(([k, c]) => ({ category: k, total: c.total, solved: c.solved, declined: c.declined, wrong: c.wrong, medianMs: med(c.ms) }));
  const total = rows.length, solved = rows.filter(r => r.status === 'solved').length, wrong = rows.filter(r => r.status === 'wrong').length;
  return { total, solved, wrong, declined: total - solved - wrong, solvedPct: +(100 * solved / total).toFixed(1), medianMs: med(rows.map(r => r.ms)), table };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const engine = (process.env.CAS_ENGINES || 'exact') !== 'fallback';
  const app = await openApp({ engine });
  if (engine) await app.waitForEngine();
  const boot = await app.page.evaluate(() => ({ boot: window.CAS.engine.boot, ms: window.CAS.engine.bootMs }));
  const rows = await runBench(app.page);
  await app.close();
  const summary = { engine: engine ? 'exact' : 'fallback', date: new Date().toISOString().slice(0, 10), engineBoot: boot, ...summarize(rows) };
  fs.writeFileSync(path.join(HERE, `results-${summary.engine}.json`), JSON.stringify({ summary, rows }, null, 2));
  console.table(summary.table);
  console.log(`${summary.engine}: ${summary.solved}/${summary.total} solved (${summary.solvedPct}%), ${summary.wrong} wrong, ${summary.declined} declined, median ${summary.medianMs} ms`);
  for (const r of rows.filter(r => r.status !== 'solved')) console.log(`  ${r.status.padEnd(8)} ${r.input}  →  ${String(r.why || r.got).slice(0, 140)}`);
}
