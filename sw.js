// MedQuest AI Service Worker v1.0.4
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    clients.claim().then(() => {
      return self.registration.update();
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Basic fetch handler to satisfy PWA requirements
  event.respondWith(fetch(event.request).catch(() => fetch(event.request)));
});

self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : { title: 'MedQuest AI', body: 'New Alert' };
  const options = {
    body: data.body,
    icon: 'https://cdn-icons-png.flaticon.com/512/3070/3070044.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/3070/3070044.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1'
    }
  };
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    // Ensure we have a valid options object
    const notificationOptions = {
      ...options,
      data: {
        dateOfArrival: Date.now(),
        ...options.data
      }
    };
    event.waitUntil(
      self.registration.showNotification(title, notificationOptions)
    );
  }
});