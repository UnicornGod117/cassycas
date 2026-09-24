// Exact integer number theory in JavaScript (BigInt), used when the SymPy engine is not
// available. Each function returns { plain, latex } or throws; anything it cannot decide with
// certainty is declined (NotCertain) rather than guessed.
import { create, all } from 'mathjs';

export class NotCertain extends Error {}

let bigMath = null;
// Evaluate an argument exactly as an integer (2^61 - 1 must not lose precision).
export function bigIntOf(text, what = 'The argument') {
  bigMath ||= create(all, { number: 'BigNumber', precision: 600 });
  let v;
  try { v = bigMath.evaluate(text); } catch { throw new Error(`${what} must be an integer`); }
  if (!v || typeof v.isInteger !== 'function' || !v.isInteger() || !v.isFinite()) throw new Error(`${what} must be an integer`);
  return BigInt(v.toFixed(0));
}

const abs = (n) => n < 0n ? -n : n;
function modPow(b, e, m) {
  let r = 1n; b %= m; if (b < 0n) b += m;
  while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; }
  return r;
}
function gcd(a, b) { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a; }
function egcd(a, b) {
  let [r0, r1, s0, s1] = [a, b, 1n, 0n];
  while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  return [r0, s0];   // gcd, x with a*x ≡ gcd (mod b)
}

// Deterministic Miller–Rabin for n < 3.3·10²⁴ (first 12 prime bases).
const MR_LIMIT = 3317044064679887385961981n;
const SMALL = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
export function isPrimeBig(n) {
  if (n < 2n) return false;
  for (const p of SMALL) { if (n === p) return true; if (n % p === 0n) return false; }
  if (n >= MR_LIMIT) throw new NotCertain('beyond the deterministic Miller–Rabin range');
  let d = n - 1n, s = 0;
  while ((d & 1n) === 0n) { d >>= 1n; s++; }
  outer: for (const a of SMALL) {
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    for (let i = 1; i < s; i++) { x = x * x % n; if (x === n - 1n) continue outer; }
    return false;
  }
  return true;
}

// Pollard–Brent rho; returns a non-trivial factor of composite n.
function rho(n) {
  if (n % 2n === 0n) return 2n;
  for (let c = 1n; c < 50n; c++) {
    let y = 2n, g = 1n, r = 1n, q = 1n, x = 0n, ys = 0n;
    const f = (v) => (v * v + c) % n;
    let steps = 0;
    while (g === 1n) {
      x = y;
      for (let i = 0n; i < r; i++) y = f(y);
      let k = 0n;
      while (k < r && g === 1n) {
        ys = y;
        const lim = r - k < 128n ? r - k : 128n;
        for (let i = 0n; i < lim; i++) { y = f(y); q = q * abs(x - y) % n; }
        g = gcd(q, n); k += 128n;
        if (++steps > 20000) throw new NotCertain('factorization is taking too long');
      }
      r *= 2n;
    }
    if (g === n) { do { ys = f(ys); g = gcd(abs(x - ys), n); } while (g === 1n); }
    if (g !== n) return g;
  }
  throw new NotCertain('factorization failed');
}
export function factorBig(n) {
  const out = new Map();
  const add = (p, k = 1) => out.set(p, (out.get(p) || 0) + k);
  n = abs(n);
  for (let p = 2n; p < 1000n && p * p <= n; p += p === 2n ? 1n : 2n) while (n % p === 0n) { add(p); n /= p; }
  const stack = n > 1n ? [n] : [];
  while (stack.length) {
    const m = stack.pop();
    if (m === 1n) continue;
    if (isPrimeBig(m)) { add(m); continue; }
    const d = rho(m);
    stack.push(d, m / d);
  }
  return [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

const show = (plain, latex = plain) => ({ plain, latex });
const setOf = (xs) => show(`{${xs.join(', ')}}`, `\\left\\{${xs.join(',\\ ')}\\right\\}`);

export const JS_NUMBER_THEORY = {
  isprime: ([n]) => { const r = isPrimeBig(bigIntOf(n, 'n')); return show(String(r), `\\text{${r}}`); },
  nextprime: ([n]) => { let k = bigIntOf(n, 'n') + 1n; if (k < 2n) k = 2n; while (!isPrimeBig(k)) k++; return show(String(k)); },
  prevprime: ([n]) => { let k = bigIntOf(n, 'n') - 1n; if (k < 2n) throw new Error('n must be at least 3'); while (!isPrimeBig(k)) k--; return show(String(k)); },
  factorint: ([n]) => {
    const k = bigIntOf(n, 'n');
    if (k >= -1n && k <= 1n) return show(String(k));
    const f = factorBig(k), sign = k < 0n ? '-' : '';
    return show(sign + f.map(([p, e]) => e > 1 ? `${p}^${e}` : `${p}`).join(' * '), sign + f.map(([p, e]) => e > 1 ? `${p}^{${e}}` : `${p}`).join(' \\cdot '));
  },
  divisors: ([n]) => {
    const k = abs(bigIntOf(n, 'n'));
    if (k === 0n) throw new Error('Every integer divides 0');
    let ds = [1n];
    for (const [p, e] of factorBig(k)) { const next = []; for (const d of ds) { let q = 1n; for (let i = 0; i <= e; i++) { next.push(d * q); q *= p; } } ds = next; }
    ds.sort((a, b) => (a < b ? -1 : 1));
    if (ds.length > 400) return show(`${ds.length} divisors`, `\\text{${ds.length} divisors (too many to list)}`);
    return setOf(ds);
  },
  totient: ([n]) => {
    const k = bigIntOf(n, 'n'); if (k < 1n) throw new Error('n must be at least 1');
    let r = k; for (const [p] of factorBig(k)) r = r / p * (p - 1n);
    return show(String(r));
  },
  mobius: ([n]) => {
    const k = bigIntOf(n, 'n'); if (k < 1n) throw new Error('n must be at least 1');
    const f = factorBig(k);
    return show(String(f.some(([, e]) => e > 1) ? 0 : f.length % 2 ? -1 : 1));
  },
  modinv: ([a, m]) => {
    const A = bigIntOf(a, 'a'), M = bigIntOf(m, 'm');
    if (M < 2n) throw new Error('m must be at least 2');
    const [g, x] = egcd(((A % M) + M) % M, M);
    if (g !== 1n) throw new Error(`${A} has no inverse modulo ${M}`);
    return show(String(((x % M) + M) % M));
  },
  powmod: ([a, b, m]) => {
    const A = bigIntOf(a, 'a'), B = bigIntOf(b, 'b'), M = bigIntOf(m, 'm');
    if (M < 1n) throw new Error('m must be at least 1');
    if (B < 0n) return JS_NUMBER_THEORY.powmod([String(JS_NUMBER_THEORY.modinv([String(A), String(M)]).plain), String(-B), String(M)]);
    return show(String(modPow(A, B, M)));
  },
  fibonacci: ([n]) => {
    const k = Number(bigIntOf(n, 'n')); if (k < 0 || k > 20000) throw new Error('n must be between 0 and 20000');
    let [a, b] = [0n, 1n]; for (let i = 0; i < k; i++) [a, b] = [b, a + b];
    return show(String(a));
  },
  lucas: ([n]) => {
    const k = Number(bigIntOf(n, 'n')); if (k < 0 || k > 20000) throw new Error('n must be between 0 and 20000');
    let [a, b] = [2n, 1n]; for (let i = 0; i < k; i++) [a, b] = [b, a + b];
    return show(String(a));
  },
  tobase: ([n, b]) => {
    const k = bigIntOf(n, 'n'), B = Number(bigIntOf(b, 'The base'));
    if (B < 2 || B > 36) throw new Error('The base must be between 2 and 36');
    const s = k.toString(B), sub = String(B).replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[d]);
    return show(s + sub, `\\mathtt{${s}}_{${B}}`);
  },
};
