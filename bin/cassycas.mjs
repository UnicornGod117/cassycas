#!/usr/bin/env node
// CassyCAS from the command line, and as a local HTTP API. It runs the same built app (dist/)
// in headless Chromium, so answers, verification and steps are exactly those of the web app.
// Nothing listens beyond 127.0.0.1; there is still no CassyCAS server on the internet.
//
//   cassycas "integrate(x^2 sin(x), x)" "solve(x^2 = 2, x)"     one result per line
//   cassycas --mode calculus --json "lim x->0 sin(x)/x"        JSON with LaTeX, engine, check
//   echo "factor(x^4 - 1)" | cassycas                          one cell per input line
//   cassycas --serve 8787                                      POST /eval {"expr", "mode"}
//   cassycas --no-engine "2 + 2"                               JavaScript engine only (fast start)
//
// Needs `npm run build` (dist/) and Playwright's Chromium (`npx playwright install chromium`).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp } from './headless.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { MODES as MODE_TABLE } from '../src/modes.js';
const MODES = Object.keys(MODE_TABLE);

function parseArgs(argv) {
  const o = { mode: 'algebra', json: false, engine: true, serve: null, exprs: [], approx: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode' || a === '-m') o.mode = argv[++i];
    else if (a === '--json') o.json = true;
    else if (a === '--no-engine') o.engine = false;
    else if (a === '--approx') o.approx = true;
    else if (a === '--serve') o.serve = /^\d+$/.test(argv[i + 1] || '') ? Number(argv[++i]) : 8787;
    else if (a === '--help' || a === '-h') o.help = true;
    else o.exprs.push(a);
  }
  return o;
}
const usage = () => fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n');

async function start(o) {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('dist/ is missing: run `npm run build` first.');
  const app = await openApp({ engine: o.engine, offline: false });
  if (o.engine) {
    process.stderr.write('Starting the exact engine (SymPy)…\n');
    await app.waitForEngine();
  }
  if (o.approx) await app.page.evaluate(() => window.CAS.setExact(false));
  // One cell at a time: the notebook is reactive, so later inputs see earlier definitions.
  let queue = Promise.resolve();
  const evaluate = (expr, mode = o.mode) => {
    if (typeof expr !== 'string' || !expr.trim() || expr.length > 5000) return Promise.resolve({ error: 'expr must be a non-empty string' });
    if (!MODES.includes(mode)) return Promise.resolve({ error: `mode must be one of ${MODES.join(', ')}` });
    const job = queue.then(() => app.page.evaluate(([e, m]) => window.CAS.run(e, m), [expr.trim(), mode]))
      .then(r => ({ input: expr.trim(), mode, ...r }), e => ({ input: expr.trim(), error: e.message }));
    queue = job.catch(() => {});
    return job;
  };
  return { app, evaluate };
}

function show(r, json) {
  if (json) return JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k, v]) => v !== null && v !== undefined && k !== 'id')));
  return r.error ? `${r.input}  ✗ ${r.error}` : `${r.plain}${r.check?.status === 'verified' ? '  ✓' : ''}`;
}

async function serve(o, { evaluate, app }) {
  const server = http.createServer(async (req, res) => {
    const reply = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    // Only same-machine callers: refuse requests a web page could make cross-site.
    if (req.headers.origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)) return reply(403, { error: 'cross-origin requests are refused' });
    if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true, engine: await app.page.evaluate(() => window.CAS.engine.status) });
    if (req.method !== 'POST' || !['/eval', '/batch'].includes(req.url)) return reply(404, { error: 'POST /eval {"expr", "mode"} or /batch {"exprs": [...], "mode"}; GET /health' });
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 1e6) return reply(413, { error: 'too large' }); }
    let msg;
    try { msg = JSON.parse(body); } catch { return reply(400, { error: 'invalid JSON' }); }
    if (req.url === '/eval') return reply(200, await evaluate(msg.expr, msg.mode || o.mode));
    if (!Array.isArray(msg.exprs) || msg.exprs.length > 500) return reply(400, { error: 'exprs must be an array (at most 500)' });
    const out = [];
    for (const e of msg.exprs) out.push(await evaluate(e, msg.mode || o.mode));
    return reply(200, out);
  });
  await new Promise(r => server.listen(o.serve, '127.0.0.1', r));
  process.stderr.write(`CassyCAS API on http://127.0.0.1:${server.address().port}  (POST /eval, POST /batch, GET /health)\n`);
  const stop = async () => { server.close(); await app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  return server;
}

export async function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  if (o.help) { console.log(usage()); return 0; }
  if (o.serve === null && !o.exprs.length && process.stdin.isTTY) { console.log(usage()); return 1; }
  if (o.serve === null && !o.exprs.length) {
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    o.exprs = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  }
  const ctx = await start(o);
  if (o.serve !== null) { await serve(o, ctx); return null; }
  let failed = 0;
  for (const e of o.exprs) {
    const r = await ctx.evaluate(e);
    if (r.error) failed++;
    console.log(show(r, o.json));
  }
  await ctx.app.close();
  return failed ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { if (code !== null) process.exit(code); }, e => { console.error(e.message); process.exit(1); });
}
