import { GALLERY } from './gallery.js';
import { escH } from './format.js';
import { state } from './state.js';

export const welcomeMarkup = () => `<div class="welcome-topline"><span class="eyebrow">YOUR SPACE TO FIGURE IT OUT</span><span class="welcome-index">01 — INFINITE POSSIBILITIES</span></div>
<div class="welcome-hero"><div class="hero-copy"><span class="hero-tag"><i></i> A little logic. A lot of possibility.</span><h2>Beautiful maths.<br><em>Brilliant possibilities.</em></h2><p>Calculate with precision. Explore with curiosity.<br>A powerful mathematics studio, at your fingertips.</p><button class="hero-button" onclick="switchView('graph')">Explore the graph studio <span>→</span></button><div class="hero-footnote"><span>∫ Symbolic algebra</span><span>⌁ Interactive graphing</span><span>∞ Room to explore</span></div></div>
<div class="hero-visual" aria-hidden="true"><svg viewBox="0 0 430 360" fill="none"><defs><pattern id="hero-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" stroke="#ffffff" stroke-opacity=".08"/></pattern><linearGradient id="curve-glow" x1="20" y1="240" x2="410" y2="80" gradientUnits="userSpaceOnUse"><stop stop-color="#62e9c0"/><stop offset="1" stop-color="#a7ffe1"/></linearGradient></defs><rect width="430" height="360" fill="url(#hero-grid)"/><path d="M0 205H430M210 0V360" stroke="#b5d2ce" stroke-opacity=".25"/><path d="M-10 305C65 320 65 65 145 80S245 350 310 200S365 25 440 55" stroke="#74e7be" stroke-opacity=".1" stroke-width="22"/><path d="M-10 305C65 320 65 65 145 80S245 350 310 200S365 25 440 55" stroke="url(#curve-glow)" stroke-width="3"/><path d="M0 250Q220 120 430 250" stroke="#a9a3ff" stroke-width="2" stroke-dasharray="6 7"/><circle cx="145" cy="80" r="6" fill="#9af6d5"/><circle cx="310" cy="200" r="5" fill="#9af6d5"/><circle cx="145" cy="80" r="13" stroke="#9af6d5" stroke-opacity=".3"/><text x="160" y="62" fill="#c4f9e8" font-size="12" font-family="monospace">a · sin(x)</text><text x="322" y="192" fill="#99acb0" font-size="11" font-family="monospace">(π, 0)</text></svg><div class="floating-formula"><span>FROM ABSTRACT TO INTUITIVE</span><strong>∫ x² dx = ⅓x³ + C</strong></div></div></div>
<div class="welcome-section-title"><div><h3>Where shall we start?</h3><p>Choose a starting point, or type your own expression below.</p></div><span>BUILT FOR YOUR CURIOSITY ↓</span></div><div class="welcome-grid" id="welcome-grid"></div>`;

const SETTINGS_KEY = 'cassy-workbench-preferences';
let preferences = { theme: 'light', accent: 'teal', density: 'comfortable', precision: 10, motion: true, grid: true };
const accents = { teal: ['#087f72', '#08695f', '#07564f'], violet: ['#7760d9', '#6751c2', '#5943ab'], blue: ['#2563d9', '#1d50b6', '#194594'] };
function apply() {
  state.darkTheme = preferences.theme === 'dark';
  state.precision = preferences.precision;
  document.body.classList.toggle('light', !state.darkTheme);
  document.body.dataset.density = preferences.density;
  document.body.classList.toggle('reduce-motion', !preferences.motion);
  document.body.classList.toggle('graph-no-grid', !preferences.grid);
  const colors = state.darkTheme ? ({ teal: ['#7bd8b7', '#63c3a1', '#50b18f'], violet: ['#bbabfa', '#a998e6', '#9584cf'], blue: ['#8fbfff', '#79acef', '#6397da'] })[preferences.accent] : accents[preferences.accent];
  for (const [i, key] of ['a0', 'a1', 'a2'].entries()) document.body.style.setProperty('--' + key, colors[i]);
  document.querySelectorAll('.grapher canvas').forEach(c => c.__grapher?.render());
}
export function initWorkbench(api) {
  try {
    const p = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (['light', 'dark'].includes(p.theme)) preferences.theme = p.theme;
    if (accents[p.accent]) preferences.accent = p.accent;
    if (['compact', 'comfortable'].includes(p.density)) preferences.density = p.density;
    if ([6, 10, 14].includes(p.precision)) preferences.precision = p.precision;
    if (typeof p.motion === 'boolean') preferences.motion = p.motion;
    if (typeof p.grid === 'boolean') preferences.grid = p.grid;
  } catch {}
  apply();
  const card = document.createElement('div'); card.className = 'settings-card';
  card.innerHTML = `<div class="settings-card-heading"><span>01</span><div><h3>Look & feel</h3><p>Your studio, your atmosphere.</p></div></div>
  <div class="setting-row"><div><strong>Appearance</strong><p>Find your light. Or embrace the dark.</p></div><select data-setting="theme" aria-label="Appearance"><option value="light">Daylight</option><option value="dark">Midnight</option></select></div>
  <div class="setting-row"><div><strong>Accent color</strong><p>A little personality goes a long way.</p></div><select data-setting="accent" aria-label="Accent color"><option value="teal">Lagoon</option><option value="violet">Iris</option><option value="blue">Cobalt</option></select></div>
  <div class="setting-row"><div><strong>Workspace density</strong><p>Choose how much room to think.</p></div><select data-setting="density" aria-label="Workspace density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>
  <div class="setting-row"><div><strong>Interface animations</strong><p>Turn off for a quieter experience.</p></div><input type="checkbox" data-setting="motion" aria-label="Interface animations"></div>
  <div class="settings-card-heading"><span>02</span><div><h3>Numbers & graphs</h3><p>The details that make a difference.</p></div></div>
  <div class="setting-row"><div><strong>Display precision</strong><p>Significant digits for decimal results.</p></div><select data-setting="precision" aria-label="Display precision"><option value="6">6 digits</option><option value="10">10 digits</option><option value="14">14 digits</option></select></div>
  <div class="setting-row"><div><strong>Graph grid</strong><p>Keep the grid, or let the curves speak.</p></div><input type="checkbox" data-setting="grid" aria-label="Graph grid"></div>`;
  $('settings-content').prepend(card);
  card.querySelectorAll('[data-setting]').forEach(el => { const v = preferences[el.dataset.setting]; if (el.type === 'checkbox') el.checked = v; else el.value = v; });
  card.addEventListener('change', e => {
    const key = e.target.dataset.setting; if (!key) return;
    preferences[key] = e.target.type === 'checkbox' ? e.target.checked : key === 'precision' ? +e.target.value : e.target.value;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences)); } catch {}
    apply(); $('settings-saved').textContent = '✓ Preferences saved';
    if (key === 'precision') api.recompute();
  });
  // Old accent/density/font controls are superseded by the persistent settings above.
  for (const id of ['tweak-accent', 'tweak-density', 'tweak-font']) $(id).closest('.tweak-group').hidden = true;
  const transfer = document.createElement('div'); transfer.className = 'settings-card';
  transfer.innerHTML = `<div class="settings-card-heading"><span>03</span><div><h3>Your work, to go</h3><p>Keep a copy. Pick up where you left off.</p></div></div><div class="settings-transfer"><button class="subtle-button" onclick="saveSession()">↓ Save notebook</button><button class="subtle-button" onclick="document.getElementById('floader').click()">↑ Open notebook</button><button class="subtle-button" onclick="exportTxt()">Export text</button><button class="subtle-button" onclick="exportLatex()">Export LaTeX</button></div><p class="settings-disclosure">Calculations stay in this browser. Advanced SymPy tools download their runtime when online. The optional assistant sends your requests to Anthropic only after you enable it with your own API key.</p>`;
  $('settings-content').append(transfer);
  const render = () => {
    const q = $('explore-search').value.toLowerCase();
    const entries = GALLERY.map((g, i) => ({ ...g, i })).filter(g => `${g.title} ${g.desc} ${g.tags.join(' ')}`.toLowerCase().includes(q));
    $('explore-grid').innerHTML = entries.length ? entries.map((g, k) => `<button class="explore-card" data-gallery="${g.i}"><div class="explore-card-art art-${k % 4}"><span>${['∫', '⌁', '∑', '∞'][k % 4]}</span><small>${escH(g.tags[0] || 'MATHEMATICS')}</small></div><div class="explore-card-copy"><span class="eyebrow">WORKING NOTEBOOK →</span><h3>${escH(g.title)}</h3><p>${escH(g.desc)}</p><span class="explore-tags">${g.tags.map(escH).join(' · ')}</span></div></button>`).join('') : '<p class="empty-search">No notebooks match. Try “calculus”, “graph”, or “algebra”.</p>';
  };
  $('explore-search').addEventListener('input', render);
  $('explore-grid').addEventListener('click', e => { const b = e.target.closest('[data-gallery]'); if (b) { api.openGallery(+b.dataset.gallery); api.switchView('nb'); } });
  render();
}
const $ = id => document.getElementById(id);
