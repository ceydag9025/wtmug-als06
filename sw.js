/* sw.js — app shell + CDN kütüphaneleri önbelleği */
const CACHE = 'als06-v1';

const ASSETS = [
  './', './index.html', './student.html', './lecturer.html', './report.html',
  './app.css', './common.js', './student.js', './lecturer.js', './report.js',
  './manifest-student.json', './manifest-lecturer.json',
  './students.json', './courses.json', './icons/icon.svg',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async (u) => {
      try { await c.add(new Request(u, { cache: 'reload' })); } catch (err) { /* yoksay */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    const cached = await caches.match(e.request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(e.request);
      if (res && (res.ok || res.type === 'opaque')) {
        const c = await caches.open(CACHE);
        c.put(e.request, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      return cached || Response.error();
    }
  })());
});