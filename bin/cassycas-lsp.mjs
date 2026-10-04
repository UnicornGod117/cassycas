#!/usr/bin/env node
// CassyCAS language server (Language Server Protocol over stdio): diagnostics, hover and
// completion for CassyCAS input in any LSP editor. Files: *.cas.txt / *.casm (one cell per
// line) and Markdown / Quarto (```cas blocks). The analysis is src/lsp.js.
//
//   VS Code / Neovim / Helix: run `node bin/cassycas-lsp.mjs` (or `npx cassycas-lsp`) as the
//   server command for those file types.
import { diagnose, hover, complete } from '../src/lsp.js';

const docs = new Map();
const isMarkdown = (uri) => /\.(md|qmd|markdown)$/i.test(uri);

function send(msg) {
  const body = JSON.stringify({ jsonrpc: '2.0', ...msg });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}
function publish(uri) {
  const text = docs.get(uri);
  if (text === undefined) return;
  const diagnostics = diagnose(text, { markdown: isMarkdown(uri) }).map(d => ({
    range: { start: { line: d.line, character: d.start }, end: { line: d.line, character: d.end } },
    severity: d.severity, source: 'cassycas', message: d.message,
  }));
  send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } });
}

const handlers = {
  initialize: () => ({
    capabilities: {
      textDocumentSync: 1,                                  // full text on every change
      hoverProvider: true,
      completionProvider: { triggerCharacters: [] },
    },
    serverInfo: { name: 'cassycas-lsp', version: '1.0.0' },
  }),
  shutdown: () => null,
  'textDocument/didOpen': ({ textDocument: d }) => { docs.set(d.uri, d.text); publish(d.uri); },
  'textDocument/didChange': ({ textDocument: d, contentChanges }) => {
    docs.set(d.uri, contentChanges[contentChanges.length - 1].text); publish(d.uri);
  },
  'textDocument/didClose': ({ textDocument: d }) => { docs.delete(d.uri); send({ method: 'textDocument/publishDiagnostics', params: { uri: d.uri, diagnostics: [] } }); },
  'textDocument/hover': ({ textDocument: d, position: p }) => {
    const h = hover(docs.get(d.uri) || '', p.line, p.character, { markdown: isMarkdown(d.uri) });
    return h && { contents: { kind: 'markdown', value: h.contents },
      range: { start: { line: p.line, character: h.start }, end: { line: p.line, character: h.end } } };
  },
  'textDocument/completion': ({ textDocument: d, position: p }) =>
    ({ isIncomplete: false, items: complete(docs.get(d.uri) || '', p.line, p.character, { markdown: isMarkdown(d.uri) }) }),
  exit: () => process.exit(0),
};

function dispatch(msg) {
  const h = handlers[msg.method];
  if (msg.id === undefined) { if (h) try { h(msg.params || {}); } catch {} return; }       // notification
  if (!h) return send({ id: msg.id, error: { code: -32601, message: `Unsupported: ${msg.method}` } });
  try { send({ id: msg.id, result: h(msg.params || {}) ?? null }); }
  catch (e) { send({ id: msg.id, error: { code: -32603, message: e.message } }); }
}

let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n');
    if (sep < 0) return;
    const len = Number((buf.slice(0, sep).toString().match(/Content-Length:\s*(\d+)/i) || [])[1]);
    if (!len && len !== 0) { buf = buf.slice(sep + 4); continue; }
    if (buf.length < sep + 4 + len) return;
    const body = buf.slice(sep + 4, sep + 4 + len).toString('utf8');
    buf = buf.slice(sep + 4 + len);
    try { dispatch(JSON.parse(body)); } catch {}
  }
});
