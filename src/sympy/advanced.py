"""CassyCAS advanced tools: number fields, Galois groups, lattices, holonomic functions,
Z-transforms, optimisation, signals, stochastic calculus, tensors, differential forms,
differential elimination, quantum circuits, knots, interval arithmetic and proofs.

Runs after bridge.py and tools.py in the same namespace (show, tex, plain, value, verdict,
TOOLS, RAW_TOOLS, … are already defined) and registers more entries in TOOLS / RAW_TOOLS.
Every result that can be checked independently carries a verdict.
"""
import itertools
import math
import re

import mpmath


# ── helpers ─────────────────────────────────────────────────────────────────
def _primes(text):
    """Derivative(y(x), x) → y'(x), Derivative(y(x), (x, 2)) → y''(x) in plain output."""
    text = re.sub(r"Derivative\((\w+)\((\w+)\), \(\2, (\d+)\)\)", lambda m: "%s%s(%s)" % (m.group(1), "'" * int(m.group(3)), m.group(2)), text)
    return re.sub(r"Derivative\((\w+)\((\w+)\), \2\)", r"\1'(\2)", text)


def _poly_var(p, x=None):
    if x is not None:
        return _syms(x)[0]
    fs = sorted(p.free_symbols, key=lambda s: s.name)
    if len(fs) != 1:
        raise ValueError('Name the variable, e.g. galois(x^4 - 2, x)')
    return fs[0]


def _tuple(v):
    """A list argument (sent as __list(...) or [...]) as a Python list."""
    if isinstance(v, (sp.Tuple, list, tuple)):
        return list(v)
    if isinstance(v, sp.MatrixBase):
        return list(v)
    return [v]


def _rows(M):
    if not isinstance(M, sp.MatrixBase):
        raise ValueError('Expected a matrix, e.g. [[1, 0], [0, 1]]')
    return M


def _laurent_tex(e, t):
    """A Laurent polynomial in t, highest power first."""
    e = sp.expand(e)
    terms = sorted(sp.Add.make_args(e), key=lambda term: -sp.Poly(term * t ** 50, t).degree() if term.has(t) else 50)
    p = sp.Add(*terms, evaluate=False)
    return sp.latex(p, order='none'), plain(p)


# ══ 3.3 number fields ═══════════════════════════════════════════════════════
def t_minpoly(alpha, x=None):
    x = _syms(x)[0] if x is not None else sp.Symbol('x')
    if alpha.free_symbols - {x}:
        raise ValueError('minpoly needs an algebraic number such as sqrt(2) + sqrt(3)')
    p = sp.minimal_polynomial(alpha, x)
    val = _cnum(p.subs(x, alpha), 60)
    check = verdict(val is not None and abs(val) < 1e-40, 'the polynomial vanishes at the number (60 digits)') if val is not None else None
    steps = [{'d': 'Degree of the field extension', 'tex': r'[\mathbb{Q}(%s):\mathbb{Q}] = %d' % (tex(alpha), sp.degree(p, x))}]
    return {'value': value(p), 'steps': steps, 'check': check,
            'prefix': r'\operatorname{minpoly}_{\mathbb{Q}}\left(%s\right) = ' % tex(alpha)}


def t_nfactor(p, alpha):
    """Factor over Q(alpha)."""
    gens = [a for a in _tuple(alpha)]
    r = sp.factor(p, extension=gens)
    ok = numerically_equal(sp.expand(r), sp.expand(p))
    return {'value': value(r), 'check': verdict(ok, 'the factors multiply back to the polynomial') if ok is not None else None,
            'prefix': r'\text{over } \mathbb{Q}(%s):\ ' % r',\,'.join(tex(g) for g in gens)}


GROUP_NAMES = {
    'S1': 'trivial group', 'S2': 'S₂ ≅ C₂', 'S3': 'S₃', 'A3': 'A₃ ≅ C₃', 'C4': 'C₄ (cyclic)', 'V': 'V₄ (Klein four)',
    'D4': 'D₄ (dihedral, order 8)', 'A4': 'A₄', 'S4': 'S₄', 'C5': 'C₅ (cyclic)', 'D5': 'D₅ (dihedral, order 10)',
    'M20': 'F₂₀ (Frobenius, order 20)', 'A5': 'A₅', 'S5': 'S₅', 'C6': 'C₆ (cyclic)', 'S3': 'S₃',
}


def t_galois(p, x=None):
    x = _poly_var(p, x)
    P = sp.Poly(p, x, domain='QQ')
    if P.degree() < 1:
        raise ValueError('Expected a non-constant polynomial')
    if not P.is_irreducible:
        facs = sp.factor_list(p, x)[1]
        raise ValueError('The polynomial is reducible: %s. Use galois on an irreducible factor.' % ' · '.join(plain(f) for f, _ in facs))
    if P.degree() > 6:
        raise ValueError('Galois groups are computed for degree ≤ 6')
    from sympy.polys.numberfields.galoisgroups import galois_group
    G, alt = galois_group(P, by_name=True)
    perm = G.get_perm_group()
    order = perm.order()
    key = G.name.split('.')[-1] if hasattr(G, 'name') else str(G).split('.')[-1]
    name = GROUP_NAMES.get(key, key)
    solvable = perm.is_solvable
    disc = sp.discriminant(p, x)
    steps = [{'d': 'Irreducible over ℚ, degree %d' % P.degree(), 'tex': ''},
             {'d': 'Discriminant', 'tex': r'\Delta = %s%s' % (tex(disc), r'\ (\text{a square: the group lies in } A_n)' if alt else '')},
             {'d': 'Order of the Galois group = degree of the splitting field', 'tex': r'|G| = %d' % order}]
    words = '%s, order %d — %s' % (name, order, 'solvable: the roots can be written with radicals' if solvable
                                     else 'not solvable: the roots cannot be written with radicals')
    gtex = 'V_4' if key == 'V' else 'F_{20}' if key == 'M20' else re.sub(r'([A-Z])(\d+)', r'\1_{\2}', key)
    return show(r'\operatorname{Gal}\left(%s\right) \cong %s,\quad |G| = %d\quad \text{(%s)}' % (
        tex(p), gtex, order, 'solvable by radicals' if solvable else 'not solvable by radicals'),
        'Gal = ' + words, steps)


# ══ 10.8 lattices ═══════════════════════════════════════════════════════════
def t_lll(B):
    B = _rows(B)
    if not all(e.is_Integer for e in B):
        raise ValueError('LLL works on integer bases, e.g. lll([[1, 0, 3], [0, 1, 5]])')
    from sympy.polys.matrices import DomainMatrix
    D = DomainMatrix.from_Matrix(B).convert_to(sp.ZZ)
    R, T = D.lll_transform()
    R, T = R.to_Matrix(), T.to_Matrix()
    same = T * B == R and abs(T.det()) == 1
    norms = [sp.sqrt(sum(c ** 2 for c in R.row(i))) for i in range(R.rows)]
    steps = [{'d': 'Unimodular change of basis T (det ±1), reduced = T·B', 'tex': 'T = %s' % tex(T)},
             {'d': 'Lengths of the reduced vectors', 'tex': r',\ '.join(tex(n) for n in norms)}]
    return {'value': value(R), 'steps': steps,
            'check': verdict(same, 'T·B equals the reduced basis and det T = ±1, so both span the same lattice'),
            'prefix': r'\operatorname{LLL}\left(%s\right) = ' % tex(B)}


# ══ 10.4 holonomic functions ════════════════════════════════════════════════
def t_holonomic(f, x):
    x = _syms(x)[0]
    from sympy.holonomic import expr_to_holonomic
    h = expr_to_holonomic(f, x)
    ann = h.annihilator
    y = sp.Function('y')(x)
    coeffs = [ann.parent.base.to_sympy(c) for c in ann.listofpoly]
    ode = sum(c * (y.diff(x, k) if k else y) for k, c in enumerate(coeffs))
    applied = sp.simplify(ode.subs(y, f).doit())
    steps = []
    if h.y0:
        x0 = h.x0
        y0 = h.y0 if isinstance(h.y0, list) else list(h.y0.values())[0] if isinstance(h.y0, dict) else [h.y0]
        steps.append({'d': 'Initial conditions at %s = %s' % (x, plain(x0)),
                      'tex': r',\ '.join('y%s(%s) = %s' % ("'" * k, tex(x0), tex(v)) for k, v in enumerate(y0))})
    try:
        seq = h.to_sequence()[0][0]
        nn = seq.n
        u = sp.Function('u')
        rec = sum(seq.recurrence.parent.base.to_sympy(c) * u(nn + k) for k, c in enumerate(seq.recurrence.listofpoly))
        steps.append({'d': 'Recurrence for the Taylor coefficients u(n)', 'tex': '%s = 0' % tex(sp.expand(rec))})
    except Exception:
        pass
    return {'display': {'latex': '%s = 0' % tex(ode), 'plain': '%s = 0' % _primes(plain(ode))}, 'steps': steps,
            'check': verdict(applied == 0, 'substituting the function into the equation gives 0')}


# ══ 2.5 Z-transform ═════════════════════════════════════════════════════════
def _z_series_check(f, n, F, z, terms=6):
    """F(z) = Σ f(n) z^−n: compare the expansion of F in 1/z with f(0), f(1), …"""
    w = sp.Dummy('w')
    try:
        s = sp.series(F.subs(z, 1 / w), w, 0, terms).removeO()
        for k in range(terms):
            a = s.coeff(w, k) if k else s.subs(w, 0)
            b = f.subs(n, k)
            if numerically_equal(sp.sympify(a), sp.sympify(b)) is False:
                return verdict(False, 'the expansion of F(z) in 1/z disagrees with f(%d)' % k)
        return verdict(True, 'the expansion of F(z) in powers of 1/z reproduces f(0), …, f(%d)' % (terms - 1))
    except Exception:
        return None


def t_ztrans(f, n, z):
    n, z = _syms(n)[0], _syms(z)[0]
    k = sp.Dummy('k', integer=True, nonnegative=True)
    r = sp.summation(f.subs(n, k) * z ** (-k), (k, 0, sp.oo))
    cond = None
    if isinstance(r, sp.Piecewise):
        r, cond = r.args[0].expr, r.args[0].cond
    if r.has(sp.Sum):
        raise ValueError('No closed form found for this Z-transform')
    r = _tidy(sp.simplify(r))
    out = {'value': value(r), 'check': _z_series_check(f, n, r, z),
           'prefix': r'\mathcal{Z}\left\{%s\right\}(%s) = ' % (tex(f), tex(z))}
    if cond is not None and cond is not sp.true:
        out['steps'] = [{'d': 'Region of convergence', 'tex': tex(cond)}]
    return out


def _real_powers(f, n):
    """Complex roots come in conjugate pairs: write a^n = |a|^n (cos nθ + i sin nθ) so that
    i(−iⁿ + (−i)ⁿ)/2 becomes sin(πn/2)."""
    if not f.has(sp.I):
        return f
    N = sp.Symbol(n.name, integer=True, nonnegative=True)
    g = f.subs(n, N).replace(
        lambda e: e.is_Pow and e.exp.has(N) and e.base.is_number and not e.base.is_real,
        lambda e: sp.Abs(e.base) ** e.exp * (sp.cos(sp.arg(e.base) * e.exp) + sp.I * sp.sin(sp.arg(e.base) * e.exp)))
    g = sp.simplify(sp.expand(g))
    return g.subs(N, n) if not g.has(sp.I) else f


def t_iztrans(F, z, n):
    z, n = _syms(z)[0], _syms(n)[0]
    F = sp.together(F)
    num, den = sp.fraction(F)
    if not (num.is_polynomial(z) and den.is_polynomial(z)):
        raise ValueError('iztrans works on rational functions of z')
    if sp.degree(num, z) > sp.degree(den, z):
        raise ValueError('F(z) grows faster than z: not the transform of a causal sequence')
    G = sp.apart(sp.cancel(F / z), z, full=True).doit()
    f = sp.Integer(0)
    for term in sp.Add.make_args(G):
        c, rest = term.as_independent(z)
        if rest.is_Pow and rest.exp.is_Integer and rest.exp < 0:
            b, k = rest.base, int(-rest.exp)
        elif rest.is_Pow or rest.is_Symbol or rest.is_Add:
            raise ValueError('F(z) grows faster than z: not the transform of a causal sequence')
        else:
            raise ValueError('Could not invert this term: %s' % plain(term))
        P = sp.Poly(b, z)
        if P.degree() != 1:
            raise ValueError('Could not invert this term: %s' % plain(term))
        lc = P.LC()
        a, c = -P.nth(0) / lc, c / lc ** k          # c / (lc (z − a))^k
        if a == 0:
            # c / z^k in F/z  →  c z^(1−k) in F  →  c δ(n − (k − 1))
            f += c * sp.KroneckerDelta(n, k - 1)
        else:
            # c z / (z − a)^k  →  c C(n, k−1) a^(n−k+1)
            f += c * sp.binomial(n, k - 1) * a ** (n - k + 1)
    f = _real_powers(sp.simplify(f), n)
    if f.has(sp.binomial):
        f = sp.simplify(sp.expand_func(f))
    check = _z_series_check(f, n, F, z)
    return {'value': value(f), 'check': check, 'prefix': r'\mathcal{Z}^{-1}\left\{%s\right\}(%s) = ' % (tex(F), tex(n)),
            'steps': [{'d': 'Partial fractions of F(z)/z', 'tex': r'\frac{F(z)}{z} = %s' % tex(G)},
                      {'d': 'Table: z/(z − a) ↔ aⁿ, z/(z − a)ᵏ ↔ C(n, k−1) aⁿ⁻ᵏ⁺¹, constant ↔ δ(n)', 'tex': ''}]}


TOOLS.update({
    'minpoly': t_minpoly, 'nfactor': t_nfactor, 'galois': t_galois, 'lll': t_lll, 'holonomic': t_holonomic,
    'ztrans': t_ztrans, 'iztrans': t_iztrans,
})


# ══ 2.7 optimisation ════════════════════════════════════════════════════════
def _is_linear(e, vs):
    try:
        return sp.Poly(e, *vs).total_degree() <= 1
    except Exception:
        return False


def _simp(e):
    """The most compact of simplify / trigsimp / factor (sin(2θ)/(2 tan θ) − cos 2θ → sin²θ)."""
    cands = [e]
    for f in (sp.simplify, sp.trigsimp, lambda t: sp.factor(sp.trigsimp(t)), lambda t: sp.trigsimp(sp.expand_trig(t))):
        try:
            cands.append(f(e))
        except Exception:
            pass
    return min(cands, key=lambda c: (sp.count_ops(c), len(str(c))))


def _relations(cons):
    out = []
    for c in cons:
        if isinstance(c, sp.Equality) or isinstance(c, sp.core.relational.Relational):
            out.append(c)
        elif c in (sp.true, sp.false):
            raise ValueError('A constraint is always %s' % ('true' if c == sp.true else 'false'))
        else:
            out.append(sp.Eq(c, 0))
    return out


def _value_at(f, pt):
    return sp.nsimplify(sp.simplify(f.subs(pt)))


def _optimise(f, spec, vs, sense):
    """Global extremum of f. spec: a variable (unconstrained), [x, a, b] (closed interval) or a
    list of constraints (equalities → Lagrange multipliers, linear → simplex)."""
    items = _tuple(spec)
    word = 'maximum' if sense > 0 else 'minimum'
    better = (lambda a, b: a > b) if sense > 0 else (lambda a, b: a < b)
    steps = []
    # closed interval [x, a, b]
    if len(items) == 3 and isinstance(items[0], sp.Symbol) and items[1].is_number and items[2].is_number:
        x, a, b = items
        crit = [c for c in sp.solveset(sp.diff(f, x), x, sp.Interval(a, b)) if c.is_real] \
            if isinstance(sp.solveset(sp.diff(f, x), x, sp.Interval(a, b)), sp.FiniteSet) else None
        if crit is None:
            raise ValueError("Could not find all critical points of f'(%s) = 0 on the interval" % x)
        cands = [a, b] + crit
        vals = [(c, sp.simplify(f.subs(x, c))) for c in cands]
        steps.append({'d': 'Closed interval method: compare f at the endpoints and critical points',
                      'tex': r',\ '.join(r'f(%s) = %s' % (tex(c), tex(v)) for c, v in vals)})
        best = vals[0]
        for c, v in vals[1:]:
            if better(float(v), float(best[1])):
                best = (c, v)
        return show(r'\%s_{%s \in [%s,\,%s]} %s = %s \quad\text{at } %s = %s' % (
            'max' if sense > 0 else 'min', tex(x), tex(a), tex(b), tex(f), tex(best[1]), tex(x), tex(best[0])),
            '%s %s at %s = %s' % (word, plain(best[1]), x, plain(best[0])), steps,
            check=verdict(True, 'compared f at every critical point and both endpoints'))
    cons = [c for c in items if not isinstance(c, sp.Symbol)]
    if not cons:
        x = items[0] if items and isinstance(items[0], sp.Symbol) else _poly_var(f)
        vs = vs or [x]
    vs = vs or sorted(set().union(f.free_symbols, *(c.free_symbols for c in cons)), key=lambda s: s.name)
    rels = _relations(cons)
    # linear programme
    if rels and _is_linear(f, vs) and all(_is_linear(r.lhs - r.rhs, vs) for r in rels):
        from sympy.solvers.simplex import lpmax, lpmin, InfeasibleLPError, UnboundedLPError
        try:
            val, pt = (lpmax if sense > 0 else lpmin)(f, rels)
        except InfeasibleLPError:
            return show(r'\text{infeasible: no point satisfies every constraint}', 'infeasible', steps)
        except UnboundedLPError:
            return show(r'\text{unbounded: the %s is not attained}' % word, 'unbounded', steps)
        pt = {k: v for k, v in pt.items()}
        feasible = all(bool(r.subs(pt)) for r in rels)
        steps.append({'d': 'Linear programme solved exactly by the simplex method', 'tex': ''})
        return show(r'\%s %s = %s\quad\text{at } %s' % ('max' if sense > 0 else 'min', tex(f), tex(val),
                                                       r',\ '.join('%s = %s' % (tex(k), tex(pt[k])) for k in vs if k in pt)),
                    '%s %s at %s' % (word, plain(val), ', '.join('%s = %s' % (k, plain(pt[k])) for k in vs if k in pt)),
                    steps, check=verdict(feasible, 'the optimal point satisfies every constraint'))
    eqs = [r for r in rels if isinstance(r, sp.Equality)]
    if len(eqs) != len(rels):
        raise ValueError('Nonlinear inequality constraints are not supported; use equalities (Lagrange) or a linear programme')
    if not eqs:
        # unconstrained: critical points, classified by the second-derivative test
        grad = [sp.diff(f, v) for v in vs]
        sols = sp.solve(grad, vs, dict=True)
        if not sols:
            return show(r'\text{no critical points: no %s}' % word, 'no critical points', steps)
        vals = [(s, sp.simplify(f.subs(s))) for s in sols if all(sp.sympify(v).is_real for v in s.values())]
        steps.append({'d': 'Critical points (∇f = 0)', 'tex': r';\ '.join(
            r',\ '.join('%s = %s' % (tex(k), tex(v)) for k, v in s.items()) + r':\ f = %s' % tex(val) for s, val in vals)})
        best = None
        for s, val in vals:
            if best is None or better(float(val), float(best[1])):
                best = (s, val)
        # is it global? compare with f far away (a coarse but honest check)
        far = [f.subs({v: sp.Integer(10) ** 6 * sgn for v in vs}) for sgn in (1, -1)]
        unbounded = any(fv.is_number and better(float(fv), float(best[1])) for fv in far)
        tag = r'\quad\text{(local; f is unbounded, so there is no global %s)}' % word if unbounded else ''
        return show(r'%s = %s\quad\text{at } %s%s' % (word, tex(best[1]), r',\ '.join('%s = %s' % (tex(k), tex(v)) for k, v in best[0].items()), tag),
                    '%s %s at %s%s' % (word, plain(best[1]), ', '.join('%s = %s' % (k, plain(v)) for k, v in best[0].items()),
                                       ' (local; no global %s)' % word if unbounded else ''), steps)
    # Lagrange multipliers
    lams = [sp.Symbol('lambda%d' % (i + 1) if len(eqs) > 1 else 'lambda') for i in range(len(eqs))]
    gs = [e.lhs - e.rhs for e in eqs]
    L = f - sum(l * g for l, g in zip(lams, gs))
    system = [sp.diff(L, v) for v in vs] + gs
    steps.append({'d': 'Lagrange conditions ∇f = Σ λᵢ∇gᵢ, gᵢ = 0', 'tex': r',\ '.join('%s = 0' % tex(e) for e in system)})
    sols = sp.solve(system, vs + lams, dict=True)
    pts = [s for s in sols if all(sp.sympify(s.get(v, 0)).is_real for v in vs)]
    if not pts:
        return show(r'\text{no real critical points on the constraint}', 'no critical points', steps)
    vals = [(s, sp.simplify(f.subs({v: s[v] for v in vs}))) for s in pts]
    steps.append({'d': 'Candidates', 'tex': r';\ '.join(r',\ '.join('%s = %s' % (tex(v), tex(s[v])) for v in vs) + r':\ f = %s' % tex(val) for s, val in vals)})
    best = vals[0]
    for s, val in vals[1:]:
        if better(float(val), float(best[1])):
            best = (s, val)
    on = all(sp.simplify(g.subs({v: best[0][v] for v in vs})) == 0 for g in gs)
    where = r',\ '.join('%s = %s' % (tex(v), tex(best[0][v])) for v in vs)
    return show(r'%s = %s\quad\text{at } %s' % (word, tex(best[1]), where),
                '%s %s at %s' % (word, plain(best[1]), ', '.join('%s = %s' % (v, plain(best[0][v])) for v in vs)), steps,
                check=verdict(on, 'the point satisfies every constraint; compared f at all Lagrange candidates'))


def t_maximize(f, spec, vs=None):
    return _optimise(f, spec, _syms(vs) if vs is not None else None, 1)


def t_minimize(f, spec, vs=None):
    return _optimise(f, spec, _syms(vs) if vs is not None else None, -1)


def t_lagrange(f, cons, vs):
    vs = _syms(vs)
    cons = _tuple(cons)
    gs = [c.lhs - c.rhs if isinstance(c, sp.Equality) else c for c in cons]
    lams = [sp.Symbol('lambda%d' % (i + 1) if len(gs) > 1 else 'lambda') for i in range(len(gs))]
    L = f - sum(l * g for l, g in zip(lams, gs))
    system = [sp.diff(L, v) for v in vs] + gs
    sols = sp.solve(system, vs + lams, dict=True)
    if not sols:
        return show(r'\text{no solutions of the Lagrange system}', 'no critical points', [])
    rows = []
    for s in sols:
        fv = sp.simplify(f.subs({v: s[v] for v in vs if v in s}))
        rows.append((s, fv))
    ok = all(sp.simplify(g.subs({v: s[v] for v in vs if v in s})) == 0 for s, _ in rows for g in gs)
    return show(r'\mathcal{L} = %s:\quad ' % tex(L) + r';\quad '.join(
        r',\ '.join('%s = %s' % (tex(k), tex(s[k])) for k in vs + lams if k in s) + r'\ \Rightarrow\ f = %s' % tex(fv) for s, fv in rows),
        '; '.join(', '.join('%s = %s' % (k, plain(s[k])) for k in vs + lams if k in s) + ' => f = %s' % plain(fv) for s, fv in rows),
        [{'d': 'Stationary points of the Lagrangian', 'tex': r',\ '.join('%s = 0' % tex(e) for e in system)}],
        check=verdict(ok, 'every point satisfies the constraints'))


# ══ 2.8 signal processing ═══════════════════════════════════════════════════
def t_convolve(f, g, t=None):
    if isinstance(f, sp.MatrixBase) and isinstance(g, sp.MatrixBase):
        a, b = list(f), list(g)
        out = [sum(a[i] * b[k - i] for i in range(len(a)) if 0 <= k - i < len(b)) for k in range(len(a) + len(b) - 1)]
        ok = sp.expand(sum(c * sp.Symbol('q') ** i for i, c in enumerate(out)) -
                       sum(c * sp.Symbol('q') ** i for i, c in enumerate(a)) * sum(c * sp.Symbol('q') ** i for i, c in enumerate(b))) == 0
        return {'value': value(sp.Matrix([out])), 'check': verdict(ok, 'equals the coefficients of the product of the generating polynomials'),
                'prefix': r'%s * %s = ' % (tex(sp.Matrix([a])), tex(sp.Matrix([b])))}
    t = _syms(t)[0] if t is not None else sp.Symbol('t')
    tau = sp.Symbol('tau', positive=True)
    tp = sp.Symbol(t.name, positive=True)
    r = sp.integrate(f.subs(t, tau) * g.subs(t, tp - tau), (tau, 0, tp))
    r = _tidy(sp.simplify(r)).subs(tp, t)
    check = None
    try:
        s = sp.Symbol('s', positive=True)
        L = lambda e: sp.laplace_transform(e, t, s, noconds=True)
        lhs, rhs = L(r), sp.simplify(L(f) * L(g))
        if not lhs.has(sp.LaplaceTransform) and not rhs.has(sp.LaplaceTransform):
            check = verdict(numerically_equal(lhs, rhs, [s]) is not False, 'ℒ{f∗g} = ℒ{f}·ℒ{g} (convolution theorem)')
    except Exception:
        pass
    return {'value': value(r), 'check': check,
            'prefix': r'(f * g)(%s) = \int_0^{%s} %s\, d\tau = ' % (tex(t), tex(t), tex(f.subs(t, sp.Symbol('tau')) * g.subs(t, t - sp.Symbol('tau'))))}


def _dft(xs, sign):
    N = len(xs)
    w = sp.exp(sign * 2 * sp.pi * sp.I / N)
    return [sp.nsimplify(sp.simplify(sp.expand_complex(sum(xs[n] * w ** (k * n) for n in range(N))))) for k in range(N)]


def t_dft(v):
    xs = list(v)
    if len(xs) > 64:
        raise ValueError('Exact DFT is limited to 64 samples')
    X = _dft(xs, -1)
    back = [sp.simplify(c / len(xs)) for c in _dft(X, 1)]
    ok = all(sp.simplify(a - b) == 0 for a, b in zip(back, xs))
    return {'value': value(sp.Matrix([X])), 'check': verdict(ok, 'the inverse DFT gives back the samples'),
            'prefix': r'X_k = \sum_{n=0}^{%d} x_n e^{-2\pi i k n / %d} = ' % (len(xs) - 1, len(xs))}


def t_idft(v):
    X = list(v)
    if len(X) > 64:
        raise ValueError('Exact DFT is limited to 64 samples')
    xs = [sp.simplify(c / len(X)) for c in _dft(X, 1)]
    ok = all(sp.simplify(a - b) == 0 for a, b in zip(_dft(xs, -1), X))
    return {'value': value(sp.Matrix([xs])), 'check': verdict(ok, 'the DFT of the result gives back the input')}


def t_bode(H, s=None):
    s = _syms(s)[0] if s is not None else sp.Symbol('s')
    w = sp.Symbol('omega', positive=True)
    u = sp.Symbol('u', real=True)
    Hw = sp.together(H.subs(s, sp.I * w))
    mag2 = sp.simplify(sp.expand_complex(Hw * sp.conjugate(Hw)))
    re_, im_ = [sp.simplify(p) for p in sp.expand_complex(Hw).as_real_imag()]
    gain = 10 * sp.log(mag2, 10)
    phase = sp.atan2(im_, re_) * 180 / sp.pi
    subs10 = {w: 10 ** u}
    plot_mag = plain(sp.simplify(gain.subs(subs10)))
    plot_ph = plain(phase.subs(subs10))
    steps = [{'d': 'Frequency response', 'tex': r'H(i\omega) = %s' % tex(Hw)},
             {'d': 'Gain (dB)', 'tex': r'20\log_{10}|H(i\omega)| = %s' % tex(gain)},
             {'d': 'Phase (degrees)', 'tex': r'\arg H(i\omega) = %s' % tex(phase)},
             {'d': 'Plotted against u = log₁₀ ω', 'tex': ''}]
    return {'display': {'latex': r'\text{Bode plot of } H(s) = %s' % tex(H), 'plain': 'Bode plot of H(s) = %s' % plain(H)},
            'steps': steps, 'plotSpec': {'items': [{'kind': 'fn', 'expr': plot_mag, 'label': 'gain (dB)'},
                                                   {'kind': 'fn', 'expr': plot_ph, 'label': 'phase (°)'}],
                                         'v': 'u', 'range': [-3, 3]}}


# ══ 2.9 stochastic calculus ═════════════════════════════════════════════════
def t_ito(f, X, mu, sigma, t=None):
    X = _syms(X)[0]
    t = _syms(t)[0] if t is not None else sp.Symbol('t')
    drift = sp.simplify(sp.diff(f, t) + mu * sp.diff(f, X) + sp.Rational(1, 2) * sigma ** 2 * sp.diff(f, X, 2))
    diffusion = sp.simplify(sigma * sp.diff(f, X))
    steps = [{'d': 'Itô’s lemma for dX = μ dt + σ dW', 'tex': r'df = \left(f_t + \mu f_X + \tfrac12 \sigma^2 f_{XX}\right) dt + \sigma f_X\, dW'},
             {'d': 'Partial derivatives', 'tex': r'f_t = %s,\ f_X = %s,\ f_{XX} = %s' % (tex(sp.diff(f, t)), tex(sp.diff(f, X)), tex(sp.diff(f, X, 2)))}]
    wrap_t = lambda e: tex(e) if e.is_Atom else r'\left(%s\right)' % tex(e)
    wrap_p = lambda e: plain(e) if e.is_Atom else '(%s)' % plain(e)
    return show(r'd\left(%s\right) = %s\, dt + %s\, dW' % (tex(f), wrap_t(drift), wrap_t(diffusion)),
                'd(%s) = %s dt + %s dW' % (plain(f), wrap_p(drift), wrap_p(diffusion)), steps)


def t_sdesolve(mu, sigma, X, x0=None, t=None):
    """dX = mu dt + sigma dW with mu = a X + b, sigma = c X + d (constants a, b, c, d)."""
    X = _syms(X)[0]
    t = _syms(t)[0] if t is not None else sp.Symbol('t')
    x0 = x0 if x0 is not None else sp.Symbol('X_0')
    W = sp.Symbol('W_t')
    try:
        pm, ps = sp.Poly(mu, X), sp.Poly(sigma, X)
    except Exception:
        raise ValueError('sdesolve handles linear SDEs: dX = (aX + b) dt + (cX + d) dW')
    if pm.degree() > 1 or ps.degree() > 1:
        raise ValueError('sdesolve handles linear SDEs: dX = (aX + b) dt + (cX + d) dW')
    a, b = pm.coeff_monomial(X), pm.coeff_monomial(1)
    c, d = ps.coeff_monomial(X), ps.coeff_monomial(1)
    if any(k.has(t) for k in (a, b, c, d)):
        raise ValueError('sdesolve handles constant coefficients')
    if d == 0 and b == 0:
        sol = x0 * sp.exp((a - c ** 2 / 2) * t + c * W)
        name = 'geometric Brownian motion'
    elif c == 0 and a == 0:
        sol = x0 + b * t + d * W
        name = 'Brownian motion with drift'
    elif c == 0:
        s_ = sp.Symbol('s')
        lt = (x0 * sp.exp(a * t) + b / a * (sp.exp(a * t) - 1))
        name = 'Ornstein–Uhlenbeck process'
        dt_, dp_ = ('', '') if d == 1 else (tex(d), plain(d) + '*')
        lt = sp.simplify(lt)
        if lt == 0:        # X_0 = 0: only the stochastic integral remains
            return show(r'X_t = %s\int_0^t e^{%s}\,dW_s\quad\text{(%s)}' % (dt_, tex(a * (t - s_)), name),
                        'X_t = %s∫ exp(%s) dW_s (%s)' % (dp_, plain(a * (t - s_)), name), [])
        return show(r'X_t = %s + %s\int_0^t e^{%s}\,dW_s\quad\text{(%s)}' % (tex(sp.simplify(lt)), dt_, tex(a * (t - s_)), name),
                    'X_t = %s + %s∫ exp(%s) dW_s (%s)' % (plain(sp.simplify(lt)), dp_, plain(a * (t - s_)), name),
                    [{'d': 'Mean', 'tex': r'\mathbb{E}[X_t] = %s' % tex(sp.simplify(lt))},
                     {'d': 'Variance', 'tex': r'\operatorname{Var}[X_t] = %s' % tex(sp.simplify(d ** 2 / (2 * a) * (sp.exp(2 * a * t) - 1)))}])
    else:
        raise ValueError('sdesolve solves geometric Brownian motion, drifted Brownian motion and Ornstein–Uhlenbeck processes')
    # check with Itô: X = g(t, W) must satisfy dX = mu dt + sigma dW
    drift = sp.diff(sol, t) + sp.Rational(1, 2) * sp.diff(sol, W, 2)
    diff_ = sp.diff(sol, W)
    ok = sp.simplify(drift - mu.subs(X, sol)) == 0 and sp.simplify(diff_ - sigma.subs(X, sol)) == 0
    return show(r'X_t = %s\quad\text{(%s)}' % (tex(sol), name), 'X_t = %s (%s)' % (plain(sol), name),
                [{'d': 'Mean', 'tex': r'\mathbb{E}[X_t] = %s' % tex(sp.simplify(x0 * sp.exp(a * t) if b == 0 else x0 + b * t))}],
                check=verdict(ok, 'Itô’s lemma applied to the solution reproduces the drift and diffusion'))


# ══ 2.10 / 10.5 tensors, relativity, differential geometry ══════════════════
def _metric(g, coords):
    g = _rows(g)
    xs = _syms(coords)
    if g.shape != (len(xs), len(xs)):
        raise ValueError('The metric must be %d×%d for %d coordinates' % (len(xs), len(xs), len(xs)))
    if g != g.T:
        raise ValueError('The metric must be symmetric')
    return g, xs


def _christoffel(g, xs):
    n = len(xs)
    gi = sp.simplify(g.inv())
    return [[[_simp(sum(gi[a, d] * (sp.diff(g[d, b], xs[c]) + sp.diff(g[d, c], xs[b]) - sp.diff(g[b, c], xs[d]))
                        for d in range(n)) / 2) for c in range(n)] for b in range(n)] for a in range(n)]


def _riemann(G, xs):
    n = len(xs)
    R = [[[[0] * n for _ in range(n)] for _ in range(n)] for _ in range(n)]
    for a, b, c, d in itertools.product(range(n), repeat=4):
        if c < d:
            v = sp.diff(G[a][b][d], xs[c]) - sp.diff(G[a][b][c], xs[d]) + sum(
                G[a][c][e] * G[e][b][d] - G[a][d][e] * G[e][b][c] for e in range(n))
            v = _simp(v)
            R[a][b][c][d], R[a][b][d][c] = v, -v
    return R


def _ricci(R, n):
    return sp.Matrix(n, n, lambda b, d: _simp(sum(R[a][b][a][d] for a in range(n))))


def _components(entries):
    return r',\quad '.join(entries) if entries else '0'


def t_christoffel(g, coords):
    g, xs = _metric(g, coords)
    G = _christoffel(g, xs)
    n = len(xs)
    nz = [(a, b, c) for a in range(n) for b in range(n) for c in range(b, n) if G[a][b][c] != 0]
    lat = [r'\Gamma^{%s}_{%s%s} = %s' % (tex(xs[a]), tex(xs[b]), tex(xs[c]), tex(G[a][b][c])) for a, b, c in nz]
    pl = ['Γ^%s_(%s,%s) = %s' % (xs[a], xs[b], xs[c], plain(G[a][b][c])) for a, b, c in nz]
    return show(_components(lat), '; '.join(pl) or 'all zero',
                [{'d': 'Γᵃ_bc = ½ gᵃᵈ (∂_b g_dc + ∂_c g_db − ∂_d g_bc); symmetric in b, c (b ≤ c shown)', 'tex': ''}])


def t_riemann(g, coords):
    g, xs = _metric(g, coords)
    n = len(xs)
    R = _riemann(_christoffel(g, xs), xs)
    nz = [(a, b, c, d) for a in range(n) for b in range(n) for c in range(n) for d in range(c + 1, n) if R[a][b][c][d] != 0]
    lat = [r'R^{%s}{}_{%s%s%s} = %s' % (tex(xs[a]), tex(xs[b]), tex(xs[c]), tex(xs[d]), tex(R[a][b][c][d])) for a, b, c, d in nz]
    pl = ['R^%s_(%s,%s,%s) = %s' % (xs[a], xs[b], xs[c], xs[d], plain(R[a][b][c][d])) for a, b, c, d in nz]
    return show(_components(lat), '; '.join(pl) or 'flat: all components zero',
                [{'d': 'Rᵃ_bcd = ∂_c Γᵃ_bd − ∂_d Γᵃ_bc + Γᵃ_ce Γᵉ_bd − Γᵃ_de Γᵉ_bc (c < d shown)', 'tex': ''}])


def t_ricci(g, coords):
    g, xs = _metric(g, coords)
    Ric = _ricci(_riemann(_christoffel(g, xs), xs), len(xs))
    return {'value': value(Ric), 'prefix': r'R_{\mu\nu} = '}


def t_ricciscalar(g, coords):
    g, xs = _metric(g, coords)
    n = len(xs)
    Ric = _ricci(_riemann(_christoffel(g, xs), xs), n)
    gi = g.inv()
    Rs = sp.simplify(sum(gi[a, b] * Ric[a, b] for a in range(n) for b in range(n)))
    return {'value': value(Rs), 'prefix': r'R = g^{\mu\nu}R_{\mu\nu} = '}


def t_einstein(g, coords):
    g, xs = _metric(g, coords)
    n = len(xs)
    Ric = _ricci(_riemann(_christoffel(g, xs), xs), n)
    gi = g.inv()
    Rs = sp.simplify(sum(gi[a, b] * Ric[a, b] for a in range(n) for b in range(n)))
    E = sp.simplify(Ric - Rs * g / 2)
    return {'value': value(E), 'prefix': r'G_{\mu\nu} = R_{\mu\nu} - \tfrac12 R\, g_{\mu\nu} = '}


def t_geodesic(g, coords, s=None):
    g, xs = _metric(g, coords)
    s = _syms(s)[0] if s is not None else sp.Symbol('s')
    n = len(xs)
    G = _christoffel(g, xs)
    fs = [sp.Function(x.name)(s) for x in xs]
    sub = dict(zip(xs, fs))
    eqs = [sp.Eq(fs[a].diff(s, 2) + sum(G[a][b][c].subs(sub) * fs[b].diff(s) * fs[c].diff(s) for b in range(n) for c in range(n)), 0)
           for a in range(n)]
    eqs = [sp.Eq(sp.simplify(e.lhs), 0) for e in eqs]
    return show(r'\begin{aligned}%s\end{aligned}' % r'\\ '.join(tex(e).replace('=', '&=') for e in eqs),
                '; '.join(_primes(plain(e.lhs)) + ' = 0' for e in eqs),
                [{'d': 'ẍᵃ + Γᵃ_bc ẋᵇ ẋᶜ = 0', 'tex': ''}])


def t_curvature(r, t):
    t = _syms(t)[0]
    if isinstance(r, sp.MatrixBase):
        comps = list(r)
        if len(comps) == 2:
            comps.append(sp.Integer(0))
        if len(comps) != 3:
            raise ValueError('Give a curve as [x(t), y(t)] or [x(t), y(t), z(t)]')
        v = sp.Matrix([sp.diff(c, t) for c in comps])
        a = sp.Matrix([sp.diff(c, t, 2) for c in comps])
        c = v.cross(a)
        k = _simp(sp.sqrt(_simp(c.dot(c))) / _simp(v.dot(v)) ** sp.Rational(3, 2))      # real parameter t
    else:
        k = sp.simplify(sp.Abs(sp.diff(r, t, 2)) / (1 + sp.diff(r, t) ** 2) ** sp.Rational(3, 2))
    return {'value': value(k), 'prefix': r'\kappa = '}


def t_surfcurv(r, uv):
    u, v = _syms(uv)
    R = sp.Matrix(list(r))
    if R.shape[0] != 3:
        raise ValueError('Give a surface as [x(u, v), y(u, v), z(u, v)]')
    ru, rv = R.diff(u), R.diff(v)
    N = ru.cross(rv)
    nn = sp.sqrt(sp.simplify(N.dot(N)))
    E, F, Gm = [sp.simplify(e) for e in (ru.dot(ru), ru.dot(rv), rv.dot(rv))]
    L, M, Nn = [sp.simplify(R.diff(a, b).dot(N) / nn) for a, b in ((u, u), (u, v), (v, v))]
    K = sp.simplify((L * Nn - M ** 2) / (E * Gm - F ** 2))
    H = sp.simplify((E * Nn - 2 * F * M + Gm * L) / (2 * (E * Gm - F ** 2)))
    steps = [{'d': 'First fundamental form', 'tex': 'E = %s,\\ F = %s,\\ G = %s' % (tex(E), tex(F), tex(Gm))},
             {'d': 'Second fundamental form', 'tex': 'L = %s,\\ M = %s,\\ N = %s' % (tex(L), tex(M), tex(Nn))},
             {'d': 'Mean curvature', 'tex': 'H = %s' % tex(H)}]
    return {'value': value(K), 'prefix': r'K = \frac{LN - M^2}{EG - F^2} = ', 'steps': steps}


TOOLS.update({
    'maximize': t_maximize, 'minimize': t_minimize, 'lagrange': t_lagrange,
    'convolve': t_convolve, 'dft': t_dft, 'idft': t_idft, 'bode': t_bode,
    'ito': t_ito, 'sdesolve': t_sdesolve,
    'christoffel': t_christoffel, 'riemann': t_riemann, 'ricci': t_ricci, 'ricciscalar': t_ricciscalar,
    'einstein': t_einstein, 'geodesic': t_geodesic, 'curvature': t_curvature, 'surfcurv': t_surfcurv,
})


# ══ 2.4 differential forms ══════════════════════════════════════════════════
class wedge(sp.Function):
    """An unevaluated exterior product of differentials, e.g. wedge(dx, dy). Forms are written
    as sums of coefficient · dxᵢ or coefficient · wedge(dxᵢ, dxⱼ, …)."""

    def _latex(self, printer):
        return r' \wedge '.join(printer._print(a) for a in self.args)


FUNCS['wedge'] = wedge
GREEK_WORDS = ('alpha', 'beta', 'gamma', 'delta', 'theta', 'phi', 'psi', 'rho', 'sigma', 'tau', 'chi', 'eta', 'xi', 'zeta', 'mu', 'nu')


def _is_diff(s):
    return isinstance(s, sp.Symbol) and len(s.name) >= 2 and s.name[0] == 'd' and (len(s.name) == 2 or s.name[1:] in GREEK_WORDS)


def _form_coords(*forms, coords=None):
    if coords is not None:
        return _syms(coords)
    names = set()
    for f in forms:
        for s in f.free_symbols:
            if _is_diff(s):
                names.add(s.name[1:])
            else:
                names.add(s.name)
    pref = ['x', 'y', 'z', 'w', 't', 'r', 'theta', 'phi', 'u', 'v']
    ordered = [n for n in pref if n in names] + sorted(n for n in names if n not in pref)
    return [sp.Symbol(n) for n in ordered]


def _perm_sign(idx):
    idx = list(idx)
    sign = 1
    for i in range(len(idx)):
        for j in range(len(idx) - 1 - i):
            if idx[j] > idx[j + 1]:
                idx[j], idx[j + 1] = idx[j + 1], idx[j]
                sign = -sign
    return sign, tuple(idx)


def _to_form(e, xs):
    """Expression → {sorted index tuple: coefficient}."""
    pos = {sp.Symbol('d' + x.name): i for i, x in enumerate(xs)}
    form = {}
    for term in sp.Add.make_args(sp.expand(e)):
        coeff, parts = sp.Integer(1), []
        for fac in sp.Mul.make_args(term):
            if isinstance(fac, wedge):
                inner = [_to_form(a, xs) for a in fac.args]
                prod = inner[0]
                for f2 in inner[1:]:
                    prod = _wedge2(prod, f2)
                parts.append(prod)
            elif fac in pos:
                parts.append({(pos[fac],): sp.Integer(1)})
            elif fac.is_Pow and fac.base in pos:
                return {}                       # dx·dx = 0
            elif any(_is_diff(s) for s in fac.free_symbols):
                raise ValueError('Write products of differentials with wedge, e.g. wedge(dx, dy)')
            else:
                coeff *= fac
        if len(parts) > 1:
            raise ValueError('Write products of differentials with wedge, e.g. x*wedge(dx, dy)')
        piece = parts[0] if parts else {(): sp.Integer(1)}
        for k, c in piece.items():
            form[k] = form.get(k, 0) + coeff * c
    return {k: v for k, v in form.items() if sp.simplify(v) != 0}


def _wedge2(a, b):
    out = {}
    for ka, ca in a.items():
        for kb, cb in b.items():
            if set(ka) & set(kb):
                continue
            sign, k = _perm_sign(ka + kb)
            out[k] = out.get(k, 0) + sign * ca * cb
    return {k: sp.simplify(v) for k, v in out.items() if sp.simplify(v) != 0}


def _from_form(form, xs):
    ds = [sp.Symbol('d' + x.name) for x in xs]
    terms = []
    for k in sorted(form, key=lambda k: (len(k), k)):
        c = _tidy(sp.simplify(form[k]))
        basis = sp.Integer(1) if not k else ds[k[0]] if len(k) == 1 else wedge(*[ds[i] for i in k])
        terms.append(c * basis)
    return sp.Add(*terms) if terms else sp.Integer(0)


def _degree(form):
    degs = {len(k) for k in form}
    return degs.pop() if len(degs) == 1 else None


def t_wedge(*forms):
    if len(forms) < 2:
        raise ValueError('Use wedge(α, β, …) with at least two forms')
    xs = _form_coords(*forms)
    prod = _to_form(forms[0], xs)
    for f in forms[1:]:
        prod = _wedge2(prod, _to_form(f, xs))
    return {'value': value(_from_form(prod, xs)), 'prefix': r'%s = ' % r' \wedge '.join(r'\left(%s\right)' % tex(f) for f in forms)}


def t_extd(omega, coords=None):
    xs = _form_coords(omega, coords=coords)
    if not xs:
        raise ValueError('Name the coordinates, e.g. extd(x*y, [x, y])')
    form = _to_form(omega, xs)
    out = {}
    for k, c in form.items():
        for j, x in enumerate(xs):
            dc = sp.diff(c, x)
            if dc == 0 or j in k:
                continue
            sign, kk = _perm_sign((j,) + k)
            out[kk] = out.get(kk, 0) + sign * dc
    out = {k: sp.simplify(v) for k, v in out.items() if sp.simplify(v) != 0}
    # d(dω) = 0 is a property every exterior derivative must have
    dd = {}
    for k, c in out.items():
        for j, x in enumerate(xs):
            if j not in k and sp.diff(c, x) != 0:
                sign, kk = _perm_sign((j,) + k)
                dd[kk] = dd.get(kk, 0) + sign * sp.diff(c, x)
    closed = all(sp.simplify(v) == 0 for v in dd.values())
    return {'value': value(_from_form(out, xs)), 'prefix': r'd\left(%s\right) = ' % tex(omega),
            'check': verdict(closed, 'd(dω) = 0, as it must be'),
            'steps': [{'d': 'Coordinates', 'tex': r',\ '.join(tex(x) for x in xs)}]}


def t_hodge(omega, coords):
    xs = _syms(coords)
    n = len(xs)
    form = _to_form(omega, xs)
    out = {}
    for k, c in form.items():
        rest = tuple(i for i in range(n) if i not in k)
        sign, _ = _perm_sign(k + rest)
        out[rest] = out.get(rest, 0) + sign * c
    return {'value': value(_from_form(out, xs)), 'prefix': r'\star\left(%s\right) = ' % tex(omega),
            'steps': [{'d': 'Euclidean metric, orientation %s' % ', '.join('d' + x.name for x in xs), 'tex': ''}]}


# ══ 10.2 differential elimination ═══════════════════════════════════════════
def t_diffelim(eqs, keep, t=None):
    t = _syms(t)[0] if t is not None else sp.Symbol('t')
    exprs = [e.lhs - e.rhs if isinstance(e, sp.Equality) else e for e in _tuple(eqs)]
    funcs = sorted({f.func for e in exprs for f in e.atoms(sp.core.function.AppliedUndef)}, key=lambda f: f.__name__)
    keep_names = {getattr(k, 'name', str(k)) for k in _tuple(keep)}
    kept = [f for f in funcs if f.__name__ in keep_names]
    gone = [f for f in funcs if f.__name__ not in keep_names]
    if not kept or not gone:
        raise ValueError('Name the functions to keep, e.g. diffelim([x\' = y, y\' = -x], [x], t); the others are eliminated')
    for depth in range(0, 4):
        system = []
        for e in exprs:
            for j in range(depth + 1):
                system.append(sp.diff(e, t, j))
        top = max(max((d.derivative_count for d in s.atoms(sp.Derivative)), default=0) for s in system)
        jets = {}
        for f in funcs:
            for k in range(top, -1, -1):
                jets[(f, k)] = sp.Symbol('%s_%d' % (f.__name__, k))
        def to_jets(s):
            for f in funcs:
                for k in range(top, 0, -1):
                    s = s.subs(sp.Derivative(f(t), (t, k)), jets[(f, k)])
                s = s.subs(f(t), jets[(f, 0)])
            return s
        polys = [sp.together(to_jets(s)) for s in system]
        polys = [sp.fraction(p)[0] for p in polys]
        gens = [jets[(f, k)] for f in gone for k in range(top, -1, -1)] + [jets[(f, k)] for f in kept for k in range(top, -1, -1)]
        try:
            G = sp.groebner(polys, *gens, order='lex', domain=sp.QQ.frac_field(t) if any(p.has(t) for p in polys) else sp.QQ)
        except Exception:
            continue
        gone_jets = {jets[(f, k)] for f in gone for k in range(top + 1)}
        found = [g for g in G.exprs if not (g.free_symbols & gone_jets) and g.free_symbols - {t}]
        if found:
            def order_of(g):
                return max(k for (f, k), s in jets.items() if s in g.free_symbols)
            g = min(found, key=lambda g: (order_of(g), sp.count_ops(g)))
            back = g
            for (f, k), s in jets.items():
                back = back.subs(s, sp.Derivative(f(t), (t, k)) if k else f(t))
            back = sp.factor_terms(sp.expand(back))
            lc = sp.Poly(g, *[jets[(f, k)] for f in kept for k in range(top, -1, -1)]).LC()
            back = sp.expand(back / lc) if lc.is_number else back
            return show('%s = 0' % tex(back), '%s = 0' % _primes(plain(back)),
                        [{'d': 'Differentiated the system %d time(s) and eliminated %s with a lex Gröbner basis' %
                          (depth, ', '.join(f.__name__ for f in gone)), 'tex': ''}])
    raise ValueError('No relation found after 3 prolongations')


# ══ 10.7 quantum circuits ═══════════════════════════════════════════════════
_SQ2 = 1 / sp.sqrt(2)
GATES1 = {
    'H': sp.Matrix([[_SQ2, _SQ2], [_SQ2, -_SQ2]]), 'X': sp.Matrix([[0, 1], [1, 0]]), 'Y': sp.Matrix([[0, -sp.I], [sp.I, 0]]),
    'Z': sp.Matrix([[1, 0], [0, -1]]), 'S': sp.Matrix([[1, 0], [0, sp.I]]), 'T': sp.Matrix([[1, 0], [0, sp.exp(sp.I * sp.pi / 4)]]),
    'I': sp.eye(2),
}


def _rot(axis, th):
    c, s_ = sp.cos(th / 2), sp.sin(th / 2)
    return {'Rx': sp.Matrix([[c, -sp.I * s_], [-sp.I * s_, c]]), 'Ry': sp.Matrix([[c, -s_], [s_, c]]),
            'Rz': sp.Matrix([[sp.exp(-sp.I * th / 2), 0], [0, sp.exp(sp.I * th / 2)]])}[axis]


def _ket(state, n):
    terms = []
    for i, amp in enumerate(state):
        amp = sp.nsimplify(sp.simplify(amp)) if amp.is_number else sp.simplify(amp)
        if amp != 0:
            terms.append((amp, format(i, '0%db' % n)))
    tex_ = ' + '.join(r'%s\left|%s\right\rangle' % ('' if a == 1 else '-' if a == -1 else r'\left(%s\right)' % tex(a) if a.is_Add else tex(a), b)
                      for a, b in terms).replace('+ -', '- ')
    plain_ = ' + '.join('%s|%s>' % ('' if a == 1 else '-' if a == -1 else '(%s)' % plain(a) if a.is_Add else plain(a), b) for a, b in terms).replace('+ -', '- ')
    return tex_ or '0', plain_ or '0'


def t_circuit(b, n_node, *gate_nodes):
    n = int(b.build(n_node))
    if not 1 <= n <= 8:
        raise ValueError('Circuits have 1 to 8 qubits')
    gates = []
    for g in gate_nodes:
        gates += g.get('items', []) if g.get('t') == 'vec' else [g]
    state = sp.zeros(2 ** n, 1)
    state[0] = 1
    steps = [{'d': 'Start', 'tex': r'\left|%s\right\rangle' % ('0' * n)}]

    def apply1(U, q):
        out = sp.zeros(2 ** n, 1)
        for i in range(2 ** n):
            if state[i] == 0:
                continue
            bit = (i >> (n - 1 - q)) & 1
            for nb in (0, 1):
                j = i if nb == bit else i ^ (1 << (n - 1 - q))
                out[j] += U[nb, bit] * state[i]
        return out

    for g in gates:
        if g.get('t') != 'fn':
            raise ValueError('Gates look like H(0), CNOT(0, 1), Rx(pi/2, 0)')
        name, args = g['n'], [b.build(a) for a in g['args']]
        qs = [int(a) for a in args if a.is_Integer]
        if name in GATES1 and len(args) == 1:
            q = qs[0]
            if not 0 <= q < n:
                raise ValueError('Qubit %d does not exist (0 to %d)' % (q, n - 1))
            state = apply1(GATES1[name], q)
        elif name in ('Rx', 'Ry', 'Rz') and len(args) == 2:
            state = apply1(_rot(name, args[0]), int(args[1]))
        elif name in ('CNOT', 'CX', 'CZ', 'SWAP') and len(args) == 2:
            c, tq = qs
            if c == tq or not (0 <= c < n and 0 <= tq < n):
                raise ValueError('%s needs two different qubits between 0 and %d' % (name, n - 1))
            out = sp.zeros(2 ** n, 1)
            for i in range(2 ** n):
                if state[i] == 0:
                    continue
                bc, bt = (i >> (n - 1 - c)) & 1, (i >> (n - 1 - tq)) & 1
                if name in ('CNOT', 'CX'):
                    j = i ^ (1 << (n - 1 - tq)) if bc else i
                    out[j] += state[i]
                elif name == 'CZ':
                    out[i] += -state[i] if bc and bt else state[i]
                else:
                    j = i
                    if bc != bt:
                        j = i ^ (1 << (n - 1 - c)) ^ (1 << (n - 1 - tq))
                    out[j] += state[i]
            state = out
        else:
            raise ValueError('Unknown gate %s; use H, X, Y, Z, S, T, Rx, Ry, Rz, CNOT, CZ or SWAP' % name)
        steps.append({'d': '%s(%s)' % (name, ', '.join(plain(a) for a in args)), 'tex': _ket(state, n)[0]})
    probs = [(format(i, '0%db' % n), sp.simplify(sp.Abs(a) ** 2)) for i, a in enumerate(state)]
    probs = [(k, p) for k, p in probs if p != 0]
    steps.append({'d': 'Measurement probabilities', 'tex': r',\ '.join(r'P(%s) = %s' % (k, tex(p)) for k, p in probs)})
    norm = sp.simplify(sum(p for _, p in probs))
    lt, pt = _ket(state, n)
    return {'display': {'latex': lt, 'plain': pt}, 'steps': steps,
            'check': verdict(norm == 1, 'the probabilities add up to 1 (every gate is unitary)')}


RAW_TOOLS['circuit'] = t_circuit


# ══ 10.9 knots ══════════════════════════════════════════════════════════════
# Planar diagram codes (KnotAtlas conventions): X[i, j, k, l], counter-clockwise from the
# incoming under-strand.
KNOTS = {
    'unknot': [],
    'trefoil': [(1, 5, 2, 4), (3, 1, 4, 6), (5, 3, 6, 2)],
    'figure8': [(4, 2, 5, 1), (8, 6, 1, 5), (6, 3, 7, 4), (2, 7, 3, 8)],
    'cinquefoil': [(1, 6, 2, 7), (3, 8, 4, 9), (5, 10, 6, 1), (7, 2, 8, 3), (9, 4, 10, 5)],
    'threetwist': [(1, 5, 2, 4), (3, 9, 4, 8), (5, 1, 6, 10), (7, 3, 8, 2), (9, 7, 10, 6)],
    'stevedore': [(1, 4, 2, 5), (7, 10, 8, 11), (3, 9, 4, 8), (9, 3, 10, 2), (5, 12, 6, 1), (11, 6, 12, 7)],
}
KNOT_ALIASES = {'K3_1': 'trefoil', 'K4_1': 'figure8', 'figureeight': 'figure8', 'K5_1': 'cinquefoil', 'K5_2': 'threetwist',
                'K6_1': 'stevedore', 'K0_1': 'unknot'}


def _pd(k):
    if isinstance(k, sp.Symbol):
        name = KNOT_ALIASES.get(k.name, k.name)
        if name not in KNOTS:
            raise ValueError('Known knots: %s (or give a PD code as a matrix of crossings)' % ', '.join(sorted(KNOTS)))
        return name, KNOTS[name]
    M = _rows(k)
    if M.cols != 4:
        raise ValueError('A PD code has one row [i, j, k, l] per crossing')
    return None, [tuple(int(v) for v in M.row(r)) for r in range(M.rows)]


def _crossing_sign(c):
    i, j, k, l = c
    # the over-strand runs j → l when l follows j, otherwise l → j
    return -1 if (l - j == 1 or j - l > 1) else 1


def _bracket(pd):
    A = sp.Symbol('A')
    d = -A ** 2 - A ** -2
    n = len(pd)
    total = sp.Integer(0)
    for state in itertools.product((0, 1), repeat=n):
        parent = {}

        def find(a):
            while parent.setdefault(a, a) != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        def union(a, b):
            parent[find(a)] = find(b)
        for (i, j, k, l), s in zip(pd, state):
            if s == 0:
                union(i, j), union(k, l)       # A-smoothing
            else:
                union(i, l), union(j, k)       # B-smoothing
        loops = len({find(a) for c in pd for a in c})
        na = state.count(0)
        total += A ** (na - (n - na)) * d ** (loops - 1)
    return sp.expand(total), A


def t_jones(K):
    name, pd = _pd(K)
    q = sp.Symbol('q')
    if not pd:
        return {'value': value(sp.Integer(1)), 'prefix': r'V(q) = '}
    br, A = _bracket(pd)
    w = sum(_crossing_sign(c) for c in pd)
    V = sp.expand((-A ** 3) ** (-w) * br)
    V = sp.expand(V.subs(A, q ** sp.Rational(-1, 4)))
    ok = V.subs(q, 1) == 1
    lt, pt = _laurent_tex(V, q)
    return {'display': {'latex': 'V(q) = ' + lt, 'plain': 'V(q) = ' + pt},
            'steps': [{'d': 'Kauffman bracket over %d states, writhe %d' % (2 ** len(pd), w), 'tex': r'\langle K\rangle = %s' % tex(br)}],
            'check': verdict(ok, 'V(1) = 1, as for every knot')}


def t_alexander(K):
    name, pd = _pd(K)
    t = sp.Symbol('t')
    if not pd:
        return {'value': value(sp.Integer(1)), 'prefix': r'\Delta(t) = '}
    parent = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for i, j, k, l in pd:
        parent[find(j)] = find(l)              # the over-strand is one arc
    arcs = sorted({find(a) for c in pd for a in c})
    col = {a: n for n, a in enumerate(arcs)}
    n = len(pd)
    M = sp.zeros(n, len(arcs))
    for r, c in enumerate(pd):
        i, j, k, l = c
        o, inc, out = col[find(j)], col[find(i)], col[find(k)]
        M[r, o] += 1 - t
        M[r, inc] += t if _crossing_sign(c) > 0 else -1
        M[r, out] += -1 if _crossing_sign(c) > 0 else t
    D = sp.expand(M[:n - 1, :n - 1].det()) if n > 1 else sp.Integer(1)
    if D == 0:
        raise ValueError('The diagram is degenerate (Alexander determinant 0)')
    # normalise: symmetric Laurent polynomial with Δ(1) = 1
    P = sp.Poly(D, t)
    lo = min(m[0] for m in P.monoms())
    hi = max(m[0] for m in P.monoms())
    D = sp.expand(D / t ** sp.Rational(lo + hi, 2))
    if D.subs(t, 1) < 0:
        D = -D
    ok = D.subs(t, 1) == 1 and sp.expand(D - D.subs(t, 1 / t)) == 0
    lt, pt = _laurent_tex(D, t)
    det = abs(D.subs(t, -1))
    return {'display': {'latex': r'\Delta(t) = ' + lt, 'plain': 'Δ(t) = ' + pt},
            'steps': [{'d': 'Determinant of the knot', 'tex': r'|\Delta(-1)| = %s' % tex(det)}],
            'check': verdict(ok, 'Δ(1) = 1 and Δ(t) = Δ(1/t)')}


TOOLS.update({'wedge': t_wedge, 'extd': t_extd, 'hodge': t_hodge, 'diffelim': t_diffelim,
              'jones': t_jones, 'alexander': t_alexander})


# ══ 3.5 interval arithmetic ═════════════════════════════════════════════════
IV = mpmath.iv


def _mid(v):
    """Midpoint of an interval, as a plain number."""
    return (mpmath.mpf(v.a) + mpmath.mpf(v.b)) / 2


class _iv_dps:
    """Temporarily raise the working precision of mpmath's interval context."""

    def __init__(self, dps):
        self.dps = dps

    def __enter__(self):
        self.saved = IV.dps
        IV.dps = self.dps

    def __exit__(self, *exc):
        IV.dps = self.saved


def _iv_const(c):
    if c.is_Integer:
        return IV.mpf(int(c))
    if c.is_Rational:
        return IV.mpf(int(c.p)) / IV.mpf(int(c.q))
    if c is sp.pi:
        return IV.pi
    if c is sp.E:
        return IV.e
    if c.is_Float:
        return IV.mpf(str(c))
    raise ValueError('Interval arithmetic cannot evaluate %s' % plain(c))


def _monotone(fn, x):
    lo, hi = fn(IV.mpf(x.a)), fn(IV.mpf(x.b))
    return IV.mpf([min(lo.a, hi.a), max(lo.b, hi.b)])


def _ieval(e, env):
    """Rigorous enclosure of e when each symbol lies in the interval env[symbol]."""
    if e.is_Symbol:
        if e not in env:
            raise ValueError('Give a range for %s, e.g. [%s, 0, 1]' % (e, e))
        return env[e]
    if e.is_number and (e.is_Rational or e in (sp.pi, sp.E) or e.is_Float):
        return _iv_const(e)
    args = [_ieval(a, env) for a in e.args] if not e.is_Pow else None
    if e.is_Add:
        r = args[0]
        for a in args[1:]:
            r = r + a
        return r
    if e.is_Mul:
        r = args[0]
        for a in args[1:]:
            r = r * a
        return r
    if e.is_Pow:
        base, ex = _ieval(e.base, env), e.exp
        if ex.is_Integer:
            return base ** int(ex)
        if ex == sp.Rational(1, 2):
            return IV.sqrt(base)
        if ex == -sp.Rational(1, 2):
            return 1 / IV.sqrt(base)
        return IV.exp(_ieval(ex, env) * IV.log(base))
    fn = {sp.exp: IV.exp, sp.log: IV.log, sp.sin: IV.sin, sp.cos: IV.cos, sp.tan: IV.tan, sp.Abs: abs,
          sp.sec: IV.sec, sp.cot: IV.cot, sp.erf: IV.erf}.get(e.func)
    if fn is not None:
        return fn(args[0])
    if e.func is sp.atan:
        return _monotone(lambda p: IV.atan2(p, IV.mpf(1)), args[0])
    if e.func is sp.asin:
        return _monotone(lambda p: IV.atan2(p, IV.sqrt(1 - p * p)), args[0])
    if e.func is sp.sinh:
        return (IV.exp(args[0]) - IV.exp(-args[0])) / 2
    if e.func is sp.cosh:
        x = args[0]
        lo = IV.mpf(0) if x.a <= 0 <= x.b else IV.mpf(min(abs(x.a), abs(x.b)))
        hi = IV.mpf(max(abs(x.a), abs(x.b)))
        return _monotone(lambda p: (IV.exp(p) + IV.exp(-p)) / 2, IV.mpf([lo.a, hi.b]))
    raise ValueError('Interval arithmetic does not support %s yet' % e.func)


def _ranges(rs):
    env = {}
    for r in rs:
        items = list(r) if isinstance(r, (sp.MatrixBase, sp.Tuple)) else None
        if not items or len(items) != 3 or not isinstance(items[0], sp.Symbol):
            raise ValueError('Ranges look like [x, 0, 1]')
        a, b = _iv_const(sp.nsimplify(items[1])), _iv_const(sp.nsimplify(items[2]))
        env[items[0]] = IV.mpf([a.a, b.b])
    return env


def _enclose(e, env, pieces=256):
    """Range enclosure, tightened by splitting the first variable's interval."""
    if not env:
        return _ieval(e, env)
    v = next(iter(env))
    lo, hi = env[v].a, env[v].b
    out = None
    for k in range(pieces):
        a = lo + (hi - lo) * k / pieces
        b_ = lo + (hi - lo) * (k + 1) / pieces
        sub = dict(env)
        sub[v] = IV.mpf([a, b_])
        r = _ieval(e, sub)
        out = r if out is None else IV.mpf([min(out.a, r.a), max(out.b, r.b)])
    return out


def _fmt_iv(r, digits=20):
    with mpmath.workdps(digits):
        return mpmath.nstr(mpmath.mpf(r.a), digits), mpmath.nstr(mpmath.mpf(r.b), digits)


def t_ieval(e, *ranges):
    env = _ranges(ranges)
    with _iv_dps(40):
        r = _enclose(e, env) if env else _ieval(e, {})
    lo, hi = _fmt_iv(r)
    what = 'range of the expression over the box' if env else 'value'
    return show(r'%s \in \left[%s,\ %s\right]' % (tex(e), lo, hi), '[%s, %s]' % (lo, hi),
                [{'d': 'Interval arithmetic with outward rounding (mpmath.iv): the %s is guaranteed to lie in this interval' % what, 'tex': ''}])


# ══ 10.10 / 7.3 proofs ══════════════════════════════════════════════════════
def _sturm_count(p, x, a, b):
    """Number of distinct real roots of p in (a, b] by Sturm's theorem."""
    seq = sp.sturm(sp.Poly(p, x))
    def changes(v):
        vals = [s.as_expr().subs(x, v) if v not in (sp.oo, -sp.oo) else sp.sign(s.LC()) * (1 if v is sp.oo or s.degree() % 2 == 0 else -1)
                for s in seq]
        vals = [v_ for v_ in vals if v_ != 0]
        return sum(1 for u, w in zip(vals, vals[1:]) if (u > 0) != (w > 0))
    return changes(a) - changes(b), seq


def _lean_expr(e):
    if e.is_Integer:
        return '(%d : ℝ)' % e if e < 0 else str(e)
    if e.is_Rational:
        return '((%d : ℝ) / %d)' % (e.p, e.q)
    if e.is_Symbol:
        return e.name
    if e.is_Add:
        return '(' + ' + '.join(_lean_expr(a) for a in e.args) + ')'
    if e.is_Mul:
        return '(' + ' * '.join(_lean_expr(a) for a in e.args) + ')'
    if e.is_Pow and e.exp.is_Integer and e.exp > 0:
        return '%s ^ %d' % (_lean_expr(e.base), e.exp)
    raise ValueError('no Lean form')


def _lean(lhs, rhs, rel='='):
    syms = sorted((lhs - rhs).free_symbols, key=lambda s: s.name)
    try:
        stmt = '%s %s %s' % (_lean_expr(lhs), rel, _lean_expr(rhs))
    except ValueError:
        return None
    binder = '(%s : ℝ) ' % ' '.join(s.name for s in syms) if syms else ''
    tactic = 'ring' if syms else 'norm_num'
    return 'import Mathlib\n\nexample %s: %s := by\n  %s' % (binder, stmt, tactic)


MISTAKES = [
    (lambda l, r: l.is_Pow and l.base.is_Add and l.exp.is_Integer and l.exp > 1 and sp.expand(r - sp.Add(*[a ** l.exp for a in l.base.args])) == 0,
     'Powers do not distribute over sums: (a + b)ⁿ ≠ aⁿ + bⁿ (the cross terms are missing).'),
    (lambda l, r: l.is_Pow and l.exp == sp.Rational(1, 2) and l.base.is_Add and sp.expand(r - sp.Add(*[sp.sqrt(a) for a in l.base.args])) == 0,
     'Square roots do not distribute over sums: √(a + b) ≠ √a + √b.'),
    (lambda l, r: isinstance(l, sp.log) and l.args[0].is_Add and sp.expand(r - sp.Add(*[sp.log(a) for a in l.args[0].args])) == 0,
     'log(a + b) ≠ log a + log b; it is log(ab) that equals log a + log b.'),
    (lambda l, r: isinstance(l, (sp.sin, sp.cos, sp.tan)) and l.args[0].is_Add and sp.expand(r - sp.Add(*[l.func(a) for a in l.args[0].args])) == 0,
     'Trigonometric functions are not additive: use the angle-sum formulas.'),
    (lambda l, r: l.is_Pow and l.exp == -1 and l.base.is_Add and sp.expand(r - sp.Add(*[1 / a for a in l.base.args])) == 0,
     '1/(a + b) ≠ 1/a + 1/b.'),
]


def _counterexample(d, syms):
    for pt in itertools.product([sp.Rational(1, 2), sp.Rational(3, 2), sp.Integer(2), -sp.Rational(1, 3), sp.Integer(3)], repeat=len(syms)):
        sub = dict(zip(syms, pt))
        v = _cnum(d.subs(sub))
        if v is not None and abs(v) > 1e-9:
            return sub
    return None


def t_prove(stmt, *ranges):
    if stmt in (sp.true, sp.false):
        return show(r'\text{%s}' % ('true' if stmt == sp.true else 'false'), 'true' if stmt == sp.true else 'false', [],
                    check=verdict(True, 'decided by exact arithmetic'))
    if not isinstance(stmt, sp.core.relational.Relational):
        raise ValueError('prove needs an identity a = b or an inequality, e.g. prove(x^2 + 1 > 0)')
    lhs, rhs = stmt.lhs, stmt.rhs
    d = lhs - rhs
    syms = sorted(d.free_symbols, key=lambda s: s.name)
    steps = []
    if isinstance(stmt, sp.Equality):
        canon = sp.cancel(sp.expand(d)) if d.is_rational_function() else sp.cancel(sp.expand(sp.expand_trig(d).rewrite(sp.exp)))
        if canon == 0:
            steps.append({'d': 'Both sides reduce to the same canonical form', 'tex': r'%s - \left(%s\right) \to 0' % (tex(lhs), tex(rhs))})
            lean = _lean(lhs, rhs) if d.is_polynomial() else None
            out = show(r'\text{Proved: } %s = %s' % (tex(lhs), tex(rhs)), 'proved: %s = %s' % (plain(lhs), plain(rhs)), steps,
                       check=verdict(True, 'exact canonical form (expansion, cancellation%s)' % ('' if d.is_rational_function() else ', exponential rewriting')))
            if lean:
                out['lean'] = lean
                out['steps'].append({'d': 'Lean 4 (Mathlib) statement', 'tex': r'\texttt{%s}' % lean.split('\n')[-2].replace('_', r'\_')})
            return out
        cx = _counterexample(d, syms)
        if cx is not None:
            why = next((msg for test, msg in MISTAKES if _safe(test, lhs, rhs)), None)
            steps.append({'d': 'Counterexample', 'tex': r'%s:\quad %s = %s,\ \ %s = %s' % (
                r',\ '.join('%s = %s' % (tex(k), tex(v)) for k, v in cx.items()), tex(lhs), tex(sp.nsimplify(lhs.subs(cx))),
                tex(rhs), tex(sp.nsimplify(rhs.subs(cx))))})
            if why:
                steps.append({'d': 'Common mistake', 'tex': r'\text{%s}' % why})
            return show(r'\text{False: } %s \ne %s' % (tex(lhs), tex(rhs)), 'false' + (' — ' + why if why else ''), steps,
                        check=verdict(True, 'a counterexample was evaluated exactly'))
        return show(r'\text{Not proved (true at every sample point)}', 'not proved', steps)
    # inequalities
    strict = isinstance(stmt, (sp.StrictGreaterThan, sp.StrictLessThan))
    f = d if isinstance(stmt, (sp.StrictGreaterThan, sp.GreaterThan)) else -d          # prove f > 0 (or ≥ 0)
    env = _ranges(ranges)
    word = '>' if strict else '≥'
    if len(syms) == 1 and f.is_rational_function(syms[0]) and not (f.has(sp.Abs)):
        x = syms[0]
        num, den = sp.fraction(sp.cancel(sp.together(f)))
        if x in env:
            a, b = sp.nsimplify(ranges[0][1]), sp.nsimplify(ranges[0][2])
        else:
            a, b = -sp.oo, sp.oo
        bad = None
        for p in (num, den):
            if sp.degree(p, x) < 1:
                continue
            for fac, mult in sp.factor_list(p, x)[1]:
                if mult % 2 == 1 or (strict and p is num) or p is den:
                    cnt, seq = _sturm_count(fac, x, a, b)
                    roots_inside = cnt + (1 if a.is_finite and fac.subs(x, a) == 0 else 0)
                    if roots_inside:
                        bad = (fac, roots_inside, seq)
                        break
            if bad:
                break
        if bad is None:
            mid = (a + b) / 2 if a.is_finite and b.is_finite else (a + 1 if a.is_finite else b - 1 if b.is_finite else sp.Integer(0))
            ok = f.subs(x, mid) > 0 if strict else f.subs(x, mid) >= 0
            if ok:
                where = r'\mathbb{R}' if not (a.is_finite or b.is_finite) else r'\left[%s, %s\right]' % (tex(a), tex(b))
                steps.append({'d': "Sturm's theorem: the relevant factors have no real roots in %s, so the sign never changes" %
                              ('ℝ' if where == r'\mathbb{R}' else 'the interval'), 'tex': ''})
                steps.append({'d': 'Sign at one point', 'tex': r'f(%s) = %s' % (tex(mid), tex(f.subs(x, mid)))})
                return show(r'\text{Proved: } %s %s %s \text{ for all } %s \in %s' % (tex(lhs), {'>': '>', '<': '<', '>=': r'\ge', '<=': r'\le'}[stmt.rel_op], tex(rhs), tex(x), where),
                            'proved: %s %s %s for all %s%s' % (plain(lhs), stmt.rel_op, plain(rhs), x,
                                                               '' if where == r'\mathbb{R}' else ' in [%s, %s]' % (plain(a), plain(b))), steps,
                            check=verdict(True, "exact real-root counting (Sturm sequences)"))
        cx = None
        for tpt in [sp.Rational(k, 4) for k in range(-40, 41)]:
            if (a == -sp.oo or tpt >= a) and (b == sp.oo or tpt <= b):
                v = f.subs(x, tpt)
                if v.is_number and (v < 0 or (strict and v == 0)):
                    cx = tpt
                    break
        if cx is not None:
            return show(r'\text{False: at } %s = %s,\ %s = %s' % (tex(x), tex(cx), tex(f), tex(f.subs(x, cx))),
                        'false at %s = %s' % (x, plain(cx)), steps, check=verdict(True, 'a counterexample was evaluated exactly'))
    if f.is_polynomial(*syms) and not strict:
        # a positive constant times even powers is a square: x² + y² − 2xy = (x − y)²
        c, facs = sp.factor_list(f)
        if c > 0 and facs and all(m % 2 == 0 for _, m in facs):
            sq = sp.Mul(*[b ** (m // 2) for b, m in facs])
            steps.append({'d': 'The difference is a perfect square times a positive constant', 'tex': r'%s = %s\left(%s\right)^{2} \ge 0' % (tex(f), '' if c == 1 else tex(c), tex(sq))})
            return show(r'\text{Proved: } %s %s %s \text{ for all real } %s' % (tex(lhs), {'>=': r'\ge', '<=': r'\le'}[stmt.rel_op], tex(rhs), r',\,'.join(tex(s_) for s_ in syms)),
                        'proved: %s %s %s for all real %s' % (plain(lhs), stmt.rel_op, plain(rhs), ', '.join(map(str, syms))), steps,
                        check=verdict(True, 'exact factorisation as a square'))
    if env and set(syms) <= set(env):
        # interval branch and bound on the box
        boxes, proved = [env], 0
        order = list(env)
        grad = [sp.diff(f, v) for v in order]
        hess = [[sp.diff(g, w) for w in order] for g in grad]

        def lower(box):
            """The better of two rigorous lower bounds: the natural interval extension, and the
            second-order Taylor form f(c) + ∇f(c)·h + ½ hᵀ H(box) h, which is exact enough at a
            touching point (eˣ ≥ 1 + x at x = 0) where the natural extension never is."""
            lb = _ieval(f, box).a
            try:
                c = {k: IV.mpf(_mid(v)) for k, v in box.items()}
                h = {k: box[k] - c[k] for k in box}
                t = _ieval(f, c)
                for g, k in zip(grad, order):
                    t = t + _ieval(g, c) * h[k]
                for i, k in enumerate(order):
                    for j, l in enumerate(order):
                        hk = h[k] ** 2 if k == l else h[k] * h[l]
                        t = t + _ieval(hess[i][j], box) * hk / 2
                lb = max(lb, t.a)
            except Exception:
                pass
            return lb
        with _iv_dps(30):
            for _ in range(6000):
                if not boxes:
                    break
                box = boxes.pop()
                lb = lower(box)
                if lb > 0 or (not strict and lb >= 0):
                    proved += 1
                    continue
                mid = {k: _mid(v) for k, v in box.items()}
                fm = _cnum(f.subs({k: sp.Float(m, 30) for k, m in mid.items()}))
                if fm is not None and (fm.real < 0 or (strict and fm.real == 0)):
                    return show(r'\text{False: at } %s,\ %s \approx %s' % (r',\ '.join('%s = %s' % (tex(k), mpmath.nstr(m, 8)) for k, m in mid.items()), tex(f), mpmath.nstr(fm.real, 8)),
                                'false', steps, check=verdict(True, 'a counterexample was found'))
                k = max(box, key=lambda s: mpmath.mpf(box[s].b) - mpmath.mpf(box[s].a))
                m = _mid(box[k])
                for part in (IV.mpf([box[k].a, m]), IV.mpf([m, box[k].b])):
                    nb = dict(box)
                    nb[k] = part
                    boxes.append(nb)
        if not boxes:
            steps.append({'d': 'Interval branch and bound', 'tex': r'\text{%d box%s, each with a rigorous lower bound %s 0}' % (proved, '' if proved == 1 else 'es', '>' if strict else r'\ge')})
            return show(r'\text{Proved on the box: } %s %s %s' % (tex(lhs), stmt.rel_op.replace('>=', r'\ge').replace('<=', r'\le'), tex(rhs)),
                        'proved on the box', steps, check=verdict(True, 'interval arithmetic with outward rounding'))
        return show(r'\text{Not proved: the interval bounds were too loose}', 'not proved', steps)
    return show(r'\text{Not proved. Give a range, e.g. prove(f > 0, [x, 0, 1]), for interval arithmetic}', 'not proved', steps)


def _safe(test, l, r):
    try:
        return bool(test(l, r))
    except Exception:
        return False


# ══ 8.5 / 8.6 grading ═══════════════════════════════════════════════════════
def t_grade(answer, key, x=None):
    def items(v):
        return sorted(list(v), key=str) if isinstance(v, (sp.MatrixBase, sp.Tuple)) else [v]
    A, K = items(answer), items(key)
    if len(A) != len(K):
        return show(r'\text{Incorrect: expected %d value(s), got %d}' % (len(K), len(A)), 'incorrect', [])
    if len(A) > 1:
        unmatched = list(K)
        for a in A:
            hit = next((k for k in unmatched if numerically_equal(a, k) is True), None)
            if hit is None:
                return show(r'\text{Incorrect: } %s \text{ is not in the answer key}' % tex(a), 'incorrect', [])
            unmatched.remove(hit)
        return show(r'\text{Correct}', 'correct', [], check=verdict(True, 'every value matches one in the key'))
    a, k = A[0], K[0]
    if isinstance(a, sp.Equality) and isinstance(k, sp.Equality):
        a, k = a.lhs - a.rhs, k.lhs - k.rhs
        ratio = sp.simplify(a / k) if k != 0 else None
        if ratio is not None and ratio.is_number and ratio != 0:
            return show(r'\text{Correct (an equivalent equation)}', 'correct', [], check=verdict(True, 'the equations differ by a nonzero factor'))
    same = numerically_equal(a, k)
    if same is True:
        simpler = sp.count_ops(a) <= sp.count_ops(sp.simplify(k)) + 2
        note = r'' if simpler else r'\text{ — but not simplified (}%s\text{)}' % tex(sp.simplify(k))
        return show(r'\text{Correct}' + note, 'correct' + ('' if simpler else ' but not simplified'), [],
                    check=verdict(True, 'equal at random sample points to 30 digits'))
    v = _syms(x)[0] if x is not None else (sorted((a - k).free_symbols, key=str) or [None])[0]
    if v is not None:
        dd = sp.simplify(sp.diff(a - k, v))
        if dd == 0:
            return show(r'\text{Correct up to a constant (fine for an antiderivative)}', 'correct up to a constant', [],
                        check=verdict(True, 'the difference has zero derivative'))
    syms = sorted((a - k).free_symbols, key=str)
    cx = _counterexample(a - k, syms) if syms else {}
    hint = ''
    if syms and cx:
        hint = r':\ \text{at } %s \text{ the answer gives } %s,\ \text{expected } %s' % (
            r',\ '.join('%s = %s' % (tex(s), tex(cx[s])) for s in syms), tex(sp.nsimplify(a.subs(cx))), tex(sp.nsimplify(k.subs(cx))))
    elif not syms:
        hint = r':\ %s \ne %s' % (tex(a), tex(k))
    return show(r'\text{Incorrect}' + hint, 'incorrect', [], check=verdict(True, 'compared exactly at a sample point'))


TOOLS.update({'ieval': t_ieval, 'prove': t_prove, 'grade': t_grade})


# ══ 2.6 random variables and 10.6 geometry: named objects ═══════════════════
# A notebook line X = Normal(0, 1) or A = Point(0, 0) defines an object. The JavaScript side
# sends every object definition (as an expression tree) with each request; the Builder makes the
# SymPy object the first time the name is used (Builder.object).
from sympy import stats as st
from sympy import geometry as geo

RV_CTORS = {
    'Normal': st.Normal, 'Uniform': st.Uniform, 'Exponential': st.Exponential, 'Poisson': st.Poisson,
    'Binomial': st.Binomial, 'Bernoulli': st.Bernoulli, 'Geometric': st.Geometric, 'Die': st.Die, 'Coin': st.Coin,
    'Gamma': st.Gamma, 'Beta': st.Beta, 'ChiSquared': st.ChiSquared, 'StudentT': st.StudentT, 'LogNormal': st.LogNormal,
    'Cauchy': st.Cauchy, 'Laplace': st.Laplace, 'Weibull': st.Weibull, 'Rayleigh': st.Rayleigh, 'Erlang': st.Erlang,
    'Pareto': st.Pareto, 'Hypergeometric': st.Hypergeometric, 'NegativeBinomial': st.NegativeBinomial,
}
GEO_CTORS = {
    'Point': lambda *a: geo.Point(*_flat_coords(a)), 'Line': geo.Line, 'Segment': geo.Segment, 'Ray': geo.Ray,
    'Circle': geo.Circle, 'Ellipse': geo.Ellipse, 'Triangle': geo.Triangle, 'Polygon': geo.Polygon,
}
OBJECT_CTORS = set(RV_CTORS) | set(GEO_CTORS)


def _flat_coords(a):
    if len(a) == 1 and isinstance(a[0], sp.MatrixBase):
        return list(a[0])
    return list(a)


def _make_object(b, name, node):
    if node.get('t') != 'fn' or node.get('n') not in OBJECT_CTORS:
        raise ValueError('%s is not a distribution or a geometric object' % name)
    args = [b.build(a) for a in node.get('args', [])]
    n = node['n']
    if n in RV_CTORS:
        if n == 'Die' and not args:
            args = [6]
        if n == 'Coin' and not args:
            args = [sp.Rational(1, 2)]
        return RV_CTORS[n](name, *args)
    return GEO_CTORS[n](*args)


def _builder_object(self, name):
    cache = self.__dict__.setdefault('_objects_built', {})
    if name in cache:
        return cache[name]
    busy = self.__dict__.setdefault('_objects_busy', set())
    if name in busy:
        raise ValueError('Circular definition of %s' % name)
    busy.add(name)
    try:
        cache[name] = _make_object(self, name, self.objects[name])
    finally:
        busy.discard(name)
    return cache[name]


Builder.object = _builder_object
for _n, _f in GEO_CTORS.items():
    FUNCS[_n] = _f


def _as_point(p):
    if isinstance(p, geo.Point):
        return p
    if isinstance(p, sp.MatrixBase) and len(p) == 2:
        return geo.Point(*list(p))
    raise ValueError('Expected a point, e.g. Point(1, 2) or [1, 2]')


def _geo(o):
    if isinstance(o, geo.entity.GeometryEntity):
        return o
    return _as_point(o)


X_, Y_ = sp.Symbol('x'), sp.Symbol('y')


def _geo_text(o):
    """(LaTeX, plain) for a geometric object."""
    if isinstance(o, geo.Point):
        return r'\left(%s\right)' % r',\ '.join(tex(c) for c in o.args), '(%s)' % ', '.join(plain(c) for c in o.args)
    if isinstance(o, (geo.Segment, geo.Ray)):
        kind = 'segment' if isinstance(o, geo.Segment) else 'ray'
        p, q = (_geo_text(o.p1), _geo_text(o.p2))
        return r'\text{%s } %s \to %s' % (kind, p[0], q[0]), '%s %s to %s' % (kind, p[1], q[1])
    if isinstance(o, geo.Line):
        eq = o.equation(X_, Y_)
        if eq.has(Y_):
            ys = sp.solve(eq, Y_)[0]
            return 'y = %s' % tex(ys), 'y = %s' % plain(ys)
        xs = sp.solve(eq, X_)[0]
        return 'x = %s' % tex(xs), 'x = %s' % plain(xs)
    if isinstance(o, geo.Circle):
        c = o.center
        lhs = (X_ - c.x) ** 2 + (Y_ - c.y) ** 2
        return '%s = %s' % (tex(lhs), tex(o.radius ** 2)), '%s = %s' % (plain(lhs), plain(o.radius ** 2))
    if isinstance(o, geo.Ellipse):
        eq = o.equation(X_, Y_)
        return '%s = 0' % tex(eq), '%s = 0' % plain(eq)
    if isinstance(o, geo.Polygon):
        pts = [_geo_text(v) for v in o.vertices]
        kind = 'triangle' if isinstance(o, geo.Triangle) else 'polygon'
        return r'\text{%s } %s' % (kind, r',\ '.join(p[0] for p in pts)), '%s %s' % (kind, ', '.join(p[1] for p in pts))
    return tex(o), plain(o)


def _geo_items(objs, labels=None):
    """Plot items (see plotspec.js) drawing geometric objects."""
    items = []
    labels = labels or {}
    for o in objs:
        lab = labels.get(id(o))
        if isinstance(o, geo.Point):
            items.append({'kind': 'point', 'x': plain(o.x), 'y': plain(o.y), 'label': lab or _geo_text(o)[1]})
        elif isinstance(o, (geo.Segment, geo.Ray)):
            p, q = o.p1, o.p2
            k = 1 if isinstance(o, geo.Segment) else 40
            items.append({'kind': 'param', 'x': plain(p.x + k * (q.x - p.x) * sp.Symbol('t')), 'y': plain(p.y + k * (q.y - p.y) * sp.Symbol('t')),
                          'v': 't', 't0': 0, 't1': 1, 'label': lab or _geo_text(o)[1]})
        elif isinstance(o, geo.Line):
            items.append({'kind': 'implicit', 'expr': plain(o.equation(X_, Y_)), 'label': lab or _geo_text(o)[1]})
        elif isinstance(o, geo.Circle):
            t = sp.Symbol('t')
            items.append({'kind': 'param', 'x': plain(o.center.x + o.radius * sp.cos(t)), 'y': plain(o.center.y + o.radius * sp.sin(t)),
                          'v': 't', 'label': lab or _geo_text(o)[1]})
        elif isinstance(o, geo.Ellipse):
            t = sp.Symbol('t')
            items.append({'kind': 'param', 'x': plain(o.center.x + o.hradius * sp.cos(t)), 'y': plain(o.center.y + o.vradius * sp.sin(t)),
                          'v': 't', 'label': lab or _geo_text(o)[1]})
        elif isinstance(o, geo.Polygon):
            vs = list(o.vertices)
            for p, q in zip(vs, vs[1:] + vs[:1]):
                items += _geo_items([geo.Segment(p, q)], {})
            items[-1]['label'] = lab or _geo_text(o)[1]
    return items


def _geo_plot(objs):
    """A plot spec framing the objects."""
    pts = []
    for o in objs:
        if isinstance(o, geo.Point):
            pts.append(o)
        elif isinstance(o, geo.Circle):
            pts += [o.center + geo.Point(o.radius, o.radius), o.center - geo.Point(o.radius, o.radius)]
        elif hasattr(o, 'vertices'):
            pts += list(o.vertices)
        elif hasattr(o, 'p1'):
            pts += [o.p1, o.p2]
    xs = [float(p.x) for p in pts if p.x.is_number]
    ys = [float(p.y) for p in pts if p.y.is_number]
    lo, hi = (min(xs + ys + [0]) - 1.5, max(xs + ys + [0]) + 1.5) if xs else (-10, 10)
    return {'items': _geo_items(objs), 'v': 'x', 'range': [lo, hi]}


def op_object(req, b):
    """Describe a newly defined object: a distribution's mean, variance and density, or a shape."""
    name = req['name']
    if name not in b.objects:
        raise ValueError('unknown object')
    o = b.object(name)
    if isinstance(o, sp.stats.rv.RandomSymbol):
        dist = o.pspace.distribution if hasattr(o.pspace, 'distribution') else st.density(o)
        kind = type(dist).__name__.replace('Distribution', '').replace('DiscreteUniform', 'Die')
        nargs = {'Binomial': 2, 'Bernoulli': 1, 'Die': 1, 'Hypergeometric': 3}.get(kind, 3)
        shown = [a for a in getattr(dist, 'args', ())[:nargs]]
        params = ', '.join(plain(a) for a in shown)
        steps = []
        for label, fn in (('Mean', st.E), ('Variance', st.variance)):
            try:
                v = _tidy(sp.simplify(fn(o)))
                steps.append({'d': label, 'tex': tex(v)})
            except Exception:
                pass
        x = sp.Symbol('k' if isinstance(o.pspace, sp.stats.drv.DiscretePSpace) or 'Die' in kind or 'Coin' in kind or kind in ('Binomial', 'Bernoulli', 'Hypergeometric') else 'x')
        try:
            d = st.density(o)
            if hasattr(d, 'items'):        # finite: list the probabilities
                pdf = None
                probs = sorted(d.items(), key=lambda kv: kv[0])
                steps.append({'d': 'Probability mass function', 'tex': r',\\ '.join(r'P(%s = %s) = %s' % (name, tex(k), tex(v)) for k, v in probs[:12])
                              + (r',\\ \ldots' if len(probs) > 12 else '')})
            else:
                pdf = sp.simplify(d(x))
                if isinstance(pdf, sp.Piecewise) and pdf.args[-1].expr == 0:
                    pdf = sp.simplify(pdf.args[0].expr)   # on the support
                steps.append({'d': 'Probability mass function' if x.name == 'k' else 'Density', 'tex': r'f(%s) = %s' % (tex(x), tex(pdf))})
        except Exception:
            pass
        return {'display': {'latex': r'%s \sim \operatorname{%s}\left(%s\right)' % (tex(sp.Symbol(name)), kind, ',\\ '.join(tex(a) for a in shown)),
                            'plain': '%s ~ %s(%s)' % (name, kind, params)}, 'steps': steps}
    lt, pt = _geo_text(o)
    out = {'display': {'latex': '%s:\\ %s' % (tex(sp.Symbol(name)), lt), 'plain': '%s: %s' % (name, pt)}, 'steps': []}
    if isinstance(o, geo.Polygon):
        out['steps'] = [{'d': 'Area', 'tex': tex(sp.Abs(o.area))}, {'d': 'Perimeter', 'tex': tex(sp.simplify(o.perimeter))}]
    elif isinstance(o, geo.Circle):
        out['steps'] = [{'d': 'Centre and radius', 'tex': r'%s,\ r = %s' % (_geo_text(o.center)[0], tex(o.radius))},
                        {'d': 'Area', 'tex': tex(sp.pi * o.radius ** 2)}]
    try:
        out['plotSpec'] = _geo_plot([o])
    except Exception:
        pass
    return out


OPS['object'] = op_object


# ── random-variable tools ──
def _rvs_of(e):
    return [s for s in e.atoms(sp.stats.rv.RandomSymbol)] if isinstance(e, sp.Basic) else []


def _need_rv(e, what):
    if not _rvs_of(e):
        raise ValueError('%s needs a random variable, e.g. X = Normal(0, 1) then %s' % (what, {'P': 'P(X > 1)', 'E': 'E(X^2)'}.get(what, what + '(X)')))


def _mp(v):
    return mpmath.inf if v is sp.oo else -mpmath.inf if v is -sp.oo else mpmath.mpf(sp.Rational(v).p) / sp.Rational(v).q if v.is_Rational else mpmath.mpf(str(sp.N(v, 40)))


def _cond_set(c, x):
    """The real numbers where a condition (relations joined by and / or / not) holds."""
    if isinstance(c, sp.And):
        return sp.Intersection(*[_cond_set(a, x) for a in c.args])
    if isinstance(c, sp.Or):
        return sp.Union(*[_cond_set(a, x) for a in c.args])
    if isinstance(c, sp.Not):
        return sp.Complement(sp.S.Reals, _cond_set(c.args[0], x))
    return sp.solveset(c, x, sp.S.Reals)


def _numeric_expectation(g, X, cond=None):
    """E[g(X)·1(cond)] for one random variable by direct numerical integration of its density
    over exactly the region where cond holds (or summation of its mass function) — a route
    independent of SymPy's symbolic integration."""
    try:
        ps = X.pspace
        x = sp.Dummy('x', real=True)
        with mpmath.workdps(30):
            if isinstance(ps, sp.stats.crv.SingleContinuousPSpace):
                region = ps.distribution.set
                if cond is not None:
                    region = sp.Intersection(region, _cond_set(cond.subs(X, x), x))
                parts = region.args if isinstance(region, sp.Union) else [region]
                h = sp.lambdify(x, g.subs(X, x) * st.density(X)(x), 'mpmath')
                total = mpmath.mpf(0)
                for iv in parts:
                    if iv is sp.S.EmptySet:
                        continue
                    if not isinstance(iv, sp.Interval):
                        return None
                    total += mpmath.quad(h, [_mp(iv.inf), _mp(iv.sup)])
                return complex(total)
            d = st.density(X)
            holds = lambda k: cond is None or bool(cond.subs(X, k))
            if hasattr(d, 'items'):                       # finite: {value: probability}
                return complex(sum(mpmath.mpf(str(sp.N(g.subs(X, k) * pk, 40))) for k, pk in d.items() if holds(k)))
            support = ps.distribution.set
            lo = support.inf
            if not (lo.is_integer and lo.is_finite):
                return None
            f = d(x)

            def term(k):
                k = int(k)
                return mpmath.mpf(str(sp.N(g.subs(X, k) * f.subs(x, k), 40))) if holds(k) else mpmath.mpf(0)
            return complex(mpmath.nsum(term, [int(lo), mpmath.inf]))
    except Exception:
        return None


def _stats_check(value_, g, X, cond=None):
    num = _numeric_expectation(g, X, cond)
    ex = _cnum(value_)
    if num is None or ex is None:
        return None
    how = 'agrees with direct numerical integration of the density' if isinstance(X.pspace, sp.stats.crv.SingleContinuousPSpace) \
        else 'agrees with direct summation of the probabilities'
    return verdict(_close(num, ex, 1e-8), how)


def t_P(cond, given=None):
    _need_rv(cond, 'P')
    r = st.P(cond, given) if given is not None else st.P(cond)
    r = _tidy(sp.simplify(r))
    rvs = _rvs_of(cond)
    check = None
    if given is None and len(rvs) == 1:
        X = rvs[0]
        check = _stats_check(r, sp.Integer(1), X, cond)
    return {'value': value(r), 'check': check, 'prefix': r'P\left(%s%s\right) = ' % (tex(cond), r' \mid ' + tex(given) if given is not None else '')}


def t_E(e, given=None):
    _need_rv(e, 'E')
    r = _tidy(sp.simplify(st.E(e, given) if given is not None else st.E(e)))
    rvs = _rvs_of(e)
    check = _stats_check(r, e, rvs[0]) if given is None and len(rvs) == 1 else None
    return {'value': value(r), 'check': check, 'prefix': r'\mathbb{E}\left[%s\right] = ' % tex(e)}


def t_Var(e):
    _need_rv(e, 'Var')
    r = _tidy(sp.simplify(st.variance(e)))
    rvs = _rvs_of(e)
    check = None
    if len(rvs) == 1:
        m = _numeric_expectation(e, rvs[0])
        m2 = _numeric_expectation(e ** 2, rvs[0])
        ex = _cnum(r)
        if m is not None and m2 is not None and ex is not None:
            check = verdict(_close(m2 - m * m, ex, 1e-8), 'E[X²] − E[X]² computed numerically from the density agrees')
    return {'value': value(r), 'check': check, 'prefix': r'\operatorname{Var}\left(%s\right) = ' % tex(e)}


def t_Std(e):
    _need_rv(e, 'Std')
    r = _tidy(sp.simplify(st.std(e)))
    return {'value': value(r), 'prefix': r'\sigma\left(%s\right) = ' % tex(e)}


def t_density(X):
    _need_rv(X, 'density')
    rvs = _rvs_of(X)
    discrete = not isinstance(rvs[0].pspace, sp.stats.crv.SingleContinuousPSpace)
    v = sp.Symbol('k' if discrete else 'x')
    f = _tidy(sp.simplify(st.density(X)(v)))
    out = {'value': value(f), 'prefix': r'f_{%s}(%s) = ' % (tex(X), tex(v))}
    if not discrete and not f.has(sp.Piecewise):
        out['plot'] = [plain(f)]
        out['plotVar'] = 'x'
    return out


def t_cdf(X):
    _need_rv(X, 'cdf')
    v = sp.Symbol('x')
    F = _tidy(sp.simplify(st.cdf(X)(v)))
    return {'value': value(F), 'prefix': r'F_{%s}(%s) = ' % (tex(X), tex(v))}


# ── geometry tools ──
def t_intersect(a, b):
    a, b = _geo(a), _geo(b)
    pts = a.intersection(b)
    steps = []
    if not pts:
        return show(r'\text{no intersection}', 'no intersection', steps)
    texts = [_geo_text(p) for p in pts]
    out = show(r',\quad '.join(t[0] for t in texts), ', '.join(t[1] for t in texts), steps)
    ok = all((not isinstance(p, geo.Point)) or (a.contains(p) if hasattr(a, 'contains') else True) and (b.contains(p) if hasattr(b, 'contains') else True)
             for p in pts if isinstance(p, geo.Point))
    out['check'] = verdict(ok, 'every point lies on both objects')
    out['plotSpec'] = _geo_plot([a, b] + [p for p in pts if isinstance(p, geo.Point)])
    return out


def t_distance(a, b):
    a, b = _geo(a), _geo(b)
    d = sp.simplify(a.distance(b) if hasattr(a, 'distance') else b.distance(a))
    return {'value': value(d), 'prefix': r'd = '}


def t_midpoint(a, b=None):
    m = _geo(a).midpoint if b is None else _as_point(a).midpoint(_as_point(b))
    lt, pt = _geo_text(m)
    return show(lt, pt, [])


def t_angle(a, b, c=None):
    if c is not None:
        A, B, C = _as_point(a), _as_point(b), _as_point(c)
        ang = geo.Line(B, A).angle_between(geo.Line(B, C))
        # angle at B between rays BA and BC, in [0, π]
        u, v = A - B, C - B
        cosv = sp.simplify((u.x * v.x + u.y * v.y) / (sp.sqrt(u.x ** 2 + u.y ** 2) * sp.sqrt(v.x ** 2 + v.y ** 2)))
        ang = sp.simplify(sp.acos(cosv))
    else:
        ang = sp.simplify(_geo(a).angle_between(_geo(b)))
    return {'value': value(ang), 'prefix': r'\theta = '}


def t_area(o):
    o = _geo(o)
    if isinstance(o, geo.Polygon):
        return {'value': value(sp.Abs(o.area)), 'prefix': r'\text{area} = '}
    if isinstance(o, geo.Ellipse):
        return {'value': value(o.area), 'prefix': r'\text{area} = '}
    raise ValueError('area needs a polygon, triangle, circle or ellipse')


def t_perimeter(o):
    o = _geo(o)
    p = o.perimeter if isinstance(o, geo.Polygon) else o.circumference if isinstance(o, geo.Ellipse) else None
    if p is None:
        raise ValueError('perimeter needs a polygon, triangle, circle or ellipse')
    return {'value': value(sp.simplify(p)), 'prefix': r'\text{perimeter} = '}


def _line_result(L, objs):
    lt, pt = _geo_text(L)
    out = show(lt, pt, [])
    out['plotSpec'] = _geo_plot(objs + [L])
    return out


def t_perpendicular(l, p):
    l, p = _geo(l), _as_point(p)
    return _line_result(l.perpendicular_line(p), [l, p])


def t_parallel(l, p):
    l, p = _geo(l), _as_point(p)
    return _line_result(l.parallel_line(p), [l, p])


def t_tangents(c, p):
    c, p = _geo(c), _as_point(p)
    ls = c.tangent_lines(p)
    texts = [_geo_text(L) for L in ls]
    out = show(r',\quad '.join(t[0] for t in texts) or r'\text{no tangent lines (the point is inside)}',
               '; '.join(t[1] for t in texts) or 'no tangent lines', [])
    out['plotSpec'] = _geo_plot([c, p] + list(ls))
    return out


def _tri(o):
    o = _geo(o)
    if not isinstance(o, geo.Triangle):
        raise ValueError('Expected a triangle, e.g. Triangle(A, B, C)')
    return o


def t_circumcircle(T):
    T = _tri(T)
    c = T.circumcircle
    lt, pt = _geo_text(c)
    out = show(lt, pt, [{'d': 'Centre (circumcentre) and radius', 'tex': r'%s,\ R = %s' % (_geo_text(c.center)[0], tex(c.radius))}])
    out['check'] = verdict(all(sp.simplify(c.center.distance(v) - c.radius) == 0 for v in T.vertices), 'every vertex lies on the circle')
    out['plotSpec'] = _geo_plot([T, c])
    return out


def t_incircle(T):
    T = _tri(T)
    c = T.incircle
    lt, pt = _geo_text(c)
    out = show(lt, pt, [{'d': 'Centre (incentre) and radius', 'tex': r'%s,\ r = %s' % (_geo_text(c.center)[0], tex(c.radius))}])
    out['check'] = verdict(all(sp.simplify(s.distance(c.center) - c.radius) == 0 for s in T.sides), 'the circle touches every side')
    out['plotSpec'] = _geo_plot([T, c])
    return out


def t_centroid(o):
    o = _geo(o)
    lt, pt = _geo_text(o.centroid)
    return show(lt, pt, [])


def t_equation(o):
    o = _geo(o)
    lt, pt = _geo_text(o)
    return show(lt, pt, [])


def t_draw(*objs):
    os_ = [_geo(o) for o in objs]
    words = '%d object%s' % (len(os_), '' if len(os_) == 1 else 's')
    out = show(r'\text{%s}' % words, words, [])
    out['plotSpec'] = _geo_plot(os_)
    return out


TOOLS.update({
    'P': t_P, 'E': t_E, 'Var': t_Var, 'Std': t_Std, 'density': t_density, 'cdf': t_cdf,
    'intersect': t_intersect, 'distance': t_distance, 'midpoint': t_midpoint, 'angle': t_angle, 'area': t_area,
    'perimeter': t_perimeter, 'perpendicular': t_perpendicular, 'parallel': t_parallel, 'tangents': t_tangents,
    'circumcircle': t_circumcircle, 'incircle': t_incircle, 'centroid': t_centroid, 'equation': t_equation, 'draw': t_draw,
})
FUNCS.update({'distance': lambda a, b: _geo(a).distance(_geo(b)), 'area': lambda o: sp.Abs(_geo(o).area),
              'perimeter': lambda o: _geo(o).perimeter})


# Distributions written inline (E(Die(6)), P(Normal(0, 1) > 1)) are anonymous random variables.
def _inline_rv(ctor, name):
    def make(*args):
        if name == 'Die' and not args:
            args = (6,)
        if name == 'Coin' and not args:
            args = (sp.Rational(1, 2),)
        return ctor('X', *args)
    return make


for _n, _c in RV_CTORS.items():
    FUNCS[_n] = _inline_rv(_c, _n)


# Constructions that make a new object from others: c = circumcircle(T), m = perpendicular(l, P)
GEO_CTORS.update({
    'circumcircle': lambda T: _tri(T).circumcircle, 'incircle': lambda T: _tri(T).incircle,
    'perpendicular': lambda l, p: _geo(l).perpendicular_line(_as_point(p)),
    'parallel': lambda l, p: _geo(l).parallel_line(_as_point(p)),
    'midpoint': lambda a, b=None: _geo(a).midpoint if b is None else _as_point(a).midpoint(_as_point(b)),
    'centroid': lambda o: _geo(o).centroid,
})
OBJECT_CTORS = set(RV_CTORS) | set(GEO_CTORS)


# ── plug-ins (plugins.js) ────────────────────────────────────────────────────
# A user's Python tool: the source defines t_<name>(...) and is run in its own namespace that
# sees sympy, show() and the tools. Built-in tool names cannot be replaced.
BUILTIN_TOOL_NAMES = set(TOOLS) | set(RAW_TOOLS)


def op_plugin(req, b):
    name, source = req.get('name', ''), req.get('source', '')
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name):
        raise ValueError('Plug-in names are identifiers.')
    if name in BUILTIN_TOOL_NAMES:
        raise ValueError(name + ' is a built-in tool.')
    ns = {'sp': sp, 'sympy': sp, 'show': show, 'tex': tex, 'TOOLS': TOOLS}
    exec(compile(source, '<plugin ' + name + '>', 'exec'), ns)
    fn = ns.get('t_' + name)
    if not callable(fn):
        raise ValueError('Define t_' + name + '(...) in the source.')
    TOOLS[name] = fn
    return {'ok': True, 'name': name}


OPS['plugin'] = op_plugin
