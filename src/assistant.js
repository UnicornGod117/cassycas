// Optional natural-language assistant (opt-in). Calls the Claude API directly from the browser
// with the user's own API key, which is stored only in this browser's localStorage.
// It never runs anything itself: a suggested expression is checked by the CAS (see main.js)
// and placed in the editor for review. The SDK is loaded only when the assistant is used.
import { MODES } from './modes.js';
import { TOOLS } from './tools.js';
import { DISTRIBUTION_DOCS } from './kernel/distributions.js';

const MODEL = 'claude-opus-5-5';
const KEY_STORAGE = 'cas-anthropic-key';

export function getApiKey() { try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } }
export function setApiKey(key) {
  try { if (key) localStorage.setItem(KEY_STORAGE, key.trim()); else localStorage.removeItem(KEY_STORAGE); } catch {}
}
export const assistantEnabled = () => !!getApiKey();

let sdk = null;
async function client() {
  sdk ||= (await import('@anthropic-ai/sdk')).default;
  // The key belongs to the person using this page and never leaves their browser except to
  // api.anthropic.com, so browser access is intended here.
  return new sdk({ apiKey: getApiKey(), dangerouslyAllowBrowser: true });
}

const SYSTEM = `You translate mathematics requests into input for CassyCAS, a computer algebra system with mathjs syntax.

Syntax: ^ for powers, * for products (implicit 2x is allowed), sqrt(), exp(), log() is the natural log, pi, e, i, Infinity.
Functions: simplify(f), expand(f), factor(f), apart(f, x), collect(f, x), polydiv(p, q, x),
derivative(f, x[, n]), integrate(f, x) or integrate(f, x, a, b), limit(f, x, a[, "+"|"-"]), series(f, x, a, n),
sum(f, k, a, b), product(f, k, a, b), gradient(f, [x, y]), solve(lhs = rhs, x), solve(x^2 < 4, x),
solve([eq1, eq2], [x, y]), dsolve(y'' + y = 0, y(x), y(0) = 1), ode(f(x, y), x, y, x0, y0, x1),
det(A), inv(A), eigs(A), rref(A), unit conversions like "100 km/h to m/s", mean([...]), std([...]),
multiple integrals integrate(f, [y, 0, x], [x, 0, 1]), mixed partials derivative(f, x, y), assume(x > 0),
plot(f, x^2 + y^2 = 4, y < x, [x(t), y(t)], r = f(theta), slopefield(f), vectorfield([P, Q]), domaincolor(f(z)), [x, a, b]).
${Object.values(TOOLS).map(t => t.sig).join(', ')}.
Probability: ${DISTRIBUTION_DOCS.map(d => d.s).join(', ')}.
Definitions: "a = 5", "f(x) = x^2 + 1".

Return exactly one expression. Choose the mode that fits: ${Object.keys(MODES).join(', ')}.
If the request is not about mathematics, return an empty expression and say why in the explanation.`;

const SCHEMA = {
  type: 'object',
  properties: {
    expression: { type: 'string', description: 'CassyCAS input, or empty if the request cannot be expressed' },
    mode: { type: 'string', enum: Object.keys(MODES) },
    explanation: { type: 'string', description: 'One short sentence explaining the translation' },
  },
  required: ['expression', 'mode', 'explanation'],
  additionalProperties: false,
};

function describeError(err) {
  const A = sdk;
  if (A && err instanceof A.AuthenticationError) return 'The API key was rejected — check it in Tweaks.';
  if (A && err instanceof A.PermissionDeniedError) return 'This API key is not allowed to use the model.';
  if (A && err instanceof A.RateLimitError) return 'Rate limited by the Claude API — try again shortly.';
  if (A && err instanceof A.APIConnectionError) return 'Could not reach the Claude API (offline?).';
  if (A && err instanceof A.APIError) return `Claude API error ${err.status ?? ''}: ${err.message}`;
  return err && err.message ? err.message : String(err);
}

async function ask(params) {
  let response;
  try {
    response = await (await client()).beta.messages.create({
      model: MODEL,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',        // re-run a declined request on Anthropic's recommended model
      ...params,
    });
  } catch (err) {
    throw new Error(describeError(err));
  }
  if (response.stop_reason === 'refusal') throw new Error('The request was declined.');
  if (response.stop_reason === 'max_tokens') throw new Error('The answer was cut off — try a shorter request.');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  if (!text) throw new Error('Empty response from the Claude API.');
  return text;
}

async function translateContent(content) {
  const text = await ask({
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });
  const out = JSON.parse(text);
  if (!MODES[out.mode]) out.mode = 'algebra';
  return out;
}

// Natural language → { expression, mode, explanation }. `feedback` reports what the CAS said
// about a previous suggestion, so a second attempt can correct it.
export async function translate(request, workspace = [], feedback = null) {
  const context = workspace.length ? `Workspace definitions: ${workspace.join('; ')}\n\n` : '';
  const retry = feedback ? `\n\nYour previous suggestion "${feedback.expression}" failed in the CAS: ${feedback.error}. Give a corrected expression.` : '';
  return translateContent(`${context}Request: ${request}${retry}`);
}

// A photo or screenshot of handwritten or printed mathematics → { expression, mode, explanation }.
export async function translateImage(base64, mediaType, hint = '') {
  return translateContent([
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
    { type: 'text', text: `Transcribe the mathematics in this image as one CassyCAS expression that does what the problem asks (solve it, integrate it, simplify it, …).${hint ? ' ' + hint : ''}` },
  ]);
}

// Plain-language explanation of a computed result, grounded in the engine's own steps and
// its independent verification, so the explanation cannot drift from what was computed.
export async function explain(input, result, steps = [], check = null) {
  const stepText = steps.length ? `\nEngine steps:\n${steps.map(s => `- ${s.d}${s.tex ? ': ' + s.tex : s.e ? ': ' + s.e : ''}`).join('\n')}` : '';
  const checkText = check ? `\nIndependent check: ${check.status} (${check.how})` : '';
  return ask({
    max_tokens: 4000,
    output_config: { effort: 'medium' },
    system: 'You explain computer-algebra results to a student in 3–6 short sentences of plain text (no Markdown, no LaTeX). Say what was computed, why the result is what it is, and one thing worth noticing. Use only the given result and steps; do not recompute or contradict them.',
    messages: [{ role: 'user', content: `Input: ${input}\nResult: ${result}${stepText}${checkText}` }],
  });
}
