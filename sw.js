// Atlas Treningowy 0.8.0-202610211257
const CACHE = 'atlas-0.8.0-202610211257';
const IMG = 'atlas-img';
const FILES = ["./","./index.html","./manifest.webmanifest","./icon-180.png","./icon-192.png","./icon-512.png"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== IMG).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  // Zdjęcia ćwiczeń: z pamięci telefonu, a przy pierwszym użyciu z sieci (i zapamiętane na stałe, także między wersjami)
  if (new URL(r.url).pathname.includes('/img/')) {
    e.respondWith(caches.open(IMG).then(c => c.match(r).then(hit => hit || fetch(r).then(res => (res.ok ? c.put(r, res.clone()).then(() => res, () => res) : res)))));
    return;
  }
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => hit || fetch(r).catch(() => caches.match('./index.html'))));
});
