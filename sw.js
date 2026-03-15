/*
  JG. SUFFU — Service Worker
  Handles: Push Notifications + Offline Cache (app shell)
*/

const CACHE_NAME = 'jgsuffu-v2';
const SHELL_ASSETS = [
  './',
  './index.html',
  './app.js',
  './main.css',
  './manifest.json',
  './logo.png'
];

// --- Install: cache app shell ---
self.addEventListener('install', function(event) {
  self.skipWaiting(); // activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(SHELL_ASSETS);
    })
  );
});

// --- Activate: clean up old caches ---
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// --- Fetch: serve from cache, fall back to network ---
self.addEventListener('fetch', function(event) {
  // Only cache GET requests for same-origin assets
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.registration.scope)) return;
  // Don't intercept Firebase API requests
  if (event.request.url.includes('firestore.googleapis.com') ||
      event.request.url.includes('firebase') ||
      event.request.url.includes('gstatic.com') ||
      event.request.url.includes('googleapis.com')) return;

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      return cached || fetch(event.request);
    })
  );
});

// --- Push Notifications ---
self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: 'logo.png',
      badge: 'logo.png',
      vibrate: [100, 50, 100],
      data: { url: self.registration.scope }
    };
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// --- Notification Click: focus or open the app ---
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(function(windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === event.notification.data.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});
