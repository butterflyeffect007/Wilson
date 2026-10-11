// Wilson service worker: network-first for pages (never serves a stale build when online),
// cache-first only for content-hashed /assets/ files. No API or proxy traffic is cached.
const CACHE = "wilson-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => { const c = res.clone(); caches.open(CACHE).then((k) => k.put("shell", c)); return res; })
        .catch(() => caches.open(CACHE).then((k) => k.match("shell")).then((r) => r || Response.error()))
    );
    return;
  }
  if (url.pathname.includes("/assets/")) {
    e.respondWith(
      caches.open(CACHE).then((k) => k.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) k.put(req, res.clone()); return res; })))
    );
  }
});
