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
const CACHE = 'atlas-${build}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
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
