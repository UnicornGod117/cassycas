// Degree mode shadows the trig functions in the evaluation scope (scope entries take
// precedence over built-ins in mathjs): whole arguments are converted, explicit units
// (30 deg) are left alone, and user functions follow the mode too.
export function makeDegFns(m) {
  const toRad = x => (x && x.isUnit) ? x : m.multiply(x, Math.PI / 180);
  const fromRad = y => m.multiply(y, 180 / Math.PI);
  const o = {};
  ['sin', 'cos', 'tan', 'sec', 'csc', 'cot'].forEach(f => { o[f] = x => m[f](toRad(x)); });
  ['asin', 'acos', 'atan', 'asec', 'acsc', 'acot'].forEach(f => { o[f] = x => fromRad(m[f](x)); });
  o.atan2 = (y, x) => fromRad(m.atan2(y, x));
  return o;
}
