const CACHE_NAME = "hnsite-v28";
const APP_SHELL = [
  "./",
  "./index.html",
  "./channels.html",
  "./app.html",
  "./bingo.html",
  "./bingo-room.html",
  "./kill.html",
  "./assets/styles.css?v=28",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    const clone = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => undefined);
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./channels.html"))));
});
