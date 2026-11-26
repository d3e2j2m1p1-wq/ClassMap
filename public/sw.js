// ClassMap service worker — makes the app open offline.
//  • The page itself: network first, so teachers get updates as soon as they're online;
//    the cached copy is used only when offline.
//  • Built JS/CSS files: cache first. Their names include a content hash, so a cached
//    file is never out of date — a new release simply uses new names.
const CACHE = 'classmap-v3';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // our own old caches, and the model files of the on-device AI that ClassMap used to have
      // ('transformers-cache', often over a gigabyte) — removed so teachers get that space back
      .then(keys => Promise.all(keys.filter(k => (k.startsWith('classmap-') && k !== CACHE) || k === 'transformers-cache').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match(new URL(url.pathname.startsWith('/pixel') ? './pixel/' : './app/', self.location.href).href)))
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
