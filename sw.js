/* Service worker: tiene in cache i file dell'app. Prova prima la rete (così gli aggiornamenti arrivano subito);
   se la rete non risponde entro 3 secondi usa la copia salvata. */
var CACHE = 'meteo-pieve-v2';
var SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () { /* file facoltativo */ }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function finish(r) { if (!done && r) { done = true; resolve(r); } }
    var timer = setTimeout(function () { caches.match(req).then(finish); }, 3000);
    fetch(req, { cache: 'no-cache' }).then(function (res) {
      clearTimeout(timer);
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      finish(res);
    }).catch(function () {
      clearTimeout(timer);
      caches.match(req).then(function (m) { return m || caches.match('index.html'); }).then(function (m) {
        if (m) finish(m); else if (!done) { done = true; resolve(Response.error()); }
      });
    });
  }));
});
