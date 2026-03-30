const CACHE_NAME = 'pomodoro-v2';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// ── Install: cache app shell ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // addAll fails if any request fails; use individual adds so missing
      // PNG icons (not yet generated) don't break the install.
      return Promise.allSettled(APP_SHELL.map(url => cache.add(url)));
    })
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: cache-first for app shell ─────────────────────────
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ── Message: show notification ────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    const { title, body } = event.data.payload;
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag: 'pomodoro-timer',   // replaces previous — no stacking
        renotify: true,          // still vibrate/sound on replacement
        requireInteraction: false,
        data: { url: self.location.origin },
      })
    );
  }
});

// ── Notification click: bring app to foreground ───────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => {
        const existing = list.find(
          c => c.url.startsWith(self.location.origin) && 'focus' in c
        );
        if (existing) return existing.focus();
        return clients.openWindow(event.notification.data?.url || self.location.origin);
      })
  );
});
