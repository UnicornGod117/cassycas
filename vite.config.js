import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// KaTeX ships woff2 + woff + ttf for every face; modern browsers only need woff2.
// Dropping the other formats keeps the single-file build ~1 MB smaller.
const katexWoff2Only = {
  name: 'katex-woff2-only',
  enforce: 'pre',
  transform(code, id) {
    if (!/katex(\.min)?\.css$/.test(id)) return null;
    return code.replace(/,\s*url\([^)]*\.woff\)\s*format\("woff"\)/g, '').replace(/,\s*url\([^)]*\.ttf\)\s*format\("truetype"\)/g, '');
  },
};

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 20000, reportCompressedSize: false },
  worker: { format: 'es' },
  plugins: [katexWoff2Only, viteSingleFile()],
});
