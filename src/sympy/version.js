// The pinned exact-engine runtime. Keep in step with the `pyodide` devDependency (its lockfile
// supplies the package hashes) and with public/sw.js (a test checks all three agree).
export const PYODIDE_VERSION = '314.0.7';
export const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
// Pure-Python packages only: a compiled extension (gmpy2) cannot be part of a memory snapshot,
// and the snapshot is what makes the engine start in half a second.
export const ENGINE_PACKAGES = ['mpmath', 'sympy'];
