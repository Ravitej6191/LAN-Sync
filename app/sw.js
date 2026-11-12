// LAN Share service worker: makes the page installable and receives files from the phone's Share menu.
// It never caches the app, so you always get the newest version from the PC.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.pathname === '/share') {
    e.respondWith((async () => {
      const fd = await e.request.formData();
      const cache = await caches.open('share-inbox');
      for (const k of await cache.keys()) await cache.delete(k);
      const files = fd.getAll('files').filter(f => f && f.name !== undefined);
      let i = 0;
      for (const f of files) await cache.put('/shared-file/' + (i++) + '/' + encodeURIComponent(f.name), new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
      const text = [fd.get('title'), fd.get('text'), fd.get('url')].filter(Boolean).join(' ').trim();
      return Response.redirect(new URL('/?share=' + i + (text ? '&t=' + encodeURIComponent(text.slice(0, 5000)) : ''), self.location.href).href, 303);
    })());
  }
});
