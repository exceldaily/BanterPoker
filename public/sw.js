/* Banter Poker service worker.
 *
 * Caching policy, deliberately conservative:
 *  - The app shell (landing, join, create) and static assets are cached so the
 *    PWA opens instantly and works offline enough to show "reconnecting".
 *  - /api/* is NEVER cached: every response may contain a player's private
 *    hole cards or a device-scoped view of the table. Those go straight to
 *    the network with no fallback.
 *  - Realtime/Supabase requests are not intercepted at all.
 */

const VERSION = "bp-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL_URLS = ["/", "/join", "/create", "/offline", "/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isPrivate(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/game/") || url.pathname.startsWith("/display/") || url.pathname.startsWith("/dev");
}

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase traffic
  if (isPrivate(url)) return; // network only, no caching, no offline fallback for private data

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && SHELL_URLS.includes(url.pathname)) {
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, res.clone()));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          const offline = await caches.match("/offline");
          return offline || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        }),
    );
  }
});
