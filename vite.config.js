import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Relative paths, so the built site works in any folder:
  // GitHub Pages (/ClassMap/) now, your own domain later.
  base: './',
  build: {
    outDir: 'dist',
    // One JS file and one CSS file per page, with a content hash in their names. A new release
    // gets new names, so browsers and the service worker never mix old and new code.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),        // public home page   →  /
        app: resolve(__dirname, 'app/index.html'),      // the app            →  /app/
        privacy: resolve(__dirname, 'privacy.html'),    // privacy policy     →  /privacy.html
      },
    },
  },
});
