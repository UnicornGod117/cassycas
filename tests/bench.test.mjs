// The scoreboard as a test: the exact engine may decline a problem but must never be wrong,
// and must solve nearly all of them. `npm run bench` prints the full table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, hasWheels } from './harness.mjs';
import { runBench, summarize } from './bench/run.mjs';

test('scoreboard: no wrong answers, ≥ 97% solved', { skip: !hasWheels() && 'SymPy wheels missing: run `npm run test:setup`' }, async () => {
  const app = await openApp();
  try {
    await app.waitForEngine();
    const rows = await runBench(app.page);
    const s = summarize(rows);
    const wrong = rows.filter(r => r.status === 'wrong').map(r => `${r.input} → ${r.why}`);
    assert.deepEqual(wrong, [], 'wrong answers');
    assert.ok(s.solvedPct >= 97, `solved ${s.solvedPct}%: ${rows.filter(r => r.status !== 'solved').map(r => r.input).join('; ')}`);
  } finally { await app.close(); }
});

test('scoreboard, JavaScript engine alone: it may decline, but is never wrong', async () => {
  const app = await openApp({ engine: false });
  try {
    const rows = await runBench(app.page);
    assert.deepEqual(rows.filter(r => r.status === 'wrong').map(r => `${r.input} → ${r.why}`), []);
  } finally { await app.close(); }
});
