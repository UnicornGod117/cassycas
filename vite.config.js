import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import path from 'node:path';

// Two builds:
//   npm run build          dist/         code-split for hosting: the app shell loads first, and
//                                         Plotly (3D), MathLive (visual input) and the Claude SDK
//                                         load only when used. The service worker precaches all.
//   npm run build:single   dist-single/  one self-contained HTML file (open it from disk, mail it).
const single = process.argv.includes('single');      // vite build --mode single

// KaTeX ships woff2 + woff + ttf for every face; modern browsers only need woff2.
const katexWoff2Only = {
  name: 'katex-woff2-only',
  enforce: 'pre',
  transform(code, id) {
    if (!/katex(\.min)?\.css$/.test(id)) return null;
    return code.replace(/,\s*url\([^)]*\.woff\)\s*format\("woff"\)/g, '').replace(/,\s*url\([^)]*\.ttf\)\s*format\("truetype"\)/g, '');
  },
};

// The single-file build cannot reference worker files, so its workers are inlined.
const inlineWorkers = {
  name: 'inline-workers',
  enforce: 'pre',
  transform(code, id) {
    if (!single || !/\/src\/.*\.js$/.test(id.replace(/\\/g, '/'))) return null;
    return code.includes("?worker'") ? code.replace(/\?worker'/g, "?worker&inline'") : null;
  },
};

// precache.json: every built file, so the service worker can make the whole app available
// offline after one visit (including chunks that have not been loaded yet).
const precacheManifest = {
  name: 'precache-manifest',
  writeBundle(options, bundle) {
    const files = Object.keys(bundle).filter(f => !f.endsWith('.map'));
    fs.writeFileSync(path.join(options.dir, 'precache.json'), JSON.stringify(files));
  },
};

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  base: './',
  build: {
    outDir: single ? '../dist-single' : '../dist',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 20000,
    reportCompressedSize: false,
  },
  worker: { format: 'es' },
  plugins: [katexWoff2Only, inlineWorkers, single ? viteSingleFile() : precacheManifest],
});
