// MARS CRM v90.53: network-first for app resources; do not cache API or private files.
const CACHE = 'mars-crm-public-v90-53';
const ASSETS = ['./','./index.html','./recovery.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('mars-crm-public-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode === 'navigate' && new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search || url.hash) return;
  const allowed = ASSETS.map(a => new URL(a, self.registration.scope).pathname);
  if (!allowed.includes(url.pathname)) return;
  event.respondWith(fetch(request).then(resp => {
    if (resp.ok) caches.open(CACHE).then(cache => cache.put(request, resp.clone())).catch(() => {});
    return resp;
  }).catch(() => caches.match(request)));
});
