/* Links service worker: push only, no caching — the network layer already
   handles offline, and a cache here would just be a second thing to debug. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.title || 'Links ⛳', {
    body: d.body || 'A new course is open. Come play your round!',
    icon: '/favicon.png',
    badge: '/favicon.png',
    data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow(e.notification.data?.url || '/');
  }));
});
