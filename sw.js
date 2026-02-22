// MedQuest AI Service Worker v1.0.2
self.addEventListener('install', (event) => {
  // Forces the waiting service worker to become the active service worker.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Ensure the service worker is ready to show notifications
      self.registration.update()
    ])
  );
});

self.addEventListener('fetch', (event) => {
  // Basic fetch handler to satisfy PWA requirements
  event.respondWith(fetch(event.request).catch(() => fetch(event.request)));
});

self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : { title: 'MedQuest AI', body: 'New Alert' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'https://cdn-icons-png.flaticon.com/512/3070/3070044.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/3070/3070044.png'
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) {
            client = clientList[i];
          }
        }
        return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});

// Handle direct messages from the app to show notifications
// This is often more reliable on iOS/Safari
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  }
});