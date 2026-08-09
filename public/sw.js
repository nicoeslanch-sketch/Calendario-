const CACHE = 'pdr-planner-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.url.includes('/rest/v1/') || event.request.url.includes('/functions/v1/')) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    if (response.ok && new URL(event.request.url).origin === self.location.origin) caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))));
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const title = data.title || 'PDR Planner';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Tienes un pendiente próximo.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || `pdr-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: { url: data.url || '/', taskId: data.taskId },
    actions: [
      { action: 'accept', title: 'Aceptar' },
      { action: 'open', title: 'Ir al calendario' }
    ]
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'accept') return;
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => 'focus' in client);
    return existing ? existing.focus().then((client) => client.navigate(url.href)) : clients.openWindow(url.href);
  }));
});

