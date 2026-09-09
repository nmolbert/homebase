// Home Base service worker: offline shell + push notifications.
// Bump CACHE whenever app files change together with a page.
const CACHE = "homebase-v1";
const SHELL = ["/", "/index.html", "/style.css", "/app.js", "/ui.js", "/vendor/preact-htm.js", "/manifest.webmanifest", "/icons/icon.svg",
  "/pages/dashboard.js", "/pages/budget.js", "/pages/transactions.js", "/pages/paycheck.js", "/pages/accounts.js", "/pages/goals.js",
  "/pages/home.js", "/pages/crud.js", "/pages/settings.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ics/")) return; // never cache data
  // Network first for everything (fresh code), cache as the offline fallback.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html"))),
  );
});

self.addEventListener("push", (e) => {
  let data = { title: "Home Base", body: "" };
  try { data = e.data.json(); } catch { data.body = e.data ? e.data.text() : ""; }
  e.waitUntil(self.registration.showNotification(data.title || "Home Base", {
    body: data.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: data.tag || "homebase",
    data: { url: data.url || "#/" }, renotify: true,
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL("/" + (e.notification.data?.url || "#/"), location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate(target); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
