const CACHE = "gonderdim-v2";
const ASSETS = ["./", "index.html", "talep/index.html", "admin/index.html", "app.js", "firebase-config.js", "manifest.webmanifest", "icons/logo.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});

// FCM / Web Push
self.addEventListener("push", e => {
  let p = {}; try { p = e.data.json(); } catch {}
  const n = p.notification || p.data || {};
  e.waitUntil(self.registration.showNotification(n.title || "GÖNDERDİM", { body: n.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png" }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window" }).then(l => l.length ? l[0].focus() : clients.openWindow("./")));
});
