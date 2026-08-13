// App-shell cache, NETWORK-FIRST for navigations: Hushfall changes often
// and players must pick up each deploy on the next launch —
// stale-while-revalidate on the shell meant players ran LAST visit's build
// (mismatched builds = "black room" / kicked-at-start reports). Hashed
// assets stay cache-first: their names change when their bytes do.
const CACHE = 'interverse-hushfall-v4';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const cacheFirst = url.pathname.includes('/assets/');
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      if (cacheFirst) {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }
      // Navigations + everything else: fresh when online, cache offline.
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        throw new Error('offline and uncached');
      }
    }),
  );
});
