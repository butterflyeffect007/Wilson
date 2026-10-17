// Wilson service worker — offline app shell + Web Push.
// The version and precache list are filled in at build time (vite.config.ts), so every deploy
// installs a fresh worker that activates immediately; the next open loads the new build.
// Only same-origin app files are cached. Worker/API traffic (other origin) is never touched.
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const SHELL = "wilson-shell-" + VERSION;
const RUNTIME = "wilson-runtime";
const BASE = new URL("./", self.location).pathname;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL).then(async (c) => {
      await Promise.all(PRECACHE.map((p) => c.add(new Request(BASE + p, { cache: "reload" })).catch(() => {})));
      const idx = await fetch(BASE, { cache: "reload" }).catch(() => null);
      if (idx && idx.ok) await c.put("shell", idx);
    }).then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("wilson-") && k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  if (req.mode === "navigate") {
    // Network-first (fresh deploys), but fall back to the cached shell fast when offline / slow.
    e.respondWith(
      Promise.race([fetch(req, { cache: "no-store" }), timeout(3500)])
        .then((res) => { if (res.ok) { const c = res.clone(); caches.open(SHELL).then((k) => k.put("shell", c)); } return res; })
        .catch(() => caches.open(SHELL).then((k) => k.match("shell")).then((r) => r || fetch(req)))
    );
    return;
  }
  if (url.pathname.endsWith("/sw.js") || url.pathname.endsWith("/version.json")) return;
  // Hashed assets, fonts, icons: cache-first; anything else same-origin: stale-while-revalidate.
  const immutable = url.pathname.includes("/assets/");
  // Wilson's on-device voice engine (Puck worker, ONNX runtime, wasm) is big and rarely changes:
  // keep it in the runtime cache, which survives deploys, so it downloads once.
  const engine = immutable && (/\/assets\/(puckWorker|ort-|transformers)/.test(url.pathname) || url.pathname.endsWith(".wasm"));
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok && res.type === "basic") { const c = res.clone(); caches.open(immutable && !engine ? SHELL : RUNTIME).then((k) => k.put(req, c)); }
        return res;
      });
      if (hit) { if (!immutable) net.catch(() => {}); return hit; }
      return net;
    })
  );
});

/* ---------- Web Push ---------- */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Wilson", {
    body: d.body || "",
    tag: d.tag || "wilson",
    icon: BASE + "icon-192.png",
    badge: BASE + "icon-192.png",
    data: { url: d.url || BASE },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || BASE, self.location).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).pathname.startsWith(BASE)) {
        await w.focus();
        w.postMessage({ type: "wilson-open", url: target });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
