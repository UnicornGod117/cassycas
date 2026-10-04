// Visualisations: statistical plots, networks, expression trees, 3D and Riemann surfaces,
// certified implicit curves, GPU domain colouring, stochastic paths and step animations.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, run, hasWheels } from './harness.mjs';
import { compileInterval } from '../src/graph/interval.js';
import { compileGLSL } from '../src/graph/glsl.js';

test('interval arithmetic encloses every value on the box', () => {
  const cases = [
    ['x^2 - 2x', ['x']], ['sin(x) * cos(y)', ['x', 'y']], ['exp(x) / (1 + y^2)', ['x', 'y']], ['sqrt(x^2 + y^2) - 1', ['x', 'y']],
    ['tan(x) + atan(y)', ['x', 'y']], ['log(1 + x^2) - abs(y)', ['x', 'y']], ['(x^2 + y^2 - 4)^2', ['x', 'y']], ['x^3 - 3x*y^2', ['x', 'y']],
  ];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const [src, vars] of cases) {
    const F = compileInterval(src, vars);
    assert.ok(F, `${src} should have an interval extension`);
    const f = new Function(...vars, `with (Math) { return ${src.replace(/\^/g, '**').replace(/(\d)([a-z(])/g, '$1*$2')}; }`);
    for (let k = 0; k < 300; k++) {
      const box = vars.map(() => { const a = rnd() * 8 - 4, w = rnd() * 2 ** -(k % 8); return [a, a + w]; });
      const r = F(...box);
      if (!r) continue;
      for (let s = 0; s < 6; s++) {
        const p = box.map(([a, b]) => a + (b - a) * rnd());
        const v = f(...p);
        if (Number.isFinite(v)) assert.ok(v >= r[0] && v <= r[1], `${src} at ${p}: ${v} not in [${r}]`);
      }
    }
  }
  assert.equal(compileInterval('gamma(x)', ['x']), null, 'unsupported functions fall back to sampling');
});

test('complex expressions compile to GLSL', () => {
  assert.equal(compileGLSL('z^2 - 1'), '(cipow(z, 2) - vec2(1.0, 0.0))');
  assert.match(compileGLSL('(z^2 - 1)/(z^2 + i)'), /cdiv\(/);
  assert.equal(compileGLSL('gamma(z)'), null);
});

describe('visualisations in the notebook', { skip: !hasWheels() && 'SymPy wheels missing: run `npm run test:setup`' }, () => {
  let app, page;
  before(async () => { app = await openApp(); page = app.page; await app.waitForEngine(); });
  after(async () => { await app?.close(); });
  const grapherOf = (id) => page.evaluate(async (id) => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const g = document.getElementById(id).querySelector('canvas')?.__grapher;
    return g && { view: g.view, kinds: g.items.map(i => i.kind), cells: g.items.map(i => i.cells ?? null), rendered: g.items.map(i => i.rendered ?? null) };
  }, id);
  const ok = async (e, m = 'algebra') => { const r = await run(page, e, m); assert.ok(!r.error, `${e}: ${r.error}`); return r; };

  test('statistical plots frame their data', async () => {
    const h = await ok('histogram([2, 3, 3, 4, 4, 4, 5, 5, 6, 9])', 'stats');
    assert.equal(h.plain, 'histogram: n = 10, mean = 4.5, sd = 1.957890021');
    const g = await grapherOf(h.id);
    assert.deepEqual(g.kinds, ['bars']);
    assert.ok(g.view.xmin > 1 && g.view.xmax < 10, `x range fits the data: ${JSON.stringify(g.view)}`);
    const s = await ok('scatter([1, 2, 3, 4, 5], [2.1, 3.9, 6.2, 7.8, 10.1])', 'stats');
    assert.equal(s.plain, 'y = 1.99*x + 0.05, r = 0.998652');
    assert.deepEqual((await grapherOf(s.id)).kinds, ['scatter', 'fn']);
    const b = await ok('boxplot([1, 2, 3, 4, 5, 6, 30])', 'stats');
    assert.deepEqual((await grapherOf(b.id)).kinds, ['box']);
  });

  test('a plot fits its y range to the function (was stuck at ±5)', async () => {
    const r = await ok('plot(x^3)');
    const g = await grapherOf(r.id);
    assert.ok(g.view.ymax > 500, JSON.stringify(g.view));
  });

  test('implicit curves are certified: touching zeros and isolated points are drawn', async () => {
    const r = await ok('plot((x^2 + y^2 - 4)^2 = 0, x^2 + (y - 3)^2 = 0)');
    const g = await grapherOf(r.id);
    assert.ok(g.cells[0] > 100, `the circle has no sign change but must be drawn: ${g.cells[0]} pixels`);
    assert.ok(g.cells[1] >= 1 && g.cells[1] <= 12, `the single point (0, 3) is found: ${g.cells[1]} pixels`);
  });

  test('domain colouring renders (on the GPU when WebGL is available)', async () => {
    const r = await ok('domaincolor((z^2 - 1)/(z^2 + 1))');
    const g = await grapherOf(r.id);
    assert.ok(['gpu', 'cpu'].includes(g.rendered[0]), String(g.rendered[0]));
  });

  test('networks: drawing, graph facts, shortest paths', async () => {
    const r = await ok('graph([[0, 1, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 1, 0]])');
    assert.equal(r.plain, 'graph: 4 vertices, 5 edges');
    const info = await page.evaluate((id) => ({ nodes: document.getElementById(id).querySelectorAll('svg.viz-net circle').length,
      steps: window.CAS.cells.find(c => c.id === id).res.steps.map(s => `${s.d}: ${s.e}`) }), r.id);
    assert.equal(info.nodes, 4);
    assert.ok(info.steps.includes('Chromatic number: 3') && info.steps.includes('Bipartite: no') && info.steps.includes('Euler: has an Euler path (not a circuit)'), info.steps.join('; '));
    // the textbook Dijkstra example
    const p = await ok('shortestpath([[1, 2, 7], [1, 3, 9], [1, 6, 14], [2, 3, 10], [2, 4, 15], [3, 4, 11], [3, 6, 2], [4, 5, 6], [5, 6, 9]], 1, 5)');
    assert.equal(p.plain, '1 → 3 → 6 → 5 (length 20)');
  });

  test('expression trees, 3D surfaces, Riemann surfaces, stochastic paths', async () => {
    const t = await ok('tree(x^2 + 3*sin(x)/2)');
    assert.equal(await page.evaluate((id) => document.getElementById(id).querySelectorAll('svg.viz-tree rect').length, t.id), 10);   // + ^ x 2 ÷ × 3 sin x 2
    for (const e of ['plot3d(sin(x) cos(y))', 'plot3d(x^2 + y^2 + z^2 = 4)', 'plot3d([(2 + cos(v)) cos(u), (2 + cos(v)) sin(u), sin(v)], [u, 0, 2pi], [v, 0, 2pi])', 'riemann(sqrt(z))', 'riemann(log(z))']) {
      const r = await ok(e, 'calculus');
      const has = await page.waitForFunction((id) => !!document.getElementById(id).querySelector('.js-plotly-plot'), r.id, { timeout: 20000 }).then(() => true, () => false);
      assert.ok(has, `${e} draws a 3D plot`);
    }
    assert.equal((await ok('plot3d(sin(x) cos(y))', 'calculus')).plain, 'surface z = sin(x) cos(y)');
    const s = await ok('sdepaths(0.1 X, 0.2 X, 1, 5, 4)', 'calculus');
    assert.deepEqual((await grapherOf(s.id)).kinds, ['series', 'series', 'series', 'series']);
  });

  test('worked solutions play as an animation', async () => {
    const r = await ok('solve(2x^2 + 3x = 5, x)', 'solve');
    const res = await page.evaluate(async (id) => {
      const el = document.getElementById(id);
      el.querySelector('[data-action="animate"]').click();
      el.querySelector('[data-m="next"]').click();
      await new Promise(r => setTimeout(r, 100));
      return { cap: el.querySelector('.morph-cap').textContent, glyphs: el.querySelectorAll('.morph-layer.new .katex-html span').length };
    }, r.id);
    assert.match(res.cap, /^2\/\d+ · /);
    assert.ok(res.glyphs > 5);
    assert.deepEqual(app.errors, []);
  });

  test('nearly constant functions plot (the grid loop used to hang the page)', async () => {
    for (const e of ['lorentz(v) = 1/sqrt(1 - v^2/299792458^2)', 'plot(1 + 1e-17 x^2, [x, -5, 5])', 'plot(1e-300 x, [x, -1, 1])']) {
      const r = await ok(e, 'calculus');
      const g = await grapherOf(r.id);
      assert.ok(g && g.view.ymax > g.view.ymin, `${e}: ${JSON.stringify(g && g.view)}`);
    }
  });
});
