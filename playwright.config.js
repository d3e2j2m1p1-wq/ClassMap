import { defineConfig } from '@playwright/test';

// Two local servers: the app (Vite) and the Cloudflare Worker that relays "Send & receive"
// (wrangler dev runs it on this computer — no Cloudflare account needed).
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: { baseURL: 'http://localhost:5199/', viewport: { width: 1280, height: 800 } },
  webServer: [
    {
      command: 'npm run dev -- --port 5199 --strictPort',
      url: 'http://localhost:5199/',
      reuseExistingServer: true,
      env: { VITE_GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', VITE_SHARE_URL: 'ws://127.0.0.1:8799/api/share/' },
    },
    {
      command: 'npm run build && npx wrangler dev --port 8799 --ip 127.0.0.1',
      url: 'http://127.0.0.1:8799/',
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
