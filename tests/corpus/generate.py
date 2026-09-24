"""Generate the differential test corpus (tests/corpus/corpus.json).

Random problems are drawn from fixed templates with a seeded RNG, and CPython SymPy computes
the reference answers. tests/corpus.test.mjs then runs every problem through both engines:
the exact engine must agree with the reference; the fallback engine may decline but must
never give a wrong answer.

    pip install sympy==1.12 mpmath==1.3.0
    python tests/corpus/generate.py
"""
import importlib.util
import json
import pathlib
import random

import sympy as sp

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('bridge', HERE.parent.parent / 'src' / 'sympy' / 'bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
plain = bridge.plain                     # SymPy -> mathjs syntax (the app's input language)

rng = random.Random(20260924)
x, k = sp.symbols('x k')
POINTS = [0.3, 0.7, 1.3, 2.1]            # sample points for comparing functions of x
items = []


def nz(lo, hi):
    while True:
        v = rng.randint(lo, hi)
        if v:
            return v


def fvalues(f):
    out = []
    for p in POINTS:
        v = complex(sp.N(f.subs(x, sp.Rational(str(p))), 20))
        out.append([v.real, v.imag])
    return out


def add(kind, inp, mode, **ref):
    items.append({'id': len(items), 'kind': kind, 'input': inp, 'mode': mode, **ref})


def value_ref(v):
    v = sp.nsimplify(v) if v.is_Float else v
    ref = {'value': [float(sp.re(sp.N(v, 20))), float(sp.im(sp.N(v, 20)))]}
    if v.is_Rational:
        ref['rational'] = plain(v)
    return ref


# ── exact arithmetic ─────────────────────────────────────────────────────────
for _ in range(25):
    a, b, c, d = (sp.Rational(nz(-9, 9), nz(1, 9)) for _ in range(4))
    A, B, C, D = ('(%s)' % plain(v) for v in (a, b, c, d))
    inp, v = rng.choice([(f'{A} + {B} * {C}', a + b * c), (f'{A} / {B} - {C}', a / b - c),
                         (f'({A} + {B}) / ({C} - {D})', (a + b) / (c - d)) if c != d else (f'{A} * {B}', a * b),
                         (f'{A}^2 - {B} * {C}', a ** 2 - b * c)])
    add('value', inp, 'algebra', **value_ref(v))
for n in rng.sample(range(8, 300), 12):
    add('value', 'sqrt(%d)' % n, 'algebra', **value_ref(sp.sqrt(n)))
for _ in range(8):
    p, q = rng.randint(2, 20), rng.randint(2, 20)
    add('value', 'sqrt(%d) + sqrt(%d)' % (p * 4, q * 9), 'algebra', **value_ref(sp.sqrt(p * 4) + sp.sqrt(q * 9)))
for num, den in [(1, 6), (1, 4), (1, 3), (2, 3), (3, 4), (5, 6), (7, 6), (5, 4), (11, 6)]:
    for fn in ['sin', 'cos', 'tan']:
        arg = sp.pi * sp.Rational(num, den)
        v = getattr(sp, fn)(arg)
        if v.is_finite:
            add('value', '%s(%d*pi/%d)' % (fn, num, den), 'trig', **value_ref(v))
for _ in range(8):
    n, r = rng.randint(4, 15), rng.randint(1, 4)
    add('value', 'combinations(%d, %d)' % (n, r), 'numeric', **value_ref(sp.binomial(n, r)))
for _ in range(6):
    b, e = sp.Rational(nz(-5, 5), nz(1, 4)), rng.randint(2, 5)
    add('value', '(%s)^%d' % (plain(b), e), 'algebra', **value_ref(b ** e))

# ── derivatives ──────────────────────────────────────────────────────────────
def atom():
    a = nz(-3, 3)
    return rng.choice([
        x ** rng.randint(2, 5), sp.sin(a * x), sp.cos(a * x), sp.exp(sp.Rational(a, 2) * x), sp.log(x),
        sp.sqrt(x), sp.atan(x), 1 / (x + rng.randint(1, 5)), x ** 2 + a * x + rng.randint(-5, 5), sp.tan(x) if a > 0 else sp.cosh(x),
    ])


def random_fn():
    f, g = atom(), atom()
    return rng.choice([f + nz(-4, 4) * g, f * g, f / (g + 10) if not g.has(sp.log, sp.atan) else f * g,
                       sp.sin(f) if f.is_polynomial(x) else f ** 2, sp.exp(g / 4) if g.is_polynomial(x) else f * g])


for _ in range(80):
    f = random_fn()
    add('function', 'diff(%s, x)' % plain(f), 'calculus', points=POINTS, values=fvalues(sp.diff(f, x)))

# ── antiderivatives (checked by differentiating the answer) ──────────────────
def integrand():
    a, b, c = nz(-4, 4), nz(-3, 3), rng.randint(1, 5)
    return rng.choice([
        a * x ** rng.randint(0, 6), sp.Rational(a, c) / x, sp.sin(a * x + b), sp.cos(a * x), sp.exp(sp.Rational(a, 2) * x),
        x * sp.exp(a * x / 2), x * sp.sin(a * x), x * sp.cos(a * x), x ** 2 * sp.exp(x), 1 / (x + c), 1 / (x ** 2 + c ** 2),
        sp.log(x), x * sp.log(x), x ** rng.randint(2, 3) * sp.log(x), sp.sec(x) ** 2, sp.sin(x) ** 2, sp.sin(x) * sp.cos(x),
        sp.expand((x + b) * (x - a) * (x + c)), 1 / ((x + c) * (x + c + 1)), sp.exp(x) * sp.sin(x), sp.sqrt(x), 1 / sp.sqrt(x),
        x / (x ** 2 + c), sp.cos(x) ** 3, (a * x + b) ** rng.randint(2, 6), 2 ** x, sp.exp(-x) * a,
    ])


for _ in range(80):
    f = integrand()
    add('antiderivative', 'integrate(%s, x)' % plain(f), 'calculus', points=POINTS, values=fvalues(f))

# ── definite integrals ──────────────────────────────────────────────────────
for _ in range(30):
    f = integrand()
    lo = rng.randint(1, 3)
    hi = lo + rng.randint(1, 3)
    add('value', 'integrate(%s, x, %d, %d)' % (plain(f), lo, hi), 'calculus', **value_ref(sp.integrate(f, (x, lo, hi))))
for f, lo, hi in [(sp.exp(-x), 0, sp.oo), (1 / (1 + x ** 2), -sp.oo, sp.oo), (1 / sp.sqrt(x), 0, 1), (sp.exp(-x ** 2), -sp.oo, sp.oo),
                  (x * sp.exp(-x), 0, sp.oo), (1 / x ** 2, 1, sp.oo), (sp.log(x), 0, 1), (1 / (x ** 2 + 4), 0, sp.oo),
                  (sp.sin(x) ** 2, 0, sp.pi), (sp.Abs(x - 1), 0, 3)]:
    add('value', 'integrate(%s, x, %s, %s)' % (plain(f), plain(lo), plain(hi)), 'calculus', **value_ref(sp.integrate(f, (x, lo, hi))))

# ── limits ──────────────────────────────────────────────────────────────────
def limit_ref(f, a, d=''):
    if d:
        r = sp.limit(f, x, a, d)
    elif a.is_infinite:
        r = sp.limit(f, x, a)
    else:
        l, r = sp.limit(f, x, a, '-'), sp.limit(f, x, a, '+')
        if l != r:
            return 'dne'
    if isinstance(r, sp.AccumBounds):
        return 'dne'
    if r in (sp.oo, -sp.oo):
        return 'Infinity' if r == sp.oo else '-Infinity'
    return float(r)


def limit_item(f, a, d=''):
    extra = ', "%s"' % d if d else ''
    add('limit', 'limit(%s, x, %s%s)' % (plain(f), plain(a), extra), 'calculus', limit=limit_ref(f, a, d))


for _ in range(3):
    a, c, n = nz(-5, 5), rng.randint(1, 4), rng.randint(2, 5)
    limit_item(sp.sin(a * x) / x, sp.Integer(0))
    limit_item((1 - sp.cos(a * x)) / x ** 2, sp.Integer(0))
    limit_item((sp.exp(a * x) - 1) / x, sp.Integer(0))
    limit_item((x ** n - c ** n) / (x - c), sp.Integer(c))
    limit_item(sp.tan(a * x) / x, sp.Integer(0))
    p = sum(nz(-5, 5) * x ** i for i in range(n + 1))
    q = sum(nz(-5, 5) * x ** i for i in range(rng.choice([n, n + 1]) + 1))
    limit_item(p / q, sp.oo)
    limit_item((1 + sp.Rational(a, c) / x) ** x, sp.oo)
    limit_item(sp.sqrt(x ** 2 + a * x) - x, sp.oo)
    limit_item(sp.Integer(a) / (x - c), sp.Integer(c))
    limit_item(sp.Integer(a) / (x - c), sp.Integer(c), rng.choice('+-'))
    limit_item(sp.Integer(abs(a)) / (x - c) ** 2, sp.Integer(c))
for f, a, d in [(sp.Abs(x) / x, 0, ''), (sp.Abs(x) / x, 0, '+'), (sp.Abs(x) / x, 0, '-'), (x * sp.log(x), 0, '+'),
                (sp.log(x), 0, '+'), (sp.sin(1 / x), 0, ''), (x * sp.sin(1 / x), 0, ''), (sp.exp(-x), sp.oo, ''),
                (sp.atan(x), sp.oo, ''), (sp.atan(x), -sp.oo, ''), (x ** x, 0, '+'), (sp.exp(1 / x), 0, '-'),
                (sp.exp(1 / x), 0, '+'), (sp.floor(x), 1, ''), (sp.log(x) / x, sp.oo, '')]:
    limit_item(f, sp.sympify(a), d)

# ── solving polynomial equations (real roots) ───────────────────────────────
def roots_ref(p):
    return sorted(float(r) for r in sp.solve(p, x) if r.is_real)


for _ in range(30):
    deg = rng.choice([2, 2, 3, 3, 4])
    factors = [rng.choice([x - nz(-6, 6), nz(1, 3) * x - nz(-5, 5)]) for _ in range(deg)]
    p = sp.expand(sp.Mul(*factors) * nz(-2, 2))
    add('roots', 'solve(%s = 0, x)' % plain(p), 'solve', roots=roots_ref(p))
for _ in range(20):
    b = nz(-8, 8)
    c = rng.randint(-10, b * b // 4 - 1) if b * b // 4 > -10 else -3
    p = x ** 2 + b * x + c
    if sp.discriminant(p, x) <= 0 or sp.sqrt(sp.discriminant(p, x)).is_Rational:
        continue
    if rng.random() < 0.4:
        p = sp.expand(p * (x - nz(-4, 4)))
    add('roots', 'solve(%s = 0, x)' % plain(p), 'solve', roots=roots_ref(p))

# ── factor / expand / simplify ──────────────────────────────────────────────
for _ in range(30):
    fs = [rng.choice([x - nz(-6, 6), nz(2, 4) * x - nz(-5, 5), x ** 2 + 1, x ** 2 + x + 1, x ** 2 - 2 * x + 5])
          for _ in range(rng.randint(2, 3))]
    p = sp.expand(sp.Mul(*fs))
    add('form', 'factor(%s)' % plain(p), 'algebra', shape='product', points=POINTS, values=fvalues(p))
for _ in range(20):
    e = sp.Mul(*[x + nz(-5, 5) for _ in range(rng.randint(2, 4))]) + nz(-9, 9) * (x - nz(-3, 3)) ** 2
    add('form', 'expand(%s)' % plain(e), 'algebra', shape='expanded', points=POINTS, values=fvalues(e))
for _ in range(20):
    r1, r2 = nz(-6, 6), nz(-6, 6)
    e = rng.choice([
        sp.expand((x - r1) * (x - r2)) / (x - r1),
        sp.sin(x) ** 2 + sp.cos(x) ** 2 + (x - r1),
        (x ** 2 - r1 ** 2) / (x + r1),
        sp.exp(x) * sp.exp(r1 * x),
        (1 / (x - r1) - 1 / (x - r2)) if r1 != r2 else 1 / (x - r1),
    ])
    add('form', 'simplify(%s)' % plain(e), 'algebra', shape='any', points=POINTS, values=fvalues(e))

# ── sums and products ───────────────────────────────────────────────────────
for _ in range(10):
    p, n = rng.randint(1, 4), rng.randint(5, 40)
    add('value', 'sum(k^%d, k, 1, %d)' % (p, n), 'calculus', **value_ref(sp.summation(k ** p, (k, 1, n))))
for _ in range(5):
    r, n = sp.Rational(1, rng.randint(2, 5)), rng.randint(3, 12)
    add('value', 'sum((%s)^k, k, 0, %d)' % (plain(r), n), 'calculus', **value_ref(sp.summation(r ** k, (k, 0, n))))
for n in rng.sample(range(3, 12), 3):
    add('value', 'product(k, k, 1, %d)' % n, 'calculus', **value_ref(sp.factorial(n)))
for e, n in [(1 / k ** 2, sp.oo), (sp.Rational(1, 2) ** k, sp.oo), (1 / sp.factorial(k), sp.oo), ((-1) ** (k + 1) / k, sp.oo)]:
    add('value', 'sum(%s, k, 1, %s)' % (plain(e), plain(n)), 'calculus', **value_ref(sp.summation(e, (k, 1, n))))

(HERE / 'corpus.json').write_text(json.dumps(items, indent=0) + '\n', encoding='utf8')
print(len(items), 'problems written to', HERE / 'corpus.json')
