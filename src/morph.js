// Equation morphing: play a worked solution as an animation in which each step turns into the
// next. Symbols present in both steps glide from their old place to their new one (FLIP on the
// KaTeX glyphs, matched by a longest common subsequence of their text); the rest fade out or in.
import { renderTex } from './render.js';

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Leaf glyphs of a KaTeX render: [{ el, text, x, y }], in reading order.
function glyphs(root, origin) {
  const out = [];
  for (const el of root.querySelectorAll('.katex-html span')) {
    if (el.children.length || !el.textContent.trim()) continue;
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    out.push({ el, text: el.textContent.trim(), x: r.left - origin.left, y: r.top - origin.top });
  }
  return out;
}

// Longest common subsequence of glyph texts → pairs [i, j].
function match(a, b) {
  const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i].text === b[j].text ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i].text === b[j].text) { pairs.push([i, j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return pairs;
}

// A player for a list of LaTeX frames (with captions) inside host.
export function morphPlayer(host, frames) {
  host.innerHTML = `<div class="morph">
      <div class="morph-stage"><div class="morph-layer old"></div><div class="morph-layer new"></div></div>
      <div class="morph-bar"><button class="cact" data-m="prev" aria-label="Previous step">◀</button>
        <button class="cact violet" data-m="play" aria-label="Play">▶ Play</button>
        <button class="cact" data-m="next" aria-label="Next step">▶</button>
        <span class="morph-cap" aria-live="polite"></span></div></div>`;
  const stage = host.querySelector('.morph-stage'), oldL = host.querySelector('.old'), newL = host.querySelector('.new');
  const cap = host.querySelector('.morph-cap');
  let k = 0, timer = null;
  const show = (i, animate) => {
    const prevTex = frames[k].tex;
    k = Math.max(0, Math.min(frames.length - 1, i));
    cap.textContent = `${k + 1}/${frames.length} · ${frames[k].d}`;
    if (!animate || reduced() || prevTex === frames[k].tex) { oldL.innerHTML = ''; renderTex(newL, frames[k].tex); return; }
    renderTex(oldL, prevTex); renderTex(newL, frames[k].tex);
    const origin = stage.getBoundingClientRect();
    const A = glyphs(oldL, origin), B = glyphs(newL, origin);
    const pairs = match(A, B), usedA = new Set(pairs.map(p => p[0])), usedB = new Set(pairs.map(p => p[1]));
    const T = 650, ease = 'cubic-bezier(.4,0,.2,1)';
    for (const [i, j] of pairs) {
      A[i].el.style.visibility = 'hidden';
      B[j].el.animate([{ transform: `translate(${A[i].x - B[j].x}px, ${A[i].y - B[j].y}px)` }, { transform: 'none' }], { duration: T, easing: ease });
    }
    B.forEach((g, j) => { if (!usedB.has(j)) g.el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { duration: T, easing: ease }); });
    A.forEach((g, i) => { if (!usedA.has(i)) g.el.animate([{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], { duration: T, easing: ease, fill: 'forwards' }); });
    setTimeout(() => { if (oldL.isConnected) oldL.innerHTML = ''; }, T + 30);
  };
  const stop = () => { clearInterval(timer); timer = null; host.querySelector('[data-m="play"]').textContent = '▶ Play'; };
  host.querySelector('.morph-bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'prev') { stop(); show(k - 1, true); }
    if (b.dataset.m === 'next') { stop(); show(k + 1, true); }
    if (b.dataset.m === 'play') {
      if (timer) return stop();
      if (k === frames.length - 1) show(0, false);
      b.textContent = '❚❚ Pause';
      timer = setInterval(() => { if (!host.isConnected || k >= frames.length - 1) return stop(); show(k + 1, true); }, 1500);
    }
  });
  show(0, false);
  return { show: (i) => show(i, true), get index() { return k; }, frames };
}
