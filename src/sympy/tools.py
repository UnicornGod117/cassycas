"""CassyCAS tools: named SymPy capabilities beyond the core operations.

Runs in the same namespace as bridge.py (the worker executes bridge.py, then this file), so
Builder, value, plain, tex and OPS are already defined. Each tool is a whitelisted Python
function; the JavaScript side (src/tools.js) sends its arguments as JSON expression trees,
which are built into SymPy objects here exactly like every other input — never as source.

A tool returns either a SymPy object (shown as its value) or a dict made with show().
"""
import inspect
import itertools

from sympy.ntheory.modular import crt as _crt
from sympy.solvers.diophantine import diophantine as _diophantine

MAX_INT_DIGITS = 5000


# ── helpers ─────────────────────────────────────────────────────────────────
def show(latex, plain_text, steps=None, **extra):
    return {'display': {'latex': latex, 'plain': plain_text}, 'steps': steps or [], **extra}


def _int(e, what='The argument', lo=None, hi=None):
    e = sp.sympify(e)
    if not e.is_Integer:
        raise ValueError('%s must be an integer' % what)
    n = int(e)
    if lo is not None and n < lo:
        raise ValueError('%s must be at least %d' % (what, lo))
    if hi is not None and n > hi:
        raise ValueError('%s must be at most %s' % (what, hi))
    return n


def _items(v):
    return list(v) if isinstance(v, sp.MatrixBase) else [v]


def _syms(v):
    items = _items(v)
    if not items or not all(isinstance(s, sp.Symbol) for s in items):
        raise ValueError('Expected a variable or a list of variables, e.g. [x, y]')
    return items


def _eq_expr(e):
    """An equation lhs = rhs (sent as Eq) or a plain expression, as expression = 0."""
    if isinstance(e, sp.Equality):
        return e.lhs - e.rhs
    if e in (sp.true, sp.false):
        raise ValueError('The equation is always %s' % ('true' if e == sp.true else 'false'))
    return e


def _set(items):
    return r'\left\{%s\right\}' % r',\ '.join(tex(i) for i in items), '{%s}' % ', '.join(plain(i) for i in items)


def _list(items):
    return r'\left[%s\right]' % r',\ '.join(tex(i) for i in items), '[%s]' % ', '.join(plain(i) for i in items)


def _text(s):
    return r'\text{%s}' % s.replace('\\', '').replace('{', '').replace('}', '')


def _tidy(r):
    s = sp.simplify(r)
    return s if sp.count_ops(s) <= sp.count_ops(r) else r


def _check_digits(n):
    if abs(n) > 10 ** MAX_INT_DIGITS:
        raise ValueError('The result is too large to display (over %d digits)' % MAX_INT_DIGITS)
    return sp.Integer(n)


# ── number theory ───────────────────────────────────────────────────────────
def t_isprime(n):
    k = _int(n, 'n')
    ok = sp.isprime(k)
    steps = []
    if not ok and k > 3:
        f = sp.factorint(k, limit=10 ** 6)
        steps.append({'d': 'Factors found', 'tex': ' \\cdot '.join('%d^{%d}' % (p, e) if e > 1 else str(p) for p, e in f.items())})
    return show(_text('true') if ok else _text('false'), 'true' if ok else 'false', steps)


def t_nextprime(n):
    return sp.Integer(sp.nextprime(_int(n, 'n')))


def t_prevprime(n):
    return sp.Integer(sp.prevprime(_int(n, 'n', lo=3)))


def t_prime(n):
    return sp.Integer(sp.prime(_int(n, 'n', lo=1, hi=10 ** 7)))


def t_primepi(n):
    return sp.Integer(sp.primepi(_int(n, 'n', hi=10 ** 10)))


def t_factorint(n):
    k = _int(n, 'n')
    if k in (-1, 0, 1):
        return show(str(k), str(k))
    f = sp.factorint(k)
    parts = [(p, e) for p, e in f.items() if p != -1]
    lt = ' \\cdot '.join('%d^{%d}' % (p, e) if e > 1 else str(p) for p, e in parts)
    pt = ' * '.join('%d^%d' % (p, e) if e > 1 else str(p) for p, e in parts)
    if k < 0:
        lt, pt = '-' + lt, '-' + pt
    steps = [{'d': 'Number of distinct prime factors', 'tex': str(len(parts))}]
    return show(lt, pt, steps)


def t_divisors(n):
    k = abs(_int(n, 'n', hi=10 ** 15))
    if k == 0:
        raise ValueError('Every integer divides 0')
    ds = sp.divisors(k)
    steps = [{'d': 'Number of divisors τ(n)', 'tex': str(len(ds))}, {'d': 'Sum of divisors σ(n)', 'tex': str(sum(ds))}]
    if len(ds) > 400:
        return show(_text('%d divisors (too many to list)' % len(ds)), '%d divisors' % len(ds), steps)
    lt, pt = _set([sp.Integer(d) for d in ds])
    return show(lt, pt, steps)


def t_totient(n):
    return sp.Integer(sp.totient(_int(n, 'n', lo=1)))


def t_mobius(n):
    from sympy.ntheory import mobius
    return sp.Integer(mobius(_int(n, 'n', lo=1)))


def t_modinv(a, m):
    return sp.Integer(sp.mod_inverse(_int(a, 'a'), _int(m, 'm', lo=2)))


def t_powmod(a, b, m):
    return sp.Integer(pow(_int(a, 'a'), _int(b, 'b'), _int(m, 'm', lo=1)))


def t_crt(rs, ms):
    r = [_int(x, 'Each remainder') for x in _items(rs)]
    m = [_int(x, 'Each modulus', lo=1) for x in _items(ms)]
    if len(r) != len(m):
        raise ValueError('Give as many remainders as moduli: crt([r1, r2], [m1, m2])')
    res = _crt(m, r)
    if res is None:
        return show(_text('no solution'), 'no solution', [{'d': 'The congruences are inconsistent', 'tex': ''}])
    x, M = res
    steps = [{'d': 'Congruences', 'tex': r',\ '.join(r'x \equiv %d \pmod{%d}' % (a, b) for a, b in zip(r, m))}]
    return show(r'x \equiv %d \pmod{%d}' % (x, M), 'x = %d mod %d' % (x, M), steps)


def t_fibonacci(n):
    return _check_digits(sp.fibonacci(_int(n, 'n', lo=0, hi=20000)))


def t_lucas(n):
    return _check_digits(sp.lucas(_int(n, 'n', lo=0, hi=20000)))


def t_catalan(n):
    return _check_digits(sp.catalan(_int(n, 'n', lo=0, hi=5000)))


def t_bernoulli(n):
    return sp.bernoulli(_int(n, 'n', lo=0, hi=1000))


def t_partition(n):
    return _check_digits(sp.npartitions(_int(n, 'n', lo=0, hi=20000)))


def t_contfrac(x, n=None):
    terms = _int(n, 'The number of terms', lo=1, hi=200) if n is not None else 12
    if x.is_Rational:
        cf = sp.continued_fraction(x)
        body = [str(t) for t in cf]
        lt = '[%s]' % (body[0] + (';\\ ' + ',\\ '.join(body[1:]) if len(body) > 1 else ''))
        return show(lt, '[%s]' % (body[0] + ('; ' + ', '.join(body[1:]) if len(body) > 1 else '')))
    try:
        cf = sp.continued_fraction(x) if x.is_algebraic and sp.degree(sp.minimal_polynomial(x, sp.Dummy())) == 2 else None
    except Exception:
        cf = None
    if cf and isinstance(cf[-1], list):
        pre, period = [str(t) for t in cf[:-1]], [str(t) for t in cf[-1]]
        if not pre:                   # purely periodic, e.g. the golden ratio [1; 1, 1, …]
            pre, period = period[:1], period[1:] + period[:1]
        head, mid = pre[0], pre[1:]
        lt = '[%s;\\ %s\\overline{%s}]' % (head, ''.join(t + ',\\ ' for t in mid), ',\\ '.join(period))
        pt = '[%s; %s(%s repeating)]' % (head, ''.join(t + ', ' for t in mid), ', '.join(period))
        return show(lt, pt, [{'d': 'Quadratic irrational: the expansion is periodic', 'tex': ''}])
    if not x.is_real:
        raise ValueError('Continued fractions need a real number')
    body = [str(t) for t in itertools.islice(sp.continued_fraction_iterator(x), terms)]
    convergents = list(itertools.islice(sp.continued_fraction_convergents([int(t) for t in body]), terms))
    steps = [{'d': 'Convergents', 'tex': r',\ '.join(tex(c) for c in convergents[:8])}]
    return show('[%s;\\ %s,\\ \\ldots]' % (body[0], ',\\ '.join(body[1:])), '[%s; %s, ...]' % (body[0], ', '.join(body[1:])), steps)


def t_identify(x):
    if not x.is_number:
        raise ValueError('identify() needs a number, e.g. identify(1.7320508075688772)')
    f = sp.N(x, 30)
    if not f.is_real:
        raise ValueError('identify() needs a real number')
    tol = sp.Float(10) ** -12 * max(1, abs(f))
    cands = []
    for consts in ([], [sp.pi], [sp.E], [sp.sqrt(2), sp.sqrt(3), sp.sqrt(5)], [sp.pi, sp.sqrt(2)], [sp.log(2)], [sp.GoldenRatio]):
        try:
            c = sp.nsimplify(sp.Float(f, 20), consts, tolerance=1e-12, full=bool(consts))
        except Exception:
            continue
        if c.is_number and abs(sp.N(c, 30) - f) <= tol and len(plain(c)) < 40:
            cands.append(c)
    if not cands:
        return show(_text('no simple closed form found'), 'no simple closed form found')
    best = min(cands, key=lambda c: (sp.count_ops(c), len(plain(c))))
    return show(tex(best), plain(best), [{'d': 'Agrees to within', 'tex': r'10^{-12}'}])


def t_tobase(n, base):
    k, b = _int(n, 'n'), _int(base, 'The base', lo=2, hi=36)
    digits, m = [], abs(k)
    while True:
        m, r = divmod(m, b)
        digits.append('0123456789abcdefghijklmnopqrstuvwxyz'[r])
        if m == 0:
            break
    s = ('-' if k < 0 else '') + ''.join(reversed(digits))
    sub = ''.join('₀₁₂₃₄₅₆₇₈₉'[int(c)] for c in str(b))
    return show(r'\mathtt{%s}_{%d}' % (s, b), s + sub)


def t_diophantine(eq):
    e = _eq_expr(eq)
    syms = sorted(e.free_symbols, key=lambda s: s.name)
    if not syms:
        raise ValueError('The equation has no unknowns')
    sols = _diophantine(e, syms=syms)
    if not sols:
        return show(_text('no integer solutions'), 'no integer solutions')
    names = ', '.join(tex(s) for s in syms)
    rows = [r'\left(%s\right) = \left(%s\right)' % (names, r',\ '.join(tex(v) for v in sol)) for sol in list(sols)[:12]]
    plains = ['(%s) = (%s)' % (', '.join(s.name for s in syms), ', '.join(plain(v) for v in sol)) for sol in list(sols)[:12]]
    return show(r',\quad '.join(rows), '; '.join(plains), [{'d': 'Integer parameters', 'tex': r't_0,\ t_1,\ \ldots \in \mathbb{Z}'}])


# ── calculus ────────────────────────────────────────────────────────────────
def t_pdiff(f, *vs):
    for v in vs:
        _syms(v)
    r = _tidy(sp.diff(f, *vs))
    return {'value': value(r), 'prefix': r'\frac{\partial^{%d}}{%s} %s = ' % (len(vs), ' '.join(r'\partial %s' % tex(v) for v in vs), tex(f)) if len(vs) > 1 else None}


def t_jacobian(F, V):
    return sp.Matrix(_items(F)).jacobian(_syms(V)).applyfunc(_tidy)


def t_hessian(f, V):
    return sp.hessian(f, _syms(V)).applyfunc(_tidy)


def t_laplacian(f, V):
    return _tidy(sum(sp.diff(f, v, 2) for v in _syms(V)))


def t_divergence(F, V):
    comps, vs = _items(F), _syms(V)
    if len(comps) != len(vs):
        raise ValueError('The field and the variable list must have the same length')
    return _tidy(sum(sp.diff(c, v) for c, v in zip(comps, vs)))


def t_curl(F, V):
    if len(_items(F)) != 3 or len(_syms(V)) != 3:
        raise ValueError('curl needs a 3-component field and [x, y, z]')
    (P, Q, R), (x, y, z) = _items(F), _syms(V)
    return sp.Matrix([_tidy(sp.diff(R, y) - sp.diff(Q, z)), _tidy(sp.diff(P, z) - sp.diff(R, x)), _tidy(sp.diff(Q, x) - sp.diff(P, y))])


def _classify_1d(f, x, p):
    for k in range(2, 7):
        d = sp.simplify(sp.diff(f, x, k).subs(x, p))
        if d != 0:
            if k % 2:
                return 'inflection point (no extremum)'
            return 'local minimum' if d > 0 else 'local maximum'
    return 'inconclusive'


def _classify_nd(f, vs, pt):
    H = sp.hessian(f, vs).subs(pt)
    try:
        ev = [complex(sp.N(e)) for e in H.eigenvals(multiple=True)]
    except Exception:
        return 'inconclusive'
    re_ = [e.real for e in ev]
    if all(r > 1e-12 for r in re_):
        return 'local minimum'
    if all(r < -1e-12 for r in re_):
        return 'local maximum'
    if any(r > 1e-12 for r in re_) and any(r < -1e-12 for r in re_):
        return 'saddle point'
    return 'inconclusive (degenerate Hessian)'


def t_extrema(f, V):
    vs = _syms(V)
    grad = [sp.diff(f, v) for v in vs]
    sols = sp.solve(grad, vs, dict=True)
    rows, plains = [], []
    for s in sols:
        if len(s) < len(vs) or not all(sp.sympify(s[v]).is_real for v in vs):
            continue
        kind = _classify_1d(f, vs[0], s[vs[0]]) if len(vs) == 1 else _classify_nd(f, vs, s)
        val = _tidy(f.subs(s))
        at = ',\\ '.join('%s = %s' % (tex(v), tex(s[v])) for v in vs)
        rows.append(r'%s:\ \text{%s},\ f = %s' % (at, kind, tex(val)))
        plains.append('%s: %s, f = %s' % (', '.join('%s = %s' % (v, plain(s[v])) for v in vs), kind, plain(val)))
        if len(rows) >= 12:
            break
    if not rows:
        return show(_text('no real critical points found'), 'no real critical points found')
    steps = [{'d': 'Critical points: solve ∇f = 0', 'tex': r',\ '.join('%s = 0' % tex(g) for g in grad)},
             {'d': 'Classify with the second-derivative test' if len(vs) == 1 else 'Classify with the Hessian', 'tex': ''}]
    return show(r'\begin{array}{l}%s\end{array}' % r'\\'.join(rows), '; '.join(plains), steps)


def t_tangent(f, x, a):
    _syms(x)
    fa, slope = _tidy(f.subs(x, a)), _tidy(sp.diff(f, x).subs(x, a))
    line = sp.expand(fa + slope * (x - a))
    steps = [{'d': 'Point', 'tex': r'f(%s) = %s' % (tex(a), tex(fa))}, {'d': 'Slope', 'tex': r"f'(%s) = %s" % (tex(a), tex(slope))}]
    return show('y = %s' % tex(line), 'y = %s' % plain(line), steps, plot=[plain(f), plain(line)], plotVar=x.name)


def t_idiff(eq, y, x, n=None):
    _syms(y), _syms(x)
    k = _int(n, 'The order', lo=1, hi=4) if n is not None else 1
    r = _tidy(sp.idiff(_eq_expr(eq), y, x, k))
    lhs = r'\frac{d%s}{d%s}' % (('^{%d}' % k if k > 1 else '') + tex(y), tex(x) + ('^{%d}' % k if k > 1 else ''))
    return show('%s = %s' % (lhs, tex(r)), plain(r))


def _positive(v):
    return sp.Symbol(v.name, positive=True)


def t_laplace(f, t, s):
    _syms(t), _syms(s)
    tp = _positive(t)
    r = sp.laplace_transform(f.subs(t, tp), tp, s, noconds=True)
    return {'value': value(_tidy(r)), 'prefix': r'\mathcal{L}\left\{%s\right\} = ' % tex(f)}


def t_invlaplace(F, s, t):
    _syms(s), _syms(t)
    tp = _positive(t)
    r = sp.inverse_laplace_transform(F, s, tp).subs(tp, t)
    return {'value': value(_tidy(r)), 'prefix': r'\mathcal{L}^{-1}\left\{%s\right\} = ' % tex(F),
            'steps': [{'d': 'Assuming t > 0', 'tex': ''}]}


def t_fourier(f, x, k):
    _syms(x), _syms(k)
    r = sp.fourier_transform(f, x, k)
    return {'value': value(_tidy(r)), 'prefix': r'\mathcal{F}\left\{%s\right\} = ' % tex(f),
            'steps': [{'d': 'Convention', 'tex': r'\hat f(k) = \int_{-\infty}^{\infty} f(x)\, e^{-2\pi i k x}\, dx'}]}


def t_invfourier(F, k, x):
    _syms(k), _syms(x)
    r = sp.inverse_fourier_transform(F, k, x)
    return {'value': value(_tidy(r)), 'prefix': r'\mathcal{F}^{-1}\left\{%s\right\} = ' % tex(F)}


def t_fourierseries(f, x, *rest):
    _syms(x)
    if len(rest) == 0:
        a, b, n = -sp.pi, sp.pi, 5
    elif len(rest) == 1:
        a, b, n = -sp.pi, sp.pi, _int(rest[0], 'The number of terms', lo=1, hi=30)
    elif len(rest) in (2, 3):
        a, b = rest[0], rest[1]
        n = _int(rest[2], 'The number of terms', lo=1, hi=30) if len(rest) == 3 else 5
    else:
        raise ValueError('Use fourierseries(f, x, n) or fourierseries(f, x, a, b, n)')
    r = sp.fourier_series(f, (x, a, b)).truncate(n)
    return {'value': value(r), 'prefix': r'%s \sim ' % tex(f),
            'steps': [{'d': 'Interval', 'tex': r'%s \in \left[%s, %s\right]' % (tex(x), tex(a), tex(b))}, {'d': 'Non-zero terms kept', 'tex': str(n)}]}


def t_residue(f, z, a):
    _syms(z)
    return {'value': value(sp.residue(f, z, a)), 'prefix': r'\operatorname{Res}_{%s = %s} %s = ' % (tex(z), tex(a), tex(f))}


def t_arclength(f, x, a, b):
    _syms(x)
    integrand = sp.sqrt(1 + sp.diff(f, x) ** 2)
    I = sp.Integral(integrand, (x, a, b))
    val = I.evalf(20)
    return show(r'%s \approx %s' % (tex(I), tex(sp.Float(val, 12))), plain(sp.Float(val, 15)))


def t_integrate_multi(f, *ranges):
    lims = []
    for r in ranges:
        items = _items(r)
        if len(items) != 3 or not isinstance(items[0], sp.Symbol):
            raise ValueError('Each range looks like [x, a, b]')
        lims.append(tuple(items))
    r = sp.integrate(f, *lims)
    exact = not r.has(sp.Integral)
    if not exact:
        r = sp.Integral(f, *lims).evalf(15)
    prefix = ''.join(r'\int_{%s}^{%s}' % (tex(a), tex(b)) for (_, a, b) in reversed(lims)) + ' ' + tex(f) + r'\, ' + r'\,'.join('d' + tex(v) for (v, _, _) in lims) + ' = '
    return {'value': value(_tidy(r) if exact else r), 'prefix': prefix, 'numeric': not exact}


def t_nsolve(eq, x, x0, digits=None):
    _syms(x)
    d = _int(digits, 'The number of digits', lo=5, hi=500) if digits is not None else 30
    r = sp.nsolve(_eq_expr(eq), x, x0, prec=d)
    return show('%s \\approx %s' % (tex(x), sp.Float(r, d)), '%s = %s' % (x.name, sp.Float(r, d)))


def t_N(e, digits=None):
    d = _int(digits, 'The number of digits', lo=1, hi=2000) if digits is not None else 50
    if isinstance(e, sp.MatrixBase):
        r = e.evalf(d)
        return show(tex(r), plain(r))
    r = sp.N(e, d)
    if not r.is_number:
        raise ValueError('N() needs a numeric expression')
    re_, im_ = r.as_real_imag()
    s = str(re_) if im_ == 0 else str(r)
    return show(s.replace('*I', 'i').replace('I', 'i'), s.replace('*I', '*i').replace('I', 'i'))


def t_rsolve(b, eq_node, fn_node, *ic_nodes):
    b.undefined_functions = True
    if fn_node.get('t') != 'fn' or len(fn_node.get('args', [])) != 1 or fn_node['args'][0].get('t') != 'sym':
        raise ValueError('The second argument names the sequence, e.g. a(n)')
    fname, nname = fn_node['n'], fn_node['args'][0]['n']
    if fname in FUNCS:
        raise ValueError('Choose a sequence name that is not a built-in function')
    n = b.sym(nname)
    a = sp.Function(fname)
    eq = _eq_expr(b.build(eq_node))
    ics = {}
    for node in ic_nodes:
        c = b.build(node)
        if not isinstance(c, sp.Equality):
            raise ValueError('Initial conditions look like a(0) = 1')
        ics[c.lhs] = c.rhs
    r = sp.rsolve(eq, a(n), ics or None)
    if r is None:
        return show(_text('no closed form found'), 'no closed form found')
    r = _tidy(r)
    return show('%s(%s) = %s' % (tex(sp.Symbol(fname)), tex(n), tex(r)), '%s(%s) = %s' % (fname, nname, plain(r)),
                plot=[plain(r)] if not any(s.name.startswith('C') for s in r.free_symbols) else None, plotVar=nname)


# ── algebra ─────────────────────────────────────────────────────────────────
def t_resultant(p, q, x):
    return sp.resultant(p, q, _syms(x)[0])


def t_discriminant(p, x):
    return sp.discriminant(p, _syms(x)[0])


def t_degree(p, x):
    return sp.Integer(sp.degree(p, _syms(x)[0]))


def t_coeffs(p, x):
    cs = sp.Poly(p, _syms(x)[0]).all_coeffs()
    lt, pt = _list(cs)
    return show(lt, pt, [{'d': 'Highest power first', 'tex': ''}])


def t_groebner(F, V):
    G = sp.groebner(_items(F), *_syms(V), order='lex')
    lt, pt = _list(list(G.exprs))
    return show(lt, pt, [{'d': 'Reduced Gröbner basis, lex order', 'tex': r' > '.join(tex(v) for v in _syms(V))}])


def t_completesquare(p, x):
    x = _syms(x)[0]
    poly = sp.Poly(sp.expand(p), x)
    if poly.degree() != 2:
        raise ValueError('completesquare() needs a quadratic in %s' % x)
    a, b, c = poly.all_coeffs()
    h, k = sp.simplify(-b / (2 * a)), sp.simplify(c - b ** 2 / (4 * a))
    sq = sp.UnevaluatedExpr(x - h) ** 2
    form = a * sq + k if a != 1 else sq + k
    steps = [{'d': 'Vertex', 'tex': r'\left(%s,\ %s\right)' % (tex(h), tex(k))}]
    return show(tex(form), plain(form), steps)


REWRITE_TARGETS = {'exp': sp.exp, 'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan, 'cot': sp.cot, 'sinh': sp.sinh,
                   'cosh': sp.cosh, 'tanh': sp.tanh, 'log': sp.log, 'sqrt': sp.sqrt, 'pow': sp.Pow, 'gamma': sp.gamma,
                   'factorial': sp.factorial, 'binomial': sp.binomial, 'atan': sp.atan}


def t_rewrite(e, target):
    if not isinstance(target, sp.Symbol) or target.name not in REWRITE_TARGETS:
        raise ValueError('Rewrite in terms of one of: ' + ', '.join(sorted(REWRITE_TARGETS)))
    return e.rewrite(REWRITE_TARGETS[target.name])


def t_logcombine(e):
    return sp.logcombine(e, force=True)


def t_expandlog(e):
    return sp.expand_log(e, force=True)


def t_powsimp(e):
    return sp.powsimp(e, force=True)


def t_polar(z):
    z = sp.simplify(z)
    r, th = sp.simplify(sp.Abs(z)), sp.simplify(sp.arg(z))
    return show(r'%s\, e^{i %s}' % (tex(r), tex(th) if th.is_Atom else r'\left(%s\right)' % tex(th)), '%s*exp(i*(%s))' % (plain(r), plain(th)),
                [{'d': 'Modulus', 'tex': r'\lvert z \rvert = %s' % tex(r)}, {'d': 'Argument', 'tex': r'\arg z = %s' % tex(th)}])


def t_rect(z):
    return sp.expand_complex(sp.simplify(z))


def t_csolve(eq, x):
    x = _syms(x)[0]
    s = sp.solveset(_eq_expr(eq), x, domain=sp.S.Complexes)
    if isinstance(s, sp.FiniteSet):
        items = sorted(s, key=lambda v: (sp.N(sp.im(v)), sp.N(sp.re(v))))
        return show(r',\quad '.join('%s = %s' % (tex(x), tex(v)) for v in items), ', '.join('%s = %s' % (x.name, plain(v)) for v in items))
    return show(tex(s), plain(s))


# ── linear algebra ──────────────────────────────────────────────────────────
def _mat(A):
    if not isinstance(A, sp.MatrixBase):
        raise ValueError('Expected a matrix, e.g. [[1, 2], [3, 4]]')
    return A


def _named(pairs, steps=None):
    return show(r',\quad '.join('%s = %s' % (n, tex(m)) for n, m in pairs), '; '.join('%s = %s' % (n, plain(m)) for n, m in pairs), steps)


def t_diagonalize(A):
    A = _mat(A)
    if not A.is_diagonalizable():
        raise ValueError('The matrix is not diagonalizable — try jordan()')
    P, D = A.diagonalize()
    return _named([('P', P), ('D', D)], [{'d': 'A = P D P⁻¹', 'tex': ''}])


def t_jordan(A):
    P, J = _mat(A).jordan_form()
    return _named([('P', P), ('J', J)], [{'d': 'A = P J P⁻¹', 'tex': ''}])


def t_expm(A):
    return _mat(A).exp().applyfunc(_tidy)


def t_lu(A):
    L, U, perm = _mat(A).LUdecomposition()
    steps = [{'d': 'Row swaps', 'tex': ',\\ '.join('(%d, %d)' % (i + 1, j + 1) for i, j in perm) or 'none'}]
    return _named([('L', L), ('U', U)], steps)


def t_qr(A):
    Q, R = _mat(A).QRdecomposition()
    return _named([('Q', Q.applyfunc(_tidy)), ('R', R.applyfunc(_tidy))])


def t_adj(A):
    return _mat(A).adjugate()


def t_columnspace(A):
    lt, pt = _set(_mat(A).columnspace())
    return show(r'\operatorname{span}' + lt, 'span' + pt)


def t_rowspace(A):
    lt, pt = _set(_mat(A).rowspace())
    return show(r'\operatorname{span}' + lt, 'span' + pt)


def t_pinv(A):
    return _mat(A).pinv().applyfunc(_tidy)


def t_linsolve(A, bvec):
    A = _mat(A)
    bb = sp.Matrix(_items(bvec))
    s = sp.linsolve((A, bb))
    if s == sp.EmptySet:
        return show(_text('no solution'), 'no solution')
    sol = list(s)[0]
    v = sp.Matrix(list(sol))
    free = sorted(v.free_symbols - A.free_symbols - bb.free_symbols, key=lambda t: t.name)
    steps = [{'d': 'Free parameters', 'tex': ',\\ '.join(tex(f) for f in free)}] if free else []
    return show('x = %s' % tex(v), 'x = %s' % plain(v), steps)


TOOLS = {
    # number theory
    'isprime': t_isprime, 'nextprime': t_nextprime, 'prevprime': t_prevprime, 'prime': t_prime, 'primepi': t_primepi,
    'factorint': t_factorint, 'divisors': t_divisors, 'totient': t_totient, 'mobius': t_mobius, 'modinv': t_modinv,
    'powmod': t_powmod, 'crt': t_crt, 'fibonacci': t_fibonacci, 'lucas': t_lucas, 'catalan': t_catalan,
    'bernoulli': t_bernoulli, 'partition': t_partition, 'contfrac': t_contfrac, 'identify': t_identify,
    'tobase': t_tobase, 'diophantine': t_diophantine,
    # calculus
    'pdiff': t_pdiff, 'jacobian': t_jacobian, 'hessian': t_hessian, 'laplacian': t_laplacian, 'divergence': t_divergence,
    'curl': t_curl, 'extrema': t_extrema, 'tangent': t_tangent, 'idiff': t_idiff, 'laplace': t_laplace,
    'invlaplace': t_invlaplace, 'fourier': t_fourier, 'invfourier': t_invfourier, 'fourierseries': t_fourierseries,
    'residue': t_residue, 'arclength': t_arclength, 'integrate_multi': t_integrate_multi, 'nsolve': t_nsolve, 'N': t_N,
    # algebra
    'resultant': t_resultant, 'discriminant': t_discriminant, 'degree': t_degree, 'coeffs': t_coeffs,
    'groebner': t_groebner, 'completesquare': t_completesquare, 'rewrite': t_rewrite, 'logcombine': t_logcombine,
    'expandlog': t_expandlog, 'powsimp': t_powsimp, 'polar': t_polar, 'rect': t_rect, 'csolve': t_csolve,
    # linear algebra
    'diagonalize': t_diagonalize, 'jordan': t_jordan, 'expm': t_expm, 'lu': t_lu, 'qr': t_qr, 'adj': t_adj,
    'columnspace': t_columnspace, 'rowspace': t_rowspace, 'pinv': t_pinv, 'linsolve': t_linsolve,
}
RAW_TOOLS = {'rsolve': t_rsolve}     # receive the builder and unbuilt argument trees


def op_tool(req, b):
    name, args = req.get('name'), req.get('args', [])
    if not isinstance(args, list) or len(args) > 12:
        raise ValueError('bad arguments')
    fn = RAW_TOOLS.get(name) or TOOLS.get(name)
    if fn is None:
        raise ValueError('unknown tool')
    try:
        inspect.signature(fn).bind(*([b] if name in RAW_TOOLS else []), *args)
    except TypeError:
        raise ValueError('Wrong number of arguments for %s()' % name)
    out = fn(b, *args) if name in RAW_TOOLS else fn(*[b.build(a) for a in args])
    if isinstance(out, dict):
        return out
    return {'value': value(out)}


OPS['tool'] = op_tool
