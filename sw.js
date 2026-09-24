/* Service worker – Biathlon 5 s – N'EPS numérique – Quentin Delisle & Gwilherm Rocher */
const CACHE = 'biathlon5s-v2.0.0';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './logo-app.png',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './lib/qrcode.js', './lib/jsQR.js', './lib/xlsx.full.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(resp => {
    if (resp.ok && new URL(e.request.url).origin === location.origin) { const cl = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); }
    return resp;
  }).catch(() => caches.match('./index.html'))));
});
