// ClassMap service worker — makes the app open offline.
//  • The page itself: network first, so teachers get updates as soon as they're online;
//    the cached copy is used only when offline.
//  • Built JS/CSS files: cache first. Their names include a content hash, so a cached
//    file is never out of date — a new release simply uses new names.
const CACHE = 'classmap-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // only our own old caches — the on-device AI keeps its model in 'transformers-cache'
      .then(keys => Promise.all(keys.filter(k => k.startsWith('classmap-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // AI model files are big and the AI caches them itself — don't keep a second copy
  if (url.pathname.startsWith('/models/') || url.pathname.startsWith('/ai-runtime/')) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match(new URL('./app/', self.location.href).href)))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
