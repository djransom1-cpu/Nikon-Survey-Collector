const CACHE_NAME = 'nikon-survey-v1';
const ASSETS = [
  './',
  './index.html',
  './index.css',
  './js/app.js',
  './js/nikon_protocol.js',
  './js/survey_cad.js',
  './js/dxf_exporter.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
