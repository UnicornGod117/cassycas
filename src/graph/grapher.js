// Interactive 2D grapher on a <canvas>: pan (drag), zoom (wheel, pinch, buttons), adaptive
// sampling with asymptote detection, implicit curves (marching squares), shaded inequalities,
// parametric and polar curves, points, slope and vector fields, complex domain colouring, and
// points of interest (roots, extrema, intersections, intercepts) that show their coordinates on
// hover. Items carry plain JavaScript functions (see jit.js); the grapher never parses input.
//
// Item kinds:
//   { kind: 'fn', f(x) }                       y = f(x)
//   { kind: 'ineq-fn', f(x), rel }             y rel f(x), rel ∈ < <= > >=
//   { kind: 'implicit', F(x, y) }              F(x, y) = 0
//   { kind: 'ineq', F(x, y), rel }             F(x, y) rel 0
//   { kind: 'param', fx(t), fy(t), t0, t1 }    (fx(t), fy(t))
//   { kind: 'polar', r(t), t0, t1 }            r = r(θ)
//   { kind: 'point', x, y }                    a point
//   { kind: 'slope', f(x, y) }                 slope field of y′ = f(x, y)
//   { kind: 'vector', P(x, y), Q(x, y) }       vector field (P, Q)
//   { kind: 'domain', w(re, im) → [re, im] }   domain colouring of a complex function
//   { kind: 'series', xs, ys }                 a polyline (e.g. a numerical ODE solution)
//   { kind: 'scatter', xs, ys }                data points
//   { kind: 'bars', edges, heights }           histogram bars over [edges[i], edges[i+1]]
//   { kind: 'box', y, min, q1, median, q3, max, outliers }   a horizontal box plot at height y
// Every item may have a label and a color. An implicit curve may also carry Fi(X, Y), an interval
// extension of F (interval.js): every pixel the curve could pass through is then shaded, so no
// part of the curve is missed — not even isolated points or touching zeros that have no sign
// change for marching squares to see.

export const PALETTE = ['#2f81f7', '#e5534b', '#3fb950', '#c69026', '#a371f7', '#db61a2', '#39c5cf', '#f0883e'];

const fmt = (v) => {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) < 1e-10) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(3).replace(/\.?0+e/, 'e');
  return String(parseFloat(v.toPrecision(6)));
};
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export class Grapher {
  constructor(host, { xRange = [-10, 10], yRange = null, equal = false, height = 300, interactive = true } = {}) {
    this.host = host;
    this.items = [];
    this.equal = equal;
    this.equal0 = equal;
    this.home = { xRange, yRange };
    this.view = { xmin: xRange[0], xmax: xRange[1], ymin: -7, ymax: 7 };
    this.fitPending = !yRange;
    if (yRange) [this.view.ymin, this.view.ymax] = yRange;
    host.classList.add('grapher');
    host.style.height = typeof height === 'number' ? height + 'px' : height;
    host.innerHTML = `<canvas role="img"></canvas><div class="grapher-tip"></div>
      <div class="grapher-tools"><button data-z="in" title="Zoom in">+</button><button data-z="out" title="Zoom out">−</button><button data-z="home" title="Reset view">⌂</button></div>
      <div class="grapher-legend"></div>`;
    this.canvas = host.querySelector('canvas');
    this.tip = host.querySelector('.grapher-tip');
    this.legend = host.querySelector('.grapher-legend');
    this.canvas.__grapher = this;
    this.ctx = this.canvas.getContext('2d');
    this.pois = [];
    this.hover = null;
    this.frame = 0;
    if (interactive) this.bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  setItems(items) {
    this.items = items.map((it, i) => ({ color: PALETTE[i % PALETTE.length], ...it }));
    // fit the view to what is drawn (the first draw, from the constructor, had nothing to fit)
    this.equal = this.equal0;
    if (!this.home.yRange) this.fitPending = true;
    this.legend.innerHTML = '';
    if (this.items.filter(i => i.label).length > 1) {
      for (const it of this.items) {
        if (!it.label) continue;
        const row = document.createElement('div');
        row.innerHTML = '<span class="grapher-swatch"></span><span></span>';
        row.firstChild.style.background = it.color;
        row.lastChild.textContent = it.label;
        this.legend.appendChild(row);
      }
    }
    this.canvas.setAttribute('aria-label', 'Graph of ' + this.items.map(i => i.label || i.kind).join(', '));
    this.render();
  }

  // ── geometry ──
  resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.W = Math.max(50, r.width); this.H = Math.max(50, r.height);
    this.canvas.width = Math.round(this.W * dpr); this.canvas.height = Math.round(this.H * dpr);
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.equal) this.fixAspect();
    this.draw();
  }
  fixAspect() {
    const v = this.view, cy = (v.ymin + v.ymax) / 2;
    const hy = (v.xmax - v.xmin) * this.H / this.W / 2;
    v.ymin = cy - hy; v.ymax = cy + hy;
  }
  sx(x) { return (x - this.view.xmin) / (this.view.xmax - this.view.xmin) * this.W; }
  sy(y) { return (this.view.ymax - y) / (this.view.ymax - this.view.ymin) * this.H; }
  wx(px) { return this.view.xmin + px / this.W * (this.view.xmax - this.view.xmin); }
  wy(py) { return this.view.ymax - py / this.H * (this.view.ymax - this.view.ymin); }

  render() { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => this.draw()); }

  zoom(factor, px = this.W / 2, py = this.H / 2) {
    const v = this.view, x = this.wx(px), y = this.wy(py);
    v.xmin = x + (v.xmin - x) * factor; v.xmax = x + (v.xmax - x) * factor;
    v.ymin = y + (v.ymin - y) * factor; v.ymax = y + (v.ymax - y) * factor;
    this.render();
  }
  reset() {
    const { xRange, yRange } = this.home;
    Object.assign(this.view, { xmin: xRange[0], xmax: xRange[1] });
    if (yRange) [this.view.ymin, this.view.ymax] = yRange; else this.fitPending = true;
    if (this.equal) this.fixAspect();
    this.render();
  }

  bind() {
    const pointers = new Map();
    let pinch = null;
    this.host.querySelector('.grapher-tools').addEventListener('click', (e) => {
      const z = e.target.closest('[data-z]')?.dataset.z;
      if (z === 'in') this.zoom(1 / 1.5); else if (z === 'out') this.zoom(1.5); else if (z === 'home') this.reset();
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      this.zoom(Math.pow(1.0015, e.deltaY), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const p = pointers.get(e.pointerId);
      if (!p) { this.onHover(e.clientX - r.left, e.clientY - r.top); return; }
      if (pointers.size === 2 && pinch) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom(pinch.d / d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        pinch.d = d;
        return;
      }
      const dx = (e.clientX - p.x) / this.W * (this.view.xmax - this.view.xmin);
      const dy = (e.clientY - p.y) / this.H * (this.view.ymax - this.view.ymin);
      this.view.xmin -= dx; this.view.xmax -= dx; this.view.ymin += dy; this.view.ymax += dy;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragging = true;
      this.tip.style.display = 'none';
      this.render();
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size && this.dragging) { this.dragging = false; this.render(); }
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('pointerleave', () => { if (!pointers.size) { this.hover = null; this.tip.style.display = 'none'; this.render(); } });
    this.canvas.addEventListener('dblclick', () => this.reset());
  }

  // ── hover: points of interest first, then the nearest curve ──
  onHover(px, py) {
    let best = null;
    for (const p of this.pois) {
      const d = Math.hypot(this.sx(p.x) - px, this.sy(p.y) - py);
      if (d < 9 && (!best || d < best.d)) best = { ...p, d };
    }
    if (!best) {
      const x = this.wx(px);
      for (const it of this.items) {
        if (it.kind === 'fn' || it.kind === 'ineq-fn') {
          const y = it.f(x);
          if (!Number.isFinite(y)) continue;
          const d = Math.abs(this.sy(y) - py);
          if (d < 12 && (!best || d < best.d)) best = { x, y, d, color: it.color, what: it.label || '' };
        } else if (it.screen) {
          for (let i = 0; i < it.screen.length; i += 2) {
            const d = Math.hypot(it.screen[i] - px, it.screen[i + 1] - py);
            if (d < 10 && (!best || d < best.d)) best = { x: this.wx(it.screen[i]), y: this.wy(it.screen[i + 1]), d, color: it.color, what: it.label || '' };
          }
        }
      }
    }
    this.hover = best;
    if (best) {
      this.tip.textContent = `${best.kindName ? best.kindName + ' ' : ''}(${fmt(best.x)}, ${fmt(best.y)})`;
      this.tip.style.display = 'block';
      this.tip.style.left = Math.min(this.sx(best.x) + 10, this.W - 150) + 'px';
      this.tip.style.top = Math.max(this.sy(best.y) - 30, 4) + 'px';
    } else this.tip.style.display = 'none';
    this.render();
  }

  // ── drawing ──
  draw() {
    const ctx = this.ctx, css = getComputedStyle(this.host);
    const col = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    this.colors = { bg: col('--g-bg', '#fff'), grid: col('--g-grid', '#e5e5e5'), grid2: col('--g-grid2', '#f3f3f3'), axis: col('--g-axis', '#888'), text: col('--g-text', '#666') };
    if (this.fitPending && this.items.length) { this.fitY(); this.fitPending = false; }
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, this.W, this.H);
    this.pois = [];
    const safely = (it) => { try { this.drawItem(it); } catch { /* one bad item must not break the others */ } };
    const domain = this.items.some(i => i.kind === 'domain');
    this.items.filter(i => i.kind === 'domain').forEach(safely);     // backgrounds first
    ctx.globalAlpha = domain ? 0.35 : 1;
    this.drawGrid();
    ctx.globalAlpha = 1;
    this.items.filter(i => i.kind !== 'domain').forEach(safely);
    if (!this.dragging) this.findIntersections();
    this.drawPois();
  }

  // Fit the y range to the function values on the x range (robust to poles).
  fitY() {
    const fns = this.items.filter(i => i.kind === 'fn' || i.kind === 'ineq-fn');
    const DATA = ['series', 'scatter', 'bars', 'box'];
    const data = this.items.filter(i => DATA.includes(i.kind));
    if (data.length && !data.some(i => i.kind === 'series')) {
      // statistical plots: frame the data (and any fitted line over the same x range)
      const xs = [], ys = [0];
      for (const it of data) {
        if (it.kind === 'scatter') { xs.push(...it.xs); ys.push(...it.ys); }
        if (it.kind === 'bars') { xs.push(...it.edges); ys.push(...it.heights); }
        if (it.kind === 'box') { xs.push(it.min, it.max, ...(it.outliers || [])); ys.push(it.y - 1, it.y + 1); }
      }
      const fx = xs.filter(Number.isFinite), lo = Math.min(...fx), hi = Math.max(...fx), pad = (hi - lo || 1) * 0.08;
      Object.assign(this.view, { xmin: lo - pad, xmax: hi + pad });
      for (const it of fns) for (let i = 0; i <= 50; i++) ys.push(it.f(lo - pad + (hi - lo + 2 * pad) * i / 50));
      this.setY(Math.min(...ys.filter(Number.isFinite)), Math.max(...ys.filter(Number.isFinite)));
      return;
    }
    const geo = this.items.some(i => !['fn', 'ineq-fn', 'series'].includes(i.kind));
    if (geo || !fns.length) {
      const series = this.items.filter(i => i.kind === 'series');
      if (series.length && !geo) {
        const ys = series.flatMap(s => s.ys).filter(Number.isFinite), xs = series.flatMap(s => s.xs).filter(Number.isFinite);
        Object.assign(this.view, { xmin: Math.min(...xs), xmax: Math.max(...xs) });
        this.setY(Math.min(...ys), Math.max(...ys));
        return;
      }
      this.equal = true; this.fixAspect(); return;
    }
    const ys = [];
    for (const it of fns) for (let i = 0; i <= 400; i++) { const y = it.f(this.view.xmin + (this.view.xmax - this.view.xmin) * i / 400); if (Number.isFinite(y)) ys.push(y); }
    if (!ys.length) return;
    ys.sort((a, b) => a - b);
    let lo = ys[Math.floor(ys.length * 0.03)], hi = ys[Math.ceil(ys.length * 0.97) - 1];
    if (ys[0] >= lo - (hi - lo) * 0.25) lo = ys[0];
    if (ys.at(-1) <= hi + (hi - lo) * 0.25) hi = ys.at(-1);
    this.setY(lo, hi);
  }
  setY(lo, hi) {
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12;
    this.view.ymin = lo - pad; this.view.ymax = hi + pad;
    // include the x-axis when it is close
    if (this.view.ymin > 0 && this.view.ymin < (hi - lo)) this.view.ymin = -pad;
    if (this.view.ymax < 0 && -this.view.ymax < (hi - lo)) this.view.ymax = pad;
  }

  drawGrid() {
    const ctx = this.ctx, v = this.view, C = this.colors;
    const stepX = niceStep((v.xmax - v.xmin) / Math.max(2, this.W / 90));
    const stepY = this.equal ? stepX : niceStep((v.ymax - v.ymin) / Math.max(2, this.H / 70));
    const lines = (step, minor) => {
      ctx.beginPath();
      for (let x = Math.ceil(v.xmin / step) * step; x <= v.xmax; x += step) { const s = Math.round(this.sx(x)) + 0.5; ctx.moveTo(s, 0); ctx.lineTo(s, this.H); }
      const sYs = minor ? step * stepY / stepX : step;
      for (let y = Math.ceil(v.ymin / sYs) * sYs; y <= v.ymax; y += sYs) { const s = Math.round(this.sy(y)) + 0.5; ctx.moveTo(0, s); ctx.lineTo(this.W, s); }
      ctx.stroke();
    };
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.grid2; lines(stepX / 5, true);
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    for (let x = Math.ceil(v.xmin / stepX) * stepX; x <= v.xmax; x += stepX) { const s = Math.round(this.sx(x)) + 0.5; ctx.moveTo(s, 0); ctx.lineTo(s, this.H); }
    for (let y = Math.ceil(v.ymin / stepY) * stepY; y <= v.ymax; y += stepY) { const s = Math.round(this.sy(y)) + 0.5; ctx.moveTo(0, s); ctx.lineTo(this.W, s); }
    ctx.stroke();
    // axes
    const ax = Math.min(Math.max(this.sy(0), 0), this.H), ay = Math.min(Math.max(this.sx(0), 0), this.W);
    ctx.strokeStyle = C.axis; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(0, Math.round(ax) + 0.5); ctx.lineTo(this.W, Math.round(ax) + 0.5);
    ctx.moveTo(Math.round(ay) + 0.5, 0); ctx.lineTo(Math.round(ay) + 0.5, this.H); ctx.stroke();
    // labels
    ctx.fillStyle = C.text; ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const ly = Math.min(Math.max(ax + 4, 2), this.H - 14);
    for (let x = Math.ceil(v.xmin / stepX) * stepX; x <= v.xmax; x += stepX) {
      if (Math.abs(x) < stepX / 2) continue;
      ctx.fillText(fmt(x), this.sx(x), ly);
    }
    ctx.textAlign = ay > this.W - 40 ? 'right' : 'left'; ctx.textBaseline = 'middle';
    const lx = ay > this.W - 40 ? ay - 4 : Math.min(Math.max(ay + 4, 2), this.W - 40);
    for (let y = Math.ceil(v.ymin / stepY) * stepY; y <= v.ymax; y += stepY) {
      if (Math.abs(y) < stepY / 2) continue;
      ctx.fillText(fmt(y), lx, this.sy(y));
    }
  }

  // Adaptive sampling of y = f(x) across the view: refines steep pieces, finds where the curve
  // ends (sqrt at 0), and breaks the line at poles and jumps. Returns [[x, y], …] runs.
  sampleFn(f) {
    const v = this.view, n = Math.ceil(this.W / 2), H = v.ymax - v.ymin;
    const runs = [];
    let run = [], budget = 25000;
    const push = (x, y) => run.push(x, y);
    const flush = () => { if (run.length >= 4) runs.push(run); run = []; };
    const onePx = H / this.H, pxW = (v.xmax - v.xmin) / this.W;
    // Is there a pole or a jump between x0 and x1? Follow the half with the larger change: on a
    // continuous curve it shrinks to under a pixel; at a jump it persists, and at a pole the
    // midpoint value leaves the [y0, y1] range (the function turns around through infinity).
    const breaks = (x0, y0, x1, y1) => {
      for (let k = 0; k < 48; k++) {
        const xm = (x0 + x1) / 2, ym = f(xm);
        budget--;
        if (!Number.isFinite(ym) || ym < Math.min(y0, y1) - onePx || ym > Math.max(y0, y1) + onePx) return true;
        if (Math.abs(ym - y0) > Math.abs(y1 - ym)) { x1 = xm; y1 = ym; } else { x0 = xm; y0 = ym; }
        if (Math.abs(y1 - y0) < onePx) return false;
      }
      return true;
    };
    const refine = (x0, y0, x1, y1, depth) => {
      const f0 = Number.isFinite(y0), f1 = Number.isFinite(y1);
      if (budget-- <= 0) { if (f1) push(x1, y1); else flush(); return; }
      if (!f0 && !f1) return;
      const xm = (x0 + x1) / 2;
      if (f0 && f1) {
        const jump = Math.abs(y1 - y0) / onePx;
        if (jump < 1.5) { push(x1, y1); return; }
        // horizontally below a quarter pixel: either a steep line or a discontinuity
        if ((x1 - x0) < pxW / 4 || depth > 10) {
          if (jump > 8 && breaks(x0, y0, x1, y1)) flush();
          push(x1, y1); return;
        }
        const ym = f(xm);
        refine(x0, y0, xm, ym, depth + 1); refine(xm, ym, x1, y1, depth + 1); return;
      }
      const ym = f(xm);
      // the curve starts or ends inside this interval: locate the edge
      if (depth > 14) { if (f1) { flush(); push(x1, y1); } else flush(); return; }
      refine(x0, y0, xm, ym, depth + 1); refine(xm, ym, x1, y1, depth + 1);
    };
    let x0 = v.xmin, y0 = f(x0);
    if (Number.isFinite(y0)) push(x0, y0);
    for (let i = 1; i <= n; i++) {
      const x1 = v.xmin + (v.xmax - v.xmin) * i / n, y1 = f(x1);
      refine(x0, y0, x1, y1, 0);
      x0 = x1; y0 = y1;
    }
    flush();
    return runs;
  }

  strokeRuns(runs, color, { dash = null, width = 2.4 } = {}) {
    const ctx = this.ctx, clamp = (s) => Math.max(-1e5, Math.min(1e5, s));
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    const screen = [];
    for (const r of runs) {
      for (let i = 0; i < r.length; i += 2) {
        const X = this.sx(r[i]), Y = clamp(this.sy(r[i + 1]));
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        if (i % 8 === 0) screen.push(X, Y);
      }
    }
    ctx.stroke(); ctx.setLineDash([]);
    return screen;
  }

  drawItem(it) {
    const ctx = this.ctx;
    switch (it.kind) {
      case 'fn': {
        const runs = this.sampleFn(it.f);
        it.runs = runs;
        it.screen = this.strokeRuns(runs, it.color);
        if (!this.dragging) this.fnPois(it, runs);
        break;
      }
      case 'ineq-fn': {
        const runs = this.sampleFn(it.f);
        it.runs = runs;
        const up = it.rel[0] === '>';
        ctx.fillStyle = it.color; ctx.globalAlpha = 0.16;
        for (const r of runs) {
          ctx.beginPath();
          ctx.moveTo(this.sx(r[0]), up ? 0 : this.H);
          for (let i = 0; i < r.length; i += 2) ctx.lineTo(this.sx(r[i]), Math.max(-1e5, Math.min(1e5, this.sy(r[i + 1]))));
          ctx.lineTo(this.sx(r[r.length - 2]), up ? 0 : this.H);
          ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = 1;
        it.screen = this.strokeRuns(runs, it.color, { dash: it.rel.length === 1 ? [7, 5] : null });
        break;
      }
      case 'implicit':
        if (it.Fi && !this.dragging) it.cells = this.enclose(it.Fi, it.color);
        it.screen = this.marching(it.F, it.color);
        break;
      case 'scatter': {
        ctx.fillStyle = it.color;
        it.screen = [];
        it.xs.forEach((x, i) => {
          const X = this.sx(x), Y = this.sy(it.ys[i]);
          if (!Number.isFinite(X) || !Number.isFinite(Y)) return;
          ctx.beginPath(); ctx.arc(X, Y, 3.2, 0, 2 * Math.PI); ctx.fill();
          if (i % 4 === 0) it.screen.push(X, Y);
        });
        break;
      }
      case 'bars': {
        ctx.fillStyle = it.color; ctx.strokeStyle = this.colors.bg; ctx.lineWidth = 1;
        it.heights.forEach((h, i) => {
          const X0 = this.sx(it.edges[i]), X1 = this.sx(it.edges[i + 1]), Y = this.sy(h), Y0 = this.sy(0);
          ctx.globalAlpha = 0.75; ctx.fillRect(X0, Math.min(Y, Y0), X1 - X0, Math.abs(Y0 - Y));
          ctx.globalAlpha = 1; ctx.strokeRect(X0, Math.min(Y, Y0), X1 - X0, Math.abs(Y0 - Y));
          this.pois.push({ x: (it.edges[i] + it.edges[i + 1]) / 2, y: h, color: it.color, kindName: `[${fmt(it.edges[i])}, ${fmt(it.edges[i + 1])}): ${fmt(h)}` });
        });
        break;
      }
      case 'box': {
        const Y = this.sy(it.y), hh = Math.max(10, Math.min(40, Math.abs(this.sy(it.y + 0.35) - Y)));
        ctx.strokeStyle = it.color; ctx.fillStyle = it.color; ctx.lineWidth = 2;
        ctx.globalAlpha = 0.25; ctx.fillRect(this.sx(it.q1), Y - hh, this.sx(it.q3) - this.sx(it.q1), 2 * hh); ctx.globalAlpha = 1;
        ctx.strokeRect(this.sx(it.q1), Y - hh, this.sx(it.q3) - this.sx(it.q1), 2 * hh);
        ctx.beginPath();
        ctx.moveTo(this.sx(it.median), Y - hh); ctx.lineTo(this.sx(it.median), Y + hh);
        ctx.moveTo(this.sx(it.min), Y); ctx.lineTo(this.sx(it.q1), Y); ctx.moveTo(this.sx(it.q3), Y); ctx.lineTo(this.sx(it.max), Y);
        ctx.moveTo(this.sx(it.min), Y - hh / 2); ctx.lineTo(this.sx(it.min), Y + hh / 2); ctx.moveTo(this.sx(it.max), Y - hh / 2); ctx.lineTo(this.sx(it.max), Y + hh / 2);
        ctx.stroke();
        for (const o of it.outliers || []) { ctx.beginPath(); ctx.arc(this.sx(o), Y, 3, 0, 2 * Math.PI); ctx.stroke(); }
        for (const [k, v] of [['min', it.min], ['Q1', it.q1], ['median', it.median], ['Q3', it.q3], ['max', it.max]]) this.pois.push({ x: v, y: it.y, color: it.color, kindName: k });
        break;
      }
      case 'ineq': {
        this.shadeRegion((x, y) => { const v = it.F(x, y); return it.rel[0] === '<' ? v < 0 : v > 0; }, it.color);
        it.screen = this.marching(it.F, it.color, it.rel.length === 1 ? [7, 5] : null);
        break;
      }
      case 'param': case 'polar': {
        const pt = it.kind === 'polar'
          ? (t) => { const r = it.r(t); return [r * Math.cos(t), r * Math.sin(t)]; }
          : (t) => [it.fx(t), it.fy(t)];
        it.screen = this.strokeRuns(this.sampleCurve(pt, it.t0, it.t1), it.color);
        break;
      }
      case 'point': {
        const X = this.sx(it.x), Y = this.sy(it.y);
        ctx.fillStyle = it.color; ctx.beginPath(); ctx.arc(X, Y, 4.5, 0, 2 * Math.PI); ctx.fill();
        this.pois.push({ x: it.x, y: it.y, color: it.color, kindName: it.label || 'point', strong: true });
        it.screen = [X, Y];
        break;
      }
      case 'slope': case 'vector': this.drawField(it); break;
      case 'domain': this.drawDomain(it); break;
      case 'series': {
        const r = [];
        it.xs.forEach((x, i) => { if (Number.isFinite(x) && Number.isFinite(it.ys[i])) r.push(x, it.ys[i]); });
        it.screen = this.strokeRuns([r], it.color);
        break;
      }
    }
  }

  // Parametric sampling with refinement where consecutive points are far apart on screen.
  sampleCurve(pt, t0, t1) {
    const n = 1500, runs = [];
    let run = [], budget = 30000;
    const finite = (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]);
    const far = (a, b) => Math.hypot(this.sx(a[0]) - this.sx(b[0]), this.sy(a[1]) - this.sy(b[1]));
    const add = (ta, pa, tb, pb, depth) => {
      if (budget-- <= 0 || !finite(pa) || !finite(pb)) { if (finite(pb)) run.push(pb[0], pb[1]); else { if (run.length >= 4) runs.push(run); run = []; } return; }
      if (far(pa, pb) > 4 && depth < 8) { const tm = (ta + tb) / 2, pm = pt(tm); add(ta, pa, tm, pm, depth + 1); add(tm, pm, tb, pb, depth + 1); return; }
      if (far(pa, pb) > Math.max(this.W, this.H)) { if (run.length >= 4) runs.push(run); run = []; }
      run.push(pb[0], pb[1]);
    };
    let ta = t0, pa = pt(t0);
    if (finite(pa)) run.push(pa[0], pa[1]);
    for (let i = 1; i <= n; i++) { const tb = t0 + (t1 - t0) * i / n, pb = pt(tb); add(ta, pa, tb, pb, 0); ta = tb; pa = pb; }
    if (run.length >= 4) runs.push(run);
    return runs;
  }

  // Certified enclosure of F(x, y) = 0: subdivide the view into squares, discard every square on
  // which the interval extension Fi proves F ≠ 0, and shade the pixel-sized squares that remain.
  // The curve is guaranteed to lie inside the shaded pixels.
  enclose(Fi, color) {
    const ctx = this.ctx, cells = [];
    let budget = 150000;
    const rec = (px, py, s) => {
      if (budget-- <= 0) { cells.push([px, py, s]); return; }      // out of budget: keep the square (conservative)
      const r = Fi([this.wx(px), this.wx(px + s)], [this.wy(py + s), this.wy(py)]);
      if (r === null || r[0] > 0 || r[1] < 0) return;               // undefined, or provably no zero here
      if (s <= 1) { cells.push([px, py, s]); return; }
      const h = s / 2;
      rec(px, py, h); rec(px + h, py, h); rec(px, py + h, h); rec(px + h, py + h, h);
    };
    for (let py = 0; py < this.H; py += 32) for (let px = 0; px < this.W; px += 32) rec(px, py, 32);
    ctx.fillStyle = color; ctx.globalAlpha = 0.5;
    for (const [px, py, s] of cells) ctx.fillRect(px, py, s, s);
    ctx.globalAlpha = 1;
    // a handful of pixels is an isolated solution (x² + y² = 0): mark it so it can be seen
    if (cells.length && cells.length <= 12) {
      for (const [px, py, s] of cells) { ctx.beginPath(); ctx.arc(px + s / 2, py + s / 2, 4, 0, 2 * Math.PI); ctx.fill(); }
      const [px, py, s] = cells[0];
      this.pois.push({ x: this.wx(px + s / 2), y: this.wy(py + s / 2), color, kindName: 'isolated solution', strong: true });
    }
    return cells.length;
  }

  // Marching squares for F(x, y) = 0. Crossings where |F| is not small are poles (e.g. of
  // tan(x) − y) and are skipped.
  marching(F, color, dash) {
    const ctx = this.ctx, step = this.W * this.H > 400000 ? 3 : 2;
    const nx = Math.ceil(this.W / step), ny = Math.ceil(this.H / step);
    const vals = new Float64Array((nx + 1) * (ny + 1));
    for (let j = 0; j <= ny; j++) { const y = this.wy(j * step); for (let i = 0; i <= nx; i++) vals[j * (nx + 1) + i] = F(this.wx(i * step), y); }
    ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.setLineDash(dash || []);
    ctx.beginPath();
    const screen = [];
    const cross = (ax, ay, va, bx, by, vb) => {
      const t = va / (va - vb), X = ax + (bx - ax) * t, Y = ay + (by - ay) * t;
      const vm = F(this.wx(X), this.wy(Y));
      if (!Number.isFinite(vm) || Math.abs(vm) > 0.5 * Math.max(Math.abs(va), Math.abs(vb)) + 1e-12) return null;
      return [X, Y];
    };
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * (nx + 1) + i;
        const a = vals[k], b = vals[k + 1], c = vals[k + nx + 2], d = vals[k + nx + 1];   // tl, tr, br, bl
        if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
        const sa = a > 0, sb = b > 0, sc = c > 0, sd = d > 0;
        if (sa === sb && sb === sc && sc === sd) continue;
        const x0 = i * step, y0 = j * step, x1 = x0 + step, y1 = y0 + step;
        const pts = [];
        if (sa !== sb) pts.push(cross(x0, y0, a, x1, y0, b));
        if (sb !== sc) pts.push(cross(x1, y0, b, x1, y1, c));
        if (sc !== sd) pts.push(cross(x1, y1, c, x0, y1, d));
        if (sd !== sa) pts.push(cross(x0, y1, d, x0, y0, a));
        const ok = pts.filter(Boolean);
        for (let m = 0; m + 1 < ok.length; m += 2) {
          ctx.moveTo(ok[m][0], ok[m][1]); ctx.lineTo(ok[m + 1][0], ok[m + 1][1]);
          if ((i + j) % 3 === 0) screen.push(ok[m][0], ok[m][1]);
        }
      }
    }
    ctx.stroke(); ctx.setLineDash([]);
    return screen;
  }

  shadeRegion(inside, color) {
    const ctx = this.ctx, step = 4;
    ctx.fillStyle = color; ctx.globalAlpha = 0.16;
    for (let py = 0; py < this.H; py += step) {
      const y = this.wy(py + step / 2);
      let start = -1;
      for (let px = 0; px <= this.W; px += step) {
        const isIn = px < this.W && inside(this.wx(px + step / 2), y);
        if (isIn && start < 0) start = px;
        if (!isIn && start >= 0) { ctx.fillRect(start, py, px - start, step); start = -1; }
      }
    }
    ctx.globalAlpha = 1;
  }

  drawField(it) {
    const ctx = this.ctx, gap = 26;
    ctx.strokeStyle = it.color; ctx.fillStyle = it.color; ctx.lineWidth = 1.4;
    const cells = [];
    let maxMag = 0;
    for (let py = gap / 2; py < this.H; py += gap) for (let px = gap / 2; px < this.W; px += gap) {
      const x = this.wx(px), y = this.wy(py);
      let dx, dy;
      if (it.kind === 'slope') { const m = it.f(x, y); dx = 1; dy = m; }
      else { dx = it.P(x, y); dy = it.Q(x, y); }
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
      // to screen directions (the axes may be scaled differently)
      const sdx = dx * this.W / (this.view.xmax - this.view.xmin), sdy = -dy * this.H / (this.view.ymax - this.view.ymin);
      const mag = Math.hypot(sdx, sdy);
      if (mag === 0) continue;
      cells.push([px, py, sdx / mag, sdy / mag, Math.hypot(dx, dy)]);
      maxMag = Math.max(maxMag, Math.hypot(dx, dy));
    }
    ctx.beginPath();
    for (const [px, py, ux, uy, m] of cells) {
      const L = it.kind === 'slope' ? 8 : 4 + 8 * Math.sqrt(m / (maxMag || 1));
      ctx.moveTo(px - ux * L, py - uy * L); ctx.lineTo(px + ux * L, py + uy * L);
      if (it.kind === 'vector') {
        const hx = px + ux * L, hy = py + uy * L;
        ctx.moveTo(hx, hy); ctx.lineTo(hx - ux * 4 - uy * 3, hy - uy * 4 + ux * 3);
        ctx.moveTo(hx, hy); ctx.lineTo(hx - ux * 4 + uy * 3, hy - uy * 4 - ux * 3);
      }
    }
    ctx.stroke();
  }

  // Domain colouring: hue = arg w, brightness from |w| with contour bands of log|w|.
  drawDomain(it) {
    const ctx = this.ctx, dpr = window.devicePixelRatio || 1;
    if (it.gpu) {          // WebGL: every pixel on the graphics card
      const gl = it.gpu(this.view, Math.round(this.W * dpr), Math.round(this.H * dpr));
      if (gl) { ctx.save(); ctx.globalAlpha = 0.95; ctx.drawImage(gl, 0, 0, this.W, this.H); ctx.restore(); it.rendered = 'gpu'; return; }
    }
    it.rendered = 'cpu';
    const step = this.dragging ? 6 : 2;
    const w = Math.ceil(this.W / step), h = Math.ceil(this.H / step);
    const img = ctx.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const [re, im] = it.w(this.wx(i * step), this.wy(j * step));
      const o = (j * w + i) * 4;
      if (!Number.isFinite(re) || !Number.isFinite(im)) { img.data[o + 3] = 255; continue; }
      const hue = (Math.atan2(im, re) / (2 * Math.PI) + 1) % 1, mod = Math.hypot(re, im);
      const band = 0.85 + 0.15 * (((Math.log2(mod + 1e-300) % 1) + 1) % 1);
      const l = (1 - 1 / (1 + Math.pow(mod, 0.35))) * band;
      const [r, g, b] = hsl(hue, 0.9, 0.12 + 0.76 * l);
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    const off = document.createElement('canvas'); off.width = w; off.height = h;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.95;
    ctx.drawImage(off, 0, 0, w * step, h * step); ctx.restore();
  }

  // ── points of interest ──
  fnPois(it, runs) {
    const f = it.f, out = [];
    const bisect = (g, a, b) => { let ga = g(a); for (let k = 0; k < 60; k++) { const m = (a + b) / 2, gm = g(m); if ((gm > 0) === (ga > 0)) { a = m; ga = gm; } else b = m; } return (a + b) / 2; };
    const golden = (g, a, b, sign) => {
      const r = (Math.sqrt(5) - 1) / 2;
      let c = b - r * (b - a), d = a + r * (b - a);
      for (let k = 0; k < 60; k++) { if (sign * g(c) < sign * g(d)) b = d; else a = c; c = b - r * (b - a); d = a + r * (b - a); }
      return (a + b) / 2;
    };
    const span = this.view.ymax - this.view.ymin;
    for (const r of runs) {
      for (let i = 2; i < r.length; i += 2) {
        const x0 = r[i - 2], y0 = r[i - 1], x1 = r[i], y1 = r[i + 1];
        if (y0 === 0) out.push({ x: x0, y: 0, kindName: 'root' });
        else if ((y0 < 0) !== (y1 < 0) && y1 !== 0) {
          const x = bisect(f, x0, x1), y = f(x);
          if (Math.abs(y) < 1e-6 * (1 + span)) out.push({ x, y: 0, kindName: 'root' });
        }
        if (i >= 4) {
          const ya = r[i - 3], d1 = y0 - ya, d2 = y1 - y0;
          if (d1 * d2 < 0 && Math.abs(d1) + Math.abs(d2) > 0) {
            const sign = d1 > 0 ? -1 : 1;      // rising then falling: a maximum (minimise −f)
            const x = golden(f, r[i - 4], x1, sign), y = f(x);
            if (Number.isFinite(y)) out.push({ x, y, kindName: sign < 0 ? 'maximum' : 'minimum' });
          }
        }
      }
    }
    if (this.view.xmin < 0 && this.view.xmax > 0) { const y = f(0); if (Number.isFinite(y)) out.push({ x: 0, y, kindName: 'y-intercept' }); }
    const seen = [];
    for (const p of out) {
      if (seen.some(q => Math.abs(this.sx(q.x) - this.sx(p.x)) < 3 && Math.abs(this.sy(q.y) - this.sy(p.y)) < 3)) continue;
      seen.push(p);
      if (seen.length > 60) break;
    }
    seen.forEach(p => { p.color = it.color; this.pois.push(p); });
  }
  findIntersections() {
    const fns = this.items.filter(i => i.kind === 'fn');
    for (let a = 0; a < fns.length; a++) for (let b = a + 1; b < fns.length; b++) {
      const g = (x) => fns[a].f(x) - fns[b].f(x);
      const n = Math.ceil(this.W / 3);
      let x0 = this.view.xmin, g0 = g(x0), count = 0;
      for (let i = 1; i <= n && count < 30; i++) {
        const x1 = this.view.xmin + (this.view.xmax - this.view.xmin) * i / n, g1 = g(x1);
        if (Number.isFinite(g0) && Number.isFinite(g1) && (g0 < 0) !== (g1 < 0)) {
          let lo = x0, hi = x1, glo = g0;
          for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2, gm = g(m); if ((gm < 0) === (glo < 0)) { lo = m; glo = gm; } else hi = m; }
          const x = (lo + hi) / 2, y = fns[a].f(x);
          if (Number.isFinite(y) && Math.abs(g(x)) < 1e-6 * (1 + Math.abs(y))) { this.pois.push({ x, y, kindName: 'intersection', color: this.colors.text }); count++; }
        }
        x0 = x1; g0 = g1;
      }
    }
  }
  drawPois() {
    const ctx = this.ctx;
    for (const p of this.pois) {
      if (p.strong) continue;
      const X = this.sx(p.x), Y = this.sy(p.y);
      if (X < -5 || X > this.W + 5 || Y < -5 || Y > this.H + 5) continue;
      ctx.beginPath(); ctx.arc(X, Y, 3.6, 0, 2 * Math.PI);
      ctx.fillStyle = this.colors.bg; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = p.color || this.colors.text; ctx.stroke();
    }
    if (this.hover) {
      const X = this.sx(this.hover.x), Y = this.sy(this.hover.y);
      ctx.beginPath(); ctx.arc(X, Y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = this.hover.color || this.colors.text; ctx.fill();
    }
  }

  toBlob() { return new Promise(r => this.canvas.toBlob(r, 'image/png')); }
  destroy() { this.ro.disconnect(); cancelAnimationFrame(this.frame); }
}

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
