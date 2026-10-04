// Dialogs: gallery & templates, version history, function library, citations, and the "More"
// menu that opens them. Dependencies (notebook loading, toasts, running cells) are injected by
// main.js through initDialogs().
import { escH } from './format.js';
import { GALLERY } from './gallery.js';
import * as WS from './workspace.js';

let deps = {};
export function initDialogs(d) { deps = d; }

// A modal dialog. Returns { el, close }. Escape and the backdrop close it; focus moves into it
// and returns to where it was.
export function modal(title, bodyHtml, { wide = false } = {}) {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-back'; back.id = 'modal';
  back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><h2 id="modal-title">${escH(title)}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">${bodyHtml}</div></div>`;
  const prev = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  (back.querySelector('.modal-body button, .modal-body input, .modal-body [tabindex]') || back.querySelector('[data-close]')).focus();
  return { el: back, close };
}
export function closeModal() { document.getElementById('modal')?.remove(); }

// ── gallery & templates ──────────────────────────────
export function openGallery() {
  const cards = GALLERY.map((g, i) => `<button class="gal-card" data-gal="${i}">
      <span class="gal-title">${escH(g.title)}</span><span class="gal-desc">${escH(g.desc)}</span>
      <span class="gal-tags">${g.tags.map(t => `<span>${escH(t)}</span>`).join('')}</span>
      <code class="gal-peek">${escH(g.cells.filter(c => c.type === 'math').slice(0, 3).map(c => c.expr).join('\n'))}</code></button>`).join('');
  const m = modal('Gallery & templates', `<p class="modal-note">Open an example notebook. Your current notebook is saved in the version history first, so nothing is lost.</p><div class="gal-grid">${cards}</div>`, { wide: true });
  m.el.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-gal]'); if (!c) return;
    const g = GALLERY[+c.dataset.gal];
    m.close();
    await deps.checkpoint('before opening “' + g.title + '”');
    await deps.load({ version: 4, exactMode: true, angleMode: 'rad', scope: {}, cells: g.cells });
    deps.toast(`Opened “${g.title}”`);
  });
}

// ── version history ──────────────────────────────────
export async function openHistory() {
  const versions = await WS.listVersions();
  const fmtT = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const rows = versions.map((v, i) => {
    const prev = versions[i + 1];
    const d = prev ? WS.diffCells(prev.cells, v.cells) : { added: v.cells.length, removed: 0 };
    return `<li class="ver-row"><div><div class="ver-time">${escH(fmtT(v.time))}${v.label ? ` · <strong>${escH(v.label)}</strong>` : ''}</div>
        <div class="ver-meta">${v.cells.length} cell${v.cells.length === 1 ? '' : 's'} · +${d.added} −${d.removed}</div></div>
        <div class="ver-acts"><button class="cact" data-label="${v.id}">Name…</button><button class="cact warm" data-restore="${v.id}">Restore</button></div></li>`;
  }).join('');
  const body = `<p class="modal-note">Every change is kept as a version on this device (IndexedDB). Unchanged cells are stored once and shared between versions.
      <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> undo and redo outside the input line.</p>
    <div class="ver-tools"><button class="cact violet" data-checkpoint>Save a named checkpoint</button></div>
    <ul class="ver-list">${rows || '<li class="ver-empty">No versions yet.</li>'}</ul>`;
  const m = modal('Version history', body);
  m.el.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-restore]'), l = e.target.closest('[data-label]'), cp = e.target.closest('[data-checkpoint]');
    if (r) { m.close(); await deps.checkpoint('before restoring'); await deps.load(await WS.loadVersion(+r.dataset.restore)); deps.toast('Version restored'); }
    if (l) { const name = prompt('Name this version'); if (name) { await WS.labelVersion(+l.dataset.label, name.slice(0, 80)); openHistory(); } }
    if (cp) { const name = prompt('Checkpoint name', 'checkpoint'); if (name) { await deps.checkpoint(name.slice(0, 80)); openHistory(); } }
  });
}

// ── function library ─────────────────────────────────
export async function openLibrary() {
  const items = await WS.libraryList();
  const rows = items.map(f => `<li class="lib-row"><div><code>${escH(f.def)}</code><div class="ver-meta">${escH(f.desc || '')}${f.mine ? ' · yours' : ' · built in'}</div></div>
      <div class="ver-acts"><button class="cact violet" data-use="${escH(f.name)}">Insert</button>${f.mine ? `<button class="cact" data-del="${escH(f.name)}">Remove</button>` : ''}</div></li>`).join('');
  const m = modal('Function library', `<p class="modal-note">Functions you save (★ on a definition) are available in every notebook. Insert adds the definition as a cell.</p><ul class="ver-list">${rows}</ul>`);
  m.el.addEventListener('click', async (e) => {
    const u = e.target.closest('[data-use]'), d = e.target.closest('[data-del]');
    if (u) { const f = items.find(x => x.name === u.dataset.use); m.close(); await deps.run(f.def); }
    if (d) { await WS.libraryRemove(d.dataset.del); openLibrary(); }
  });
}

// ── citations ────────────────────────────────────────
export async function openCite() {
  const link = await deps.shareLink().catch(() => null);
  const { bib, apa } = WS.citations({ link });
  const m = modal('Cite', `<p class="modal-note">If CassyCAS helped your work, please cite it and the libraries that do the mathematics.</p>
    <h3>BibTeX</h3><textarea class="cite-box" readonly rows="14">${escH(bib)}</textarea>
    <div class="ver-tools"><button class="cact violet" data-copy="bib">Copy BibTeX</button><button class="cact" data-dl>Download .bib</button></div>
    <h3>APA</h3><ol class="cite-apa">${apa.map(a => `<li>${escH(a)}</li>`).join('')}</ol>
    <div class="ver-tools"><button class="cact" data-copy="apa">Copy APA</button></div>`, { wide: true });
  m.el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { navigator.clipboard?.writeText(c.dataset.copy === 'bib' ? bib : apa.join('\n')); deps.toast('Copied'); }
    if (e.target.closest('[data-dl]')) deps.download('cassycas.bib', bib, 'text/plain');
  });
}

// ── the "More" menu ──────────────────────────────────
export function toggleMoreMenu(anchor) {
  const open = document.getElementById('more-menu');
  if (open) { open.remove(); return; }
  const items = [
    ['gallery', 'Gallery & templates'], ['history', 'Version history'], ['library', 'Function library'], ['formulas', 'Search formulas…'],
    ['-'], ['md', 'Export Markdown'], ['qmd', 'Export Quarto (.qmd)'], ['import', 'Import Markdown / Quarto…'],
    ['-'], ['collab', 'Collaborate (peer to peer)…'], ['cite', 'Cite…'], ['plugins', 'Plug-in API…'],
  ];
  const menu = document.createElement('div');
  menu.id = 'more-menu'; menu.className = 'more-menu'; menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map(([k, label]) => k === '-' ? '<div class="more-sep" role="separator"></div>' : `<button role="menuitem" data-more="${k}">${escH(label)}</button>`).join('');
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`; menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  document.body.appendChild(menu);
  menu.querySelector('button').focus();
  const off = (e) => { if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener('pointerdown', off, true); } };
  document.addEventListener('pointerdown', off, true);
  menu.addEventListener('keydown', (e) => {
    const bs = [...menu.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { bs[(i + 1) % bs.length].focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { bs[(i - 1 + bs.length) % bs.length].focus(); e.preventDefault(); }
    if (e.key === 'Escape') { menu.remove(); anchor.focus(); }
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-more]'); if (!b) return;
    menu.remove();
    deps.more(b.dataset.more);
  });
}

export function openPluginsHelp() {
  modal('Plug-in API', `<p class="modal-note">Add your own tools from the browser console (or a script you trust). They appear in autocomplete and the palette. Nothing is ever loaded from a URL.</p>
<pre class="cite-box">CAS.plugins.register({
  name: 'double', sig: 'double(x)', desc: 'Twice x', ex: 'double(21)',
  run(args, { evaluate }) {
    const v = evaluate(args[0]);
    return { latex: String(2 * v), plain: String(2 * v) };
  },
});

// A SymPy tool, run in the exact engine's worker:
await CAS.plugins.registerPython('cube',
  'def t_cube(e):\\n    return e**3', { sig: 'cube(x)', desc: 'x³' });</pre>`, { wide: true });
}
