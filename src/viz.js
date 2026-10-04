// Visualisations beyond 2D function plots:
//   histogram(data[, bins]), boxplot(data, …), scatter(xs, ys)     statistical plots (2D grapher)
//   graph(A or edges), shortestpath(A, from, to)                     networks, with graph facts
//   tree(expr)                                                        expression trees (SVG)
//   plot3d(f) · plot3d(F = c) · plot3d([x, y, z], [u, …], [v, …])     surfaces, implicit surfaces,
//   riemann(f(z))                                                     parametric surfaces/curves,
//                                                                     Riemann surfaces (Plotly, lazy)
// Each eval* function returns a cell result with a plotSpec that drawViz() renders.
import { math, parseTopLevelArgs, freeSymbols, normalise, inlineUserFns, stripParens, splitRelation } from './expr.js';
import { escH } from './format.js';
import { ctx } from './kernel/mathjs-client.js';
import { realFunction } from './graph/jit.js';

const isList = (s) => /^\[.*\]$/s.test(s.trim());
// statistics are measurements: decimals, never fractions
const fmt = (v) => String(Math.abs(v) < 1e-12 ? 0 : +(+v).toPrecision(10));

// ── data ──────────────────────────────────────────────
function numbers(text, evaluate) {
  const v = evaluate(text);
  const arr = v && v.isMatrix ? v.toArray() : v;
  const flat = Array.isArray(arr) ? arr.flat(Infinity) : null;
  if (!flat || !flat.length || !flat.every(x => typeof x === 'number' && Number.isFinite(x))) throw new Error(`Expected a list of numbers: ${text}`);
  return flat;
}
const quantile = (sorted, p) => {
  const h = (sorted.length - 1) * p, lo = Math.floor(h);
  return sorted[lo] + (h - lo) * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo]);
};
function summary(xs) {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { s, n, mean, sd, min: s[0], max: s[n - 1], q1: quantile(s, 0.25), median: quantile(s, 0.5), q3: quantile(s, 0.75) };
}
const result = (latex, plain, extra) => ({ out: latex, plain, type: 'plot', engine: 'js', ...extra });

export function evalStatPlot(head, args, evaluate) {
  if (head === 'histogram') {
    if (!args.length || args.length > 2) throw new Error('Use histogram(data[, bins]).');
    const xs = numbers(args[0], evaluate), S = summary(xs);
    const k = args[1] ? Math.round(Number(evaluate(args[1]))) : Math.ceil(Math.log2(S.n) + 1);       // Sturges
    if (!(k >= 1 && k <= 200)) throw new Error('The number of bins must be between 1 and 200.');
    const w = (S.max - S.min || 1) / k, edges = Array.from({ length: k + 1 }, (_, i) => S.min + i * w), heights = new Array(k).fill(0);
    for (const x of xs) heights[Math.min(k - 1, Math.floor((x - S.min) / w))]++;
    return result(`\\text{histogram: } n = ${S.n},\\ \\bar x = ${fmt(+S.mean.toPrecision(10))},\\ s = ${fmt(+S.sd.toPrecision(10))}`,
      `histogram: n = ${S.n}, mean = ${fmt(S.mean)}, sd = ${fmt(S.sd)}`, {
        steps: [{ d: 'Bins', e: `${k} bins of width ${fmt(w)} (Sturges' rule${args[1] ? ' overridden' : ''})` }, { d: 'Counts', e: `[${heights.join(', ')}]` },
          { d: 'Five-number summary', e: `${fmt(S.min)}, ${fmt(S.q1)}, ${fmt(S.median)}, ${fmt(S.q3)}, ${fmt(S.max)}` }],
        plotSpec: { items: [{ kind: 'bars', edges, heights, label: args[0] }], range: null } });
  }
  if (head === 'boxplot') {
    if (!args.length) throw new Error('Use boxplot(data, …).');
    const items = [], steps = [];
    args.forEach((a, i) => {
      const S = summary(numbers(a, evaluate)), iqr = S.q3 - S.q1;
      const lo = S.q1 - 1.5 * iqr, hi = S.q3 + 1.5 * iqr;
      const inside = S.s.filter(x => x >= lo && x <= hi);
      items.push({ kind: 'box', y: args.length - i, min: inside[0], q1: S.q1, median: S.median, q3: S.q3, max: inside.at(-1), outliers: S.s.filter(x => x < lo || x > hi), label: a });
      steps.push({ d: a.length > 40 ? `data ${i + 1}` : a, e: `min ${fmt(S.min)}, Q1 ${fmt(S.q1)}, median ${fmt(S.median)}, Q3 ${fmt(S.q3)}, max ${fmt(S.max)}, IQR ${fmt(iqr)}` });
    });
    return result(`\\text{box plot of ${args.length} data set${args.length > 1 ? 's' : ''}}`, `box plot (${args.length})`, { steps, plotSpec: { items, range: null } });
  }
  // scatter(xs, ys): points and the least-squares line
  if (args.length !== 2) throw new Error('Use scatter(xs, ys).');
  const xs = numbers(args[0], evaluate), ys = numbers(args[1], evaluate);
  if (xs.length !== ys.length || xs.length < 2) throw new Error('scatter needs two lists of the same length (at least 2 points).');
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxx = 0, sxy = 0, syy = 0;
  xs.forEach((x, i) => { sxx += (x - mx) ** 2; sxy += (x - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; });
  if (sxx === 0) throw new Error('All x values are equal; no line can be fitted.');
  const b = sxy / sxx, a = my - b * mx, r = syy ? sxy / Math.sqrt(sxx * syy) : 1;
  const line = `${+b.toPrecision(12)} * x + ${+a.toPrecision(12)}`;
  return result(`\\hat y = ${fmt(+b.toPrecision(8))}\\,x ${a < 0 ? '-' : '+'} ${fmt(Math.abs(+a.toPrecision(8)))},\\quad r = ${fmt(+r.toPrecision(6))},\\ r^2 = ${fmt(+(r * r).toPrecision(6))}`,
    `y = ${fmt(+b.toPrecision(8))}*x + ${fmt(+a.toPrecision(8))}, r = ${fmt(+r.toPrecision(6))}`, {
      steps: [{ d: 'Least squares', e: `slope = Sxy/Sxx = ${fmt(sxy)}/${fmt(sxx)}` }, { d: 'Intercept', e: `ȳ − slope·x̄ = ${fmt(a)}` }],
      plotSpec: { items: [{ kind: 'scatter', xs, ys, label: 'data' }, { kind: 'fn', expr: line, v: 'x', label: 'least-squares line' }], range: null } });
}

// ── stochastic paths ──────────────────────────────────
// sdepaths(μ, σ, X0, T[, n]): n sample paths of dX = μ(X, t) dt + σ(X, t) dW by Euler–Maruyama,
// from a fixed seed so the picture is reproducible.
export function evalSdePaths(args, evaluate) {
  if (args.length < 4 || args.length > 5) throw new Error('Use sdepaths(μ, σ, X0, T[, paths]) with μ and σ in X and t.');
  const mu = math.compile(inlineUserFns(normalise(args[0]))), sigma = math.compile(inlineUserFns(normalise(args[1])));
  const x0 = Number(evaluate(args[2])), T = Number(evaluate(args[3])), n = args[4] ? Math.round(Number(evaluate(args[4]))) : 6;
  if (!Number.isFinite(x0) || !(T > 0) || !(n >= 1 && n <= 50)) throw new Error('X0 must be a number, T > 0 and 1 to 50 paths.');
  let seed = 20240607;
  const rand = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const steps = 500, dt = T / steps, scope = ctx(), items = [];
  const ends = [];
  for (let p = 0; p < n; p++) {
    const xs = [0], ys = [x0];
    let X = x0;
    for (let k = 1; k <= steps && Number.isFinite(X); k++) {
      scope.X = X; scope.t = (k - 1) * dt;
      X += Number(mu.evaluate(scope)) * dt + Number(sigma.evaluate(scope)) * Math.sqrt(dt) * gauss();
      xs.push(k * dt); ys.push(X);
    }
    ends.push(X);
    items.push({ kind: 'series', xs, ys, label: n <= 8 ? `path ${p + 1}` : '' });
  }
  const mean = ends.reduce((a, b) => a + b, 0) / n;
  return result(`\\text{${n} sample paths of } dX = \\left(${math.parse(normalise(args[0])).toTex()}\\right) dt + \\left(${math.parse(normalise(args[1])).toTex()}\\right) dW`,
    `${n} sample paths of dX = (${args[0]}) dt + (${args[1]}) dW`, {
      steps: [{ d: 'Euler–Maruyama', e: `${steps} steps of size ${fmt(dt)}; fixed seed (reproducible)` }, { d: 'Sample mean of X(T)', e: fmt(mean) }],
      plotSpec: { items, range: null } });
}

// ── networks ──────────────────────────────────────────
// A square matrix is an adjacency matrix (weights; directed if not symmetric); a list of pairs
// [[1, 2], [2, 3]] (or triples with a weight) is an edge list.
function parseGraph(text, evaluate) {
  const v = evaluate(text);
  const A = v && v.isMatrix ? v.toArray() : v;
  if (!Array.isArray(A) || !A.length || !A.every(Array.isArray)) throw new Error('A graph is an adjacency matrix [[0, 1], [1, 0]] or an edge list [[1, 2], [2, 3]].');
  // square with a zero diagonal: an adjacency matrix; otherwise rows of 2 or 3 entries are edges
  const square = A.length >= 2 && A.every(r => r.length === A.length) && A.every((r, i) => Number(r[i]) === 0);
  let n, edges = [], labels, directed;
  if (square) {
    n = A.length; labels = Array.from({ length: n }, (_, i) => String(i + 1));
    directed = A.some((r, i) => r.some((w, j) => w !== A[j][i]));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const w = Number(A[i][j]);
      if (w && (directed || j >= i)) edges.push({ a: i, b: j, w });
    }
  } else {
    if (!A.every(r => r.length === 2 || r.length === 3)) throw new Error('Each edge looks like [1, 2] or [1, 2, weight].');
    const names = [...new Set(A.flatMap(r => [r[0], r[1]]).map(String))].sort((p, q) => (+p - +q) || p.localeCompare(q));
    const idx = Object.fromEntries(names.map((s, i) => [s, i]));
    n = names.length; labels = names; directed = false;
    edges = A.map(r => ({ a: idx[String(r[0])], b: idx[String(r[1])], w: r.length === 3 ? Number(r[2]) : 1 }));
  }
  if (n > 200) throw new Error('Graphs are limited to 200 vertices.');
  const weighted = edges.some(e => e.w !== 1);
  return { n, edges, labels, directed, weighted };
}
function adjacency(G) {
  const adj = Array.from({ length: G.n }, () => []);
  for (const e of G.edges) { adj[e.a].push([e.b, e.w]); if (!G.directed && e.a !== e.b) adj[e.b].push([e.a, e.w]); }
  return adj;
}
function components(G) {
  const adj = Array.from({ length: G.n }, () => []);
  for (const e of G.edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
  const comp = new Array(G.n).fill(-1);
  let c = 0;
  for (let s = 0; s < G.n; s++) {
    if (comp[s] >= 0) continue;
    const st = [s]; comp[s] = c;
    while (st.length) { const u = st.pop(); for (const v of adj[u]) if (comp[v] < 0) { comp[v] = c; st.push(v); } }
    c++;
  }
  return { count: c, comp };
}
function bipartite(G) {
  const adj = Array.from({ length: G.n }, () => []);
  for (const e of G.edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
  const col = new Array(G.n).fill(-1);
  for (let s = 0; s < G.n; s++) {
    if (col[s] >= 0) continue;
    col[s] = 0; const q = [s];
    while (q.length) { const u = q.shift(); for (const v of adj[u]) { if (col[v] < 0) { col[v] = 1 - col[u]; q.push(v); } else if (col[v] === col[u]) return false; } }
  }
  return true;
}
function chromatic(G) {
  if (G.n > 12) return null;
  const adj = Array.from({ length: G.n }, () => new Set());
  for (const e of G.edges) if (e.a !== e.b) { adj[e.a].add(e.b); adj[e.b].add(e.a); }
  for (let k = 1; k <= G.n; k++) {
    const col = new Array(G.n).fill(-1);
    const go = (v) => {
      if (v === G.n) return true;
      for (let c = 0; c < k; c++) {
        if ([...adj[v]].some(u => col[u] === c)) continue;
        col[v] = c; if (go(v + 1)) return true; col[v] = -1;
      }
      return false;
    };
    if (go(0)) return k;
  }
  return G.n;
}
function dijkstra(G, s) {
  const adj = adjacency(G), dist = new Array(G.n).fill(Infinity), prev = new Array(G.n).fill(-1), done = new Array(G.n).fill(false);
  dist[s] = 0;
  for (let it = 0; it < G.n; it++) {
    let u = -1;
    for (let i = 0; i < G.n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) { if (w < 0) throw new Error('Shortest paths need non-negative weights.'); dist[v] = dist[u] + w; prev[v] = u; }
  }
  return { dist, prev };
}
export function evalGraph(head, args, evaluate) {
  if (!args.length) throw new Error(head === 'graph' ? 'Use graph(A) with an adjacency matrix or an edge list.' : 'Use shortestpath(G, from, to).');
  const G = parseGraph(args[0], evaluate);
  const deg = new Array(G.n).fill(0);
  for (const e of G.edges) { deg[e.a]++; if (!G.directed) deg[e.b]++; }      // out-degree when directed
  const { count } = components(G);
  const m = G.edges.length;
  const steps = [
    { d: 'Vertices and edges', e: `${G.n} vertices, ${m} ${G.directed ? 'directed ' : ''}edges${G.weighted ? ' (weighted)' : ''}` },
    { d: 'Degrees', e: G.labels.map((l, i) => `${l}: ${deg[i]}`).join(', ') },
    { d: 'Connected', e: count === 1 ? 'yes' : `no (${count} components)` },
  ];
  if (!G.directed) {
    const odd = deg.filter(d => d % 2).length;
    steps.push({ d: 'Bipartite', e: bipartite(G) ? 'yes' : 'no' });
    steps.push({ d: 'Tree', e: count === 1 && m === G.n - 1 ? 'yes' : 'no' });
    steps.push({ d: 'Euler', e: count === 1 && odd === 0 ? 'has an Euler circuit' : count === 1 && odd === 2 ? 'has an Euler path (not a circuit)' : 'no Euler path' });
    const chi = chromatic(G);
    if (chi !== null) steps.push({ d: 'Chromatic number', e: String(chi) });
  }
  let path = null, plain = `graph: ${G.n} vertices, ${m} edges`, latex = `\\text{graph: ${G.n} vertices, ${m} edges}`;
  if (head === 'shortestpath') {
    if (args.length !== 3) throw new Error('Use shortestpath(G, from, to).');
    const find = (t) => { const k = G.labels.indexOf(String(evaluate(t))); if (k < 0) throw new Error(`No vertex ${t}.`); return k; };
    const s = find(args[1]), t = find(args[2]);
    const { dist, prev } = dijkstra(G, s);
    if (dist[t] === Infinity) { plain = `no path from ${G.labels[s]} to ${G.labels[t]}`; latex = `\\text{${plain}}`; }
    else {
      path = [t]; while (path[0] !== s) path.unshift(prev[path[0]]);
      plain = `${path.map(i => G.labels[i]).join(' → ')} (length ${fmt(dist[t])})`;
      latex = `${path.map(i => G.labels[i]).join(' \\to ')}\\quad\\text{(length ${fmt(dist[t])})}`;
      steps.push({ d: "Dijkstra's algorithm", e: G.labels.map((l, i) => `${l}: ${dist[i] === Infinity ? '∞' : fmt(dist[i])}`).join(', ') });
    }
  }
  return result(latex, plain, { steps, plotSpec: { type: 'network', G, path } });
}
// Force-directed layout (Fruchterman–Reingold), deterministic: starts on a circle.
function layout(G) {
  const n = G.n, P = Array.from({ length: n }, (_, i) => [Math.cos(2 * Math.PI * i / n), Math.sin(2 * Math.PI * i / n)]);
  if (n <= 2) return P;
  const k = 1.6 / Math.sqrt(n);
  for (let it = 0; it < 300; it++) {
    const D = P.map(() => [0, 0]), T = 0.1 * (1 - it / 300);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], d = Math.hypot(dx, dy) || 1e-3, f = k * k / d;
      D[i][0] += dx / d * f; D[i][1] += dy / d * f; D[j][0] -= dx / d * f; D[j][1] -= dy / d * f;
    }
    for (const e of G.edges) {
      if (e.a === e.b) continue;
      const dx = P[e.a][0] - P[e.b][0], dy = P[e.a][1] - P[e.b][1], d = Math.hypot(dx, dy) || 1e-3, f = d * d / k;
      D[e.a][0] -= dx / d * f; D[e.a][1] -= dy / d * f; D[e.b][0] += dx / d * f; D[e.b][1] += dy / d * f;
    }
    P.forEach((p, i) => { const d = Math.hypot(...D[i]) || 1; p[0] += D[i][0] / d * Math.min(d, T); p[1] += D[i][1] / d * Math.min(d, T); });
  }
  return P;
}
function drawNetwork(host, { G, path }) {
  const css = getComputedStyle(document.body), col = (v, f) => css.getPropertyValue(v).trim() || f;
  const fg = col('--t0', '#ddd'), mute = col('--t2', '#888'), accent = col('--cyan', '#2f81f7'), bg = col('--s1', '#111');
  const W = Math.max(280, host.clientWidth || 600), H = 340, pad = 30;
  const P = layout(G);
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sc = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (y1 - y0 || 1));
  const X = (i) => W / 2 + (P[i][0] - (x0 + x1) / 2) * sc, Y = (i) => H / 2 + (P[i][1] - (y0 + y1) / 2) * sc;
  const onPath = new Set();
  if (path) for (let i = 0; i + 1 < path.length; i++) onPath.add(`${path[i]},${path[i + 1]}`).add(`${path[i + 1]},${path[i]}`);
  const r = G.n > 40 ? 5 : 13;
  let svg = `<svg class="viz-net" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Network with ${G.n} vertices and ${G.edges.length} edges">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${mute}"/></marker></defs>`;
  for (const e of G.edges) {
    const hot = onPath.has(`${e.a},${e.b}`);
    if (e.a === e.b) { svg += `<circle cx="${X(e.a)}" cy="${Y(e.a) - r - 7}" r="8" fill="none" stroke="${hot ? accent : mute}" stroke-width="${hot ? 3 : 1.5}"/>`; continue; }
    const dx = X(e.b) - X(e.a), dy = Y(e.b) - Y(e.a), d = Math.hypot(dx, dy) || 1;
    const ax = X(e.a) + dx / d * r, ay = Y(e.a) + dy / d * r, bx = X(e.b) - dx / d * r, by = Y(e.b) - dy / d * r;
    svg += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${hot ? accent : mute}" stroke-width="${hot ? 3 : 1.5}"${G.directed ? ' marker-end="url(#arrow)"' : ''}/>`;
    if (G.weighted) svg += `<text x="${(ax + bx) / 2}" y="${(ay + by) / 2 - 4}" fill="${mute}" font-size="11" text-anchor="middle">${escH(fmt(e.w))}</text>`;
  }
  for (let i = 0; i < G.n; i++) {
    const hot = path && path.includes(i);
    svg += `<circle cx="${X(i)}" cy="${Y(i)}" r="${r}" fill="${hot ? accent : bg}" stroke="${hot ? accent : fg}" stroke-width="1.5"/>`;
    if (G.n <= 40) svg += `<text x="${X(i)}" y="${Y(i) + 4}" fill="${hot ? '#fff' : fg}" font-size="12" text-anchor="middle">${escH(G.labels[i])}</text>`;
  }
  host.innerHTML = svg + '</svg>';
}

// ── expression trees ──────────────────────────────────
export function evalTree(args) {
  if (args.length !== 1) throw new Error('Use tree(expression).');
  const node = math.parse(normalise(args[0]));
  return result(`\\text{expression tree of } ${node.toTex({ parenthesis: 'auto' })}`, `tree of ${args[0]}`, { plotSpec: { type: 'tree', expr: args[0] } });
}
function treeOf(node) {
  node = stripParens(node);
  const OPN = { add: '+', subtract: '−', multiply: '×', divide: '÷', pow: '^', unaryMinus: '−', factorial: '!', mod: 'mod' };
  if (node.isOperatorNode) return { label: OPN[node.fn] || node.op, kind: 'op', kids: node.args.map(treeOf) };
  if (node.isFunctionNode) return { label: node.fn.name || 'f', kind: 'fn', kids: node.args.map(treeOf) };
  if (node.isSymbolNode) return { label: node.name, kind: 'sym', kids: [] };
  if (node.isConstantNode) return { label: String(node.value), kind: 'num', kids: [] };
  if (node.isArrayNode) return { label: '[ ]', kind: 'fn', kids: node.items.map(treeOf) };
  if (node.isAssignmentNode || node.isRelationalNode) return { label: '=', kind: 'op', kids: (node.params || [node.object, node.value]).filter(Boolean).map(treeOf) };
  return { label: node.type.replace('Node', ''), kind: 'fn', kids: (node.args || []).map(treeOf) };
}
function drawTree(host, { expr }) {
  const root = treeOf(math.parse(normalise(expr)));
  let leaf = 0, depth = 0;
  const place = (t, d) => {
    t.d = d; depth = Math.max(depth, d);
    if (!t.kids.length) { t.x = leaf++; return; }
    t.kids.forEach(k => place(k, d + 1));
    t.x = (t.kids[0].x + t.kids.at(-1).x) / 2;
  };
  place(root, 0);
  const W = Math.max(280, (leaf + 1) * 56), H = (depth + 1) * 64 + 20, sx = (x) => 28 + x * 56, sy = (d) => 30 + d * 64;
  const css = getComputedStyle(document.body), col = (v, f) => css.getPropertyValue(v).trim() || f;
  const C = { op: col('--cyan', '#2f81f7'), fn: col('--violet', '#a371f7'), sym: col('--a0', '#3fb950'), num: col('--warm', '#c69026') };
  const fg = col('--t0', '#ddd'), mute = col('--t2', '#888'), bg = col('--s1', '#111');
  let edges = '', nodes = '';
  const walk = (t) => {
    for (const k of t.kids) { edges += `<line x1="${sx(t.x)}" y1="${sy(t.d)}" x2="${sx(k.x)}" y2="${sy(k.d)}" stroke="${mute}" stroke-width="1.4"/>`; walk(k); }
    const w = Math.max(30, 9 * t.label.length + 14);
    nodes += `<rect x="${sx(t.x) - w / 2}" y="${sy(t.d) - 14}" width="${w}" height="28" rx="14" fill="${bg}" stroke="${C[t.kind]}" stroke-width="2"/>
      <text x="${sx(t.x)}" y="${sy(t.d) + 5}" fill="${fg}" font-size="13" text-anchor="middle" font-family="var(--mono, monospace)">${escH(t.label)}</text>`;
  };
  walk(root);
  host.innerHTML = `<div class="viz-scroll"><svg class="viz-tree" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Expression tree of ${escH(expr)}">${edges}${nodes}</svg></div>`;
}

// ── 3D ────────────────────────────────────────────────
const rangeOf = (s, evaluate) => {
  if (!isList(s)) return null;
  const it = parseTopLevelArgs(s.trim().slice(1, -1));
  if (it.length !== 3 || !/^[A-Za-z_]\w*$/.test(it[0])) return null;
  return { v: it[0], a: Number(evaluate(it[1])), b: Number(evaluate(it[2])) };
};
export function evalPlot3d(head, args, evaluate, prepare) {
  if (head === 'riemann') {
    if (!args.length || args.length > 2) throw new Error('Use riemann(f(z)[, radius]).');
    const R = args[1] ? Number(evaluate(args[1])) : 2;
    if (!(R > 0)) throw new Error('The radius must be positive.');
    riemannFunction(args[0]);       // reject unsupported input now
    return result(`\\text{Riemann surface of } ${math.parse(normalise(args[0])).toTex({ parenthesis: 'auto' })}`, `Riemann surface of ${args[0]}`,
      { plotSpec: { type: '3d', kind: 'riemann', expr: args[0], R }, steps: [{ d: 'Height', e: 'Re w over the z-plane; colour: Im w. Each branch of √, ∛, z^(p/q) and log is continued around the origin.' }] });
  }
  if (!args.length) throw new Error('Use plot3d(f(x, y)), plot3d(F(x, y, z) = c) or plot3d([x(u, v), y(u, v), z(u, v)], [u, a, b], [v, c, d]).');
  const ranges = args.slice(1).map(a => rangeOf(a, evaluate));
  if (ranges.some(r => !r || !(r.b > r.a))) throw new Error('Ranges look like [x, -2, 2].');
  const f = args[0];
  if (isList(f)) {
    const comps = parseTopLevelArgs(f.trim().slice(1, -1));
    if (comps.length !== 3) throw new Error('A parametric surface or curve has three components [x, y, z].');
    const vars = ranges.length ? ranges.map(r => r.v) : freeSymbols(comps.join('+')).sort();
    if (vars.length === 1) return result(`\\text{space curve}`, `space curve ${f}`, { plotSpec: { type: '3d', kind: 'curve', comps, ranges: ranges.length ? ranges : [{ v: vars[0], a: 0, b: 2 * Math.PI }] } });
    if (vars.length !== 2) throw new Error('A parametric surface uses two parameters, e.g. [u, 0, 2pi], [v, 0, pi].');
    return result(`\\text{parametric surface}`, `parametric surface ${f}`, { plotSpec: { type: '3d', kind: 'param', comps, ranges: ranges.length === 2 ? ranges : vars.map(v => ({ v, a: 0, b: 2 * Math.PI })) } });
  }
  const hasEq = /(?<![<>!=])=(?!=)/.test(f);
  const { lhs, rhs, rel } = hasEq ? splitRelation(f) : { lhs: f, rhs: '0', rel: null };
  const implicit = rel === '=' && !(lhs.trim() === 'z' && !freeSymbols(rhs).includes('z'));
  if (implicit) {
    const F = `(${lhs}) - (${rhs})`;
    const box = ranges.length === 3 ? ranges : ['x', 'y', 'z'].map(v => ({ v, a: -3, b: 3 }));
    return result(`\\text{implicit surface } ${math.parse(`${lhs} == ${rhs}`).toTex().replace('==', '=')}`, `implicit surface ${f}`, { plotSpec: { type: '3d', kind: 'implicit', F, box } });
  }
  const expr = rel === '=' ? rhs : f;
  const xr = ranges.find(r => r.v === 'x') || { v: 'x', a: -3, b: 3 }, yr = ranges.find(r => r.v === 'y') || { v: 'y', a: -3, b: 3 };
  return result(`z = ${math.parse(normalise(expr)).toTex({ parenthesis: 'auto' })}`, `surface z = ${expr}`, { plotSpec: { type: '3d', kind: 'surface', expr, xr, yr } });
}

// Riemann surfaces: z = r e^{iθ} with θ running over several turns; each multivalued atom of z
// (sqrt(z), cbrt(z), nthRoot(z, n), z^(p/q), log(z)) is replaced by its continuation along θ.
function riemannFunction(text) {
  const node = math.parse(normalise(text));
  let turns = 1, k = 0;
  const atoms = [];
  const frac = (n) => { n = stripParens(n); try { const v = n.evaluate(); return typeof v === 'number' && isFinite(v) ? v : null; } catch { return null; } };
  const isZ = (n) => { n = stripParens(n); return n.isSymbolNode && n.name === 'z'; };
  const lcm = (a, b) => { const g = (x, y) => y ? g(y, x % y) : x; return a / g(a, b) * b; };
  const replaced = node.transform((n) => {
    let p = null;
    if (n.isFunctionNode && n.fn.name === 'sqrt' && isZ(n.args[0])) p = { kind: 'pow', e: 0.5, q: 2 };
    else if (n.isFunctionNode && n.fn.name === 'cbrt' && isZ(n.args[0])) p = { kind: 'pow', e: 1 / 3, q: 3 };
    else if (n.isFunctionNode && n.fn.name === 'nthRoot' && isZ(n.args[0]) && Number.isInteger(frac(n.args[1]))) { const m = frac(n.args[1]); p = { kind: 'pow', e: 1 / m, q: m }; }
    else if (n.isFunctionNode && n.fn.name === 'log' && n.args.length === 1 && isZ(n.args[0])) p = { kind: 'log', q: 3 };
    else if (n.isOperatorNode && n.fn === 'pow' && isZ(n.args[0])) {
      const e = frac(n.args[1]);
      if (e !== null && !Number.isInteger(e)) {
        let q = 1; while (q < 12 && Math.abs(e * q - Math.round(e * q)) > 1e-9) q++;
        p = { kind: 'pow', e, q };
      }
    }
    if (!p) return n;
    turns = lcm(turns, Math.min(p.q, 6));
    const name = `__w${k++}`;
    atoms.push({ name, ...p });
    return new math.SymbolNode(name);
  });
  if (atoms.some(a => a.kind === 'log')) turns = Math.max(turns, 3);
  const compiled = replaced.compile(), scope = ctx();
  return {
    turns, log: atoms.some(a => a.kind === 'log'),
    at(r, th) {
      scope.z = math.complex({ r, phi: th });
      for (const a of atoms) scope[a.name] = a.kind === 'log' ? math.complex(Math.log(r), th) : math.complex({ r: Math.pow(r, a.e), phi: a.e * th });
      const w = compiled.evaluate(scope);
      return typeof w === 'number' ? [w, 0] : [w.re, w.im];
    },
  };
}

async function draw3d(host, spec, prepare) {
  host.innerHTML = '<div class="spin" style="margin:20px"></div>';
  const Plotly = (await import('plotly.js-dist-min')).default;
  const dk = !document.body.classList.contains('light');
  const theme = { paper_bgcolor: dk ? '#0f1218' : '#fbfaf6', font: { color: dk ? '#a3adc0' : '#3e4350' },
    scene: { bgcolor: dk ? '#13171f' : '#f1efe8', aspectmode: 'cube' }, margin: { l: 0, r: 0, t: 10, b: 0 }, showlegend: false };
  const fnOf = (src, vars) => realFunction(prepare(src, vars), vars, ctx());
  const grid = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
  const clean = (v) => Number.isFinite(v) ? v : null;
  let traces;
  if (spec.kind === 'surface') {
    const f = fnOf(spec.expr, ['x', 'y']), xs = grid(spec.xr.a, spec.xr.b, 80), ys = grid(spec.yr.a, spec.yr.b, 80);
    traces = [{ type: 'surface', x: xs, y: ys, z: ys.map(y => xs.map(x => clean(f(x, y)))), colorscale: 'Viridis', showscale: false }];
  } else if (spec.kind === 'param' || spec.kind === 'curve') {
    const [U, V] = spec.ranges, fs = spec.comps.map(c => fnOf(c, spec.ranges.map(r => r.v)));
    if (spec.kind === 'curve') {
      const ts = grid(U.a, U.b, 800);
      traces = [{ type: 'scatter3d', mode: 'lines', x: ts.map(t => clean(fs[0](t))), y: ts.map(t => clean(fs[1](t))), z: ts.map(t => clean(fs[2](t))), line: { width: 5, color: ts, colorscale: 'Viridis' } }];
    } else {
      const us = grid(U.a, U.b, 70), vs = grid(V.a, V.b, 70);
      const M = (k) => vs.map(v => us.map(u => clean(fs[k](u, v))));
      traces = [{ type: 'surface', x: M(0), y: M(1), z: M(2), colorscale: 'Viridis', showscale: false }];
    }
  } else if (spec.kind === 'implicit') {
    const F = fnOf(spec.F, ['x', 'y', 'z']), [bx, by, bz] = spec.box, n = 36;
    const X = [], Y = [], Z = [], val = [];
    for (const x of grid(bx.a, bx.b, n)) for (const y of grid(by.a, by.b, n)) for (const z of grid(bz.a, bz.b, n)) { X.push(x); Y.push(y); Z.push(z); const v = F(x, y, z); val.push(Number.isFinite(v) ? v : 1e9); }
    traces = [{ type: 'isosurface', x: X, y: Y, z: Z, value: val, isomin: 0, isomax: 0, surface: { count: 1 }, caps: { x: { show: false }, y: { show: false }, z: { show: false } }, colorscale: 'Viridis', showscale: false }];
  } else if (spec.kind === 'riemann') {
    const rf = riemannFunction(spec.expr), rs = grid(spec.R / 40, spec.R, 30);
    const ths = rf.log ? grid(-Math.PI * rf.turns, Math.PI * rf.turns, 90 * rf.turns) : grid(0, 2 * Math.PI * rf.turns, 90 * rf.turns);
    const X = [], Y = [], Z = [], C = [];
    for (const r of rs) {
      const rx = [], ry = [], rz = [], rc = [];
      for (const th of ths) { const [re, im] = rf.at(r, th); rx.push(r * Math.cos(th)); ry.push(r * Math.sin(th)); rz.push(clean(rf.log ? im : re)); rc.push(clean(rf.log ? re : im)); }
      X.push(rx); Y.push(ry); Z.push(rz); C.push(rc);
    }
    traces = [{ type: 'surface', x: X, y: Y, z: Z, surfacecolor: C, colorscale: 'RdBu', showscale: false }];
  }
  host.innerHTML = '';
  const div = document.createElement('div');
  div.style.cssText = 'width:100%;height:380px';
  host.appendChild(div);
  await Plotly.newPlot(div, traces, theme, { responsive: true, displaylogo: false });
}

// Render a non-2D plot spec into a cell's plot area; returns false for ordinary 2D specs.
export function drawViz(host, spec, prepare) {
  if (spec.type === 'network') { drawNetwork(host, spec); return true; }
  if (spec.type === 'tree') { drawTree(host, spec); return true; }
  if (spec.type === '3d') { draw3d(host, spec, prepare).catch(e => { host.innerHTML = `<div class="plot-err">${escH(e.message)}</div>`; }); return true; }
  return false;
}
