// Mode catalogue, autocomplete dictionary and constants.
export const MODES = {
  algebra:{
    label:'Algebra', glyph:'α',
    sub:'Symbolic manipulation, simplification, factoring.',
    sm:['Simplify','Expand','Factor','Collect','Apart','Together','GCD','LCM'],
    qr:['x^2','sqrt(x)','abs(x)','floor(x)','ceil(x)','sign(x)','mod(a,b)','gcd(a,b)','lcm(a,b)','factorial(n)','log(x)','polydiv(x^3-1,x-1,x)'],
    syn:'<span class="kw">simplify</span>(expr)  <span class="kw">expand</span>(expr)\n<span class="kw">factor</span>(expr)  <span class="kw">collect</span>(expr,<span class="var">x</span>)\n<span class="kw">apart</span>(expr)\n<span class="var">f</span>(<span class="var">x</span>) = <span class="var">x</span>^2+1   <span class="var">x</span> = 42\n<span class="kw">gcd</span>(252,198)  <span class="kw">lcm</span>(4,6)',
    ex:[
      {expr:'simplify((x^2-1)/(x-1))', desc:'Cancel a removable singularity'},
      {expr:'sqrt(8) + sqrt(2)', desc:'Exact surd arithmetic'},
      {expr:'apart((x^2+1)/(x^3-x), x)', desc:'Partial fractions'},
      {expr:'expand((a+b)^4)', desc:'Binomial expansion'},
      {expr:'factor(x^3-8)', desc:'Difference of cubes'},
      {expr:'f(x) = sin(x)+x^2', desc:'Define a function'},
    ]
  },
  calculus:{
    label:'Calculus', glyph:'∫',
    sub:'Differentiation, integration, limits, series.',
    sm:['Derive','Integrate','Definite ∫','Limit','Sum','Product','Series','DSolve'],
    qr:['derivative(f,x)','integrate(f,x)','integrate(f,x,a,b)','limit(f,x,0)','sum(f,n,1,10)','product(f,n,1,5)','derivative(f,x,2)','series(f,x)','gradient(f,[x,y])','ode(x+y,x,y,0,1,1)'],
    syn:'<span class="kw">derivative</span>(expr, <span class="var">x</span>)\n<span class="kw">derivative</span>(expr, <span class="var">x</span>, n)  nth order\n<span class="kw">integrate</span>(expr, <span class="var">x</span>)\n<span class="kw">integrate</span>(expr, <span class="var">x</span>, a, b)\n<span class="kw">limit</span>(expr, <span class="var">x</span>, a, "+")\n<span class="kw">series</span>(expr, <span class="var">x</span>, a, n)',
    ex:[
      {expr:'derivative(sin(x)*x^2, x)', desc:'Product rule'},
      {expr:'integrate(x*sin(x), x)', desc:'Integration by parts'},
      {expr:'integrate(x^2, x, 0, 1)', desc:'Definite integral'},
      {expr:'series(sin(x), x, 0, 8)', desc:'Maclaurin series for sin'},
      {expr:'sum(k^2, k, 1, n)', desc:'Closed-form sum'},
      {expr:"dsolve(y'' + y = 0, y(x))", desc:'Solve an ODE exactly'},
      {expr:'limit((1+1/x)^x, x, Infinity)', desc:'Exact limit → e'},
    ]
  },
  solve:{
    label:'Solve', glyph:'=',
    sub:'Roots, equations, and systems.',
    sm:['Solve','Zeros','System'],
    qr:['solve(eq,x)','zeros(f,x)','solve([eq1,eq2],[x,y])'],
    syn:'<span class="kw">solve</span>(<span class="var">x</span>^2-4=0, <span class="var">x</span>)\n<span class="kw">zeros</span>(expr, <span class="var">x</span>)\n<span class="kw">solve</span>([<span class="var">x</span>+<span class="var">y</span>=5,<span class="var">x</span>-<span class="var">y</span>=1],[<span class="var">x</span>,<span class="var">y</span>])',
    ex:[
      {expr:'solve(x^2-5x+6=0, x)', desc:'Quadratic roots'},
      {expr:'solve([x+y=10,2x-y=2],[x,y])', desc:'Linear system'},
      {expr:'zeros(x^3-6x^2+11x-6, x)', desc:'All real zeros'},
      {expr:'solve(sin(x) = 1/2, x)', desc:'General solution'},
      {expr:'solve(x^2 < 4, x)', desc:'Inequality'},
    ]
  },
  matrix:{
    label:'Linear Algebra', glyph:'▦',
    sub:'Matrices, eigenvalues, vector operations.',
    sm:['Det','Inv','Transpose','Eigs','RREF','Trace'],
    qr:['[[1,2],[3,4]]','det(A)','inv(A)','transpose(A)','trace(A)','eigs(A)','norm(A)','cross(a,b)','dot(a,b)'],
    syn:'<span class="var">A</span> = [[1,2],[3,4]]\n<span class="kw">det</span>(<span class="var">A</span>)  <span class="kw">inv</span>(<span class="var">A</span>)  <span class="kw">eigs</span>(<span class="var">A</span>)\n<span class="kw">cross</span>(a,b)  <span class="kw">dot</span>(a,b)',
    ex:[
      {expr:'det([[1,2],[3,4]])', desc:'2×2 determinant'},
      {expr:'inv([[2,1],[5,3]])', desc:'Matrix inverse'},
      {expr:'eigs([[4,1],[2,3]])', desc:'Eigen-decomposition'},
      {expr:'inv([[1,2],[3,4]])', desc:'Exact inverse'},
    ]
  },
  numeric:{
    label:'Numeric', glyph:'#',
    sub:'High-precision evaluation, formatting.',
    sm:['Evaluate','Round','Format'],
    qr:['pi','e','phi','tau','i','Infinity','sqrt(2)','exp(1)'],
    syn:'<span class="kw">pi</span>  <span class="kw">e</span>  <span class="kw">phi</span>  <span class="kw">tau</span>  <span class="kw">i</span>\n<span class="kw">round</span>(x, n)  <span class="kw">format</span>(x,opts)',
    ex:[
      {expr:'pi^e', desc:'π raised to e'},
      {expr:'e^(i*pi)', desc:'Euler\'s identity'},
      {expr:'phi^10', desc:'Tenth golden power'},
    ]
  },
  stats:{
    label:'Statistics', glyph:'σ',
    sub:'Descriptive statistics and correlation.',
    sm:['Mean','Std','Var','Median','Quantile','Corr'],
    qr:['mean([])','std([])','variance([])','median([])','mad([])','quantileSeq([],p)','correlation([],[])','sum([])'],
    syn:'<span class="kw">mean</span>([…])  <span class="kw">std</span>([…])\n<span class="kw">variance</span>([…])  <span class="kw">median</span>([…])\n<span class="kw">quantileSeq</span>([…], 0.25)\n<span class="kw">correlation</span>(a,b)',
    ex:[
      {expr:'mean([2,4,6,8,10])', desc:'Arithmetic mean'},
      {expr:'std([1,2,3,4,5])', desc:'Standard deviation'},
      {expr:'quantileSeq([1,2,3,4,5,6,7,8,9,10], 0.75)', desc:'Third quartile'},
    ]
  },
  trig:{
    label:'Trigonometry', glyph:'∠',
    sub:'Trig, inverse trig, hyperbolic functions.',
    sm:['Basic','Inverse','Hyperbolic','Degrees'],
    qr:['sin(x)','cos(x)','tan(x)','asin(x)','acos(x)','atan(x)','atan2(y,x)','sinh(x)','cosh(x)','tanh(x)'],
    syn:'<span class="kw">sin cos tan sec csc cot</span>\n<span class="kw">asin acos atan</span>\n<span class="kw">sinh cosh tanh</span>\nDegrees: <span class="kw">sin</span>(45 deg)',
    ex:[
      {expr:'sin(pi/6)', desc:'Common angle'},
      {expr:'tan(60 deg)', desc:'In degree mode'},
      {expr:'atan2(1,1)', desc:'Two-arg arctan'},
    ]
  },
  units:{
    label:'Units', glyph:'⚖',
    sub:'Convert between physical units.',
    sm:['Convert','SI','Imperial'],
    qr:['100 km/h to m/s','5 kg to lb','1 atm to Pa','60 degF to degC','1 mi to km','1 kWh to J'],
    syn:'100 km/h <span class="kw">to</span> m/s\n500 g + 2 kg\n60 degF <span class="kw">to</span> degC',
    ex:[
      {expr:'100 km/h to m/s', desc:'Highway conversion'},
      {expr:'60 degF to degC', desc:'Temperature'},
      {expr:'1 acre to m^2', desc:'Area unit'},
    ]
  },
  logic:{
    label:'Logic', glyph:'⊻',
    sub:'Boolean, bitwise, and combinatorial.',
    sm:['Boolean','Bitwise','Combinatorics'],
    qr:['and(a,b)','or(a,b)','not(a)','xor(a,b)','bitAnd(a,b)','bitOr(a,b)','bitXor(a,b)','combinations(n,k)','permutations(n,k)'],
    syn:'<span class="kw">and or not xor</span>\n<span class="kw">bitAnd bitOr bitXor</span>\n<span class="kw">combinations</span>(n,k)\n<span class="kw">permutations</span>(n,k)',
    ex:[
      {expr:'combinations(10,3)', desc:'10 choose 3'},
      {expr:'permutations(8,3)', desc:'Ordered selection'},
      {expr:'bitAnd(0b1010,0b1100)', desc:'Binary AND'},
    ]
  }
};

export const ACD = [
  {n:'simplify',s:'simplify(expr)',t:'algebra'},{n:'expand',s:'expand(expr)',t:'algebra'},
  {n:'factor',s:'factor(expr)',t:'algebra'},{n:'collect',s:'collect(expr,x)',t:'algebra'},
  {n:'derivative',s:'derivative(expr,x)',t:'calc'},{n:'integrate',s:'integrate(expr,x)',t:'calc'},
  {n:'limit',s:'limit(expr,x,a[,"+"|"-"])',t:'calc'},{n:'sum',s:'sum(expr,n,a,b)',t:'calc'},
  {n:'product',s:'product(expr,n,a,b)',t:'calc'},{n:'series',s:'series(expr,x,a,n)',t:'calc'},{n:'apart',s:'apart(expr,x)',t:'algebra'},
  {n:'solve',s:'solve(equation,x)',t:'solve'},
  {n:'zeros',s:'zeros(expr,x)',t:'solve'},{n:'det',s:'det(matrix)',t:'matrix'},
  {n:'inv',s:'inv(matrix)',t:'matrix'},{n:'transpose',s:'transpose(matrix)',t:'matrix'},
  {n:'eigs',s:'eigs(matrix)',t:'matrix'},{n:'trace',s:'trace(matrix)',t:'matrix'},
  {n:'cross',s:'cross(a,b)',t:'matrix'},{n:'dot',s:'dot(a,b)',t:'matrix'},
  {n:'norm',s:'norm(x)',t:'matrix'},{n:'rank',s:'rank(matrix)',t:'matrix'},
  {n:'mean',s:'mean([...])',t:'stats'},{n:'std',s:'std([...])',t:'stats'},
  {n:'variance',s:'variance([...])',t:'stats'},{n:'median',s:'median([...])',t:'stats'},
  {n:'quantileSeq',s:'quantileSeq([...],p)',t:'stats'},{n:'correlation',s:'correlation(a,b)',t:'stats'},
  {n:'mad',s:'mad([...])',t:'stats'},{n:'gradient',s:'gradient(f,[x,y])',t:'calc'},{n:'ode',s:'ode(f,x,y,x0,y0,x1)',t:'calc'},{n:'polydiv',s:'polydiv(p,q,x)',t:'algebra'},{n:'sin',s:'sin(x)',t:'trig'},
  {n:'cos',s:'cos(x)',t:'trig'},{n:'tan',s:'tan(x)',t:'trig'},
  {n:'asin',s:'asin(x)',t:'trig'},{n:'acos',s:'acos(x)',t:'trig'},
  {n:'atan',s:'atan(x)',t:'trig'},{n:'atan2',s:'atan2(y,x)',t:'trig'},
  {n:'sinh',s:'sinh(x)',t:'trig'},{n:'cosh',s:'cosh(x)',t:'trig'},
  {n:'tanh',s:'tanh(x)',t:'trig'},{n:'sqrt',s:'sqrt(x)',t:'algebra'},
  {n:'cbrt',s:'cbrt(x)',t:'algebra'},{n:'abs',s:'abs(x)',t:'algebra'},
  {n:'floor',s:'floor(x)',t:'algebra'},{n:'ceil',s:'ceil(x)',t:'algebra'},
  {n:'round',s:'round(x,n)',t:'numeric'},{n:'sign',s:'sign(x)',t:'algebra'},
  {n:'mod',s:'mod(a,b)',t:'algebra'},{n:'gcd',s:'gcd(a,b)',t:'algebra'},
  {n:'lcm',s:'lcm(a,b)',t:'algebra'},{n:'factorial',s:'factorial(n)',t:'algebra'},
  {n:'log',s:'log(x)',t:'algebra'},{n:'log2',s:'log2(x)',t:'algebra'},
  {n:'log10',s:'log10(x)',t:'algebra'},{n:'exp',s:'exp(x)',t:'algebra'},
  {n:'combinations',s:'combinations(n,k)',t:'logic'},{n:'permutations',s:'permutations(n,k)',t:'logic'},
  {n:'bitAnd',s:'bitAnd(a,b)',t:'logic'},{n:'bitOr',s:'bitOr(a,b)',t:'logic'},
  {n:'bitXor',s:'bitXor(a,b)',t:'logic'},{n:'bitNot',s:'bitNot(a)',t:'logic'},
  {n:'format',s:'format(x,opts)',t:'numeric'},{n:'rationalize',s:'rationalize(expr)',t:'algebra'},
];

export const CONSTS = [
  {n:'Speed of light',v:'299,792,458 m/s',e:'299792458 m/s'},
  {n:'Planck constant',v:'6.626×10⁻³⁴ J·s',e:'6.626e-34 J * s'},
  {n:'Gravitational G',v:'6.674×10⁻¹¹',e:'6.674e-11 m^3/(kg*s^2)'},
  {n:'Boltzmann',v:'1.381×10⁻²³ J/K',e:'1.381e-23 J/K'},
  {n:'Avogadro',v:'6.022×10²³ /mol',e:'6.022e23 / mol'},
  {n:'Electron charge',v:'1.602×10⁻¹⁹ C',e:'1.602e-19 C'},
  {n:'π (pi)',v:'3.14159265…',e:'pi'},{n:'e (Euler)',v:'2.71828182…',e:'e'},
  {n:'φ (golden)',v:'1.61803398…',e:'(1+sqrt(5))/2'},{n:'√2',v:'1.41421356…',e:'sqrt(2)'},
];

ACD.push(
  {n:'dsolve',s:"dsolve(y'' + y = 0, y(x))",t:'calc'},{n:'together',s:'together(expr)',t:'algebra'},
  {n:'cancel',s:'cancel(expr)',t:'algebra'},{n:'rref',s:'rref(matrix)',t:'matrix'},{n:'nullspace',s:'nullspace(matrix)',t:'matrix'},
  {n:'charpoly',s:'charpoly(matrix)',t:'matrix'},{n:'trigsimp',s:'trigsimp(expr)',t:'algebra'},
);

export const INSERT_MAP = {
  Simplify:'simplify(', Expand:'expand(', Factor:'factor(', Collect:'collect(', Apart:'apart(', Together:'together(',
  GCD:'gcd(', LCM:'lcm(', Derive:'derivative(', Integrate:'integrate(', Limit:'limit(', Sum:'sum(', Product:'product(',
  Series:'series(', DSolve:'dsolve(', Solve:'solve(', Zeros:'zeros(', System:'solve([', Det:'det(', Inv:'inv(',
  Transpose:'transpose(', Eigs:'eigs(', RREF:'rref(', Trace:'trace(', Evaluate:'', Round:'round(', Format:'format(',
  Mean:'mean([', Std:'std([', Var:'variance([', Median:'median([', Quantile:'quantileSeq([', Corr:'correlation(',
  Basic:'sin(', Inverse:'asin(', Hyperbolic:'sinh(', Degrees:'sin(', Convert:'', SI:'', Imperial:'',
  Boolean:'and(', Bitwise:'bitAnd(', Combinatorics:'combinations(',
};
