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
        ...guides,                                            // each guide       →  /guides/<name>/
      },
    },
  },
});
