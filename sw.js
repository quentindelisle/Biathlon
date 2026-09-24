/* Service worker – Biathlon 5 s – N'EPS numérique – Quentin Delisle et Gwilherm Rocher
   Réseau d'abord (toujours la dernière version quand on est connecté), cache si hors-ligne. */
const CACHE = 'biathlon5s-v3.2.0';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './logo-app.png',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './lib/qrcode.js', './lib/jsQR.js', './lib/xlsx.full.min.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ASSETS.map(u => fetch(u, { cache:'reload' }).then(r => r.ok && c.put(u, r)).catch(()=>{})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request.url, { cache:'no-cache' }).then(resp => {
    if (resp.ok) { const cl = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); }
    return resp;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
