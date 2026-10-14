// Panelin uygulama olarak kurulabilmesi için service worker.
// Bilerek hiçbir panel/API verisini önbelleğe almaz (siparişler her zaman canlı gelmeli);
// yalnızca bağlantı koptuğunda sayfa yerine "bağlantı yok" ekranı gösterir.
const CACHE = "tndrwa-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
