// Outside the browser: the language server (src/lsp.js, bin/cassycas-lsp.mjs) and the command
// line / local HTTP API (bin/cassycas.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose, hover, complete } from '../src/lsp.js';
import { openApp } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = `# a CassyCAS file: one cell per line
f(x) = x^2 + 1
integrate(f(x), x, 0, 1)
intgrate(x, x)
solve(x^2 = 4, x
f(1, 2)
y'' + y = 0
lim x->0 sin(x)/x
d/dx x^2 sin(x)
X ~ Normal(0, 1)
P(X > 1)
100 km/h to m/s
plot(sin(x), [x, -5, 5])
taylor(sin(x), x, 0, 5)
a(n+2) = a(n+1) + a(n)
isprime(97, 3, 4)
nextprime()`;

test('diagnostics: typos, brackets, argument counts — and no false alarms', () => {
  const d = diagnose(DOC).map(x => `${x.line}:${x.start}-${x.end} ${x.severity} ${x.message}`);
  assert.deepEqual(d, [
    '3:0-8 2 Unknown function intgrate — did you mean integrate?',
    '4:5-6 1 "(" is never closed',
    '5:0-1 1 f takes 1 argument (line 2: f(x) = x^2 + 1)',
    '15:0-7 1 isprime takes 1 argument: isprime(n)',
    '16:0-9 1 nextprime takes 1 argument: nextprime(n)',
  ]);
});

test('Markdown: only ```cas blocks are read', () => {
  const md = 'Some prose with intgrate( in it.\n\n```cas {mode=calculus}\nintegrate(x, x)\nfoo_bar(x)\n```\n\n$$x$$\n';
  assert.deepEqual(diagnose(md, { markdown: true }).map(d => [d.line, d.message]), [[4, 'Unknown function foo_bar']]);
});

test('hover and completion', () => {
  assert.match(hover(DOC, 2, 3).contents, /integrate/);
  assert.match(hover(DOC, 2, 10).contents, /f\(x\) = x\^2 \+ 1[\s\S]*line 2/);
  assert.equal(hover(DOC, 2, 25), null);
  const items = complete(DOC, 3, 3).map(i => i.label);
  assert.ok(items.includes('integrate') && items.includes('intersect'));
  assert.ok(complete('g(t) = t\ng', 1, 1).some(i => i.label === 'g' && i.detail === 'g(t) = t'));
});

test('the language server knows every function the app routes', async () => {
  const app = await openApp({ engine: false });
  try {
    const heads = await app.page.evaluate(() => window.CAS.opHeads());
    const unknown = heads.filter(h => diagnose(`${h}(x)`).some(d => /Unknown function/.test(d.message)));
    assert.deepEqual(unknown, []);
  } finally { await app.close(); }
});

function lspSession() {
  const p = spawn(process.execPath, [path.join(ROOT, 'bin', 'cassycas-lsp.mjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = Buffer.alloc(0);
  const waiting = [];
  const messages = [];
  p.stdout.on('data', (c) => {
    buf = Buffer.concat([buf, c]);
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n'); if (sep < 0) break;
      const len = Number(buf.slice(0, sep).toString().match(/Content-Length: (\d+)/)[1]);
      if (buf.length < sep + 4 + len) break;
      messages.push(JSON.parse(buf.slice(sep + 4, sep + 4 + len).toString()));
      buf = buf.slice(sep + 4 + len);
      waiting.splice(0).forEach(f => f());
    }
  });
  const send = (m) => { const b = JSON.stringify({ jsonrpc: '2.0', ...m }); p.stdin.write(`Content-Length: ${Buffer.byteLength(b)}\r\n\r\n${b}`); };
  const next = async (pred) => {
    for (;;) {
      const i = messages.findIndex(pred);
      if (i >= 0) return messages.splice(i, 1)[0];
      await new Promise(r => waiting.push(r));
    }
  };
  return { p, send, next };
}

test('language server protocol over stdio', async () => {
  const s = lspSession();
  try {
    s.send({ id: 1, method: 'initialize', params: { capabilities: {} } });
    const init = await s.next(m => m.id === 1);
    assert.equal(init.result.capabilities.hoverProvider, true);
    s.send({ method: 'initialized', params: {} });
    s.send({ method: 'textDocument/didOpen', params: { textDocument: { uri: 'file:///a.casm', languageId: 'cassycas', version: 1, text: 'f(x) = x^2\nf(1, 2)' } } });
    const diag = await s.next(m => m.method === 'textDocument/publishDiagnostics');
    assert.equal(diag.params.diagnostics.length, 1);
    assert.deepEqual(diag.params.diagnostics[0].range, { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } });
    s.send({ method: 'textDocument/didChange', params: { textDocument: { uri: 'file:///a.casm', version: 2 }, contentChanges: [{ text: 'f(x) = x^2\nf(1)' }] } });
    assert.equal((await s.next(m => m.method === 'textDocument/publishDiagnostics')).params.diagnostics.length, 0);
    s.send({ id: 2, method: 'textDocument/hover', params: { textDocument: { uri: 'file:///a.casm' }, position: { line: 1, character: 0 } } });
    assert.match((await s.next(m => m.id === 2)).result.contents.value, /f\(x\) = x\^2/);
    s.send({ id: 3, method: 'textDocument/completion', params: { textDocument: { uri: 'file:///a.casm' }, position: { line: 1, character: 1 } } });
    assert.ok((await s.next(m => m.id === 3)).result.items.some(i => i.label === 'factor'));
    s.send({ id: 4, method: 'workspace/symbol', params: {} });
    assert.equal((await s.next(m => m.id === 4)).error.code, -32601);
    s.send({ id: 5, method: 'shutdown' });
    await s.next(m => m.id === 5);
    s.send({ method: 'exit' });
    await new Promise(r => s.p.on('exit', r));
  } finally { s.p.kill(); }
});

function cli(args, input) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'bin', 'cassycas.mjs'), ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', c => { out += c; });
    p.stderr.on('data', c => { err += c; });
    p.on('exit', code => resolve({ code, out, err }));
    p.stdin.end(input || '');
  });
}

test('command line: arguments, stdin, JSON, exit codes', async () => {
  const a = await cli(['--no-engine', '--json', 'a = 3', 'a^2 + 1', 'nonsense(']);
  const lines = a.out.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(lines[1].plain, '10', 'later lines see earlier definitions');
  assert.ok(lines[2].error);
  assert.equal(a.code, 2, 'exit code 2 when an input fails');
  const b = await cli(['--no-engine'], '# comment\n2 + 2\n');
  assert.equal(b.out.trim(), '4');
  assert.equal(b.code, 0);
});

test('local HTTP API', async () => {
  const p = spawn(process.execPath, [path.join(ROOT, 'bin', 'cassycas.mjs'), '--no-engine', '--serve', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise((resolve, reject) => {
      let err = '';
      p.stderr.on('data', c => { err += c; const m = err.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) resolve(m[0]); });
      p.on('exit', () => reject(new Error(err)));
    });
    const post = (route, body, headers = {}) => fetch(url + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await (await fetch(url + '/health')).json()).ok, true);
    assert.equal((await (await post('/eval', { expr: 'factor(x^2 - 1)' })).json()).plain, '(x - 1) * (x + 1)');
    const batch = await (await post('/batch', { exprs: ['k = 4', 'k!'] })).json();
    assert.equal(batch[1].plain, '24');
    assert.equal((await post('/eval', { expr: '1', mode: 'nope' }).then(r => r.json())).error.startsWith('mode must be'), true);
    assert.equal((await post('/eval', { expr: '1' }, { origin: 'https://evil.example' })).status, 403, 'other web pages cannot call it');
  } finally { p.kill(); }
});
