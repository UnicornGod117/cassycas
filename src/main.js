// CassyCAS entry point: wires the UI to the engines and notebook.
import './styles.css';
import { math, normalise, canonical } from './expr.js';
import { escH, fmtR } from './format.js';
import { state, scope, userFns, varDefs, CONSTANT_NAMES } from './state.js';
import { workerEval, loadStoredScope, sanitizeScope, reviveJSON } from './kernel/mathjs-client.js';
import { numericallyEqual } from './kernel/fallback.js';
import { dispatch } from './engine.js';
import { createEditor } from './editor.js';
import { renderTex } from './render.js';
import { plotGraph, exportPlot } from './plot.js';
import { compileReal } from './graph/jit.js';
import { MODES, ACD, CONSTS, INSERT_MAP } from './modes.js';
import { engine, startEngine, stopEngine, onEngineStatus } from './sympy/client.js';
import * as NB from './notebook.js';
import * as Assistant from './assistant.js';

// MathLive (visual input) loads the first time the visual editor is opened. It uses the KaTeX
// fonts already bundled with the app (no extra font downloads).
let mathlive = null;
const ensureMathLive = () => (mathlive ||= import('mathlive').then(({ MathfieldElement }) => {
  MathfieldElement.fontsDirectory = null;
  MathfieldElement.soundsDirectory = null;
}));

const $ = (id) => document.getElementById(id);
let editor = null;
let inpMode = 'code';

// ══════════════════════════════════════════════════════
//  ERRORS / TOAST
// ══════════════════════════════════════════════════════
function categorizeError(err) {
  const msg = (err && err.message) ? err.message : String(err);
  if (/undefined.*symbol|symbol.*undefined|is not defined/i.test(msg)) {
    const sym = msg.match(/["'`]([^"'`]+)["'`]/) || msg.match(/symbol\s+([A-Za-z_]\w*)/i);
    return sym ? `Unknown symbol: "${sym[1]}". Define it first (e.g. ${sym[1]} = 5).` : 'Unknown symbol — check spelling or define it first.';
  }
  if (/unexpected.*end|unexpected.*token|unexpected end/i.test(msg)) return 'Incomplete expression — check your brackets and parentheses.';
  if (/division by zero|divide by zero/i.test(msg)) return 'Division by zero — expression is undefined at this point.';
  if (/cannot convert|type error|expected.*number/i.test(msg)) return 'Type mismatch — check that arguments are the right type.';
  if (/timed out/i.test(msg)) return '⏱ ' + msg;
  if (/maximum.*call|stack overflow/i.test(msg)) return 'Expression is too deeply nested or recursive.';
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ══════════════════════════════════════════════════════
//  INPUT
// ══════════════════════════════════════════════════════
function getCurInput() {
  if (inpMode === 'code') return editor.getValue().trim();
  const mf = $('mf');
  // LaTeX is read by the input front end (src/syntax.js), which also understands \int, \frac{d}{dx}, …
  try { return (mf.getValue('latex') || '').trim(); } catch { return (mf.value || '').trim(); }
}
function clrInput() {
  if (inpMode === 'code') editor.setValue(''); else $('mf').value = '';
  $('lprev').classList.remove('on');
}
function runCell() {
  const expr = getCurInput();
  if (!expr) return Promise.resolve();
  editor.pushHistory(expr);
  clrInput();
  return NB.runNewCell(expr, state.curMode);
}
function setInputMode(m) {
  inpMode = m === 'ml' ? 'ml' : 'code';
  $('tg-mo').classList.toggle('on', inpMode === 'code');
  $('tg-ml').classList.toggle('on', inpMode === 'ml');
  $('editor').style.display = inpMode === 'code' ? '' : 'none';
  $('mlwrap').classList.toggle('on', inpMode === 'ml');
  if (inpMode === 'ml') ensureMathLive().then(() => $('mf').focus()); else editor.focus();
}
function insText(t) {
  if (inpMode === 'code') editor.insert(t);
  else { $('mf').insert(t); $('mf').focus(); }
}
function setInput(text) { if (inpMode === 'code') { editor.setValue(text); editor.focus(); } else $('mf').value = text; }

// Live preview + validity dot
let prevTimer = null;
function onEditorChange(v) {
  clearTimeout(prevTimer);
  prevTimer = setTimeout(() => {
    const el = $('lprev'), dot = $('valid-indicator');
    if (!v.trim()) { el.classList.remove('on'); dot.style.opacity = '0'; return; }
    dot.style.opacity = '1';
    try {
      const node = math.parse(canonical(v.trim()).replace(/(?<![<>!=])=(?!=)/, '=='));
      dot.style.background = 'var(--a0)'; dot.title = 'Syntax OK';
      renderTex(el, node.toTex({ parenthesis: 'auto' }).replace(/==/, '='), false);
      el.classList.add('on');
    } catch {
      dot.style.background = 'var(--rose)'; dot.title = 'Syntax error';
      el.classList.remove('on');
    }
  }, 200);
}

// ══════════════════════════════════════════════════════
//  MODES / SIDEBAR
// ══════════════════════════════════════════════════════
function setMode(m) {
  if (!MODES[m]) return;
  state.curMode = m;
  document.querySelectorAll('.op').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  const md = MODES[m];
  $('mode-title').innerHTML = `<span class="sb-title-glyph">${md.glyph}</span><span>${md.label}</span>`;
  $('mode-sub').textContent = md.sub;
  renderModeUI();
}
function renderModeList() {
  $('mode-list').innerHTML = Object.keys(MODES).map(k => `<button class="op ${k === state.curMode ? 'on' : ''}" data-mode="${k}"><span class="op-glyph">${MODES[k].glyph}</span><span>${MODES[k].label}</span></button>`).join('');
}
function renderModeUI() {
  const m = MODES[state.curMode];
  $('ops-row').innerHTML = m.sm.map((s, i) => `<button class="in-op ${i === 0 ? 'on' : ''}" data-sm="${escH(s)}">${escH(s)}</button>`).join('');
  $('ops-list').innerHTML = m.sm.map(s => `<button class="chip" data-sm="${escH(s)}">${escH(s)}</button>`).join('');
  $('qi-list').innerHTML = m.qr.map(q => `<span class="chip" data-ins="${escH(q)}" title="${escH(q)}">${escH(q)}</span>`).join('');
  $('syntax-block').innerHTML = m.syn.split('\n').map(l => `<div>${l}</div>`).join('');
}
function insertSM(name, btn) {
  if (btn && btn.classList.contains('in-op')) { document.querySelectorAll('.in-op').forEach(b => b.classList.remove('on')); btn.classList.add('on'); }
  if (name === 'Definite ∫') { $('defint-panel').classList.toggle('on'); return; }
  const t = INSERT_MAP[name];
  if (t !== undefined) insText(t);
}
function insertDefInt() {
  const f = $('di-f').value || 'f(x)', v = $('di-v').value || 'x', a = $('di-a').value || 'a', b = $('di-b').value || 'b';
  setInput(`integrate(${f}, ${v}, ${a}, ${b})`);
  $('defint-panel').classList.remove('on');
}
function runDefInt() { insertDefInt(); runCell(); }
function switchView(v) {
  ['nb', 'graph', 'units'].forEach(id => {
    $('view-' + id).classList.toggle('on', id === v);
    $('view-tab-' + id).classList.toggle('on', id === v);
  });
}
function toggleSidebar() {
  const sb = document.querySelector('.sidebar');
  sb.classList.toggle('collapsed');
  $('view-tab-panel').classList.toggle('on', !sb.classList.contains('collapsed'));
}

// Workspace definitions panel
function renderDefs() {
  const keys = [...new Set([...Object.keys(scope), ...Object.keys(varDefs)])].filter(k => !CONSTANT_NAMES.includes(k));
  const el = $('deflist');
  if (!keys.length) { el.innerHTML = '<div class="def-empty">Nothing defined yet</div>'; return; }
  el.innerHTML = keys.map(k => {
    const val = scope[k], isF = typeof val === 'function';
    const disp = isF ? `(${(userFns[k]?.params || []).join(', ')}) = ${userFns[k]?.body || '…'}` : val === undefined ? varDefs[k] : fmtR(val);
    return `<div class="def" data-name="${escH(k)}" title="${escH(k)}"><span class="def-name"><small>${isF ? '[Fn]' : '[Var]'}</small>${escH(k)}</span><span class="def-val">${escH(String(disp).slice(0, 40))}</span></div>`;
  }).join('');
}
function clearDefs(skipConfirm) {
  if (!skipConfirm && !confirm('Clear all workspace definitions imported from files or storage?')) return;
  state.baseScope = {};
  NB.recompute({ all: true });
}
function clearAll() {
  if (!confirm('Clear all cells and workspace definitions?')) return;
  state.baseScope = {};
  NB.idle().then(() => {
    NB.clearNotebook();
    $('notebook').appendChild(buildWelcomeNode());
    buildWelcomeGrid();
    NB.recompute({ all: true });
    try { localStorage.removeItem('cas2-scope'); } catch {}
  });
}

// ══════════════════════════════════════════════════════
//  MODE TOGGLES
// ══════════════════════════════════════════════════════
function syncToggles() {
  $('tg-exact').classList.toggle('on', state.exactMode);
  $('tg-approx').classList.toggle('on', !state.exactMode);
  $('tg-rad').classList.toggle('on', state.angleMode === 'rad');
  $('tg-deg').classList.toggle('on', state.angleMode === 'deg');
}
function toggleExact() { state.exactMode = !state.exactMode; syncToggles(); return NB.recompute({ all: true }); }
function toggleAngle() { state.angleMode = state.angleMode === 'rad' ? 'deg' : 'rad'; syncToggles(); return NB.recompute({ all: true }); }
function toggleTheme() { state.darkTheme = !state.darkTheme; document.body.classList.toggle('light', !state.darkTheme); }
const PREFS = 'cas-prefs';
function savePrefs() { try { localStorage.setItem(PREFS, JSON.stringify({ autoPlot: state.autoPlot })); localStorage.setItem('cas-engine', state.engineEnabled ? 'on' : 'off'); } catch {} }
function loadPrefs() {
  try { const p = JSON.parse(localStorage.getItem(PREFS) || '{}'); if (typeof p.autoPlot === 'boolean') state.autoPlot = p.autoPlot; } catch {}
  try { state.engineEnabled = localStorage.getItem('cas-engine') !== 'off'; } catch {}
}
function setAutoPlot(on) { state.autoPlot = !!on; savePrefs(); NB.recompute({ all: true }); }
function setEngineEnabled(on) {
  state.engineEnabled = !!on; savePrefs();
  if (on) startEngine(); else { stopEngine(); NB.recompute({ all: true }); }
}

// Engine status pill
function renderEngineStatus(e) {
  const pill = $('engine-pill'), text = $('engine-text');
  pill.dataset.status = e.status;
  const label = { off: 'numeric only', loading: 'loading…', restarting: 'restarting…', ready: 'exact', failed: 'unavailable' }[e.status] || e.status;
  text.textContent = `SymPy · ${label}`;
  pill.title = e.status === 'ready' ? 'Exact engine ready (SymPy on WebAssembly)'
    : e.status === 'failed' ? `Exact engine unavailable: ${e.detail}. Using the JavaScript engine.`
    : e.status === 'off' ? 'Exact engine disabled (Tweaks). Using the JavaScript engine.' : (e.detail || 'Loading');
}
function engineInfo() { toast($('engine-pill').title); }

// ══════════════════════════════════════════════════════
//  UNITS VIEW
// ══════════════════════════════════════════════════════
async function evalUnit() {
  const expr = $('uinp').value.trim(), el = $('ures');
  if (!expr) { el.innerHTML = '<span class="units-result-empty">Enter a unit expression to convert…</span>'; return; }
  el.innerHTML = '<div class="spin" style="margin-left:10px;"></div>';
  try {
    const r = await workerEval(normalise(expr));
    el.innerHTML = `<span>${escH(r && r.isUnit ? math.format(r, { precision: 10 }) : fmtR(r))}</span>`;
  } catch (e) { el.innerHTML = `<span style="color:var(--rose);font-size:14px;">! ${escH(e.message)}</span>`; }
}
function setUnitInp(s) { $('uinp').value = s; evalUnit(); }
function buildConsts() {
  $('cgrid').innerHTML = CONSTS.map(c => `<div class="const-card" data-unit="${escH(c.e)}" title="${escH(c.n)}"><div class="const-card-name">${escH(c.n)}</div><div class="const-card-val">${escH(c.v)}</div></div>`).join('');
}

// ══════════════════════════════════════════════════════
//  WELCOME / PALETTE / TWEAKS
// ══════════════════════════════════════════════════════
function buildWelcomeNode() {
  const w = document.createElement('div');
  w.className = 'welcome'; w.id = 'welcome';
  w.innerHTML = `<div class="welcome-mark">∑</div>
    <div class="welcome-title">A precision instrument for <em>symbolic mathematics.</em></div>
    <div class="welcome-sub">Type any expression below and press Enter. Exact answers come from SymPy running in your browser; click any part of a result to keep working on it.</div>
    <div class="welcome-grid" id="welcome-grid"></div>
    <div class="welcome-tip"><span><kbd>Enter</kbd> run</span><span><kbd>Shift</kbd>+<kbd>Enter</kbd> newline</span><span><kbd>⌘</kbd>+<kbd>K</kbd> palette</span><span><kbd>Tab</kbd> complete</span></div>`;
  return w;
}
function buildWelcomeGrid() {
  const all = [];
  Object.entries(MODES).forEach(([k, m]) => m.ex.forEach(ex => all.push({ mode: k, modeLabel: m.label, ...ex })));
  const sample = all.sort(() => Math.random() - 0.5).slice(0, 6);
  const el = $('welcome-grid');
  if (el) el.innerHTML = sample.map(s => `<div class="wcell" data-ex="${escH(s.expr)}" data-mode="${s.mode}"><div class="wcell-tag">${escH(s.modeLabel)}</div><div class="wcell-expr">${escH(s.expr)}</div><div class="wcell-desc">${escH(s.desc)}</div></div>`).join('');
}
let palItems = [], palIdx = 0;
function openPalette() { $('palette').classList.add('on'); $('palette-input').value = ''; $('palette-input').focus(); filterPalette(); }
function closePalette() { $('palette').classList.remove('on'); }
function filterPalette() {
  const q = $('palette-input').value.toLowerCase();
  palItems = [
    ...Object.entries(MODES).map(([k, m]) => ({ type: 'mode', cat: 'Modes', k, label: m.label, desc: m.sub })),
    ...ACD.filter(Boolean).map(d => ({ type: 'fn', cat: 'Functions', n: d.n, label: d.n, desc: d.s })),
    ...CONSTS.map(c => ({ type: 'const', cat: 'Constants', e: c.e, label: c.n, desc: c.v })),
  ].filter(i => !q || i.label.toLowerCase().includes(q) || (i.desc || '').toLowerCase().includes(q)).slice(0, 40);
  palIdx = 0;
  let html = '', last = '';
  palItems.forEach((i, idx) => {
    if (i.cat !== last) { html += `<div class="palette-cat">${i.cat}</div>`; last = i.cat; }
    html += `<div class="palette-item ${idx === 0 ? 'sel' : ''}" data-idx="${idx}"><span class="palette-item-name">${escH(i.label)}</span><span class="palette-item-desc">${escH(i.desc || '')}</span></div>`;
  });
  $('palette-list').innerHTML = html;
}
function palAction(idx) {
  const it = palItems[idx]; if (!it) return;
  if (it.type === 'mode') setMode(it.k); else if (it.type === 'fn') insText(it.n + '('); else insText(it.e);
  closePalette();
}
function palKey(e) {
  if (e.key === 'Escape') { closePalette(); return; }
  if (e.key === 'Enter') { palAction(palIdx); return; }
  if (e.key === 'ArrowDown') { palIdx = Math.min(palIdx + 1, palItems.length - 1); e.preventDefault(); }
  if (e.key === 'ArrowUp') { palIdx = Math.max(palIdx - 1, 0); e.preventDefault(); }
  document.querySelectorAll('.palette-item').forEach((el, i) => el.classList.toggle('sel', i === palIdx));
}
const ACCENTS = [
  { name: 'green', a0: '#7eef9c', a1: '#5dd87f', a2: '#3bb95e' }, { name: 'cyan', a0: '#7fc5e0', a1: '#5da8c5', a2: '#3b88a5' },
  { name: 'amber', a0: '#e8b87a', a1: '#d29a52', a2: '#a87530' }, { name: 'rose', a0: '#e88a99', a1: '#c9657a', a2: '#a23f55' },
  { name: 'violet', a0: '#a99cf2', a1: '#8a7dd8', a2: '#6957c4' },
];
function buildTweaks() {
  $('tweak-accent').innerHTML = ACCENTS.map((a, i) => `<div class="tweak-swatch ${i === 0 ? 'on' : ''}" style="background:${a.a0};color:${a.a0};" data-accent="${i}" title="${a.name}"></div>`).join('');
  $('tweak-density').innerHTML = ['Compact', 'Standard', 'Spacious'].map((d, i) => `<button class="in-op ${i === 1 ? 'on' : ''}" style="flex:1;" data-density="${i}">${d}</button>`).join('');
  $('tweak-font').innerHTML = ['Inter', 'System'].map((f, i) => `<button class="in-op ${i === 0 ? 'on' : ''}" style="flex:1;" data-font="${i}">${f}</button>`).join('');
  $('tw-autoplot').checked = state.autoPlot;
  $('tw-engine').checked = state.engineEnabled;
  $('tw-key').value = Assistant.getApiKey() ? '••••••••••••' : '';
}
function toggleTweaks() { $('tweaks').classList.toggle('on'); }

// ══════════════════════════════════════════════════════
//  ASSISTANT (optional)
// ══════════════════════════════════════════════════════
function syncAssistant() {
  const on = Assistant.assistantEnabled();
  $('assist-btn').style.display = on ? '' : 'none';
  if (!on) $('assist-bar').classList.remove('on');
  window.CAS_ASSISTANT = () => Assistant.assistantEnabled();
}
function setAssistantKey(v) {
  if (/^•+$/.test(v)) return;
  Assistant.setApiKey(v);
  syncAssistant();
  toast(v ? 'Claude assistant enabled' : 'Claude assistant disabled');
  NB.recompute({ all: true });
}
function toggleAssistant() { const b = $('assist-bar'); b.classList.toggle('on'); if (b.classList.contains('on')) $('assist-input').focus(); }
const workspaceSummary = () => Object.keys(scope).filter(k => !CONSTANT_NAMES.includes(k)).slice(0, 30)
  .map(k => typeof scope[k] === 'function' ? `${k}(${userFns[k]?.params.join(',')}) = ${userFns[k]?.body}` : `${k} = ${fmtR(scope[k]).slice(0, 40)}`);
// Run a suggestion through the CAS without adding a cell: Claude proposes, the CAS checks.
async function dryRun(expr, mode) {
  if (/^\s*[A-Za-z_]\w*(\([^)]*\))?\s*=(?!=)/.test(expr) || /^assume\s*\(/.test(expr)) return { ok: true };   // definitions change the workspace
  try {
    const r = await dispatch(expr, mode);
    return { ok: true, plain: r && r.plain, check: r && r.check };
  } catch (e) { return { ok: false, error: e.message }; }
}
// Show a CAS-checked suggestion in the editor (one corrective retry when the CAS rejects it).
async function offerSuggestion(out, retry) {
  const status = $('assist-status');
  if (!out.expression) { status.textContent = out.explanation || 'Not a maths request.'; return; }
  let res = await dryRun(out.expression, out.mode);
  if (!res.ok && retry) {
    status.textContent = 'The CAS rejected the first attempt; asking Claude to correct it…';
    const second = await retry({ expression: out.expression, error: res.error });
    if (second.expression) { out = second; res = await dryRun(out.expression, out.mode); }
  }
  setMode(out.mode);
  setInputMode('code');
  setInput(out.expression);
  if (!res.ok) { status.textContent = `${out.explanation} — the CAS reports: ${res.error}. Edit before running.`; return; }
  const preview = res.plain ? ` CAS preview: ${res.plain.length > 80 ? res.plain.slice(0, 79) + '…' : res.plain}${res.check?.status === 'verified' ? ' (✓ verified)' : ''}.` : '';
  status.textContent = `${out.explanation}.${preview} Press Enter to run.`;
}
async function askAssistant() {
  const q = $('assist-input').value.trim();
  if (!q) return;
  const status = $('assist-status');
  status.textContent = 'Thinking…';
  try {
    const ws = workspaceSummary();
    await offerSuggestion(await Assistant.translate(q, ws), (feedback) => Assistant.translate(q, ws, feedback));
  } catch (e) { status.textContent = e.message; }
}
async function askFromPhoto(ev) {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const status = $('assist-status');
  if (file.size > 5e6) { status.textContent = 'That image is over 5 MB — crop or shrink it first.'; return; }
  status.textContent = 'Reading the photo…';
  try {
    const base64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('Could not read the image.'));
      r.readAsDataURL(file);
    });
    const hint = $('assist-input').value.trim();
    await offerSuggestion(await Assistant.translateImage(base64, file.type, hint), null);
  } catch (e) { status.textContent = e.message; }
}
async function explainCell(cell, el) {
  const steps = el.querySelector('.steps');
  let box = el.querySelector('.explain-box');
  if (!box) { box = document.createElement('div'); box.className = 'explain-box'; steps.before(box); }
  box.textContent = 'Asking Claude…';
  try { box.textContent = await Assistant.explain(cell.expr, el.dataset.plain, cell.res?.steps || [], cell.res?.check || null); }
  catch (e) { box.textContent = e.message; }
}

// ══════════════════════════════════════════════════════
//  SESSIONS / SHARING
// ══════════════════════════════════════════════════════
function saveSession() { NB.saveSessionFile(); toast('Saved'); }
function loadFile(ev) {
  const file = ev.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = async (e) => {
    try {
      const d = JSON.parse(e.target.result);
      await NB.loadNotebook(d, { replace: false });
      syncToggles();
      toast('Loaded');
    } catch (err) { alert('Load error: ' + err.message); }
  };
  r.readAsText(file); ev.target.value = '';
}
async function shareNotebook() {
  try {
    const url = await NB.shareLink();
    await navigator.clipboard?.writeText(url).catch(() => {});
    history.replaceState(null, '', url);
    toast('Share link copied');
  } catch (e) { toast('Could not create link: ' + e.message); }
}
// Embed: an <iframe> showing this notebook without the app chrome (?embed); the notebook
// travels in the URL fragment exactly like a share link, so nothing is uploaded anywhere.
async function embedNotebook() {
  try {
    const link = await NB.shareLink();
    const [base, hash] = [link.split('#')[0], link.slice(link.indexOf('#'))];
    const src = base + (base.includes('?') ? '&' : '?') + 'embed' + hash;
    const html = `<iframe src="${src}" width="100%" height="520" style="border:1px solid #ddd;border-radius:8px" title="CassyCAS notebook" loading="lazy"></iframe>`;
    await navigator.clipboard?.writeText(html).catch(() => {});
    toast('Embed code copied');
    return html;
  } catch (e) { toast('Could not create embed code: ' + e.message); return null; }
}
function addText() { NB.createTextCell(); NB.persistNotebook(); }

// ══════════════════════════════════════════════════════
//  EVENTS
// ══════════════════════════════════════════════════════
function bindEvents() {
  $('mode-list').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
  document.addEventListener('click', e => {
    const sm = e.target.closest('[data-sm]'); if (sm) return insertSM(sm.dataset.sm, sm);
    const ins = e.target.closest('[data-ins]'); if (ins) return insText(ins.dataset.ins);
    const ex = e.target.closest('.wcell[data-ex]');
    if (ex) { setMode(ex.dataset.mode); setInput(ex.dataset.ex); return; }
    const pi = e.target.closest('.palette-item[data-idx]'); if (pi) return palAction(parseInt(pi.dataset.idx, 10));
    const def = e.target.closest('.def[data-name]'); if (def) return setInput(def.dataset.name);
    const unit = e.target.closest('[data-unit]'); if (unit) return setUnitInp(unit.dataset.unit);
    const acc = e.target.closest('[data-accent]');
    if (acc) {
      const a = ACCENTS[+acc.dataset.accent];
      ['a0', 'a1', 'a2'].forEach(k => document.documentElement.style.setProperty('--' + k, a[k]));
      document.querySelectorAll('[data-accent]').forEach(el => el.classList.toggle('on', el === acc));
      return;
    }
    const den = e.target.closest('[data-density]');
    if (den) { document.querySelector('.notebook').style.padding = ['16px 24px 24px', '28px 40px 36px', '36px 56px 44px'][+den.dataset.density]; document.querySelectorAll('[data-density]').forEach(el => el.classList.toggle('on', el === den)); return; }
    const font = e.target.closest('[data-font]');
    if (font) { document.documentElement.style.setProperty('--ui', +font.dataset.font === 0 ? "'Inter','Helvetica Neue',sans-serif" : 'system-ui,-apple-system,sans-serif'); document.querySelectorAll('[data-font]').forEach(el => el.classList.toggle('on', el === font)); }
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') { closePalette(); NB.closeExploreMenu(); }
  });
  $('mf').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runCell(); } });
  window.addEventListener('hashchange', () => openFromHash());
}

async function openFromHash() {
  if (!location.hash.startsWith('#nb=')) return false;
  try {
    const data = await NB.notebookFromHash(location.hash);
    if (!data) return false;
    await NB.loadNotebook(data, { replace: true });
    syncToggles();
    toast('Opened shared notebook');
    return true;
  } catch (e) { toast('Could not open link: ' + e.message); return false; }
}

// ══════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════
async function init() {
  loadPrefs();
  // ?embed: notebook only (for iframes); ?embed=interactive keeps the input line.
  const embed = new URLSearchParams(location.search).get('embed');
  if (embed !== null) document.body.classList.add('embed', ...(embed === 'interactive' ? ['embed-interactive'] : []));
  // The exact engine boots in its own worker (≈0.4 s from its snapshot): start it first.
  if (state.engineEnabled) startEngine();
  editor = createEditor($('editor'), { onRun: runCell, onChange: onEditorChange });
  renderModeList(); renderModeUI(); buildConsts(); buildTweaks(); buildWelcomeGrid(); syncAssistant();
  bindEvents();
  NB.setNotebookHooks({ onDefsChanged: renderDefs, toast, categorizeError });
  NB.bindNotebookEvents({ explain: explainCell });
  onEngineStatus(renderEngineStatus);
  let wasReady = false;
  onEngineStatus(e => { if (e.status === 'ready' && !wasReady) { wasReady = true; NB.upgradePendingCells(); } if (e.status !== 'ready') wasReady = false; });

  // Workspace: legacy stored scope (older versions) becomes part of the base workspace.
  loadStoredScope();
  try { localStorage.removeItem('cas2-scope'); } catch {}
  const opened = await openFromHash();
  if (!opened) {
    const saved = NB.storedNotebook();
    if (saved) { try { await NB.loadNotebook(saved, { replace: true }); } catch {} }
    else NB.recompute({ all: true });
  }
  syncToggles();
  renderDefs();
  if (!state.engineEnabled) renderEngineStatus(engine);
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && location.hostname !== '127.0.0.1')
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  editor.focus();
  window.CAS.ready = true;
}

// Handlers referenced by the static markup.
Object.assign(window, {
  runCell, setInputMode, insertDefInt, runDefInt, switchView, toggleSidebar, clearDefs, clearAll,
  toggleExact, toggleAngle, toggleTheme, toggleTweaks, openPalette, closePalette, filterPalette, palKey,
  evalUnit, setUnitInp, plotGraph, exportPlot: (id) => exportPlot(document.getElementById('gplot'), 'cas-plot-' + id),
  saveSession, loadFile, exportLatex: NB.exportLatex, exportTxt: NB.exportTxt, shareNotebook, embedNotebook, addText,
  engineInfo, setAutoPlot, setEngineEnabled, setAssistantKey, toggleAssistant, askAssistant, askFromPhoto,
});

// Automation / test API.
window.CAS = {
  ready: false, engine, state, scope, math, numericallyEqual, dispatch, MODES, clearDefs, jit: { compileReal },
  cells: NB.cells, recompute: NB.recompute, idle: NB.idle, editCell: NB.editCell, deleteCell: NB.deleteCell,
  shareLink: NB.shareLink, setExact: async (b) => { if (state.exactMode !== b) await toggleExact(); },
  setAngle: async (a) => { if (state.angleMode !== a) await toggleAngle(); },
  // Run an expression through the real UI path and report the cell's result.
  async run(expr, mode = 'algebra') {
    setMode(mode);
    setInputMode('code');
    editor.setValue(expr);
    const cell = await runCell();
    const el = document.getElementById(cell.id);
    return cell.error ? { error: cell.error } : { plain: el.dataset.plain, latex: el.dataset.latex, engine: cell.res?.engine, note: cell.res?.note || null, id: cell.id };
  },
};

init();
