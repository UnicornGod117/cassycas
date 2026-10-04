// KaTeX rendering, including "explorable" output where every sub-expression is clickable.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { math, stripParens } from './expr.js';

const KATEX_OPTS = {
  throwOnError: false, strict: 'ignore', maxExpand: 1000, output: 'htmlAndMathml',
  // Only \htmlData is trusted (it adds data-* attributes used for click-to-explore).
  trust: (ctx) => ctx.command === '\\htmlData',
};

export function renderTex(el, tex, display = true) {
  try { katex.render(tex, el, { ...KATEX_OPTS, displayMode: display }); }
  catch { el.textContent = tex; }
}

// "3 * x" → implicit product for nicer TeX (3x instead of 3·x).
function implicitCoefficients(node) {
  return node.transform(n => {
    if (n.isOperatorNode && n.fn === 'multiply' && n.args.length === 2) {
      const [a, b] = n.args.map(stripParens);
      if (a.isConstantNode && !b.isConstantNode && !(b.isOperatorNode && b.fn === 'unaryMinus'))
        return new math.OperatorNode('*', 'multiply', n.args, true);
    }
    return n;
  });
}

// Returns { tex, subs } where subs[i] is the mathjs node wrapped as \htmlData{p=i}{…}.
export function explorableTex(plain) {
  const root = implicitCoefficients(math.parse(plain));
  const subs = [];
  const handler = (node, options) => {
    if (!(node.isOperatorNode || node.isFunctionNode)) return undefined;
    const i = subs.push(node) - 1;
    return `\\htmlData{p=${i}}{${node._toTex(options)}}`;
  };
  const tex = root.toTex({ parenthesis: 'auto', implicit: 'hide', handler });
  return { tex, subs, root };
}
