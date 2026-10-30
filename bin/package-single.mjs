// Keep the downloadable entry point at the repository root. No server is needed.
import { readFile, writeFile } from 'node:fs/promises';
const source = new URL('../dist-single/index.html', import.meta.url);
let html = await readFile(source, 'utf8');
// A manifest only applies to hosted installations; avoid a file:// resource request.
html = html.replace(/<link\b[^>]*rel="manifest"[^>]*>/g, '');
if (/<script\b[^>]*\bsrc=/.test(html) || /<link\b[^>]*rel="stylesheet"/.test(html)) {
  throw new Error('The portable calculator must contain its scripts and styles.');
}
await writeFile(new URL('../index.html', import.meta.url), html);
console.log('Portable calculator ready: double-click index.html');
