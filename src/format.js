// Number / value formatting honouring the Exact ↔ Approx toggle.
import { math, escTex } from './expr.js';
import { state } from './state.js';

// Recover a simple rational p/q (q ≤ maxDen) from a double via continued fractions.
export function asRational(n, maxDen = 10000, tol = 1e-12) {
  if (typeof n !== 'number' || !isFinite(n) || Number.isInteger(n)) return null;
  const sign = n < 0 ? -1 : 1, x = Math.abs(n);
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0, b = x;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0, k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (Math.abs(x - h1 / k1) <= tol * Math.max(1, x)) return k1 === 1 ? null : { n: sign * h1, d: k1 };
    const frac = b - a;
    if (frac < 1e-15) break;
    b = 1 / frac;
  }
  return null;
}
export function fmtN(n) {
  if (typeof n !== 'number') return fmtR(n);
  if (!isFinite(n)) return String(n);
  if (Math.abs(n) < 1e-12 && n !== 0) return '0';
  if (Math.abs(n) >= 1e10 || (Math.abs(n) < 0.001 && n !== 0)) return n.toExponential(9).replace(/\.?0+e/, 'e');
  return parseFloat(n.toPrecision(10)).toString();
}
export function fmtNum(n) {
  if (state.exactMode) { const r = asRational(n); if (r) return `${r.n}/${r.d}`; }
  return fmtN(n);
}
export function texNum(n) {
  if (typeof n !== 'number') return toTex(n);
  if (!isFinite(n)) return isNaN(n) ? '\\text{Undefined}' : (n > 0 ? '\\infty' : '-\\infty');
  if (state.exactMode) {
    const r = asRational(n);
    if (r) return `${r.n < 0 ? '-' : ''}\\frac{${Math.abs(r.n)}}{${r.d}}`;
  }
  const s = fmtN(n), m = s.match(/^(-?[\d.]+)e([+-]?\d+)$/);
  return m ? `${m[1]}\\times 10^{${parseInt(m[2], 10)}}` : s;
}
function complexParts(re, im, num, tex) {
  const reZ = Math.abs(re) < 1e-12 * (1 + Math.abs(im)), imZ = Math.abs(im) < 1e-12 * (1 + Math.abs(re));
  if (imZ) return num(re);
  const imAbs = Math.abs(im), unit = Math.abs(imAbs - 1) < 1e-12;
  const imStr = (unit ? '' : num(imAbs)) + (tex && !unit ? '\\,' : '') + 'i';
  if (reZ) return (im < 0 ? '-' : '') + imStr;
  return `${num(re)} ${im < 0 ? '-' : '+'} ${imStr}`;
}
export const fmtComplex = (re, im) => complexParts(re, im, fmtNum, false);
export const texComplex = (re, im) => complexParts(re, im, texNum, true);
// Decimal forms for the "≈" part of a result, which should never be rationalised.
const texDec = (n) => { const s = fmtN(n), m = s.match(/^(-?[\d.]+)e([+-]?\d+)$/); return m ? `${m[1]}\\times 10^{${parseInt(m[2], 10)}}` : s; };
export const fmtComplexDec = (re, im) => complexParts(re, im, fmtN, false);
export const texComplexDec = (re, im) => complexParts(re, im, texDec, true);
export function toTex(val) {
  try {
    if (typeof val === 'number') return texNum(val);
    if (typeof val === 'boolean') return `\\text{${val}}`;
    if (typeof val === 'string') return `\\text{“${escTex(val)}”}`;
    if (val === null || val === undefined) return '\\text{null}';
    if (val.isComplex) return complexParts(val.re, val.im, texNum, true);
    if (val.isFraction) return texNum(math.number(val));
    if (val.isUnit) return `\\text{${escTex(math.format(val, { precision: 10 }))}}`;
    if (val.isMatrix || Array.isArray(val)) {
      const arr = val.isMatrix ? val.toArray() : val;
      if (!arr.length) return '\\begin{bmatrix}\\end{bmatrix}';
      const rows = Array.isArray(arr[0]) ? arr : arr.map(x => [x]);
      if (rows.some(r => r.some(Array.isArray))) return `\\text{${escTex(fmtR(val))}}`;
      return `\\begin{bmatrix}${rows.map(r => r.map(toTex).join('&')).join('\\\\')}\\end{bmatrix}`;
    }
    if (val.toTex) return val.toTex();
    return `\\text{${escTex(String(val))}}`;
  } catch { return `\\text{${escTex(String(val))}}`; }
}
export function fmtR(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return String(val);
  if (typeof val === 'number') return fmtNum(val);
  if (typeof val === 'string') return val;
  if (typeof val === 'function') return 'function';
  if (val.isComplex) return complexParts(val.re, val.im, fmtNum, false);
  if (val.isFraction) return fmtNum(math.number(val));
  if (val.isUnit) return math.format(val, { precision: 10 });
  if (val.isMatrix) return fmtR(val.toArray());
  if (Array.isArray(val)) return '[' + val.map(fmtR).join(', ') + ']';
  if (val.toString) return val.toString();
  return String(val);
}
export function escH(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function toReal(y) {
  if (typeof y === 'number') return y;
  if (y && y.isComplex) return Math.abs(y.im) < 1e-9 * (1 + Math.abs(y.re)) ? y.re : NaN;
  if (y && y.isFraction) return math.number(y);
  if (typeof y === 'boolean') return +y;
  return NaN;
}
