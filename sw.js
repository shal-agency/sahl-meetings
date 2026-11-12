// [سهل] مواعيد السيلز — Service Worker: بيستقبل الإشعارات حتى لو الموقع مقفول
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const BASE = self.registration.scope; // مثلاً https://sahal-2.github.io/sahl-meetings/

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (_) { d = { title: 'تذكير اجتماع', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'تذكير اجتماع', {
    body: d.body || '',
    icon: BASE + 'icons/icon-192.png',
    badge: BASE + 'icons/badge-72.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 300],
    dir: 'rtl',
    lang: 'ar',
    data: { url: BASE + (d.url || '') }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || BASE;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(BASE)) {
        try { await c.navigate(url); } catch (_) {}
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
