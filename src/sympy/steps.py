"""CassyCAS worked solutions: step-by-step derivations the way they are taught.

Runs in the same namespace as bridge.py (after tools.py) and replaces its simpler step
generators. Every step is {'d': description, 'tex': LaTeX, 'depth': nesting level}; each one is
an equation that holds, so a student can follow (and check) the derivation line by line.
Step generation never decides the answer — the result always comes from SymPy — and any
failure here only means fewer steps.
"""


def _st(depth, d, t=''):
    return {'d': d, 'tex': t, 'depth': depth}


def _p(e):
    """LaTeX of e, parenthesised when it is a sum (for products like (x + 1)·sin x)."""
    t = tex(e)
    return r'\left(%s\right)' % t if isinstance(e, sp.Add) or (e.could_extract_minus_sign() and e != -1) else t


def _D(x, e):
    return r'\frac{d}{d%s}\left[%s\right]' % (tex(x), tex(e))


FN_NAMES = {'sin': 'sine', 'cos': 'cosine', 'tan': 'tangent', 'sec': 'secant', 'csc': 'cosecant', 'cot': 'cotangent',
            'exp': 'the exponential', 'log': 'the natural logarithm', 'asin': 'arcsine', 'acos': 'arccosine', 'atan': 'arctangent',
            'sinh': 'sinh', 'cosh': 'cosh', 'tanh': 'tanh', 'Abs': 'the absolute value', 'sqrt': 'the square root'}


# ── Derivatives ────────────────────────────────────────────────────────────
def derivative_steps(expr, x, limit=40):
    steps = []

    def d(e, depth):
        if len(steps) > limit:
            return sp.diff(e, x)
        if not e.has(x):
            return sp.Integer(0)
        if e == x:
            return sp.Integer(1)
        slot = len(steps)
        steps.append(None)
        rule, rhs, result = None, None, None
        if e.is_Add:
            terms = list(e.args)
            parts = [d(t, depth + 1) for t in terms]
            result = sp.Add(*parts)
            rule = 'Sum rule: differentiate term by term'
            rhs = ' + '.join(_D(x, t) for t in terms)
        elif e.is_Mul:
            c, rest = e.as_independent(x, as_Add=False)
            num, den = sp.fraction(e)
            if c != 1:
                inner = d(rest, depth + 1)
                result = c * inner
                rule, rhs = 'Constant multiple rule', r'%s \cdot %s' % (_p(c), _D(x, rest))
            elif den.has(x) and den != 1 and num != 1:
                du, dv = d(num, depth + 1), d(den, depth + 1)
                result = (du * den - num * dv) / den ** 2
                rule = r"Quotient rule: (u/v)' = (u'v − uv')/v²"
                rhs = r'\frac{%s \cdot %s - %s \cdot %s}{%s^{2}}' % (_p(du), _p(den), _p(num), _p(dv), _p(den))
            else:
                u = e.args[0]
                v = sp.Mul(*e.args[1:])
                du, dv = d(u, depth + 1), d(v, depth + 1)
                result = du * v + u * dv
                rule = r"Product rule: (uv)' = u'v + uv'"
                rhs = r'%s \cdot %s + %s \cdot %s' % (_p(du), _p(v), _p(u), _p(dv))
        elif e.is_Pow:
            b, n = e.args
            if not n.has(x):
                inner = d(b, depth + 1) if b != x else sp.Integer(1)
                result = n * b ** (n - 1) * inner
                if n == sp.Rational(1, 2):
                    rule = 'Square root: d/du √u = 1/(2√u)' + (' with the chain rule' if b != x else '')
                else:
                    rule = 'Power rule: d/dx xⁿ = n·xⁿ⁻¹' + (' with the chain rule' if b != x else '')
                rhs = r'%s \cdot %s' % (_p(n * b ** (n - 1)), _D(x, b)) if b != x else tex(n * x ** (n - 1))
            elif not b.has(x):
                inner = d(n, depth + 1) if n != x else sp.Integer(1)
                result = e * sp.log(b) * inner
                rule = ('Exponential rule: d/dx aᵘ = aᵘ·ln a·u′' if b != sp.E else 'Exponential rule: d/dx eᵘ = eᵘ·u′')
                lead = tex(e) if b == sp.E else r'%s \ln %s' % (tex(e), _p(b))
                rhs = r'%s \cdot %s' % (lead, _D(x, n)) if n != x else lead
            else:
                inner = d(n * sp.log(b), depth + 1)
                result = e * inner
                rule = 'Logarithmic differentiation: y = uᵛ ⇒ y′ = y·(v ln u)′'
                rhs = r'%s \cdot %s' % (tex(e), _D(x, n * sp.log(b)))
        elif isinstance(e, sp.Function) and len(e.args) == 1:
            arg = e.args[0]
            u = sp.Dummy('u')
            outer = sp.diff(e.func(u), u)
            name = FN_NAMES.get(e.func.__name__, e.func.__name__)
            if arg == x:
                result = outer.subs(u, x)
                rule, rhs = 'Derivative of %s' % name, tex(result)
            else:
                inner = d(arg, depth + 1)
                result = outer.subs(u, arg) * inner
                rule = 'Chain rule: d/dx f(g(x)) = f′(g(x))·g′(x), derivative of %s' % name
                rhs = r'%s \cdot %s' % (_p(outer.subs(u, arg)), _D(x, arg))
        if result is None:
            result = sp.diff(e, x)
            rule, rhs = 'Differentiate', tex(result)
        shown = result if sp.count_ops(result) < 60 else sp.simplify(result)
        line = r'%s = %s' % (_D(x, e), rhs)
        if rhs != tex(shown):
            line += r' = %s' % tex(shown)
        steps[slot] = _st(depth, rule, line)
        return result

    raw = d(expr, 0)
    steps = [s for s in steps if s]
    final = sp.simplify(raw)
    if sp.count_ops(final) < sp.count_ops(raw) and final != raw:
        steps.append(_st(0, 'Simplify', r'%s = %s' % (tex(raw), tex(final))))
    return steps


# ── Limits ─────────────────────────────────────────────────────────────────
def limit_steps(f, x, a, direction):
    steps = []
    arrow = r'\lim_{%s \to %s%s}' % (tex(x), tex(a), '' if a.is_infinite or not direction else '^{%s}' % direction)
    try:
        if a.is_finite:
            direct = f.subs(x, a)
            if direct.is_finite and direct is not sp.nan and not direct.has(sp.zoo, sp.nan):
                steps.append(_st(0, 'Direct substitution (the function is continuous here)', r'%s %s = %s' % (arrow, tex(f), tex(sp.simplify(direct)))))
                return steps
        num, den = sp.fraction(sp.together(f))
        n0 = sp.limit(num, x, a, direction or '+')
        d0 = sp.limit(den, x, a, direction or '+')
        zero_zero = n0 == 0 and d0 == 0
        inf_inf = n0.is_infinite and d0.is_infinite
        if zero_zero or inf_inf:
            form = r'\frac{0}{0}' if zero_zero else r'\frac{\infty}{\infty}'
            steps.append(_st(0, 'Substituting gives an indeterminate form', form))
            polys = num.is_polynomial(x) and den.is_polynomial(x)
            if polys and zero_zero:
                fn, fd = sp.factor(num), sp.factor(den)
                g = sp.cancel(num / den)
                steps.append(_st(0, 'Factor numerator and denominator', r'\frac{%s}{%s}' % (tex(fn), tex(fd))))
                steps.append(_st(0, 'Cancel the common factor', tex(g)))
                val = g.subs(x, a)
                if val.is_finite:
                    steps.append(_st(0, 'Now substitute', r'%s %s = %s' % (arrow, tex(g), tex(sp.simplify(val)))))
                    return steps
            if polys and a.is_infinite:
                k = sp.degree(den, x)
                steps.append(_st(0, 'Divide numerator and denominator by %s' % plain(x ** k),
                                 r'\frac{%s}{%s}' % (tex(sp.expand(num / x ** k)), tex(sp.expand(den / x ** k)))))
                steps.append(_st(0, 'Terms with negative powers of %s vanish' % x.name, r'%s %s = %s' % (arrow, tex(f), tex(sp.limit(f, x, a)))))
                return steps
            n, dd = num, den
            for k in range(3):
                n, dd = sp.diff(n, x), sp.diff(dd, x)
                steps.append(_st(0, "L'Hôpital's rule: differentiate numerator and denominator", r'%s \frac{%s}{%s}' % (arrow, tex(n), tex(dd))))
                if a.is_finite:
                    nv, dv = n.subs(x, a), dd.subs(x, a)
                    if dv != 0 and dv.is_finite and nv.is_finite:
                        steps.append(_st(0, 'Substitute', r'\frac{%s}{%s} = %s' % (tex(nv), tex(dv), tex(sp.simplify(nv / dv)))))
                        return steps
                    if not (nv == 0 and dv == 0):
                        break
                else:
                    break
    except Exception:
        pass
    steps.append(_st(0, 'Evaluated exactly with the Gruntz algorithm', ''))
    return steps


# ── Equations ──────────────────────────────────────────────────────────────
def solve_steps(lhs, rhs, x):
    """Worked solution for the usual school cases; None for anything else."""
    try:
        e = sp.expand(lhs - rhs)
        steps = [_st(0, 'Move everything to one side', '%s = 0' % tex(e))] if rhs != 0 else []
        num, den = sp.fraction(sp.together(lhs - rhs))
        if den.has(x):
            steps = [_st(0, 'Combine into one fraction', r'\frac{%s}{%s} = 0' % (tex(sp.factor(num)), tex(sp.factor(den)))),
                     _st(0, 'A fraction is zero when its numerator is (and its denominator is not)', '%s = 0' % tex(sp.expand(num)))]
            e = sp.expand(num)
        if e.is_polynomial(x):
            p = sp.Poly(e, x)
            if any(c.has(x) for c in p.coeffs()):
                return None
            deg = p.degree()
            if deg == 1:
                a, b = p.all_coeffs()
                steps.append(_st(0, 'Isolate the %s term' % x.name, '%s = %s' % (tex(a * x), tex(-b))))
                if a != 1:
                    steps.append(_st(0, 'Divide both sides by %s' % plain(a), '%s = %s' % (tex(x), tex(sp.simplify(-b / a)))))
                return steps
            if deg == 2:
                a, b, c = p.all_coeffs()
                fac = sp.factor(e)
                if fac.is_Mul and sum(1 for f in sp.Mul.make_args(fac) if f.has(x)) >= 2:
                    steps.append(_st(0, 'Factor', '%s = 0' % tex(fac)))
                    steps.append(_st(0, 'A product is zero when one of its factors is zero',
                                     r',\quad '.join('%s = 0' % tex(f) for f in sp.Mul.make_args(fac) if f.has(x))))
                    return steps
                disc = sp.simplify(b ** 2 - 4 * a * c)
                steps.append(_st(0, 'Quadratic with a = %s, b = %s, c = %s' % (plain(a), plain(b), plain(c)), ''))
                steps.append(_st(0, 'Discriminant', r'\Delta = b^2 - 4ac = %s' % tex(disc)))
                if disc.is_negative:
                    steps.append(_st(0, 'Δ < 0: no real roots; the roots are complex conjugates', ''))
                steps.append(_st(0, 'Quadratic formula', r'%s = \frac{-b \pm \sqrt{\Delta}}{2a} = \frac{%s \pm \sqrt{%s}}{%s}' % (tex(x), tex(-b), tex(disc), tex(2 * a))))
                return steps
            if deg >= 3:
                fac = sp.factor(e)
                if fac != e:
                    steps.append(_st(0, 'Factor', '%s = 0' % tex(fac)))
                    steps.append(_st(0, 'Set each factor to zero', r',\quad '.join('%s = 0' % tex(f) for f in sp.Mul.make_args(fac) if f.has(x))))
                elif deg >= 5:
                    steps.append(_st(0, 'Irreducible of degree %d: by Abel–Ruffini there is no general formula in radicals; roots are given exactly as CRootOf and numerically' % deg, ''))
                return steps
        # a single radical: isolate it and square
        rads = [r for r in sp.preorder_traversal(lhs - rhs) if r.is_Pow and r.exp == sp.Rational(1, 2) and r.base.has(x)]
        if len(rads) == 1:
            r = rads[0]
            rest = sp.expand((lhs - rhs) - (lhs - rhs).coeff(r) * r)
            k = (lhs - rhs).coeff(r)
            if k != 0 and not rest.has(r):
                iso = sp.Eq(r, sp.simplify(-rest / k))
                steps = [_st(0, 'Isolate the square root', tex(iso))]
                sq = sp.Eq(sp.expand(r.base), sp.expand(iso.rhs ** 2))
                steps.append(_st(0, 'Square both sides', tex(sq)))
                cands = sp.solve(sq.lhs - sq.rhs, x)
                steps.append(_st(0, 'Solve the squared equation', r',\quad '.join('%s = %s' % (tex(x), tex(c)) for c in cands)))
                for c in cands:
                    l, r_ = sp.simplify(lhs.subs(x, c)), sp.simplify(rhs.subs(x, c))
                    ok = sp.simplify(l - r_) == 0
                    steps.append(_st(1, 'Check %s = %s: %s' % (x.name, plain(c), 'satisfies the equation' if ok else 'extraneous (introduced by squaring), discard'),
                                     r'%s %s %s' % (tex(l), '=' if ok else r'\ne', tex(r_))))
                return steps
        # a^(f(x)) = c, e^(f(x)) = c
        if lhs.is_Pow and not lhs.base.has(x) and lhs.exp.has(x) and not rhs.has(x):
            steps = [_st(0, 'Take the logarithm of both sides', r'%s \ln %s = \ln %s' % (_p(lhs.exp), _p(lhs.base), _p(rhs)) if lhs.base != sp.E else r'%s = \ln %s' % (tex(lhs.exp), _p(rhs)))]
            return steps
    except Exception:
        return None
    return None


def inequality_steps(rel, x, s):
    """Critical points and a sign table for a polynomial or rational inequality."""
    try:
        e = sp.together(rel.lhs - rel.rhs)
        num, den = sp.fraction(e)
        if not (num.is_polynomial(x) and den.is_polynomial(x)):
            return None
        crit = sorted(set(sp.real_roots(sp.Poly(num, x))) | set(sp.real_roots(sp.Poly(den, x)) if den.has(x) else set()), key=lambda r: float(r))
        steps = [_st(0, 'Compare with zero', r'%s %s 0' % (tex(sp.factor(e)), {'<': '<', '>': '>', '<=': r'\le', '>=': r'\ge'}[rel.rel_op]))]
        if not crit:
            return steps + [_st(0, 'No critical points: the sign is the same everywhere', '')]
        steps.append(_st(0, 'Critical points (zeros of numerator and denominator)', r',\ '.join(tex(c) for c in crit)))
        pts = [crit[0] - 1] + [(p + q) / 2 for p, q in zip(crit, crit[1:])] + [crit[-1] + 1]
        cells = []
        for t in pts:
            v = e.subs(x, t)
            cells.append(r'%s = %s: \ %s' % (tex(x), tex(t), '+' if v > 0 else '-'))
        steps.append(_st(0, 'Sign in each interval', r'\begin{array}{l}%s\end{array}' % r'\\'.join(cells)))
        return steps
    except Exception:
        return None


# ── Factoring ──────────────────────────────────────────────────────────────
def factor_steps(e, result):
    try:
        x = sorted(e.free_symbols, key=str)
        if len(x) != 1:
            return []
        x = x[0]
        p = sp.Poly(sp.expand(e), x)
        steps = []
        content, prim = p.primitive()
        mono = min(m[0] for m in p.monoms()) if p.monoms() else 0
        common = content * x ** mono
        if common != 1:
            steps.append(_st(0, 'Take out the common factor %s' % plain(common), r'%s \left(%s\right)' % (tex(common), tex(sp.expand(e / common)))))
        rest = sp.expand(e / common)
        q = sp.Poly(rest, x)
        cs = q.all_coeffs()
        if q.degree() == 2 and cs[1] == 0 and cs[0] > 0 and cs[2] < 0 and all(sp.sqrt(abs(c)).is_rational for c in (cs[0], cs[2])):
            A, B = sp.sqrt(cs[0]), sp.sqrt(-cs[2])
            steps.append(_st(0, 'Difference of squares: a² − b² = (a − b)(a + b)', r'(%s)^2 - (%s)^2' % (tex(A * x), tex(B))))
        elif q.degree() == 3 and cs[1] == 0 and cs[2] == 0 and sp.cbrt(abs(cs[0])).is_rational and sp.cbrt(abs(cs[3])).is_rational:
            steps.append(_st(0, 'Sum or difference of cubes: a³ ± b³ = (a ± b)(a² ∓ ab + b²)', ''))
        elif q.degree() == 2:
            a, b, c = cs
            if sp.sqrt(b ** 2 - 4 * a * c).is_rational:
                r1, r2 = sp.roots(q, multiple=True) or [None, None]
                if r1 is not None:
                    lead = '' if a == 1 else _p(a) + r'\,'
                    steps.append(_st(0, 'The quadratic has rational roots %s and %s' % (plain(r1), plain(r2)),
                                     r'%s = %s(%s - %s)(%s - %s)' % (tex(rest), lead, tex(x), _p(r1), tex(x), _p(r2))))
        elif q.degree() >= 3:
            rr = [r for r in sp.roots(q, filter='Q')]
            if rr:
                steps.append(_st(0, 'Rational root test finds %s' % ', '.join('%s = %s' % (x, plain(r)) for r in rr),
                                 r',\ '.join('(%s - %s)' % (tex(x), _p(r)) for r in rr) + r'\ \text{divide}\ %s' % tex(rest)))
            else:
                steps.append(_st(0, 'Factor over the rationals (Berlekamp–Zassenhaus)', ''))
        steps.append(_st(0, 'Factored form', tex(result)))
        return steps
    except Exception:
        return []


# ── Integrals: render SymPy's rule tree with the substitution details ──────
def integral_steps_list(f, x):
    try:
        from sympy.integrals.manualintegrate import integral_steps
        root = integral_steps(f, x)
    except Exception:
        return []
    out = []

    def walk(rule, depth):
        if rule is None or depth > 10 or len(out) >= 30 or not is_dataclass(rule):
            return
        name = type(rule).__name__
        if name == 'AlternativeRule' and getattr(rule, 'alternatives', None):
            walk(rule.alternatives[0], depth)
            return
        desc = RULE_TEXT.get(name, _camel(name))
        try:
            if name == 'URule':
                u = sp.Symbol('u')
                desc = 'Substitute u = %s, du = %s dx' % (plain(rule.u_func), plain(sp.diff(rule.u_func, rule.variable)))
            elif name == 'PartsRule':
                desc = 'Integration by parts with u = %s, dv = %s dx (so du = %s dx, v = %s)' % (
                    plain(rule.u), plain(rule.dv), plain(sp.diff(rule.u, rule.variable)), plain(sp.integrate(rule.dv, rule.variable)))
            elif name == 'RewriteRule':
                desc += ' as  %s' % plain(rule.rewritten)
        except Exception:
            pass
        try:
            res = rule.eval()
            t = r'\int %s \, d%s = %s' % (tex(rule.integrand), tex(rule.variable), tex(res))
        except Exception:
            t = r'\int %s \, d%s' % (tex(rule.integrand), tex(rule.variable))
        out.append(_st(depth, desc, t))
        for fld in fields(rule):
            v = getattr(rule, fld.name, None)
            if is_dataclass(v) and hasattr(v, 'integrand'):
                walk(v, depth + 1)
            elif isinstance(v, (list, tuple)):
                for item in v:
                    if is_dataclass(item) and hasattr(item, 'integrand'):
                        walk(item, depth + 1)

    walk(root, 0)
    seen, uniq = set(), []
    for st in out:          # the same sub-integral can appear twice in a rule tree (e.g. parts)
        if (st['d'], st['tex']) not in seen:
            seen.add((st['d'], st['tex']))
            uniq.append(st)
    out = uniq
    if out and not any('DontKnow' in s['d'] or 'No elementary rule' in s['d'] for s in out):
        out.append(_st(0, 'Add the constant of integration', '+ C'))
    return out


def diff_steps_list(e, x):
    return derivative_steps(e, x)


# Hook the worked solutions into the bridge's operations.
worked_equation = solve_steps
worked_inequality = inequality_steps
worked_factor = factor_steps
