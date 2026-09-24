# Work in progress — "20× better" rebuild

This branch holds a partially complete rebuild of CassyCAS. The previous single-file app
(`CAS (new).html`) is still the working, tested version; the new app lives in `src/` and builds
to `dist/index.html` with `npx vite build`, but it has **not been smoke-tested yet**.

## Done (committed, untested end-to-end unless noted)
- **Exact engine:** SymPy 1.12 on Pyodide 0.26.4 in a Web Worker (`src/sympy/`).
  - `bridge.py` builds SymPy objects from a whitelisted JSON expression tree, so no Python
    source is generated from user input. Tested under CPython with SymPy 1.12.
  - Operations: exact evaluation, simplify/expand/factor/apart/together/cancel/collect,
    polynomial division, derivative (with steps), integration (steps from `manualintegrate`),
    limits (one- and two-sided), series, closed-form sums and products, solve (polynomials,
    general solutions, inequalities), systems, `dsolve` with initial conditions, exact matrix
    operations, gradient.
  - Spike verified: Pyodide and SymPy boot inside the Vite-inlined module worker (~7.6 s
    served locally) and return `3*sqrt(2)` for `sqrt(8)+sqrt(2)`.
- **Evaluator** (`src/engine.js`): SymPy first; falls back to the verified JavaScript engine
  (`src/kernel/`) while SymPy loads, when it times out, or when it is disabled or offline.
  Cells computed by the fallback are re-evaluated automatically once SymPy is ready.
- **Notebook** (`src/notebook.js`):
  - dependency-graph recomputation (ordered; only downstream cells re-run);
  - in-place cell editing and deletion;
  - sliders for numeric definitions;
  - click-to-explore sub-expressions (KaTeX `\htmlData`);
  - auto-plots with parameter sliders;
  - share links (deflate-compressed into the URL fragment);
  - notebook persisted in localStorage;
  - session files restore cells; LaTeX and text export.
- **UI:**
  - CodeMirror 6 replaces Monaco, and KaTeX replaces MathJax;
  - the engine status pill, share button, and new Tweaks (auto-plot, engine on/off, API key).
- **Optional Claude assistant** (`src/assistant.js`), for plain-English input and "Explain":
  - uses the user's own API key, stored in this browser only;
  - calls `claude-opus-5` with structured output;
  - server-side refusal fallback: `fallbacks: "default"`.
- **Build and PWA:**
  - Vite plus `vite-plugin-singlefile` produce one self-contained HTML file (~7.9 MB);
  - `public/` holds the manifest, icon and a service worker that caches Pyodide after the first
    load when the app is hosted.
- **Test harness** (`tests/harness.mjs`), rewritten:
  - serves `dist/` over local HTTP;
  - serves Pyodide from the npm package and the SymPy wheels from `tests/.wheels` (with the
    lockfile hashes patched), so the tests run offline.

## Remaining
1. **Smoke-test the built app and fix what breaks.** Nothing beyond the Pyodide spike has run
   in a browser yet: `main.js`, `notebook.js`, `editor.js`, `render.js`, `plot.js`, MathLive
   with the KaTeX fonts, the Algebrite ESM import, and the CSS.
2. **Port `tests/cas.test.mjs` to the new harness API** (`window.CAS.run`, `openApp({engine})`).
   The existing tests target the old page and fail against this harness. Run the suite twice:
   once with the exact engine and once with it disabled (the fallback engine).
3. **Add `npm run test:setup`:**
   `pip download sympy==1.12 mpmath==1.3.0 --no-deps -d tests/.wheels`.
   Add `"build"` and `"type": "module"` to `package.json`.
4. **Build a differential test corpus:**
   - generate a few hundred to a few thousand problems with CPython SymPy as the reference
     (`tests/corpus/`);
   - assert that the exact path agrees with the reference;
   - assert that the fallback path is never wrong (declining to answer is allowed).
5. **Update CI** to build first, install Chromium, download the wheels and run both suites.
   Add a GitHub Pages deploy workflow for `dist/`.
6. **Remove the old `CAS (new).html`** once the new build passes, and point the README at
   `npm run build` / the Pages URL.
7. **Update the README:** architecture, exact vs fallback engines, sharing, the assistant
   (opt-in, key stays local), offline behaviour, and the build size.
8. **Engine decision:** Giac was ruled out. Its npm package is native C++ source, not
   WebAssembly, and GeoGebra's WebAssembly build is not reachable from this environment.
   Record this in the README.
9. **Known gaps to check:**
   - SymPy latency on the first symbolic call after load;
   - the worker restart after a SymPy timeout;
   - degree mode with SymPy (numeric evaluation only);
   - the Explore menu on nested sub-expressions;
   - the service worker scope on GitHub Pages;
   - a mobile layout pass.
