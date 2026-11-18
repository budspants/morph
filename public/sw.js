// Offline support. Pages: network first, cached copy when offline. /assets/*: cached on first use
// (file names carry a content hash, so a cached file never goes stale). Nothing else is touched.
const PAGES = 'morph-pages'
const ASSETS = 'morph-assets'
const BIG = '' // origin of the big .wasm host; filled in at build by scripts/split-big-assets.mjs

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.add('/')))
  self.skipWaiting()
})
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// "ffmpeg-core-CgUfceKH.wasm" -> "ffmpeg-core.wasm": one cached copy per file, so updates don't pile up
// (the wasm files alone are ~70 MB).
const base = (path) => path.replace(/-[\w-]{8}(\.\w+)$/, '$1')

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const big = BIG && req.url.startsWith(BIG + '/assets/')
  if (url.origin !== location.origin && !big) return

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(PAGES).then((c) => c.put(url.pathname, res.clone()))
          return res
        })
        .catch(async () => (await caches.match(url.pathname, { cacheName: PAGES })) ?? caches.match('/', { cacheName: PAGES })),
    )
    return
  }

  if (big || url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req, { cacheName: ASSETS }).then(
        (hit) =>
          hit ||
          fetch(req).then(async (res) => {
            if (res.ok && res.status === 200) {
              const c = await caches.open(ASSETS)
              for (const k of await c.keys()) {
                const p = new URL(k.url).pathname
                if (p !== url.pathname && base(p) === base(url.pathname)) await c.delete(k)
              }
              await c.put(req, res.clone())
            }
            return res
          }),
      ),
    )
  }
})
