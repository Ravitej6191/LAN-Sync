// LAN Share (web version) service worker:
// 1) keeps the page working offline after the first visit (network first, cache as the fallback),
// 2) receives files from the phone's Share menu when the page is installed.
const CACHE = 'lanshare-p2p-v1';
const SHELL = ['./', 'index.html', 'qrcode.js', 'jsQR.js', 'icon-192.png', 'manifest.webmanifest'];

self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE && k !== 'share-inbox') await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method === 'POST' && u.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      const fd = await req.formData();
      const cache = await caches.open('share-inbox');
      for (const k of await cache.keys()) await cache.delete(k);
      const files = fd.getAll('files').filter(f => f && f.name !== undefined);
      let i = 0;
      for (const f of files) await cache.put('/shared-file/' + (i++) + '/' + encodeURIComponent(f.name), new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
      const text = [fd.get('title'), fd.get('text'), fd.get('url')].filter(Boolean).join(' ').trim();
      return Response.redirect(new URL('./?share=' + i + (text ? '&t=' + encodeURIComponent(text.slice(0, 5000)) : ''), self.registration.scope).href, 303);
    })());
    return;
  }
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch (err) {
      return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('./')) || Response.error();
    }
  })());
});
