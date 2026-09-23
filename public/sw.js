const CACHE_NAME = "water-workbench-v11";
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
      Promise.all(keys.filter((key) => key.startsWith('water-workbench-') && key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Online assets must match the running server; cache is only an offline fallback.
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' }).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
      }
      return response;
    }).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      return cached || Response.error();
    })
  );
});
