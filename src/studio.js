// Graph workspace: editable layers, shared parameters, numerical inspection and value tables.
import { drawSpec, plotGraph, validateSpec } from './plot.js';
import { parsePlotItems } from './plotspec.js';
import { parseTopLevelArgs } from './expr.js';
import { PALETTE } from './graph/grapher.js';
import { escH } from './format.js';

const KEY = 'cassy-studio-v1';
const presets = [
  ['Waves', ['a*sin(x)', 'cos(x)']], ['Conics', ['x^2 + y^2 = 25', 'y = x^2/4 - 3']],
  ['Polar rose', ['r = 3*cos(4*theta)']], ['Parametric', ['[3*cos(t), 2*sin(2*t)]']],
  ['Inequalities', ['x^2 + y^2 < 16', 'y > x']],
];
let rows = [], graph = null, timer, active = false, tableOpen = false, values = {}, hooks;
const $ = id => document.getElementById(id);
const num = x => Number.isFinite(x) ? Number(x.toPrecision(7)).toString() : '—';
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch {} };
const newRow = (expr = '', i = rows.length) => ({ id: crypto.randomUUID(), expr, visible: true, color: PALETTE[i % PALETTE.length] });
function load() {
  try { const saved = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(saved) && saved.length && saved.length <= 30) rows = saved.filter(r => typeof r.expr === 'string' && /^#[0-9a-f]{6}$/i.test(r.color)).map((r, i) => ({ ...newRow(r.expr.slice(0, 2000), i), visible: r.visible !== false, color: r.color })); } catch {}
  if (!rows.length) rows = [newRow('sin(x)', 0), newRow('0.15*x^2 - 2', 1)];
}
function renderRows() {
  $('expression-list').innerHTML = rows.map((r, i) => `<div class="expression-row" data-row="${r.id}"><div class="expression-row-top"><span class="expression-index">${String(i + 1).padStart(2, '0')}</span><input type="color" value="${r.color}" data-color aria-label="Color of expression ${i + 1}"><button class="expression-visibility ${r.visible ? 'on' : ''}" data-visible aria-label="${r.visible ? 'Hide' : 'Show'} expression ${i + 1}" aria-pressed="${r.visible}">${r.visible ? '◉' : '○'}</button><button data-remove class="expression-remove" aria-label="Remove expression ${i + 1}">×</button></div><input class="expression-input" data-expr aria-label="Expression ${i + 1}" placeholder="e.g. a*sin(x)" value="${escH(r.expr)}" spellcheck="false"><div class="expression-error" role="status"></div></div>`).join('');
}
function rowError(id, message) { const el = document.querySelector(`[data-row="${id}"] .expression-error`); if (el) el.textContent = message; }
export function refreshStudio({ fit = false } = {}) {
  if (!active) return;
  document.querySelector('.studio-canvas-area').classList.remove('is3d');
  const oldView = !fit && graph ? { ...graph.view } : null;
  const items = [];
  for (const row of rows) {
    rowError(row.id, '');
    if (!row.visible || !row.expr.trim()) continue;
    try {
      const parsed = parsePlotItems(parseTopLevelArgs(row.expr));
      // Compile each row independently, so a bad expression cannot hide the other curves.
      validateSpec(parsed, values);
      items.push(...parsed.items.map(it => ({ ...it, color: row.color, label: row.expr })));
    } catch (e) { rowError(row.id, e.message); }
  }
  if (graph) { Object.assign(values, graph.parameterValues); graph.destroy(); }
  graph = drawSpec($('gplot'), { items, range: null }, { height: '100%', values });
  graph.onParameterChange = () => { updateInsights(); if (tableOpen) renderTable(); };
  if (oldView) { graph.view = oldView; graph.fitPending = false; graph.render(); }
  $('studio-status').textContent = `${items.length} active ${items.length === 1 ? 'layer' : 'layers'} · 2D`;
  updateInsights();
  if (tableOpen) renderTable();
  save();
}
function schedule() { clearTimeout(timer); timer = setTimeout(() => refreshStudio(), 260); }
function firstFunction() { return graph?.items.find(i => i.kind === 'fn' && !i.tangent); }
function updateInsights() {
  const f = firstFunction()?.f;
  const x = Number($('inspect-x').value), a = Number($('inspect-a').value), b = Number($('inspect-b').value);
  let y = NaN, slope = NaN;
  try { if (f && Number.isFinite(x)) { y = f(x); const h = 1e-5 * Math.max(1, Math.abs(x)); slope = (f(x + h) - f(x - h)) / (2*h); } } catch {}
  let area = NaN;
  try { if (f && Number.isFinite(a) && Number.isFinite(b)) area = integrate(f, a, b); } catch {}
  if (graph) {
    graph.items = graph.items.filter(it => !it.tangent);
    if ($('inspect-tangent').checked && Number.isFinite(y) && Number.isFinite(slope)) graph.items.push({ kind: 'fn', f: t => y + slope*(t - x), color: '#a383d1', label: `Tangent at x = ${x}`, tangent: true });
    graph.render();
  }
  $('studio-insights').innerHTML = f ? `<div><span class="insight-icon">ƒ</span><span>Value at x = ${escH(num(x))}<strong>${escH(num(y))}</strong></span></div><div><span class="insight-icon">∂</span><span>Slope at x = ${escH(num(x))}<strong>${escH(num(slope))}</strong></span></div><div><span class="insight-icon">∫</span><span>Signed area · ${escH(num(a))} to ${escH(num(b))}<strong>${escH(num(area))}</strong></span></div><span class="insight-note">Numerical estimates<br>Explore exact values in Calculator</span>` : '<p class="insight-note">Add a function of x for live value, slope, and area estimates. Roots and intersections appear on the canvas.</p>';
}
function integrate(f, a, b) {
  let sum = 0; const n = 400, h = (b - a) / n;
  for (let i = 0; i <= n; i++) { const v = f(a + i * h); if (!Number.isFinite(v)) return NaN; sum += v * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2); }
  return sum * h / 3;
}
function tableData() {
  const fs = graph?.items.filter(i => i.kind === 'fn' && !i.tangent) || [];
  const start = Number($('table-start')?.value ?? -5), step = Number($('table-step')?.value ?? 1);
  if (!Number.isFinite(start) || !Number.isFinite(step) || step <= 0) return null;
  return { fs, data: Array.from({ length: 21 }, (_, i) => { const x = start + i * step; return [x, ...fs.map(f => f.f(x))]; }) };
}
function renderTable() {
  const host = $('studio-table');
  if (!host.querySelector('#table-start')) host.innerHTML = `<div class="table-heading"><h3>Value table</h3><label>Start <input id="table-start" type="number" value="-5"></label><label>Step <input id="table-step" type="number" value="0.5" min="0.000001" step="any"></label><button class="subtle-button" id="table-csv">↓ CSV</button></div><div class="value-table-scroll"></div>`;
  const d = tableData();
  host.querySelector('.value-table-scroll').innerHTML = !d ? '<p>Use a finite start and a positive step.</p>' : !d.fs.length ? '<p>Add a function of x to create a value table.</p>' : `<table><thead><tr><th>x</th>${d.fs.map(f => `<th>${escH(f.label)}</th>`).join('')}</tr></thead><tbody>${d.data.map(row => `<tr>${row.map(x => `<td>${escH(num(x))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
export function enterStudio() { active = true; requestAnimationFrame(() => refreshStudio({ fit: !graph })); }
export function leaveStudio() { active = false; }
export function initStudio(api) {
  hooks = api; load(); renderRows();
  $('studio-presets').innerHTML = presets.map(([label], i) => `<button data-preset="${i}">${label} →</button>`).join('');
  $('add-expression').addEventListener('click', () => { if (rows.length >= 30) return hooks.toast('Up to 30 expression rows per graph.'); rows.push(newRow()); renderRows(); $('expression-list').lastElementChild.querySelector('[data-expr]').focus(); save(); });
  $('expression-list').addEventListener('input', e => {
    const row = rows.find(r => r.id === e.target.closest('[data-row]')?.dataset.row); if (!row) return;
    if (e.target.matches('[data-expr]')) row.expr = e.target.value;
    if (e.target.matches('[data-color]')) row.color = e.target.value;
    save(); schedule();
  });
  $('expression-list').addEventListener('click', e => {
    const row = rows.find(r => r.id === e.target.closest('[data-row]')?.dataset.row); if (!row) return;
    if (e.target.closest('[data-visible]')) row.visible = !row.visible;
    else if (e.target.closest('[data-remove]')) rows = rows.filter(r => r !== row);
    else return;
    renderRows(); refreshStudio();
  });
  $('studio-presets').addEventListener('click', e => { const b = e.target.closest('[data-preset]'); if (!b) return; rows = presets[+b.dataset.preset][1].map((s, i) => newRow(s, i)); values = {}; renderRows(); refreshStudio({ fit: true }); });
  $('studio-range').addEventListener('click', () => {
    const a = Number($('gxmin').value), b = Number($('gxmax').value);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) return hooks.toast('Use a finite minimum smaller than the maximum.');
    if (graph) { graph.home.xRange = [a, b]; graph.reset(); }
  });
  $('studio-3d').addEventListener('click', () => { if (graph) graph.destroy(); graph = null; plotGraph(true).catch(e => hooks.toast(e.message)); $('studio-status').textContent = '3D surface'; document.querySelector('.studio-canvas-area').classList.add('is3d'); });
  $('studio-2d').addEventListener('click', () => refreshStudio({ fit: true }));
  $('studio-table-toggle').addEventListener('click', () => { tableOpen = !tableOpen; $('studio-table').hidden = !tableOpen; $('studio-table-toggle').classList.toggle('selected', tableOpen); if (tableOpen) renderTable(); requestAnimationFrame(() => graph?.resize()); });
  for (const id of ['inspect-x', 'inspect-a', 'inspect-b', 'inspect-tangent']) $(id).addEventListener('input', updateInsights);
  $('studio-table').addEventListener('input', () => renderTable());
  $('studio-table').addEventListener('click', e => {
    if (!e.target.closest('#table-csv')) return;
    const d = tableData(); if (!d) return;
    const csv = [['x', ...d.fs.map(f => f.label)], ...d.data.map(r => r.map(num))].map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
    hooks.download('cassycas-values.csv', csv, 'text/csv');
  });
}
