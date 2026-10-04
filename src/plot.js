// Plotting: inline cell plots and the Graph view, drawn by the canvas grapher (graph/grapher.js)
// with expressions compiled to native functions (graph/jit.js). Free parameters get sliders with
// a play button. Plotly is loaded only for 3D surfaces.
import { math, freeSymbols, normalise, inlineUserFns, parseTopLevelArgs } from './expr.js';
import { escH } from './format.js';
import { scope } from './state.js';
import { ctx } from './kernel/mathjs-client.js';
import { substituteWorkspace } from './engine.js';
import { parsePlotItems } from './plotspec.js';
import { Grapher } from './graph/grapher.js';
import { realFunction } from './graph/jit.js';
import { compileInterval } from './graph/interval.js';
import { drawViz } from './viz.js';
import { compileGLSL, glDomainRenderer } from './graph/glsl.js';

const PLOT_VARS = ['x', 'y', 't', 'theta', 'z'];

// mathjs node for an expression, with user functions and workspace values substituted.
const prepare = (s, keep) => substituteWorkspace(inlineUserFns(normalise(s)), keep);

// Free parameters of a plot spec: names that are neither plotting variables nor defined.
function specParams(spec) {
  const names = new Set();
  const add = (s, keep) => { try { freeSymbols(prepare(s, keep)).forEach(n => { if (!keep.includes(n) && scope[n] === undefined) names.add(n); }); } catch {} };
  for (const it of spec.items) {
    if (it.kind === 'fn' || it.kind === 'ineq-fn') add(it.expr, [it.v || 'x', 'y']);
    else if (it.kind === 'implicit' || it.kind === 'ineq' || it.kind === 'slope') add(it.expr, ['x', 'y']);
    else if (it.kind === 'param') { add(it.x, [it.v]); add(it.y, [it.v]); }
    else if (it.kind === 'polar') add(it.r, [it.v]);
    else if (it.kind === 'vector') { add(it.P, ['x', 'y']); add(it.Q, ['x', 'y']); }
    else if (it.kind === 'point') { add(it.x, []); add(it.y, []); }
  }
  return [...names].filter(n => !PLOT_VARS.includes(n)).sort();
}

// Compile one spec item into grapher functions reading the shared parameter values.
function compileItem(it, params, values) {
  const fn = (src, vars) => {
    const f = realFunction(prepare(src, [...vars, ...params]), [...vars, ...params], ctx());
    return (...xs) => f(...xs, ...params.map(p => values[p]));
  };
  const base = { label: it.label };
  switch (it.kind) {
    case 'fn': { const f = fn(it.expr, [it.v || 'x']); return { ...base, kind: 'fn', f }; }
    case 'ineq-fn': return { ...base, kind: 'ineq-fn', f: fn(it.expr, ['x']), rel: it.rel };
    case 'implicit': {
      // certified enclosure (interval arithmetic) when every function in F has an interval extension
      const node = prepare(it.expr, ['x', 'y', ...params]);
      const Fi0 = compileInterval(node, ['x', 'y', ...params]);
      const Fi = Fi0 && ((X, Y) => Fi0(X, Y, ...params.map(p => [values[p], values[p]])));
      return { ...base, kind: 'implicit', F: fn(it.expr, ['x', 'y']), Fi };
    }
    case 'scatter': return { ...base, kind: 'scatter', xs: it.xs, ys: it.ys };
    case 'series': return { ...base, kind: 'series', xs: it.xs, ys: it.ys };
    case 'bars': return { ...base, kind: 'bars', edges: it.edges, heights: it.heights };
    case 'box': return { ...base, ...it };
    case 'ineq': return { ...base, kind: 'ineq', F: fn(it.expr, ['x', 'y']), rel: it.rel };
    case 'param': return { ...base, kind: 'param', fx: fn(it.x, [it.v]), fy: fn(it.y, [it.v]), t0: it.t0 ?? 0, t1: it.t1 ?? 2 * Math.PI };
    case 'polar': return { ...base, kind: 'polar', r: fn(it.r, [it.v]), t0: it.t0 ?? 0, t1: it.t1 ?? 2 * Math.PI };
    case 'slope': return { ...base, kind: 'slope', f: fn(it.expr, ['x', 'y']) };
    case 'vector': return { ...base, kind: 'vector', P: fn(it.P, ['x', 'y']), Q: fn(it.Q, ['x', 'y']) };
    case 'point': {
      const px = fn(it.x, []), py = fn(it.y, []);
      return { ...base, kind: 'point', get x() { return px(); }, get y() { return py(); } };
    }
    case 'domain': {
      const node = prepare(it.expr, ['z']);
      const glsl = params.length ? null : compileGLSL(node);
      let gpu;            // created on first draw; false when WebGL is unavailable
      const c = node.compile();
      const loc = ctx();
      return { ...base, kind: 'domain', gpu: glsl && ((v, W, H) => { if (gpu === undefined) gpu = glDomainRenderer(glsl) || false; return gpu ? gpu(v, W, H) : null; }), w: (re, im) => {
        loc.z = math.complex(re, im);
        try { const v = c.evaluate(loc); return typeof v === 'number' ? [v, 0] : [v.re, v.im]; } catch { return [NaN, NaN]; }
      } };
    }
    default: throw new Error(`Cannot plot ${it.kind}`);
  }
}

// Slider rows for parameters (with ▶ to animate); calls onChange() after every change.
function sliders(host, params, values, onChange) {
  if (!params.length) return;
  const box = document.createElement('div');
  box.className = 'plot-sliders';
  box.innerHTML = params.map(p => `
    <label class="pslider"><button class="pslider-play" data-play="${escH(p)}" title="Animate ${escH(p)}">▶</button><span class="pslider-name">${escH(p)}</span>
      <input type="range" min="-10" max="10" step="0.01" value="${values[p]}" data-param="${escH(p)}"/>
      <span class="pslider-val">${values[p]}</span></label>`).join('');
  host.appendChild(box);
  const timers = {};
  const set = (inp, v) => { inp.value = v; values[inp.dataset.param] = Number(v); inp.parentElement.querySelector('.pslider-val').textContent = Number(v).toFixed(2).replace(/\.?0+$/, '') || '0'; onChange(); };
  box.addEventListener('input', e => { const inp = e.target.closest('input[data-param]'); if (inp) set(inp, inp.value); });
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-play]'); if (!b) return;
    e.preventDefault();
    const p = b.dataset.play, inp = box.querySelector(`input[data-param="${CSS.escape(p)}"]`);
    if (timers[p]) { clearInterval(timers[p]); delete timers[p]; b.textContent = '▶'; return; }
    let dir = 1;
    b.textContent = '❚❚';
    timers[p] = setInterval(() => {
      if (!host.isConnected) { clearInterval(timers[p]); return; }
      let v = Number(inp.value) + dir * 0.05;
      if (v > 10 || v < -10) { dir = -dir; v = Math.max(-10, Math.min(10, v)); }
      set(inp, v.toFixed(2));
    }, 40);
  });
}

// Draw a plot spec (see plotspec.js) into a container.
export function drawSpec(container, spec, { xrange, height = 320 } = {}) {
  const params = specParams(spec);
  const values = Object.fromEntries(params.map(p => [p, 1]));
  container.innerHTML = '';
  const host = document.createElement('div');
  container.appendChild(host);
  const r = spec.range;
  const onlyComplex = spec.items.every(it => it.kind === 'domain');
  const xr = xrange || (r && ['x', 'y', 'z'].includes(r.v) ? [r.a, r.b] : onlyComplex ? [-3, 3] : [-10, 10]);
  const g = new Grapher(host, { xRange: xr, height });
  const items = spec.items.map(it => {
    if (r && r.v === it.v && (it.kind === 'param' || it.kind === 'polar')) return { ...it, t0: r.a, t1: r.b };
    return it;
  });
  const compiled = items.map(it => compileItem(it, params, values));
  g.setItems(compiled);
  g.spec = spec;
  sliders(container, params, values, () => g.render());
  return g;
}

export function plotSpecInline(container, spec) {
  try { if (!drawViz(container, spec, prepare)) drawSpec(container, spec); }
  catch (e) { container.innerHTML = `<div class="plot-err">${escH(e.message)}</div>`; }
}

// Inline plot of an expression in one variable.
export function plotInline(container, exprPlain, v = 'x', title) {
  plotSpecInline(container, { items: [{ kind: 'fn', expr: exprPlain, v, label: title || exprPlain }], range: null });
}

// A precomputed polyline (numerical ODE solution).
export function plotSeries(container, xs, ys, title) {
  container.innerHTML = '';
  const host = document.createElement('div');
  container.appendChild(host);
  const g = new Grapher(host, { xRange: [Math.min(...xs), Math.max(...xs)], height: 300 });
  g.setItems([{ kind: 'series', xs, ys, label: title }]);
}

export async function exportPlot(el, name) {
  const canvas = el && el.querySelector('canvas');
  if (canvas && canvas.__grapher) {
    const blob = await canvas.__grapher.toBlob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name + '.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
  const div = el && (el.classList.contains('js-plotly-plot') ? el : el.querySelector('.js-plotly-plot'));
  if (div) { const Plotly = (await import('plotly.js-dist-min')).default; Plotly.downloadImage(div, { format: 'png', width: 1200, height: 800, filename: name }); }
}

// Graph view: 2D on the grapher, 3D surfaces with Plotly (loaded on demand).
export async function plotGraph(is3D) {
  const raw = document.getElementById('ginp').value.trim();
  if (!raw) return;
  const xmin = parseFloat(document.getElementById('gxmin').value), xmax = parseFloat(document.getElementById('gxmax').value);
  const panel = document.getElementById('gplot');
  const fail = (m) => { panel.innerHTML = `<div class="cout err" style="padding:14px 18px;">${escH(m)}</div>`; };
  if (!isFinite(xmin) || !isFinite(xmax) || xmin >= xmax) return fail('The x range must satisfy min < max.');
  panel.innerHTML = '<div id="gplotinner" style="width:100%;height:100%;min-height:420px;"></div>';
  const inner = document.getElementById('gplotinner');
  if (!is3D) {
    try { drawSpec(inner, parsePlotItems(parseTopLevelArgs(raw)), { xrange: [xmin, xmax], height: Math.max(420, panel.clientHeight - 60) }); }
    catch (e) { fail(e.message); }
    return;
  }
  let f;
  try { f = realFunction(prepare(parseTopLevelArgs(raw)[0], ['x', 'y']), ['x', 'y'], ctx()); }
  catch (e) { return fail(e.message); }
  const n = 80, xs = [], ys = [], zs = [];
  for (let i = 0; i <= n; i++) { xs.push(xmin + i * (xmax - xmin) / n); ys.push(xmin + i * (xmax - xmin) / n); }
  for (let j = 0; j <= n; j++) zs.push(xs.map(x => { const z = f(x, ys[j]); return Number.isFinite(z) ? z : null; }));
  inner.innerHTML = '<div class="spin" style="margin:20px"></div>';
  const Plotly = (await import('plotly.js-dist-min')).default;
  inner.innerHTML = '';
  const dk = !document.body.classList.contains('light');
  Plotly.newPlot(inner, [{ x: xs, y: ys, z: zs, type: 'surface', colorscale: 'Viridis', showscale: false }],
    { paper_bgcolor: dk ? '#0f1218' : '#fbfaf6', font: { color: dk ? '#a3adc0' : '#3e4350' }, scene: { bgcolor: dk ? '#13171f' : '#f1efe8' }, margin: { l: 0, r: 0, t: 10, b: 0 } },
    { responsive: true });
}
