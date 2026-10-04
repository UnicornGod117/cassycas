// Serves the built app (dist/) over local HTTP in headless Chromium.
// Pyodide requests to jsDelivr are answered from the `pyodide` npm package, and the SymPy,
// mpmath and gmpy2 wheels from tests/.wheels (see `npm run test:setup`, which checks them
// against the lockfile hashes) — so the whole suite, exact engine included, runs offline.
export { openApp, hasWheels } from '../bin/headless.mjs';

// Run an expression through the real UI path in a mode; returns the cell's result.
export async function run(page, expr, mode = 'algebra') {
  return page.evaluate(([expr, mode]) => window.CAS.run(expr, mode), [expr, mode]);
}

// Rendered results that are not well-formed: KaTeX errors, or LaTeX command names leaking into
// the visible text (the sign of a mangled escape such as "\operatorname" written with one "\").
export function latexProblems(page) {
  return page.evaluate(() => [...document.querySelectorAll('.cell .cout .mjrender')].flatMap(el => {
    const expr = el.closest('.cell').querySelector('.cexpr')?.textContent;
    const text = el.querySelector('.katex-html')?.textContent || el.textContent;
    const problems = [];
    if (el.querySelector('.katex-error')) problems.push('KaTeX error');
    const leak = text.match(/(operatorname|left[([{]|right[)\]}]|frac\{|mathcal|quad|text\{)/);
    if (leak) problems.push(`leaked "${leak[0]}"`);
    return problems.length ? [`${expr}: ${problems.join(', ')}`] : [];
  }));
}
