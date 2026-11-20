/* ── FCM Background Messaging ── */
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCv2XLxjpR5S5nfa0tlkwYqoPaXzbtULXI",
  authDomain: "march-madness-snake-draft.firebaseapp.com",
  projectId: "march-madness-snake-draft",
  storageBucket: "march-madness-snake-draft.firebasestorage.app",
  messagingSenderId: "564071043666",
  appId: "1:564071043666:web:e4ace7ca3e9966cdebc58b"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || 'Madness Draft';
  const body = data.body || '';
  const options = {
    body,
    icon: '/madness/icons/icon-192.png',
    badge: '/madness/icons/icon-192.png',
    tag: data.tag || 'default',
    data: { url: data.url || './' }
  };
  if (data.badgeCount && 'setAppBadge' in self.navigator) {
    self.navigator.setAppBadge(parseInt(data.badgeCount)).catch(() => {});
  }
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/madness/') && 'focus' in client) {
          return client.focus().then(c => (c && 'navigate' in c && c.url !== new URL(url, self.registration.scope).href) ? c.navigate(url) : c);
        }
      }
      return clients.openWindow(url);
    })
  );
});

/* ── Service Worker Cache ── */
const CACHE_NAME = 'mm-draft-v9';
const PRECACHE_URLS = [
  './',
  './index.html',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only the app's own files and the Firebase SDK scripts are cached. Everything else goes straight to the
  // network untouched: Firestore, and the score relay (Cloud Functions), whose answers change every minute.
  // Cache-first on the relay kept the first answer for a URL forever (frozen scores, a bracket import stuck on
  // "not available yet").
  if (event.request.method !== 'GET' ||
      !(url.origin === self.location.origin || url.hostname === 'www.gstatic.com')) {
    return;
  }

  // Network-first for navigation requests (HTML pages)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            // Only the app page itself is the offline shell: privacy.html and support.html are navigations in this scope too.
            const isShell = url.pathname === new URL('./', self.registration.scope).pathname || url.pathname.endsWith('/index.html');
            if (isShell) caches.open(CACHE_NAME).then(c => c.put('./index.html', clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for everything else (CDN scripts, icons, images)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => Response.error())
  );
});
