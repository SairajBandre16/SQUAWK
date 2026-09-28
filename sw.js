// Squawk's service worker. It only shows alerts as system notifications (Android can't show them any other way)
// and brings Squawk back when one is tapped. It doesn't cache anything.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', e => {
  e.notification.close(); const id = e.notification.data?.id || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(c => new URL(c.url).origin === location.origin);
    if (c) { c.postMessage({ squawk: 'select', id }); return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
