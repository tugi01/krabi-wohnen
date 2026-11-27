// Thailand Wohnen – Service Worker: immer zuerst aus dem Netz (damit Neuerungen sofort ankommen),
// offline aus dem Zwischenspeicher.
const CACHE = 'krabiwohnen-v33';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'th.js', 'touch.js', 'manifest.webmanifest', 'datenschutz.html',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'icons/icon-192.png', 'icons/icon-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'}))))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return; // Fotos/Kacheln direkt
  // Programmteile mit Versionsnummer (?v=…) und Bibliotheken ändern sich nie unter derselben Adresse:
  // sofort aus dem Zwischenspeicher – spart beim Öffnen mehrere Netz-Anfragen. Neue Version = neue Adresse.
  if (u.searchParams.has('v') || u.pathname.includes('/vendor/') || u.pathname.includes('/icons/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
      return r;
    })));
    return;
  }
  e.respondWith(fetch(e.request, {cache: 'no-cache'}).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined))));
});
