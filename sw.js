// sw.js - service worker: web push (STEP 10). No caching of /api.
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => self.clients.claim());
