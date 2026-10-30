import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const build = `${version}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;

// Service worker: kopia aplikacji w telefonie. Nowa wersja = nowa nazwa pamięci podręcznej.
const serviceWorker = (): Plugin => ({
  name: 'atlas-sw',
  generateBundle() {
    const files = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
    this.emitFile({ type: 'asset', fileName: 'sw.js', source: `// Atlas Treningowy ${build}
const CACHE = 'atlas-${build}';\nconst IMG = 'atlas-img';
const FILES = ${JSON.stringify(files)};
// Instalacja: pliki zawsze prosto z serwera (z pominięciem pamięci przeglądarki) i sprawdzenie, że strona to naprawdę ta wersja.
// Gdy serwer jeszcze podaje starą stronę (GitHub Pages rozsyła zmiany do kilku minut), instalacja się nie udaje i telefon spróbuje ponownie.
self.addEventListener('install', e => { e.waitUntil((async () => {
  await caches.delete(CACHE); // resztki po nieudanej próbie
  const got = [];
  for (const f of FILES) {
    const res = await fetch(new Request(f, { cache: 'reload' }));
    if (!res.ok) throw new Error('brak ' + f);
    if ((res.headers.get('content-type') || '').includes('html') && !(await res.clone().text()).includes('${build}')) throw new Error('serwer podaje jeszcze starą wersję');
    got.push([f, res]);
  }
  const c = await caches.open(CACHE);
  for (const [f, res] of got) await c.put(f, res);
  await self.skipWaiting();
})()); });
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
` });
  },
});

export default defineConfig({
  root: 'phone',
  base: './',
  publicDir: 'public',
  define: { __APP_VERSION__: JSON.stringify(build) },
  plugins: [react(), viteSingleFile(), serviceWorker()],
  build: { outDir: new URL('./dist-phone', import.meta.url).pathname, emptyOutDir: true, assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 10_000 },
});
