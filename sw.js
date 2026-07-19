const CACHE_NAME = "chonglema-shell-20260719-1";
const PRIVATE_DB = "chonglema-private-state";
const PRIVATE_STORE = "state";
const TODAY_STATE_KEY = "today-record";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/index-Linked22.css",
  "./assets/index-Linked22.js",
  "./assets/refine-245.css",
  "./assets/refine-motion.css?v=20260718-1",
  "./assets/refine-motion.js?v=20260718-1",
  "./assets/recovery-module.css",
  "./assets/recovery-module.js",
  "./assets/leaderboard-module.css?v=20260718-4",
  "./assets/leaderboard-module.js?v=20260718-4",
  "./assets/leaderboard-core.js",
  "./assets/leaderboard-config.js",
  "./assets/pwa-module.css?v=20260717-1",
  "./assets/pwa-module.js?v=20260717-2",
  "./assets/gsap.min.js?v=3.15.0",
  "./assets/Flip.min.js?v=3.15.0",
  "./assets/ScrollTrigger.min.js?v=3.15.0",
  "./assets/gsap-motion.css?v=20260719-1",
  "./assets/gsap-motion.js?v=20260719-1",
  "./assets/pwa-icon-192.png",
  "./assets/pwa-icon-512.png",
];

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readTodayRecordState() {
  if (typeof indexedDB === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const request = indexedDB.open(PRIVATE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PRIVATE_STORE)) {
        request.result.createObjectStore(PRIVATE_STORE, { keyPath: "key" });
      }
    };
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      try {
        const transaction = request.result.transaction(PRIVATE_STORE, "readonly");
        const getRequest = transaction.objectStore(PRIVATE_STORE).get(TODAY_STATE_KEY);
        getRequest.onerror = () => resolve(false);
        getRequest.onsuccess = () => {
          const value = getRequest.result;
          resolve(Boolean(value?.recorded && value.date === localDateKey()));
        };
      } catch {
        resolve(false);
      }
    };
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", response.clone()));
          return response;
        })
        .catch(() => caches.match("./index.html").then((cached) => cached || caches.match("./"))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      }).catch(() => cached);
      return cached || fresh;
    }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || "花几秒记一下，保持自己的节奏。" };
  }
  event.waitUntil((async () => {
    const isDailyReminder = (payload.tag || "chonglema-daily") === "chonglema-daily";
    if (isDailyReminder && await readTodayRecordState()) return;
    await self.registration.showNotification(payload.title || "今天，冲了吗？", {
      body: payload.body || "花几秒记一下，保持自己的节奏。",
      icon: "./assets/pwa-icon-192.png",
      badge: "./assets/pwa-icon-192.png",
      tag: payload.tag || "chonglema-daily",
      renotify: false,
      data: { url: payload.url || "./?source=push" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === new URL(targetUrl).origin);
      if (existing) {
        if ("navigate" in existing) await existing.navigate(targetUrl);
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
