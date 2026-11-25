import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readdirSync, existsSync } from 'fs';

// Every guide page: guides/<name>/index.html
const guides = Object.fromEntries(
  readdirSync(resolve(__dirname, 'guides'), { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(resolve(__dirname, 'guides', d.name, 'index.html')))
    .map(d => ['guide-' + d.name, resolve(__dirname, 'guides', d.name, 'index.html')])
);

export default defineConfig({
  // Relative paths, so the built site works in any folder
  base: './',
  // The on-device AI runs in a module Web Worker (src/ai/aiWorker.js)
  worker: { format: 'es' },
  // Use the onnxruntime build that loads its 27 MB engine file at run time (from /ai-runtime/ — see
  // worker/index.js) instead of copying it into the site: Cloudflare won't host files over 25 MiB.
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm'] },
  build: {
    outDir: 'dist',
    // One JS file and one CSS file per page, with a content hash in their names. A new release
    // gets new names, so browsers and the service worker never mix old and new code.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),              // public home page →  /
        app: resolve(__dirname, 'app/index.html'),            // the app          →  /app/
        privacy: resolve(__dirname, 'privacy/index.html'),    // privacy policy   →  /privacy/
        guides: resolve(__dirname, 'guides/index.html'),      // guides list      →  /guides/
        contact: resolve(__dirname, 'contact/index.html'),    // contact page     →  /contact/
        ...guides,                                            // each guide       →  /guides/<name>/
      },
    },
  },
});
