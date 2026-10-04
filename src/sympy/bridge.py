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
from sympy.core.function import AppliedUndef
from sympy.printing.latex import LatexPrinter
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
    def _print_ComplexInfinity(self, e): return 'ComplexInfinity'
    def _print_NaN(self, e): return 'undefined'
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


class TexPrinter(LatexPrinter):
    """SymPy's LaTeX, with f'(x) for derivatives of abstract one-variable functions."""

    def _print_Derivative(self, expr):
        f, vs = expr.expr, expr.variables
        if isinstance(f, AppliedUndef) and len(f.args) == 1 and len(vs) <= 3 and set(vs) == {f.args[0]}:
            return r'%s%s\left(%s\right)' % (self._print(sp.Symbol(f.func.__name__)), "'" * len(vs), self._print(f.args[0]))
        return super()._print_Derivative(expr)


_tex_printer = TexPrinter({'ln_notation': True})


def tex(e):
    return _tex_printer.doprint(e)


# Results whose plain form mathjs cannot represent faithfully are displayed from LaTeX.
TEX_ONLY = re.compile(r'\b(Derivative|Integral|Piecewise|RootOf|Sum|Product|Subs|AccumBounds|Lambda|ImageSet|Interval|Union|Order)\(')


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
    if e is sp.nan:
        return {'latex': r'\text{undefined}', 'plain': 'undefined', 'approx': None, 'special': True}
    if e is sp.zoo:
        return {'latex': r'\tilde{\infty}', 'plain': 'ComplexInfinity', 'approx': None, 'special': True}
    out = {'latex': tex(e), 'plain': plain(e), 'approx': approx(e)}
    if isinstance(e, sp.MatrixBase):
        out['matrix'] = True
    if TEX_ONLY.search(out['plain']):
        out['texOnly'] = True
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
    'pi': sp.pi, 'e': sp.E, 'i': sp.I, 'Infinity': sp.oo, 'oo': sp.oo, 'phi': sp.GoldenRatio, 'tau': 2 * sp.pi,
    'true': sp.true, 'false': sp.false, 'NaN': sp.nan, 'deg': sp.pi / 180,
}
# Unknown one-letter names called like functions (f(x), g(t), y1(x)) are abstract functions,
# so diff(f(x)*g(x), x) gives the product rule. Longer unknown names are reported as errors.
ABSTRACT_FN = re.compile(r'^[A-Za-z][0-9]?$')
# Assumptions a workspace may place on a symbol with assume(...).
ASSUMPTIONS = {'real', 'positive', 'negative', 'nonnegative', 'nonpositive', 'nonzero', 'integer', 'rational', 'complex'}
BINOPS = {
    '+': lambda a, b: a + b, '-': lambda a, b: a - b, '*': lambda a, b: a * b, '/': lambda a, b: a / b,
    '^': lambda a, b: a ** b, '%': sp.Mod,
    '==': sp.Eq, '!=': sp.Ne, '<': sp.Lt, '>': sp.Gt, '<=': sp.Le, '>=': sp.Ge,
    'and': sp.And, 'or': sp.Or, 'xor': sp.Xor,
}


class Builder:
    def __init__(self, deg=False, undefined_functions=False, deriv_ctx=None, assume=None):
        self.deg = deg
        self.undefined_functions = undefined_functions
        self.deriv_ctx = deriv_ctx      # (function name, variable symbol) for dsolve primes
        self.symbols = {}
        self.count = 0
        self.assume = {}
        for name, flags in (assume or {}).items():
            if not IDENT.match(name) or not isinstance(flags, list) or not set(flags) <= ASSUMPTIONS:
                raise ValueError('invalid assumption')
            self.assume[name] = {f: True for f in flags}

    def sym(self, name):
        if not IDENT.match(name):
            raise ValueError('invalid symbol name')
        if name not in self.symbols:
            self.symbols[name] = sp.Symbol(name, **self.assume.get(name, {}))
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
            if self.undefined_functions or (self.deriv_ctx and n == self.deriv_ctx[0]) or ABSTRACT_FN.match(n):
                return sp.Function(n)(*args)
            raise ValueError('Unknown function: ' + n)
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


# ── Verification ───────────────────────────────────────────────────────────
# Every result that can be checked independently of the method that produced it is checked,
# and the outcome travels with the result: {'status': 'verified' | 'failed', 'how': text}.
# A result with no check carries no verdict (rather than a claimed one).
VPOINTS = [sp.Rational(n, 100) for n in (37, 113, 171, 229, 61, 283, 89)]


def verdict(ok, how):
    if ok is None:
        return None
    return {'status': 'verified' if ok else 'failed', 'how': how}


def _cnum(e, prec=30):
    """A finite complex value of a closed expression, else None."""
    try:
        v = complex(sp.N(e, prec))
    except Exception:
        return None
    return v if math.isfinite(v.real) and math.isfinite(v.imag) else None


def _close(a, b, tol=1e-9):
    return abs(a - b) <= tol * (1 + abs(b))


def _points(syms, k):
    """Distinct sample values for each symbol at sample k (positive reals, away from 0 and 1)."""
    return {s: VPOINTS[(k + 2 * j) % len(VPOINTS)] + sp.Rational(j, 7) for j, s in enumerate(syms)}


def numerically_equal(a, b, syms=None, tol=1e-9):
    """True / False when a and b were compared at enough points, None when they could not be."""
    syms = sorted((sp.sympify(a).free_symbols | sp.sympify(b).free_symbols), key=str) if syms is None else syms
    good = 0
    for k in range(len(VPOINTS)):
        subs = _points(syms, k)
        va, vb = _cnum(sp.sympify(a).xreplace(subs)), _cnum(sp.sympify(b).xreplace(subs))
        if va is None or vb is None:
            continue
        if not _close(va, vb, tol):
            return False
        good += 1
    return True if good >= 3 else None


def check_antiderivative(F, f, x):
    try:
        same = numerically_equal(sp.diff(F, x), f)
    except Exception:
        same = None
    return verdict(same, 'differentiated the result and compared it with the integrand at sample points')


def check_identity(before, after, what):
    try:
        same = numerically_equal(before, after)
    except Exception:
        same = None
    return verdict(same, 'compared the %s with the input at sample points' % what)


def check_definite(r, f, x, a, c):
    """Compare an exact definite integral with numerical quadrature."""
    exact = _cnum(r)
    if exact is None:
        return None
    try:
        n = sp.Integral(f, (x, a, c)).evalf(20, maxn=200)
        # evalf reports how many bits it could vouch for: oscillatory tails (sin(x²) on [0, ∞))
        # come back as "-0.e+104", which is no evidence either way
        q = _cnum(n) if all(fl._prec >= 40 for fl in n.atoms(sp.Float) if fl != 0) else None
    except Exception:
        q = None
    if q is None:
        return None
    if _close(q, exact, 1e-7):
        return verdict(True, 'agrees with numerical quadrature')
    if _close(q, exact, 1e-3):
        return None
    return verdict(False, 'numerical quadrature gives %.10g' % q.real if abs(q.imag) < 1e-12 else 'numerical quadrature disagrees')


def _approach(x, a, direction):
    """Points tending to a (from the given side) for a numerical limit check."""
    # Floats, so that e.g. (1 + 1/n)^n is evaluated numerically rather than as an exact power.
    if a is sp.oo:
        return [sp.Float(10 ** k, 60) for k in (4, 6, 8, 10, 12)]
    if a is sp.S.NegativeInfinity:
        return [sp.Float(-10 ** k, 60) for k in (4, 6, 8, 10, 12)]
    sgn = -1 if direction == '-' else 1
    return [a + sgn * sp.Float(10, 60) ** -k for k in (6, 9, 12, 15, 18)]


def check_limit(f, x, a, L, direction='+'):
    """Evaluate f along a sequence approaching a and compare with L."""
    try:
        vals = [_cnum(f.xreplace({x: p}), 60) for p in _approach(x, a, direction)]
    except Exception:
        return None
    vals = [v for v in vals if v is not None]
    if len(vals) < 3:
        return None
    last = vals[-3:]
    if L.is_infinite:
        grows = all(abs(v) > 1e3 for v in last) and abs(last[-1]) >= abs(last[0])
        sign_ok = L is sp.zoo or all((v.real > 0) == (L is sp.oo) for v in last)
        return verdict(True, 'the function grows without bound along a sequence approaching the point') if grows and sign_ok else None
    target = _cnum(L)
    if target is None:
        return None
    if _close(last[-1], target, 1e-4):
        return verdict(True, 'the function approaches this value numerically')
    settled = _close(last[-1], last[-2], 1e-8) and _close(last[-2], last[-3], 1e-8)
    if settled:
        return verdict(False, 'numerically the function approaches %.10g instead' % last[-1].real)
    return None


def check_sum(r, f, k, lo, hi):
    try:
        if hi is sp.oo or lo is sp.S.NegativeInfinity:
            exact, q = _cnum(r), _cnum(sp.Sum(f, (k, lo, hi)).evalf(20))
            if exact is None or q is None:
                return None
            if _close(q, exact, 1e-8):
                return verdict(True, 'agrees with a numerically accelerated partial sum')
            return verdict(False, 'numerically the series sums to %.10g' % q.real) if not _close(q, exact, 1e-3) else None
        free = sorted(hi.free_symbols | lo.free_symbols, key=str)
        if len(free) == 1 and hi.free_symbols:
            n = free[0]
            for m in range(1, 6):
                lo_m, hi_m = lo.subs(n, m), hi.subs(n, m)
                if not (lo_m.is_Integer and hi_m.is_Integer) or hi_m - lo_m > 200:
                    return None
                direct = sum((f.subs(k, j) for j in range(int(lo_m), int(hi_m) + 1)), sp.Integer(0))
                if numerically_equal(direct, r.subs(n, m)) is False:
                    return verdict(False, 'the formula disagrees with direct summation at %s = %d' % (n, m))
            return verdict(True, 'agrees with direct summation for %s = 1, …, 5' % n)
    except Exception:
        return None
    return None


def check_root(expr, x, s):
    """Is s a root of expr? Substitutes and evaluates to high precision."""
    if s.has(sp.CRootOf):
        return None                 # a root by definition; evaluating it to 60 digits is slow
    try:
        sv = sp.N(s, 60)            # numeric first: substituting RootOf objects symbolically is slow
        val = expr.xreplace({x: sv}) if sv.is_number else expr.xreplace({x: s})
        v = _cnum(val, 50)
        if v is not None:
            return abs(v) < 1e-20 * max(1.0, abs(_cnum(s) or 1))
        val = expr.xreplace({x: s})
        if not val.free_symbols and sp.count_ops(val) < 60 and sp.simplify(val) == 0:
            return True
        return None
    except Exception:
        return None


def check_solutions(expr, x, sols):
    oks = [check_root(expr, x, s) for s in sols]
    if any(o is False for o in oks):
        return verdict(False, 'a solution does not satisfy the equation')
    if sols and all(o is True for o in oks):
        return verdict(True, 'each solution was substituted back into the equation')
    return None


def check_solution_set(rel, x, s):
    """Test the relation at points inside and outside a solution set over ℝ."""
    try:
        bounds = sorted({p for p in _set_boundaries(s) if p.is_real and p.is_finite}, key=lambda p: float(p))
        if len(bounds) > 12:
            return None
        tests = []
        if not bounds:
            tests = [sp.Rational(-7, 3), sp.Rational(1, 3), sp.Rational(11, 3)]
        else:
            tests.append(bounds[0] - 1)
            for p, q in zip(bounds, bounds[1:]):
                tests.append((p + q) / 2)
            tests.append(bounds[-1] + 1)
            tests += bounds
        checked = 0
        for t in tests:
            inside = s.contains(t)
            if inside not in (sp.true, sp.false):
                continue
            truth = rel.subs(x, t)
            if truth not in (sp.true, sp.false):
                truth = sp.simplify(truth)
            if truth not in (sp.true, sp.false):
                continue
            if bool(truth) != bool(inside):
                return verdict(False, 'the relation fails at %s = %s' % (x, plain(t)))
            checked += 1
        return verdict(True, 'tested the relation inside and outside every interval') if checked >= 2 else None
    except Exception:
        return None


def _set_boundaries(s):
    if isinstance(s, sp.Interval):
        return [s.start, s.end]
    if isinstance(s, sp.FiniteSet):
        return list(s)
    if isinstance(s, (sp.Union, sp.Complement, sp.Intersection)):
        return [p for a in s.args for p in _set_boundaries(a)]
    return []


# ── Solution sets in the words a student would use ─────────────────────────
def _family(img, x, used):
    """ImageSet(Lambda(n, expr), Integers) → (latex, plain, parameter name)."""
    lam = img.lamda
    if len(lam.variables) != 1 or img.base_sets != (sp.S.Integers,):
        return None
    name = next(c for c in ('n', 'k', 'm', 'j') if sp.Symbol(c) not in used)
    p = sp.Symbol(name, integer=True)
    e = lam.expr.xreplace({lam.variables[0]: p})
    return ('%s = %s' % (tex(x), tex(e)), '%s = %s' % (x.name, plain(e)), name)


def _interval_words(iv, x):
    xt, xp = tex(x), x.name
    a, b = iv.start, iv.end
    lt = lambda open_: ('<', '<') if open_ else (r'\le', '<=')
    if a is sp.S.NegativeInfinity and b is sp.oo:
        return (r'%s \in \mathbb{R}' % xt, 'all real %s' % xp)
    if a is sp.S.NegativeInfinity:
        t, p = lt(iv.right_open)
        return ('%s %s %s' % (xt, t, tex(b)), '%s %s %s' % (xp, p, plain(b)))
    if b is sp.oo:
        t, p = (('>', '>') if iv.left_open else (r'\ge', '>='))
        return ('%s %s %s' % (xt, t, tex(a)), '%s %s %s' % (xp, p, plain(a)))
    (t1, p1), (t2, p2) = lt(iv.left_open), lt(iv.right_open)
    return ('%s %s %s %s %s' % (tex(a), t1, xt, t2, tex(b)), '%s %s %s %s %s' % (plain(a), p1, xp, p2, plain(b)))


def describe_set(s, x, domain='ℝ'):
    """{latex, plain} stating "x ∈ s" the way it would be written by hand."""
    used = s.free_symbols | {x}
    if s is sp.S.EmptySet:
        return {'latex': r'\text{no solutions in } %s' % (r'\mathbb{R}' if domain == 'ℝ' else r'\mathbb{C}'), 'plain': 'no solutions in %s' % domain}
    if isinstance(s, sp.Interval):
        lt_, pt_ = _interval_words(s, x)
        return {'latex': lt_, 'plain': pt_}
    if isinstance(s, sp.FiniteSet):
        return {'latex': r',\quad '.join('%s = %s' % (tex(x), tex(v)) for v in s), 'plain': ', '.join('%s = %s' % (x.name, plain(v)) for v in s)}
    if isinstance(s, sp.ImageSet):
        fam = _family(s, x, used)
        if fam:
            return {'latex': r'%s,\quad %s \in \mathbb{Z}' % (fam[0], fam[2]), 'plain': '%s, %s ∈ ℤ' % (fam[1], fam[2])}
    if isinstance(s, sp.Union):
        parts = list(s.args)
        if all(isinstance(p, sp.ImageSet) for p in parts):
            fams = [_family(p, x, used) for p in parts]
            if all(fams) and len({f[2] for f in fams}) == 1:
                return {'latex': r'%s,\quad %s \in \mathbb{Z}' % (r',\quad '.join(f[0] for f in fams), fams[0][2]),
                        'plain': '%s, %s ∈ ℤ' % (' or '.join(f[1] for f in fams), fams[0][2])}
        if all(isinstance(p, (sp.Interval, sp.FiniteSet)) for p in parts):
            words = [describe_set(p, x, domain) for p in parts]
            return {'latex': r'\ \text{or}\ '.join(w['latex'] for w in words), 'plain': ' or '.join(w['plain'] for w in words)}
    if isinstance(s, sp.Complement) and isinstance(s.args[1], sp.FiniteSet):
        base, holes = s.args
        if base is sp.S.Reals or base is sp.S.Complexes:
            return {'latex': r',\ '.join(r'%s \ne %s' % (tex(x), tex(h)) for h in holes), 'plain': ', '.join('%s != %s' % (x.name, plain(h)) for h in holes)}
    return {'latex': r'%s \in %s' % (tex(x), tex(s)), 'plain': '%s in %s' % (x.name, plain(s))}


# ── Antiderivatives: SymPy first, then substitutions SymPy does not try ────
def _substitution_candidates(f, x):
    out = []
    for g in sp.preorder_traversal(f):
        if g == x or not g.has(x) or g in out:
            continue
        radical = g.is_Pow and g.exp.is_Rational and not g.exp.is_Integer
        if radical or isinstance(g, (sp.exp, sp.log)) or (isinstance(g, sp.Function) and g.args and g.args[0] != x):
            out.append(g)
    return sorted(out, key=sp.count_ops, reverse=True)[:6]


def _by_substitution(f, x, g):
    """∫ f dx with u = g(x), x = h(u): integrate f(h(u)) h'(u) du, then substitute back."""
    u = sp.Dummy('u', positive=True)
    try:
        sols = sp.solve(sp.Eq(u, g), x)
    except Exception:
        return None
    for h in sols[:2]:
        new = sp.simplify(f.subs(x, h) * sp.diff(h, u))
        if new.has(x) or sp.count_ops(new) > 80:
            continue
        G = sp.integrate(new, u)
        if not G.has(sp.Integral):
            return G.subs(u, g)
    return None


def antiderivative(f, x):
    """(F, how) — how is None for SymPy's own integrator; F is None when nothing worked."""
    r = sp.integrate(f, x)
    if not r.has(sp.Integral) and not r.has(sp.Piecewise):
        return r, None
    try:
        m = sp.integrate(f, x, manual=True)
        if not m.has(sp.Integral) and not (m.has(sp.Piecewise) and not r.has(sp.Integral)):
            if numerically_equal(sp.diff(m, x), f) is not False:
                return m, None if not r.has(sp.Integral) else 'rule-based integration'
    except Exception:
        pass
    if not r.has(sp.Integral):
        return r, None
    for g in _substitution_candidates(f, x):
        F = _by_substitution(f, x, g)
        if F is not None and numerically_equal(sp.diff(F, x), f) is True:
            return F, 'substitution u = %s' % plain(g)
    return None, None


# Worked solutions for equations and inequalities; steps.py supplies the real ones.
def worked_equation(lhs, rhs, x):
    return None


def worked_inequality(rel, x, s):
    return None


# ── Operations ─────────────────────────────────────────────────────────────
def _var(b, name):
    return b.sym(name)


def op_eval(req, b):
    e = b.build(req['expr'])
    # Small symbolic expressions are shown simplified (sin(x)^2 + cos(x)^2 → 1), with a check.
    if isinstance(e, sp.Expr) and e.free_symbols and sp.count_ops(e) <= 40 and not e.has(sp.Derivative, sp.Integral):
        s = sp.simplify(e)
        if sp.count_ops(s) < sp.count_ops(e):
            return {'value': value(s), 'steps': [{'d': 'Simplified', 'tex': '%s = %s' % (tex(e), tex(s))}],
                    'check': check_identity(e, s, 'simplified form')}
    if isinstance(e, sp.Expr) and e.has(sp.Derivative, sp.Integral):
        e = e.doit()
    if isinstance(e, sp.Expr) and e.is_number and not e.is_Atom and sp.count_ops(e) <= 40 \
            and not any(p.is_Pow and p.exp.is_Integer and abs(p.exp) > 64 for p in sp.preorder_traversal(e)):
        best = e
        for cand in (lambda t: sp.expand(t, complex=t.has(sp.I)), sp.radsimp, sp.simplify):
            try:
                c = cand(e)
                if sp.count_ops(c) < sp.count_ops(best) and _same_number(c, e):
                    best = c
            except Exception:
                pass
        e = best
    return {'value': value(e)}


def nicest(r):
    """The most compact of a few equivalent forms (sqrt(25 - x^2) rather than sqrt(-(x - 5)*(x + 5)))."""
    cands = [r]
    for f in (sp.expand, sp.factor, sp.simplify):
        try:
            cands.append(f(r))
        except Exception:
            pass
    return min(cands, key=lambda c: (sp.count_ops(c), len(str(c))))


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
    words = {'simplify': 'simplified form', 'expand': 'expansion', 'factor': 'factorization', 'apart': 'partial fractions',
             'together': 'combined fraction', 'cancel': 'cancelled form', 'collect': 'collected form',
             'rationalize': 'rationalized form', 'trigsimp': 'simplified form', 'expand_trig': 'expansion'}
    out = {'value': value(r), 'check': check_identity(e, r, words[kind])}
    if kind == 'factor':
        out['steps'] = worked_factor(e, r)
    return out


def worked_factor(e, r):
    return []


def op_polydiv(req, b):
    p, q = b.build(req['p']), b.build(req['q'])
    v = _var(b, req['var'])
    quo, rem = sp.div(p, q, v)
    return {'quotient': value(quo), 'remainder': value(rem), 'check': check_identity(p, quo * q + rem, 'quotient × divisor + remainder')}


def _real_map(e):
    """Symbols of unknown sign → real ones, when the expression has |…| or sign (whose complex
    derivatives are not what anyone means by d|x|/dx). Returns (forward, back) maps."""
    if not e.has(sp.Abs, sp.sign, sp.re, sp.im, sp.arg):
        return {}, {}
    fwd = {s: sp.Symbol(s.name, real=True) for s in e.free_symbols if isinstance(s, sp.Symbol) and s.is_real is None}
    return fwd, {r: s for s, r in fwd.items()}


def _unpiece(r, x):
    """Fold the piecewise forms |x| produces back into |x|: (−x²/2 if x ≤ 0, x²/2 otherwise) is
    x·|x|/2, and (0 if x = 0, 2x²/|x| otherwise) is 2|x|. Kept only if numerically identical."""
    if not isinstance(r, sp.Piecewise) or len(r.args) != 2 or r.args[1].cond is not sp.true:
        return r
    (e1, c1), (e2, _) = r.args
    cand = None
    if c1 == sp.Eq(x, 0) or c1 == sp.Eq(0, x):
        cand = e2
    elif c1 in (x <= 0, x < 0) and sp.simplify(e1 + e2) == 0:
        cand = sp.cancel(e2 * sp.Abs(x) / x)
    elif c1 in (x >= 0, x > 0) and sp.simplify(e1 + e2) == 0:
        cand = sp.cancel(e1 * sp.Abs(x) / x)
    if cand is None:
        return r
    a = sp.Dummy('a', positive=True)        # |x| (a real |x|² would turn straight back into x²)
    cand = cand.subs(sp.Abs(x), a).replace(lambda t: t.is_Pow and t.base == x and t.exp.is_even, lambda t: a ** t.exp)
    cand = (sp.cancel(cand) if not cand.has(sp.Piecewise) else cand).subs(a, sp.Abs(x))
    for p in (sp.Rational(-27, 10), sp.Rational(-13, 10), sp.Rational(-1, 2), sp.Rational(1, 2), sp.Rational(13, 10), sp.Rational(27, 10)):
        if not _close(_cnum(cand.subs(x, p)) or 0, _cnum(r.subs(x, p)) or 0, 1e-12):
            return r
    return cand


def op_diff(req, b):
    e = b.build(req['expr'])
    v = _var(b, req['var'])
    n = int(req.get('order', 1))
    fwd, back = _real_map(e)
    if fwd:
        er, vr = e.xreplace(fwd), fwd.get(v, v)
        r = _unpiece(sp.simplify(sp.diff(er, vr, n)), vr).xreplace(back)
        return {'value': value(r), 'steps': [], 'check': check_derivative(e, v, n, r),
                'note': 'variables treated as real'}
    r = sp.simplify(sp.diff(e, v, n)) if n > 1 else sp.diff(e, v)
    r2 = sp.simplify(r)
    if sp.count_ops(r2) <= sp.count_ops(r):
        r = r2
    steps = diff_steps_list(e, v) if n == 1 else []
    return {'value': value(r), 'steps': steps, 'check': check_derivative(e, v, n, r)}


def check_derivative(e, v, n, r):
    """Compare with a high-precision numerical derivative (mpmath) at sample points."""
    if n > 3 or any(isinstance(a, sp.core.function.AppliedUndef) for a in sp.preorder_traversal(e)):
        return None
    import mpmath
    others = _points(sorted(e.free_symbols - {v}, key=str), 3)
    try:
        fn = sp.lambdify(v, e.xreplace(others), 'mpmath')
    except Exception:
        return None
    good = 0
    for p in VPOINTS[:4]:
        try:
            with mpmath.workdps(40):
                num = complex(mpmath.diff(fn, mpmath.mpf(p.p) / p.q, n))
            ex = _cnum(r.xreplace(others).xreplace({v: p}))
        except Exception:
            continue
        if ex is None or not (math.isfinite(num.real) and math.isfinite(num.imag)):
            continue
        if not _close(num, ex, 1e-7):
            return verdict(False, 'a numerical derivative disagrees at %s = %s' % (v, plain(p)))
        good += 1
    return verdict(True, 'agrees with a numerical derivative at sample points') if good >= 3 else None


def _divergent(r):
    return r is sp.nan or r.has(sp.zoo, sp.nan) or isinstance(r, sp.AccumBounds) or r.is_infinite


def _interior_poles(f, v, a, c):
    """Real singularities strictly inside the interval of integration (sec(x)² on [0, π] has π/2)."""
    try:
        if not (a.is_real and c.is_real) or a == c:
            return []
        lo, hi = (a, c) if bool(a < c) else (c, a)
        from sympy.calculus.singularities import singularities
        s = singularities(f, v, sp.Interval.open(lo, hi))
        if not isinstance(s, sp.FiniteSet) or len(s) > 8:
            return []
        return sorted((p for p in s if p.is_real and p.is_finite), key=lambda p: float(p))
    except Exception:
        return []


def _split_integral(f, v, a, c, poles):
    """∫ over [a, c] as a sum of improper integrals between the poles, from one antiderivative:
    F(q⁻) − F(p⁺) on each piece. Returns the value, 'diverges', or None (no antiderivative)."""
    F, _ = antiderivative(f, v)
    if F is None or F.has(sp.Integral):
        return None
    sign = 1
    if not bool(a < c):
        a, c, sign = c, a, -1
    pts = [a] + poles + [c]
    total, infinite, unknown = sp.Integer(0), set(), False
    for p, q in zip(pts, pts[1:]):
        Fq, Fp = sp.limit(F, v, q, '-'), sp.limit(F, v, p, '+')
        if any(isinstance(L, sp.AccumBounds) or L.has(sp.Limit) for L in (Fq, Fp)):
            unknown = True
            continue
        piece = Fq - Fp
        if piece in (sp.oo, -sp.oo):
            infinite.add(piece)
        elif _divergent(piece):
            unknown = True
        else:
            total += piece
    if infinite or unknown:
        # every piece that diverges does so the same way (∫ 1/x² over [−1, 1] = +∞)
        return ('diverges', sign * infinite.pop()) if len(infinite) == 1 and not unknown else ('diverges', None)
    return sign * nicest(total)


def op_integrate(req, b):
    f = b.build(req['expr'])
    v = _var(b, req['var'])
    if req.get('a') is not None:
        a, c = b.build(req['a']), b.build(req['b'])
        # A pole inside the interval: integrate up to it from each side (SymPy's own integrator can
        # spend a long time here, and the answer is usually "diverges").
        poles = _interior_poles(f, v, a, c)
        split = _split_integral(f, v, a, c, poles) if poles else None
        if isinstance(split, tuple):
            out = {'diverges': True, 'to': value(split[1]) if split[1] is not None else None}
            if f.is_rational_function(v) and len(poles) == 1:
                try:
                    pv = sp.Integral(f, (v, a, c)).principal_value()
                    if pv.is_finite and not pv.has(sp.Integral):
                        out['pv'] = value(pv)
                except Exception:
                    pass
            return out
        r = split if split is not None else sp.integrate(f, (v, a, c))
        if not r.has(sp.Integral) and _divergent(r):
            out = {'diverges': True, 'to': value(r) if r.is_infinite and r is not sp.zoo else None}
            try:
                pv = sp.Integral(f, (v, a, c)).principal_value()
                if pv.is_finite and not pv.has(sp.Integral):
                    out['pv'] = value(pv)
            except Exception:
                pass
            return out
        exact = not r.has(sp.Integral)
        if not exact:
            r = sp.Integral(f, (v, a, c)).evalf(15)
            if not r.is_number or _cnum(r) is None:
                return {'diverges': True, 'to': None, 'numericFailed': True}
        return {'value': value(r), 'exact': exact, 'steps': integral_steps_list(f, v) if exact else [],
                'check': check_definite(r, f, v, a, c) if exact else None}
    steps = integral_steps_list(f, v)
    r, how = antiderivative(f, v)
    fwd, back = _real_map(f)
    if fwd and (r is None or r.has(sp.re, sp.im, sp.Integral)):
        fr, vr = f.xreplace(fwd), fwd.get(v, v)
        rr, how_r = antiderivative(fr, vr)
        if rr is not None and not rr.has(sp.Integral):
            rr = _unpiece(rr, vr)
            return {'value': value(rr.xreplace(back)), 'steps': [], 'check': check_antiderivative(rr, fr, vr),
                    'note': 'variables treated as real'}
    if r is None:
        return {'noForm': True, 'steps': steps}
    simp = sp.simplify(r)
    if sp.count_ops(simp) < sp.count_ops(r):
        r = simp
    if how:
        steps = [{'d': 'SymPy’s integrator found no antiderivative; tried ' + how, 'tex': ''}]
    return {'value': value(r), 'steps': steps, 'check': check_antiderivative(r, f, v)}


def op_limit(req, b):
    f = b.build(req['expr'])
    v = _var(b, req['var'])
    a = b.build(req['point'])
    d = req.get('dir') or ''
    # An AccumBounds result means the function oscillates: the limit does not exist.
    osc = lambda r: {'dne': True, 'oscillates': [value(r.min), value(r.max)], 'steps': []}
    if d in ('+', '-') or a.is_infinite:
        side = d or ('-' if a is sp.oo else '+')
        r = sp.limit(f, v, a, side)
        if isinstance(r, sp.AccumBounds):
            return osc(r)
        return {'value': value(r), 'steps': limit_steps(f, v, a, side), 'check': check_limit(f, v, a, r, side)}
    left, right = sp.limit(f, v, a, '-'), sp.limit(f, v, a, '+')
    if isinstance(left, sp.AccumBounds) or isinstance(right, sp.AccumBounds):
        return osc(left if isinstance(left, sp.AccumBounds) else right)
    steps = limit_steps(f, v, a, '')
    if left == right:
        checks = [check_limit(f, v, a, right, '+'), check_limit(f, v, a, left, '-')]
        failed = [c for c in checks if c and c['status'] == 'failed']
        check = failed[0] if failed else (checks[0] if all(checks) else None)
        return {'value': value(right), 'steps': steps, 'check': check}
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


def _numeric_series(f, v, lo, hi, product):
    """A convergent infinite sum or product to 25 digits (mpmath's extrapolating nsum / nprod)."""
    import mpmath
    try:
        g = sp.lambdify(v, f, 'mpmath')
        conv = lambda t: mpmath.inf if t is sp.oo else -mpmath.inf if t is -sp.oo else mpmath.mpf(int(t))
        with mpmath.workdps(30):
            val = (mpmath.nprod if product else mpmath.nsum)(g, [conv(lo), conv(hi)])
        val = complex(val)
        if not (math.isfinite(val.real) and math.isfinite(val.imag)):
            return None
        return sp.Float(mpmath.mpf(val.real), 25) if abs(val.imag) < 1e-25 else None
    except Exception:
        return None


def _recognise(x):
    """A simple closed form matching a numerical value to 20 digits (a guess, shown as one)."""
    try:
        g = sp.nsimplify(x, [sp.pi, sp.E, sp.sqrt(2), sp.sqrt(3), sp.log(2)], tolerance=sp.Float('1e-20'))
        small = all(r.q <= 1000 and abs(r.p) <= 10 ** 6 for r in g.atoms(sp.Rational))
        if g.is_Float or not small or sp.count_ops(g) > 8 or abs(_cnum(g) - _cnum(x)) > 1e-18 * max(1, abs(_cnum(x))):
            return None
        return g
    except Exception:
        return None


def op_sum(req, b, product=False):
    f = b.build(req['expr'])
    v = _var(b, req['var'])
    lo, hi = b.build(req['a']), b.build(req['b'])
    r = sp.product(f, (v, lo, hi)) if product else sp.summation(f, (v, lo, hi))
    # Σ x^n = 1/(1 - x) for |x| < 1: SymPy answers with a Piecewise whose last piece is unevaluated.
    if isinstance(r, sp.Piecewise) and r.args[-1].expr.has(sp.Sum, sp.Product):
        known = [(e, c) for e, c in r.args[:-1] if not e.has(sp.Sum, sp.Product)]
        if len(known) == 1:
            e, c = known[0]
            e = _tidy(e)
            return {'value': value(e), 'when': value(c), 'check': None if product else check_sum(e, f, v, lo, hi)}
    if isinstance(r, (sp.Sum, sp.Product)) or r.has(sp.Sum, sp.Product):
        if (hi.is_infinite or lo.is_infinite) and not (f.free_symbols - {v}):
            Op = sp.Product if product else sp.Sum
            try:
                conv = Op(f, (v, lo, hi)).is_convergent()
            except Exception:
                conv = None
            if conv == sp.false:      # is_convergent answers with SymPy booleans
                return {'diverges': True, 'to': None}
            if conv == sp.true:
                num = _numeric_series(f, v, lo, hi, product)
                if num is not None:
                    out = {'value': value(num), 'numeric': True}
                    guess = _recognise(num)
                    if guess is not None:
                        out['looksLike'] = value(guess)
                    return out
        return {'noForm': True}
    if _divergent(r):
        return {'diverges': True, 'to': value(r) if r.is_infinite and r is not sp.zoo else None}
    r = _tidy(r)
    return {'value': value(r), 'check': None if product else check_sum(r, f, v, lo, hi)}


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


def _reject_extraneous(expr, v, sols, steps):
    """Drop candidate solutions that do not satisfy the original equation (log and radical
    equations produce them when the equation is transformed)."""
    bad = [s for s in sols if check_root(expr, v, s) is False]
    if bad:
        steps.append({'d': 'Reject candidates that do not satisfy the original equation',
                      'tex': r',\ '.join(r'%s = %s' % (tex(v), tex(s)) for s in bad)})
    return [s for s in sols if s not in bad]


def op_solve(req, b):
    lhs, rhs = b.build(req['lhs']), b.build(req['rhs'])
    v = _var(b, req['var'])
    rel = req.get('rel', '=')
    steps = []
    if rel != '=':
        ineq = BINOPS[rel](lhs, rhs)
        s = sp.solveset(ineq, v, domain=sp.S.Reals)
        steps = (worked_inequality(ineq, v, s) or []) + [{'d': 'Solution over ℝ', 'tex': describe_set(s, v)['latex']}]
        return {'statement': describe_set(s, v), 'steps': steps, 'check': check_solution_set(ineq, v, s)}
    f = sp.together(lhs - rhs)
    num, den = sp.fraction(f)
    worked = worked_equation(lhs, rhs, v)
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
            if not any(_same_number(r, u) for u in uniq):
                uniq.append(r)
        if den.has(v):
            excluded = [r for r in uniq if sp.simplify(den.subs(v, r)) == 0]
            if excluded:
                steps.append({'d': 'Discard roots of the denominator',
                              'tex': r',\ '.join('%s = %s' % (tex(v), tex(r)) for r in excluded)})
            uniq = [r for r in uniq if r not in excluded]
        uniq = [nicest(r) if r.free_symbols and not r.has(sp.CRootOf) else r for r in uniq]
        if not uniq and poly.degree() >= 5:
            uniq = [sp.CRootOf(poly, k) for k in range(poly.degree())]
        if worked:
            steps = worked
        uniq = _reject_extraneous(lhs - rhs, v, uniq, steps)
        steps = steps + [{'d': 'Solutions', 'tex': r',\quad '.join('%s = %s' % (tex(v), tex(r)) for r in uniq) or r'\text{none}'}]
        return {'solutions': _solution_values(uniq), 'steps': steps, 'check': check_solutions(lhs - rhs, v, uniq)}
    if worked:
        steps = worked
    s = sp.solveset(sp.Eq(lhs, rhs), v, domain=sp.S.Reals)
    if isinstance(s, sp.FiniteSet):
        steps = list(steps)
        sols = _reject_extraneous(lhs - rhs, v, list(s), steps)
        s = sp.FiniteSet(*sols)
        return {'solutions': _solution_values(sols), 'steps': steps + [{'d': 'Solution over ℝ', 'tex': describe_set(s, v)['latex']}],
                'check': check_solutions(lhs - rhs, v, sols)}
    if isinstance(s, sp.ConditionSet) or s is None:
        return {'unsolved': True, 'steps': steps}
    steps.append({'d': 'General solution over ℝ', 'tex': describe_set(s, v)['latex']})
    return {'statement': describe_set(s, v), 'steps': steps, 'check': check_family(lhs - rhs, v, s)}


def _same_number(a, b):
    """Exact equality, deciding numerically first (simplify on RootOf objects is slow)."""
    if isinstance(a, sp.CRootOf) or isinstance(b, sp.CRootOf):
        return a == b
    va, vb = _cnum(a), _cnum(b)
    if va is not None and vb is not None and not _close(va, vb, 1e-12):
        return False
    return sp.simplify(a - b) == 0


def check_family(expr, x, s):
    """Substitute members of a parametric solution family (n = -1, 0, 1)."""
    fams = [s] if isinstance(s, sp.ImageSet) else list(s.args) if isinstance(s, sp.Union) else []
    if not fams or not all(isinstance(fm, sp.ImageSet) and len(fm.lamda.variables) == 1 for fm in fams):
        return None
    members = [fm.lamda.expr.xreplace({fm.lamda.variables[0]: sp.Integer(n)}) for fm in fams for n in (-1, 0, 1)]
    res = check_solutions(expr, x, members)
    return verdict(True, 'substituted the solutions for n = −1, 0, 1') if res and res['status'] == 'verified' else res


def _residual_ok(eq, sol):
    """Does the substitution sol satisfy eq? True / False / None (undecided)."""
    try:
        z = (eq.lhs - eq.rhs).xreplace(sol)
        if sp.simplify(z) == 0:
            return True
        if z.free_symbols:
            return None
        v = _cnum(z, 50)
        return None if v is None else abs(v) < 1e-20
    except Exception:
        return None


def op_solve_system(req, b):
    eqs = [sp.Eq(b.build(e['lhs']), b.build(e['rhs'])) for e in req['eqs']]
    vs = [_var(b, n) for n in req['vars']]
    sols = sp.solve(eqs, vs, dict=True)
    oks = [_residual_ok(eq, sol) for sol in sols for eq in eqs]
    check = None
    if sols and all(o is True for o in oks):
        check = verdict(True, 'each solution was substituted into every equation')
    elif any(o is False for o in oks):
        check = verdict(False, 'a solution does not satisfy every equation')
    return {'systems': [[{'var': str(k), **value(sol[k])} for k in vs if k in sol] for sol in sols], 'check': check}


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
    eq = sp.Eq(lhs, rhs)
    sol = sp.dsolve(eq, y, ics=ics or None)
    sols = sol if isinstance(sol, list) else [sol]
    check = None
    try:
        check = verdict(all(sp.checkodesol(eq, s, func=y)[0] for s in sols),
                        'substituted the solution into the differential equation')
    except Exception:
        pass
    return {'solutions': [{'latex': tex(s), 'plain': plain(s.rhs) if isinstance(s, sp.Equality) else plain(s),
                           'approx': None} for s in sols], 'check': check}


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
        lam = sp.Dummy('lambda')
        cp = (m - lam * sp.eye(m.rows)).det()
        oks = [check_root(cp, lam, val) for val in ev]
        check = verdict(True, 'det(A − λI) = 0 for every eigenvalue') if oks and all(o is True for o in oks) else \
            verdict(False, 'an eigenvalue does not satisfy det(A − λI) = 0') if any(o is False for o in oks) else None
        return {'values': _solution_values(vals), 'vectors': vecs, 'check': check}
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
        b = Builder(deg=bool(req.get('deg')), undefined_functions=bool(req.get('undefinedFunctions')), assume=req.get('assume'))
        return json.dumps({'ok': True, **op(req, b)}, allow_nan=False)
    except Exception as err:  # reported to the UI, never re-raised into JS
        msg = str(err) or type(err).__name__
        return json.dumps({'ok': False, 'error': msg[:300]})
