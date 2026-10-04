// CassyCAS service worker: makes the hosted app work offline.
// The app shell is network-first (so updates arrive); versioned Pyodide/SymPy files from
// jsDelivr are immutable and served cache-first after the first download.
const SHELL = 'cassycas-shell-v2';
const RUNTIME = 'cassycas-pyodide-v314.0.7';
const SNAPSHOT = 'cassycas-engine-snapshot';     // written by the SymPy worker
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(SHELL_FILES);
    // Every built chunk (precache.json is written by the build), so features loaded on demand
    // (3D plots, visual input) also work offline after one visit.
    try { await cache.addAll((await (await fetch('./precache.json')).json()).map(f => './' + f)); } catch {}
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![SHELL, RUNTIME, SNAPSHOT].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/pyodide/v314.0.7/')) {
    e.respondWith(caches.open(RUNTIME).then(async cache => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) caches.open(SHELL).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
  }
});
