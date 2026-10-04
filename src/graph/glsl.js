// GPU domain colouring: compile a complex expression in z into a WebGL fragment shader, so every
// pixel is computed on the graphics card (full resolution, smooth while panning). Expressions
// using anything without a GLSL counterpart return null and the CPU renderer is used instead.
import { math, stripParens } from '../expr.js';

const num = (v) => { const s = String(v); return /[.eE]/.test(s) ? s : s + '.0'; };

export function compileGLSL(node) {
  const walk = (n) => {
    n = stripParens(n);
    if (n.isConstantNode && typeof n.value === 'number') return `vec2(${num(n.value)}, 0.0)`;
    if (n.isSymbolNode) {
      if (n.name === 'z') return 'z';
      if (n.name === 'i') return 'vec2(0.0, 1.0)';
      if (n.name === 'pi') return `vec2(${Math.PI}, 0.0)`;
      if (n.name === 'e') return `vec2(${Math.E}, 0.0)`;
      throw new Error('symbol');
    }
    if (n.isOperatorNode) {
      const a = n.args.map(walk);
      if (n.fn === 'unaryMinus') return `(-${a[0]})`;
      if (n.fn === 'unaryPlus') return a[0];
      const bin = { add: (p, q) => `(${p} + ${q})`, subtract: (p, q) => `(${p} - ${q})`, multiply: (p, q) => `cmul(${p}, ${q})`,
        divide: (p, q) => `cdiv(${p}, ${q})`, pow: (p, q) => `cpow(${p}, ${q})` }[n.fn];
      if (!bin) throw new Error('op');
      if (n.fn === 'pow') {
        const e = stripParens(n.args[1]);
        if (e.isConstantNode && Number.isInteger(e.value) && Math.abs(e.value) <= 8) return `cipow(${a[0]}, ${e.value})`;
      }
      return a.slice(1).reduce((acc, q) => bin(acc, q), a[0]);
    }
    if (n.isFunctionNode && n.fn.isSymbolNode) {
      const a = n.args.map(walk);
      const F = { exp: 'cexp', log: 'clog', sin: 'csin', cos: 'ccos', tan: 'ctan', sqrt: 'csqrt', sinh: 'csinh', cosh: 'ccosh', tanh: 'ctanh', conj: 'cconj' };
      if (F[n.fn.name] && a.length === 1) return `${F[n.fn.name]}(${a[0]})`;
      if (n.fn.name === 'abs' && a.length === 1) return `vec2(length(${a[0]}), 0.0)`;
      if (n.fn.name === 're' && a.length === 1) return `vec2((${a[0]}).x, 0.0)`;
      if (n.fn.name === 'im' && a.length === 1) return `vec2((${a[0]}).y, 0.0)`;
      throw new Error('fn');
    }
    throw new Error('node');
  };
  try { return walk(typeof node === 'string' ? math.parse(node) : node); } catch { return null; }
}

const LIB = `
precision highp float;
uniform vec4 view;   // xmin, xmax, ymin, ymax
uniform vec2 size;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) { float d = dot(b, b); return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d; }
vec2 cexp(vec2 a) { return exp(a.x) * vec2(cos(a.y), sin(a.y)); }
vec2 clog(vec2 a) { return vec2(log(length(a)), atan(a.y, a.x)); }
vec2 cpow(vec2 a, vec2 b) { if (dot(a, a) == 0.0) return vec2(0.0); return cexp(cmul(b, clog(a))); }
vec2 cipow(vec2 a, int n) { vec2 r = vec2(1.0, 0.0); vec2 b = n < 0 ? cdiv(vec2(1.0, 0.0), a) : a; int m = n < 0 ? -n : n;
  for (int k = 0; k < 8; k++) { if (k >= m) break; r = cmul(r, b); } return r; }
vec2 csqrt(vec2 a) { float r = length(a); return vec2(sqrt(max(0.0, (r + a.x) / 2.0)), sign(a.y + 1e-30) * sqrt(max(0.0, (r - a.x) / 2.0))); }
float sh(float x) { return 0.5 * (exp(x) - exp(-x)); }
float ch(float x) { return 0.5 * (exp(x) + exp(-x)); }
vec2 csin(vec2 a) { return vec2(sin(a.x) * ch(a.y), cos(a.x) * sh(a.y)); }
vec2 ccos(vec2 a) { return vec2(cos(a.x) * ch(a.y), -sin(a.x) * sh(a.y)); }
vec2 ctan(vec2 a) { return cdiv(csin(a), ccos(a)); }
vec2 csinh(vec2 a) { return vec2(sh(a.x) * cos(a.y), ch(a.x) * sin(a.y)); }
vec2 ccosh(vec2 a) { return vec2(ch(a.x) * cos(a.y), sh(a.x) * sin(a.y)); }
vec2 ctanh(vec2 a) { return cdiv(csinh(a), ccosh(a)); }
vec2 cconj(vec2 a) { return vec2(a.x, -a.y); }
vec3 hsl(float h, float s, float l) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}
`;
// The same colouring as the CPU renderer: hue = arg w, lightness from |w| with log bands.
const MAIN = (expr) => `
void main() {
  vec2 z = vec2(view.x + gl_FragCoord.x / size.x * (view.y - view.x), view.z + gl_FragCoord.y / size.y * (view.w - view.z));
  vec2 w = ${expr};
  if (!(w.x == w.x) || !(w.y == w.y) || abs(w.x) > 1e30 || abs(w.y) > 1e30) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float hue = fract(atan(w.y, w.x) / 6.28318530718 + 1.0);
  float m = length(w);
  float band = 0.85 + 0.15 * fract(log2(m + 1e-30));
  float l = (1.0 - 1.0 / (1.0 + pow(m, 0.35))) * band;
  gl_FragColor = vec4(hsl(hue, 0.9, 0.12 + 0.76 * l), 1.0);
}`;

// A renderer for one expression: draw(view, width, height) → the WebGL canvas, or null.
export function glDomainRenderer(exprCode) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  if (!gl) return null;
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = shader(gl.VERTEX_SHADER, 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }');
  const fs = shader(gl.FRAGMENT_SHADER, LIB + MAIN(exprCode));
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'), uView = gl.getUniformLocation(prog, 'view'), uSize = gl.getUniformLocation(prog, 'size');
  return (v, w, h) => {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4f(uView, v.xmin, v.xmax, v.ymin, v.ymax);
    gl.uniform2f(uSize, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return canvas;
  };
}
