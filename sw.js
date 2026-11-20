// sw.js - web push only (STEP 10). Caches nothing: desk data is never stored by the service worker.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = {text: e.data && e.data.text()}; }
  e.waitUntil(self.registration.showNotification("Grok Bot · now", {body: d.text || "", icon: "icons/icon-192.png",
    badge: "icons/icon-192.png", data: {link: d.link || null}, actions: d.link ? [{action: "fomo", title: "Open on FOMO"}] : []}));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const link = e.notification.data && e.notification.data.link;   // a links.py string from the desk, never built here
  e.waitUntil(link ? clients.openWindow(link) : clients.openWindow("./"));
});
