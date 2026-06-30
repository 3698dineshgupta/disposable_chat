/* ZapChat Service Worker — Push Notifications + Offline Cache */
const CACHE_NAME = 'zapchat-v1';
const OFFLINE_URL = '/';

/* ── Install: pre-cache app shell ── */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([OFFLINE_URL]).catch(() => {})
    )
  );
  self.skipWaiting();
});

/* ── Activate: clean old caches ── */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── Fetch: network-first, fallback to cache ── */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Skip cross-origin and API requests
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(e.request).then((cached) => cached || caches.match(OFFLINE_URL)))
  );
});

/* ── Push Notification handler ── */
self.addEventListener('push', (e) => {
  if (!e.data) return;

  let payload;
  try { payload = e.data.json(); }
  catch { payload = { title: 'ZapChat', body: e.data.text() }; }

  const title   = payload.title   || 'ZapChat';
  const options = {
    body:    payload.body    || 'You have a new message',
    icon:    payload.icon    || '/icons/icon-192.png',
    badge:   '/icons/badge-72.png',
    tag:     payload.tag     || 'zapchat-notification',
    data:    payload.data    || {},
    vibrate: [100, 50, 100],
    actions: payload.actions || [],
    renotify: !!payload.renotify,
    silent:  false,
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

/* ── Notification click: focus or open tab ── */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  const data           = e.notification.data || {};
  const conversationId = data.conversationId;
  const targetUrl      = conversationId
    ? `${self.location.origin}/chat?conv=${conversationId}`
    : `${self.location.origin}/chat`;

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing ZapChat tab
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          client.focus();
          if (conversationId) {
            client.postMessage({ type: 'NAVIGATE_TO_CONVERSATION', conversationId });
          }
          return;
        }
      }
      // No existing tab — open new window
      return self.clients.openWindow(targetUrl);
    })
  );
});

/* ── Background Sync: flush pending messages when back online ── */
self.addEventListener('sync', (e) => {
  if (e.tag === 'zapchat-sync-messages') {
    e.waitUntil(syncPendingMessages());
  }
});

async function syncPendingMessages() {
  // Notify all clients to flush their IndexedDB pending queue
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client) => client.postMessage({ type: 'SYNC_PENDING_MESSAGES' }));
}
