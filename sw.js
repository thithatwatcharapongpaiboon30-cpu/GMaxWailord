self.addEventListener('push', function(event) {
  const options = {
    body: event.data.text(),
    icon: 'https://cdn-icons-png.flaticon.com/512/3070/3070044.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/3070/3070044.png',
    vibrate: [100, 50, 100]
  };
  event.waitUntil(
    self.registration.showNotification('MedQuest AI', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});