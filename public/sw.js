const CACHE_NAME = "water-workbench-v10";
const APP_SHELL = [
  "/",
  "/research.html",
  "/research.css",
  "/research.js",
  "/research-map.js",
  "/diffusion.js",
  "/diffusion-worker.js",
  "/vendor/numeric-1.2.6.min.js",
  "/styles.css",
  "/app.js",
  "/contour-map.js",
  "/contour-export.js",
  "/vendor/clipper.js",
  "/safe-clipping.js",
  "/vendor/shpwrite.js",
  "/vendor/jszip.min.js",
  "/vendor/d3.v7.min.js",
  "/vendor/topojson-client.min.js",
  "/data/japan.topo.json",
  "/manifest.webmanifest",
  "/icons/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
