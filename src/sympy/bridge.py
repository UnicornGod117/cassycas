"""CassyCAS ⇄ SymPy bridge (runs inside Pyodide).

The JavaScript side never sends Python source. It sends a JSON expression tree whose
node types, operators and function names are checked against whitelists here, so user
input can only ever become SymPy objects — it cannot execute code.

Entry point: handle(request_json) -> response_json
"""
import json
import math
import re
from dataclasses import fields, is_dataclass

import sympy as sp
from sympy.printing.str import StrPrinter

IDENT = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
NUMBER = re.compile(r'^[0-9]*\.?[0-9]*(?:[eE][+-]?[0-9]+)?$')
MAX_NODES = 5000


# ── Printing back to mathjs syntax ─────────────────────────────────────────
class MathjsPrinter(StrPrinter):
    """str() output that mathjs can parse (^ for powers, i/e/Infinity/phi constants)."""

    def _print_Pow(self, expr, rational=False):
        return super()._print_Pow(expr, rational).replace('**', '^')

    def _print_ImaginaryUnit(self, e): return 'i'
    def _print_Exp1(self, e): return 'e'
    def _print_Infinity(self, e): return 'Infinity'
    def _print_NegativeInfinity(self, e): return '-Infinity'
    def _print_ComplexInfinity(self, e): return 'Infinity'
    def _print_NaN(self, e): return 'NaN'
    def _print_GoldenRatio(self, e): return 'phi'
    def _print_EulerGamma(self, e): return '0.5772156649015329'
    def _print_Catalan(self, e): return '0.915965594177219'
    def _print_Abs(self, e): return 'abs(%s)' % self._print(e.args[0])
    def _print_ceiling(self, e): return 'ceil(%s)' % self._print(e.args[0])
    def _print_conjugate(self, e): return 'conj(%s)' % self._print(e.args[0])
    def _print_Heaviside(self, e): return 'heaviside(%s)' % self._print(e.args[0])
    def _print_Mod(self, e): return 'mod(%s, %s)' % (self._print(e.args[0]), self._print(e.args[1]))
    def _print_binomial(self, e): return 'combinations(%s, %s)' % (self._print(e.args[0]), self._print(e.args[1]))

    def _print_Max(self, e): return 'max(%s)' % self.stringify(e.args, ', ')
    def _print_Min(self, e): return 'min(%s)' % self.stringify(e.args, ', ')

    def _print_MatrixBase(self, m):
        return '[' + ', '.join('[' + ', '.join(self._print(v) for v in row) + ']' for row in m.tolist()) + ']'

    _print_ImmutableDenseMatrix = _print_MatrixBase
    _print_MutableDenseMatrix = _print_MatrixBase


_printer = MathjsPrinter()


def plain(e):
    return _printer.doprint(e)


def tex(e):
    return sp.latex(e, ln_notation=True)


def approx(e):
    """(re, im) floats for a closed numeric value, else None."""
    try:
        if isinstance(e, (sp.MatrixBase, sp.Set, sp.logic.boolalg.Boolean, sp.Rel)):
            return None
        if not getattr(e, 'is_number', False) or e.free_symbols:
            return None
        v = sp.N(e, 17)
        re_, im_ = sp.re(v), sp.im(v)
        if re_.is_comparable is False or im_.is_comparable is False:
            return None
        pair = [float(re_), float(im_)]
        return pair if all(math.isfinite(c) for c in pair) else None
    except Exception:
        return None


def value(e):
    out = {'latex': tex(e), 'plain': plain(e), 'approx': approx(e)}
    if isinstance(e, sp.MatrixBase):
        out['matrix'] = True
    return out


# ── Building SymPy objects from the JSON tree ──────────────────────────────
def _log(*a):
    return sp.log(a[0]) if len(a) == 1 else sp.log(a[0], a[1])


def _perm(n, k):
    return sp.factorial(n) / sp.factorial(n - k)


FUNCS = {
    'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan, 'sec': sp.sec, 'csc': sp.csc, 'cot': sp.cot,
    'asin': sp.asin, 'acos': sp.acos, 'atan': sp.atan, 'asec': sp.asec, 'acsc': sp.acsc, 'acot': sp.acot,
    'sinh': sp.sinh, 'cosh': sp.cosh, 'tanh': sp.tanh, 'sech': sp.sech, 'csch': sp.csch, 'coth': sp.coth,
    'asinh': sp.asinh, 'acosh': sp.acosh, 'atanh': sp.atanh, 'atan2': sp.atan2,
    'exp': sp.exp, 'log': _log, 'ln': sp.log, 'log10': lambda x: sp.log(x, 10), 'log2': lambda x: sp.log(x, 2),
    'sqrt': sp.sqrt, 'cbrt': lambda x: sp.real_root(x, 3), 'nthRoot': lambda x, n: sp.real_root(x, n),
    'abs': sp.Abs, 'sign': sp.sign, 'floor': sp.floor, 'ceil': sp.ceiling, 'round': lambda x: sp.floor(x + sp.Rational(1, 2)),
    'factorial': sp.factorial, 'gamma': sp.gamma, 'erf': sp.erf, 'beta': sp.beta,
    're': sp.re, 'im': sp.im, 'conj': sp.conjugate, 'arg': sp.arg,
    'max': sp.Max, 'min': sp.Min, 'mod': sp.Mod, 'gcd': sp.gcd, 'lcm': sp.lcm,
    'combinations': sp.binomial, 'binomial': sp.binomial, 'permutations': _perm,
    'heaviside': sp.Heaviside, 'isPrime': sp.isprime,
    'det': lambda m: sp.Matrix(m).det(), 'inv': lambda m: sp.Matrix(m).inv(), 'transpose': lambda m: sp.Matrix(m).T,
    'trace': lambda m: sp.Matrix(m).trace(), 'rank': lambda m: sp.Integer(sp.Matrix(m).rank()),
    'cross': lambda a, b: sp.Matrix(a).cross(sp.Matrix(b)), 'dot': lambda a, b: sp.Matrix(a).dot(sp.Matrix(b)),
    'norm': lambda m: sp.Matrix(m).norm(),
}
TRIG = {'sin', 'cos', 'tan', 'sec', 'csc', 'cot'}
ATRIG = {'asin', 'acos', 'atan', 'asec', 'acsc', 'acot'}
CONST = {
    'pi': sp.pi, 'e': sp.E, 'i': sp.I, 'Infinity': sp.oo, 'phi': sp.GoldenRatio, 'tau': 2 * sp.pi,
    'true': sp.true, 'false': sp.false, 'NaN': sp.nan, 'deg': sp.pi / 180,
}
BINOPS = {
    '+': lambda a, b: a + b, '-': lambda a, b: a - b, '*': lambda a, b: a * b, '/': lambda a, b: a / b,
    '^': lambda a, b: a ** b, '%': sp.Mod,
    '==': sp.Eq, '!=': sp.Ne, '<': sp.Lt, '>': sp.Gt, '<=': sp.Le, '>=': sp.Ge,
    'and': sp.And, 'or': sp.Or, 'xor': sp.Xor,
}


class Builder:
    def __init__(self, deg=False, undefined_functions=False, deriv_ctx=None):
        self.deg = deg
        self.undefined_functions = undefined_functions
        self.deriv_ctx = deriv_ctx      # (function name, variable symbol) for dsolve primes
        self.symbols = {}
        self.count = 0

    def sym(self, name):
        if not IDENT.match(name):
            raise ValueError('invalid symbol name')
        if name not in self.symbols:
            self.symbols[name] = sp.Symbol(name)
        return self.symbols[name]

    @staticmethod
    def mentions(node, name):
        if node.get('t') == 'sym' and node.get('n') == name:
            return True
        return any(Builder.mentions(c, name) for c in node.get('args', []) + node.get('items', [])
                   + [x for r in node.get('rows', []) for x in r])

    def build(self, node):
        self.count += 1
        if self.count > MAX_NODES:
            raise ValueError('expression too large')
        t = node.get('t')
        if t == 'num':
            v = str(node['v'])
            if not NUMBER.match(v) or not re.search(r'\d', v):
                raise ValueError('invalid number')
            return sp.Rational(v)
        if t == 'sym':
            n = node['n']
            if n in CONST:
                return CONST[n]
            if self.deriv_ctx and n == self.deriv_ctx[0]:
                return sp.Function(n)(self.deriv_ctx[1])
            return self.sym(n)
        if t == 'op':
            op, args = node['op'], node['args']
            if op == 'neg':
                return -self.build(args[0])
            if op == 'pos':
                return self.build(args[0])
            if op == 'not':
                return sp.Not(self.build(args[0]))
            if op == '!':
                return sp.factorial(self.build(args[0]))
            if op in BINOPS and len(args) == 2:
                return BINOPS[op](self.build(args[0]), self.build(args[1]))
            raise ValueError('unsupported operator ' + str(op))
        if t == 'fn':
            n, raw = node['n'], node['args']
            if not IDENT.match(n):
                raise ValueError('invalid function name')
            if n == '__deriv' and self.deriv_ctx:
                name, var = self.deriv_ctx
                return sp.Derivative(sp.Function(name)(var), var, int(raw[1]['v']))
            if n == 'diff' and len(raw) >= 2:
                a = [self.build(x) for x in raw]
                return sp.Derivative(*a)
            args = [self.build(x) for x in raw]
            if n in FUNCS:
                if self.deg and n in TRIG and not self.mentions(raw[0], 'deg'):
                    return FUNCS[n](args[0] * sp.pi / 180)
                if self.deg and n in ATRIG:
                    return FUNCS[n](*args) * 180 / sp.pi
                return FUNCS[n](*args)
            if self.undefined_functions or (self.deriv_ctx and n == self.deriv_ctx[0]):
                return sp.Function(n)(*args)
            raise ValueError('Unsupported function: ' + n)
        if t == 'mat':
            return sp.Matrix([[self.build(x) for x in row] for row in node['rows']])
        if t == 'vec':
            return sp.Matrix([self.build(x) for x in node['items']])
        raise ValueError('unsupported expression')


# ── Step-by-step explanations ──────────────────────────────────────────────
RULE_TEXT = {
    'ConstantRule': 'Integral of a constant', 'ConstantTimesRule': 'Constant multiple rule — pull the constant out',
    'PowerRule': 'Power rule  ∫uⁿ du = uⁿ⁺¹/(n+1)', 'AddRule': 'Sum rule — integrate term by term',
    'URule': 'Substitution', 'PartsRule': 'Integration by parts  ∫u dv = uv − ∫v du',
    'CyclicPartsRule': 'Integration by parts (the integral reappears — solve for it)',
    'TrigRule': 'Standard trigonometric integral', 'ExpRule': 'Exponential rule', 'ReciprocalRule': 'Reciprocal rule  ∫1/u du = ln|u|',
    'ArctanRule': 'Arctangent form', 'ArcsinRule': 'Arcsine form', 'RewriteRule': 'Rewrite the integrand',
    'DontKnowRule': 'No elementary rule applies', 'DerivativeRule': 'The integrand is a derivative',
    'TrigSubstitutionRule': 'Trigonometric substitution', 'PiecewiseRule': 'Integrate piece by piece',
    'HeavisideRule': 'Heaviside step', 'ErfRule': 'Gaussian integral (error function)',
    'CompleteSquareRule': 'Complete the square', 'SinRule': '∫sin u du = −cos u', 'CosRule': '∫cos u du = sin u',
    'Sec2Rule': '∫sec²u du = tan u', 'Csc2Rule': '∫csc²u du = −cot u', 'SecTanRule': '∫sec u tan u du = sec u',
    'CscCotRule': '∫csc u cot u du = −csc u', 'SinhRule': '∫sinh u du = cosh u', 'CoshRule': '∫cosh u du = sinh u',
    'ReciprocalSqrtQuadraticRule': 'Standard form 1/√(quadratic)', 'PolynomialDivisionRule': 'Polynomial division',
}


def _camel(name):
    return re.sub(r'(?<!^)(?=[A-Z])', ' ', name.replace('Rule', '')).strip() or name


def integral_steps_list(f, x):
    try:
        from sympy.integrals.manualintegrate import integral_steps
        root = integral_steps(f, x)
    except Exception:
        return []
    out = []

    def walk(rule, depth):
        if rule is None or depth > 8 or len(out) >= 24 or not is_dataclass(rule):
            return
        name = type(rule).__name__
        if name == 'AlternativeRule' and getattr(rule, 'alternatives', None):
            walk(rule.alternatives[0], depth)
            return
        desc = RULE_TEXT.get(name, _camel(name))
        try:
            if name == 'URule':
                desc += ':  u = %s' % plain(rule.u_func)
            elif name == 'PartsRule':
                desc += ':  u = %s,  dv = %s' % (plain(rule.u), plain(rule.dv))
            elif name == 'RewriteRule':
                desc += ' as  %s' % plain(rule.rewritten)
        except Exception:
            pass
        try:
            res = rule.eval()
            step_tex = r'\int %s \, d%s = %s' % (tex(rule.integrand), tex(rule.variable), tex(res))
        except Exception:
            step_tex = r'\int %s \, d%s' % (tex(rule.integrand), tex(rule.variable))
        out.append({'d': desc, 'tex': step_tex})
        for fld in fields(rule):
            v = getattr(rule, fld.name, None)
            if is_dataclass(v) and hasattr(v, 'integrand'):
                walk(v, depth + 1)
            elif isinstance(v, (list, tuple)):
                for item in v:
                    if is_dataclass(item) and hasattr(item, 'integrand'):
                        walk(item, depth + 1)

    walk(root, 0)
    return out


def diff_steps_list(e, x):
    out = []

    def walk(e, depth):
        if depth > 6 or len(out) >= 20 or not e.has(x):
            return
        d = sp.diff(e, x)
        children, rule = [], None
        if e == x:
            return
        if e.is_Add:
            rule, children = 'Sum rule — differentiate term by term', list(e.args)
        elif e.is_Mul:
            const, var = e.as_independent(x)
            if const != 1:
                rule, children = 'Constant multiple rule', [var]
            else:
                rule, children = 'Product rule  (uv)′ = u′v + uv′', list(e.args)
        elif e.is_Pow:
            b, p = e.args
            if not p.has(x):
                rule = 'Power rule' + (' with the chain rule' if b != x else '')
                children = [b]
            elif not b.has(x):
                rule = 'Exponential rule' + (' with the chain rule' if p != x else '')
                children = [p]
            else:
                rule, children = 'Logarithmic differentiation', []
        elif isinstance(e, sp.Function) and e.args:
            arg = e.args[0]
            rule = 'Derivative of %s' % e.func.__name__ + (' with the chain rule' if arg != x else '')
            children = [arg]
        if rule:
            out.append({'d': rule, 'tex': r'\frac{d}{d%s}\left[%s\right] = %s' % (tex(x), tex(e), tex(d))})
        for c in children:
            if c != x:
                walk(c, depth + 1)

    walk(e, 0)
    return out


def limit_steps(f, x, a, direction):
    steps = []
    try:
        if a.is_finite:
            direct = f.subs(x, a)
            if direct.is_finite and direct is not sp.nan and not direct.has(sp.zoo):
                steps.append({'d': 'Direct substitution', 'tex': r'%s\big|_{%s=%s} = %s' % (tex(f), tex(x), tex(a), tex(direct))})
                return steps
        n, d = sp.fraction(sp.together(f))
        if d.has(x):
            n0, d0 = sp.limit(n, x, a, direction), sp.limit(d, x, a, direction)
            if (n0 == 0 and d0 == 0) or (n0.is_infinite and d0.is_infinite):
                form = r'\frac{0}{0}' if n0 == 0 else r'\frac{\infty}{\infty}'
                steps.append({'d': "Indeterminate form — apply L'Hôpital's rule", 'tex': r'%s \;\Rightarrow\; \lim \frac{%s}{%s}' % (form, tex(sp.diff(n, x)), tex(sp.diff(d, x)))})
    except Exception:
        pass
    steps.append({'d': 'Evaluated with the Gruntz algorithm (exact)', 'tex': ''})
    return steps


# ── Operations ─────────────────────────────────────────────────────────────
def _var(b, name):
    return b.sym(name)


def op_eval(req, b):
    return {'value': value(b.build(req['expr']))}


def op_transform(req, b):
    e = b.build(req['expr'])
    kind = req['kind']
    v = _var(b, req['var']) if req.get('var') else None
    if kind == 'simplify':
        r = sp.simplify(e)
    elif kind == 'expand':
        r = sp.expand(e)
    elif kind == 'factor':
        r = sp.factor(e, v) if v is not None and len(e.free_symbols) > 1 else sp.factor(e)
    elif kind == 'apart':
        r = sp.apart(e, v) if v is not None else sp.apart(e)
    elif kind == 'together':
        r = sp.together(e)
    elif kind == 'cancel':
        r = sp.cancel(e)
    elif kind == 'collect':
        r = sp.collect(sp.expand(e), v)
    elif kind == 'rationalize':
        r = sp.radsimp(e)
    elif kind == 'trigsimp':
        r = sp.trigsimp(e)
    elif kind == 'expand_trig':
        r = sp.expand_trig(e)
    else:
        raise ValueError('unknown transform')
    return {'value': value(r)}


def op_polydiv(req, b):
    p, q = b.build(req['p']), b.build(req['q'])
    v = _var(b, req['var'])
    quo, rem = sp.div(p, q, v)
    return {'quotient': value(quo), 'remainder': value(rem)}


def op_diff(req, b):
    e = b.build(req['expr'])
    v = _var(b, req['var'])
    n = int(req.get('order', 1))
    r = sp.simplify(sp.diff(e, v, n)) if n > 1 else sp.diff(e, v)
    r2 = sp.simplify(r)
    if sp.count_ops(r2) <= sp.count_ops(r):
        r = r2
    steps = diff_steps_list(e, v) if n == 1 else []
    return {'value': value(r), 'steps': steps}


def op_integrate(req, b):
    f = b.build(req['expr'])
    v = _var(b, req['var'])
    if req.get('a') is not None:
        a, c = b.build(req['a']), b.build(req['b'])
        r = sp.integrate(f, (v, a, c))
        exact = not r.has(sp.Integral)
        if not exact:
            r = sp.Integral(f, (v, a, c)).evalf(15)
        return {'value': value(r), 'exact': exact, 'steps': integral_steps_list(f, v) if exact else []}
    steps = integral_steps_list(f, v)
    r = sp.integrate(f, v)
    if r.has(sp.Integral):
        return {'noForm': True, 'steps': steps}
    simp = sp.simplify(r)
    if sp.count_ops(simp) < sp.count_ops(r):
        r = simp
    return {'value': value(r), 'steps': steps}


def op_limit(req, b):
    f = b.build(req['expr'])
    v = _var(b, req['var'])
    a = b.build(req['point'])
    d = req.get('dir') or ''
    # An AccumBounds result means the function oscillates: the limit does not exist.
    osc = lambda r: {'dne': True, 'oscillates': [value(r.min), value(r.max)], 'steps': []}
    if d in ('+', '-'):
        r = sp.limit(f, v, a, d)
        if isinstance(r, sp.AccumBounds):
            return osc(r)
        return {'value': value(r), 'steps': limit_steps(f, v, a, d)}
    if a.is_infinite:
        r = sp.limit(f, v, a)
        if isinstance(r, sp.AccumBounds):
            return osc(r)
        return {'value': value(r), 'steps': limit_steps(f, v, a, '-' if a == sp.oo else '+')}
    left, right = sp.limit(f, v, a, '-'), sp.limit(f, v, a, '+')
    if isinstance(left, sp.AccumBounds) or isinstance(right, sp.AccumBounds):
        return osc(left if isinstance(left, sp.AccumBounds) else right)
    steps = limit_steps(f, v, a, '+')
    if left == right:
        return {'value': value(right), 'steps': steps}
    return {'dne': True, 'left': value(left), 'right': value(right), 'steps': steps}


def op_series(req, b):
    f = b.build(req['expr'])
    v = _var(b, req['var'])
    a = b.build(req['point'])
    n = max(0, min(int(req.get('order', 6)), 30))
    s = sp.series(f, v, a, n + 1)
    poly = s.removeO()
    order_tex = tex(sp.Order((v - a) ** (n + 1), (v, a))) if a != 0 else r'O\left(%s^{%d}\right)' % (tex(v), n + 1)
    out = value(poly)
    out['plain'], out['latex'] = _ascending(poly, v, a)
    return {'value': out, 'orderTex': order_tex,
            'orderPlain': 'O(%s)' % plain((v - a) ** (n + 1))}


def _ascending(poly, v, a):
    """Print a series in ascending powers of (v - a), e.g. -1 + (x - pi)^2/2."""
    t = sp.Dummy('t')
    shifted = sp.expand(poly.subs(v, t + a)) if a != 0 else sp.expand(poly.subs(v, t))
    terms = sorted((term.as_coeff_exponent(t) for term in sp.Add.make_args(shifted)), key=lambda ce: ce[1])
    if a == 0:
        base, base_tex = v, None
    else:
        base = sp.Symbol('(%s)' % plain(v - a))
        base_tex = {base: r'\left(%s\right)' % tex(v - a)}
    ps, ts = [], []
    for c, k in terms:
        term = c * base ** k
        ps.append(plain(term))
        ts.append(sp.latex(term, ln_notation=True, symbol_names=base_tex) if base_tex else tex(term))
    if not ps:
        return '0', '0'
    join = lambda parts: parts[0] + ''.join(' - ' + p[1:].lstrip() if p.startswith('-') else ' + ' + p for p in parts[1:])
    return join(ps), join(ts)


def op_sum(req, b, product=False):
    f = b.build(req['expr'])
    v = _var(b, req['var'])
    lo, hi = b.build(req['a']), b.build(req['b'])
    r = sp.product(f, (v, lo, hi)) if product else sp.summation(f, (v, lo, hi))
    if isinstance(r, (sp.Sum, sp.Product)) or r.has(sp.Sum, sp.Product):
        return {'noForm': True}
    return {'value': value(_tidy(r))}


def _tidy(r):
    """Pick the most compact of simplify/factor."""
    best = r
    for cand in (sp.simplify, sp.factor):
        try:
            c = cand(r)
            if sp.count_ops(c) < sp.count_ops(best):
                best = c
        except Exception:
            pass
    return best


def _solution_values(sols):
    return [value(s) for s in sols]


def op_solve(req, b):
    lhs, rhs = b.build(req['lhs']), b.build(req['rhs'])
    v = _var(b, req['var'])
    rel = req.get('rel', '=')
    steps = []
    if rel != '=':
        ineq = BINOPS[rel](lhs, rhs)
        s = sp.solveset(ineq, v, domain=sp.S.Reals)
        steps.append({'d': 'Solve the inequality over ℝ', 'tex': tex(s)})
        return {'set': value(s), 'steps': steps}
    f = sp.together(lhs - rhs)
    num, den = sp.fraction(f)
    steps.append({'d': 'Rewrite as f = 0', 'tex': '%s = 0' % tex(lhs - rhs)})
    poly = None
    try:
        poly = sp.Poly(num, v)
        if any(c.has(v) for c in poly.coeffs()):
            poly = None
    except Exception:
        poly = None
    if poly is not None and poly.degree() >= 1:
        fac = sp.factor(num, v) if len(num.free_symbols) > 1 else sp.factor(num)
        if fac != num:
            steps.append({'d': 'Factor', 'tex': '%s = 0' % tex(fac)})
        roots = sp.roots(poly, multiple=True)
        if len(roots) < poly.degree():
            roots = sp.solve(num, v)
        uniq = []
        for r in roots:
            if not any(sp.simplify(r - u) == 0 for u in uniq):
                uniq.append(r)
        if den.has(v):
            uniq = [r for r in uniq if sp.simplify(den.subs(v, r)) != 0]
        if not uniq and poly.degree() >= 5:
            uniq = [sp.CRootOf(poly, k) for k in range(poly.degree())]
        return {'solutions': _solution_values(uniq), 'steps': steps}
    s = sp.solveset(sp.Eq(lhs, rhs), v, domain=sp.S.Reals)
    if isinstance(s, sp.FiniteSet):
        return {'solutions': _solution_values(list(s)), 'steps': steps + [{'d': 'Solved over ℝ', 'tex': tex(s)}]}
    if isinstance(s, sp.ConditionSet) or s is None:
        return {'unsolved': True, 'steps': steps}
    steps.append({'d': 'General solution over ℝ', 'tex': tex(s)})
    return {'set': value(s), 'steps': steps}


def op_solve_system(req, b):
    eqs = [sp.Eq(b.build(e['lhs']), b.build(e['rhs'])) for e in req['eqs']]
    vs = [_var(b, n) for n in req['vars']]
    sols = sp.solve(eqs, vs, dict=True)
    return {'systems': [[{'var': str(k), **value(sol[k])} for k in vs if k in sol] for sol in sols]}


def op_dsolve(req, b):
    fname, xname = req['func'], req['var']
    x = b.sym(xname)
    b.deriv_ctx = (fname, x)
    b.undefined_functions = True
    lhs, rhs = b.build(req['lhs']), b.build(req['rhs'])
    y = sp.Function(fname)(x)
    ics = {}
    for ic in req.get('ics', []):
        at, val = b.build(ic['at']), b.build(ic['value'])
        k = int(ic.get('order', 0))
        key = y.subs(x, at) if k == 0 else sp.Derivative(y, x, k).subs(x, at)
        ics[key] = val
    sol = sp.dsolve(sp.Eq(lhs, rhs), y, ics=ics or None)
    sols = sol if isinstance(sol, list) else [sol]
    return {'solutions': [{'latex': tex(s), 'plain': plain(s.rhs) if isinstance(s, sp.Eq) else plain(s),
                           'approx': None} for s in sols]}


def op_matrix(req, b):
    m = b.build(req['expr'])
    if not isinstance(m, sp.MatrixBase):
        raise ValueError('expected a matrix')
    kind = req['kind']
    if kind == 'eigs':
        ev = m.eigenvals()
        vals = []
        for k, mult in ev.items():
            vals += [k] * mult
        vecs = []
        try:
            for val, mult, basis in m.eigenvects():
                vecs.append({'value': value(val), 'vectors': [value(sp.simplify(v)) for v in basis]})
        except Exception:
            pass
        return {'values': _solution_values(vals), 'vectors': vecs}
    if kind == 'rref':
        return {'value': value(m.rref()[0])}
    if kind == 'nullspace':
        return {'values': _solution_values(m.nullspace())}
    if kind == 'charpoly':
        lam = sp.Symbol('lambda')
        return {'value': value(m.charpoly(lam).as_expr())}
    raise ValueError('unknown matrix operation')


def op_gradient(req, b):
    f = b.build(req['expr'])
    vs = [_var(b, n) for n in req['vars']]
    return {'values': [value(sp.simplify(sp.diff(f, v))) for v in vs]}


OPS = {
    'eval': op_eval, 'transform': op_transform, 'polydiv': op_polydiv, 'diff': op_diff,
    'integrate': op_integrate, 'limit': op_limit, 'series': op_series,
    'sum': op_sum, 'product': lambda r, b: op_sum(r, b, product=True),
    'solve': op_solve, 'solveSystem': op_solve_system, 'dsolve': op_dsolve,
    'matrix': op_matrix, 'gradient': op_gradient,
}


def handle(request_json):
    try:
        req = json.loads(request_json)
        op = OPS.get(req.get('op'))
        if op is None:
            raise ValueError('unknown operation')
        b = Builder(deg=bool(req.get('deg')), undefined_functions=bool(req.get('undefinedFunctions')))
        return json.dumps({'ok': True, **op(req, b)}, allow_nan=False)
    except Exception as err:  # reported to the UI, never re-raised into JS
        msg = str(err) or type(err).__name__
        return json.dumps({'ok': False, 'error': msg[:300]})
