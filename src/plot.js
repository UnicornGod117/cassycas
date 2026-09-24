// Plotly plotting: inline cell plots (with sliders for free parameters) and the Graph view.
import Plotly from 'plotly.js-dist-min';
import { math, freeSymbols, normalise, inlineUserFns, parseTopLevelArgs } from './expr.js';
import { toReal, escH } from './format.js';
import { state, scope } from './state.js';
import { ctx } from './kernel/mathjs-client.js';
import { substituteWorkspace } from './engine.js';
import { parsePlotItems } from './plotspec.js';

const COLORS = ['#7eef9c', '#a99cf2', '#7fc5e0', '#e8b87a', '#e88a99', '#f0a06f'];

export function layout(title, extra = {}) {
  const dk = state.darkTheme;
  return {
    title: { text: title, font: { color: dk ? '#a3adc0' : '#3e4350', size: 12, family: 'JetBrains Mono' } },
    paper_bgcolor: dk ? '#0f1218' : '#fbfaf6', plot_bgcolor: dk ? '#13171f' : '#f1efe8',
    font: { color: dk ? '#6f7a8e' : '#6b7384', family: 'JetBrains Mono' },
    xaxis: { gridcolor: dk ? '#1f2530' : '#e3dfd0', zerolinecolor: dk ? '#2a3240' : '#d3cdb8' },
    yaxis: { gridcolor: dk ? '#1f2530' : '#e3dfd0', zerolinecolor: dk ? '#2a3240' : '#d3cdb8' },
    margin: { l: 48, r: 20, t: 36, b: 36 }, hovermode: 'x unified',
    legend: { font: { color: dk ? '#a3adc0' : '#3e4350' } }, ...extra,
  };
}

// Sample f(v) on [lo, hi]; returns arrays with gaps (null) at discontinuities.
function sample(fn, v, lo, hi, params, n = 600) {
  const xs = [], ys = [];
  const loc = ctx(params);
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const x = lo + (hi - lo) * i / n; loc[v] = x;
    let y = null;
    try { y = toReal(fn.evaluate(loc)); } catch {}
    if (!isFinite(y)) y = null;
    // break the line across poles (huge jumps)
    if (y !== null && prev !== null && Math.abs(y - prev) > 1e3 * (1 + Math.abs(prev))) { xs.push(x); ys.push(null); }
    xs.push(x); ys.push(y); prev = y;
  }
  return { xs, ys };
}

// Inline plot for a cell. Free parameters (other than v) get sliders.
export function plotInline(container, exprPlain, v = 'x', title) {
  let node;
  try { node = substituteWorkspace(inlineUserFns(normalise(exprPlain)), [v]); }
  catch (e) { container.innerHTML = `<div class="plot-err">${escH(e.message)}</div>`; return; }
  const params = freeSymbols(node).filter(s => s !== v && scope[s] === undefined);
  const fn = node.compile();
  const values = Object.fromEntries(params.map(p => [p, 1]));
  container.innerHTML = `<div class="cell-plot-inner"></div>${params.length ? '<div class="plot-sliders"></div>' : ''}`;
  const div = container.querySelector('.cell-plot-inner');
  const draw = () => {
    const { xs, ys } = sample(fn, v, -10, 10, values);
    const trace = { x: xs, y: ys, type: 'scatter', mode: 'lines', line: { color: COLORS[0], width: 2 }, name: title || exprPlain, connectgaps: false };
    const lay = layout(title || exprPlain, { xaxis: { ...layout('').xaxis, title: v }, yaxis: { ...layout('').yaxis, autorange: true } });
    Plotly.react(div, [trace], lay, { responsive: true, displayModeBar: false });
  };
  if (params.length) {
    const sl = container.querySelector('.plot-sliders');
    sl.innerHTML = params.map(p => `
      <label class="pslider"><span class="pslider-name">${escH(p)}</span>
        <input type="range" min="-10" max="10" step="0.05" value="1" data-param="${escH(p)}"/>
        <span class="pslider-val">1</span></label>`).join('');
    let frame = 0;
    sl.addEventListener('input', e => {
      const inp = e.target.closest('input[data-param]'); if (!inp) return;
      values[inp.dataset.param] = parseFloat(inp.value);
      inp.nextElementSibling.textContent = inp.value;
      cancelAnimationFrame(frame); frame = requestAnimationFrame(draw);
    });
  }
  draw();
}

export function plotSeries(container, xs, ys, title, xv, yv) {
  container.innerHTML = '<div class="cell-plot-inner"></div>';
  Plotly.newPlot(container.firstChild, [{ x: xs, y: ys, type: 'scatter', mode: 'lines', line: { color: '#a99cf2', width: 2 }, name: `${yv}(${xv})` }],
    layout(title), { responsive: true, displayModeBar: false });
}

export function exportPlot(el, name) {
  const div = el && (el.classList.contains('js-plotly-plot') ? el : el.querySelector('.js-plotly-plot'));
  if (div) Plotly.downloadImage(div, { format: 'png', width: 1200, height: 800, filename: name });
}

// Draw a plot spec (see plotspec.js): functions, implicit, parametric and polar curves.
export function drawSpec(target, spec, { xrange } = {}) {
  const compile = (s, keep) => substituteWorkspace(inlineUserFns(normalise(s)), keep).compile();
  const r = spec.range;
  const [xa, xb] = xrange || (r && ['x', 'y'].includes(r.v) ? [r.a, r.b] : [-10, 10]);
  const traces = [];
  let geometric = false;
  spec.items.forEach((it, idx) => {
    const color = COLORS[idx % COLORS.length];
    const line = { color, width: 2.2 };
    if (it.kind === 'fn') {
      const [a, b] = r && r.v === it.v ? [r.a, r.b] : [xa, xb];
      const { xs, ys } = sample(compile(it.expr, [it.v]), it.v, a, b, {}, 800);
      traces.push({ x: xs, y: ys, type: 'scatter', mode: 'lines', line, name: it.label, connectgaps: false });
    } else if (it.kind === 'implicit') {
      geometric = true;
      const fn = compile(it.expr, ['x', 'y']), n = 180;
      const xs = [], ys = [], zs = [];
      for (let i = 0; i <= n; i++) { xs.push(xa + (xb - xa) * i / n); ys.push(xa + (xb - xa) * i / n); }
      const loc = ctx({});
      for (let j = 0; j <= n; j++) {
        const row = [];
        loc.y = ys[j];
        for (let i = 0; i <= n; i++) { loc.x = xs[i]; let z = null; try { z = toReal(fn.evaluate(loc)); } catch {} row.push(isFinite(z) ? z : null); }
        zs.push(row);
      }
      traces.push({ x: xs, y: ys, z: zs, type: 'contour', name: it.label, showscale: false, hoverinfo: 'skip', showlegend: true,
        contours: { start: 0, end: 0, size: 1, coloring: 'lines' }, colorscale: [[0, color], [1, color]], line: { width: 2.2 } });
    } else {
      geometric = true;
      const [a, b] = r && r.v === it.v ? [r.a, r.b] : [0, 2 * Math.PI];
      const n = 1200, xs = [], ys = [];
      const loc = ctx({});
      const fx = it.kind === 'param' ? compile(it.x, [it.v, 'x', 'y']) : null, fy = it.kind === 'param' ? compile(it.y, [it.v, 'x', 'y']) : null;
      const fr = it.kind === 'polar' ? compile(it.r, [it.v]) : null;
      for (let i = 0; i <= n; i++) {
        const t = a + (b - a) * i / n; loc[it.v] = t;
        let X = null, Y = null;
        try {
          if (fr) { const rr = toReal(fr.evaluate(loc)); X = rr * Math.cos(t); Y = rr * Math.sin(t); }
          else { X = toReal(fx.evaluate(loc)); Y = toReal(fy.evaluate(loc)); }
        } catch {}
        xs.push(isFinite(X) ? X : null); ys.push(isFinite(Y) ? Y : null);
      }
      traces.push({ x: xs, y: ys, type: 'scatter', mode: 'lines', line, name: it.label, connectgaps: false });
    }
  });
  const base = layout(spec.items.length === 1 ? spec.items[0].label : '');
  const lay = { ...base, showlegend: spec.items.length > 1, hovermode: geometric ? 'closest' : 'x unified' };
  if (geometric) lay.yaxis = { ...base.yaxis, scaleanchor: 'x', scaleratio: 1 };
  Plotly.newPlot(target, traces, lay, { responsive: true, displayModeBar: false });
}
export function plotSpecInline(container, spec) {
  container.innerHTML = '<div class="cell-plot-inner"></div>';
  try { drawSpec(container.firstChild, spec); }
  catch (e) { container.innerHTML = `<div class="plot-err">${escH(e.message)}</div>`; }
}

// Graph view (2D multi-trace or 3D surface).
export function plotGraph(is3D) {
  const raw = document.getElementById('ginp').value.trim();
  if (!raw) return;
  const xmin = parseFloat(document.getElementById('gxmin').value), xmax = parseFloat(document.getElementById('gxmax').value);
  const panel = document.getElementById('gplot');
  const fail = (m) => { panel.innerHTML = `<div class="cout err" style="padding:14px 18px;">${escH(m)}</div>`; };
  if (!isFinite(xmin) || !isFinite(xmax) || xmin >= xmax) return fail('The x range must satisfy min < max.');
  let fns = [];
  if (is3D) {
    try { fns = parseTopLevelArgs(raw).map(e => substituteWorkspace(inlineUserFns(normalise(e)), ['x', 'y']).compile()); }
    catch (e) { return fail(e.message); }
  }
  panel.innerHTML = '<div id="gplotinner" style="width:100%;height:100%;min-height:380px;"></div>';
  if (is3D) {
    const n = 60, xs = [], ys = [], zs = [];
    for (let i = 0; i <= n; i++) { xs.push(xmin + i * (xmax - xmin) / n); ys.push(xmin + i * (xmax - xmin) / n); }
    for (let j = 0; j <= n; j++) {
      const row = [];
      for (let i = 0; i <= n; i++) {
        let z = null; try { z = toReal(fns[0].evaluate(ctx({ x: xs[i], y: ys[j] }))); } catch {}
        row.push(isFinite(z) ? z : null);
      }
      zs.push(row);
    }
    const dk = state.darkTheme;
    Plotly.newPlot('gplotinner', [{ x: xs, y: ys, z: zs, type: 'surface', colorscale: [[0, '#1f8a4d'], [0.5, '#7eef9c'], [1, '#a99cf2']], showscale: false }],
      { ...layout(raw), scene: { bgcolor: dk ? '#13171f' : '#f1efe8' }, margin: { l: 0, r: 0, t: 36, b: 0 } }, { responsive: true });
  } else {
    try { drawSpec(document.getElementById('gplotinner'), parsePlotItems(parseTopLevelArgs(raw)), { xrange: [xmin, xmax] }); }
    catch (e) { fail(e.message); }
  }
}
