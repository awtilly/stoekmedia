/* ── FCM Background Messaging ── */
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDEPiHPEURzn_gtiTaR-rbCGg06JYUSlQY",
  authDomain: "greendoor-2da47.firebaseapp.com",
  projectId: "greendoor-2da47",
  storageBucket: "greendoor-2da47.firebasestorage.app",
  messagingSenderId: "975315709404",
  appId: "1:975315709404:web:c03a1663f999eb49783319"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || 'GreenDoor CRM';
  const body  = data.body  || '';
  const options = {
    body,
    icon: '/greendoor/app/icons/icon-192.png',
    badge: '/greendoor/app/icons/icon-192.png',
    tag: data.tag || 'default',
    data: { url: data.url || '/greendoor/app/dashboard' }
  };
  if (data.badgeCount) {
    self.navigator.setAppBadge(parseInt(data.badgeCount)).catch(() => {});
  }
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/greendoor/app/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/greendoor/app/') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

/* ── Service Worker Cache ── */
const CACHE_NAME = 'greendoor-v3';
const PRECACHE_URLS = [
  '/greendoor/app/dashboard',
  '/greendoor/app/login',
  '/greendoor/app/clients',
  '/greendoor/app/calendar',
  '/greendoor/app/settings',
  '/greendoor/app/listings',
  '/greendoor/css/greendoor.css',
  '/assets/css/style.css',
  '/greendoor/app/icons/icon-192.png',
  '/greendoor/app/icons/icon-512.png',
  '/greendoor/app/icons/apple-touch-icon.png',
  '/greendoor/app/manifest.json'
];

const OFFLINE_PAGE = '/greendoor/app/login';

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

  // Pass through Firebase / Firestore API calls
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com') ||
      (url.hostname.includes('firebase') && url.pathname.includes('/documents/'))) {
    return;
  }

  // Network-first for navigation (HTML pages)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(c => c || caches.match('/greendoor/app/login')))
    );
    return;
  }

  // Network-first for JS and CSS so deploys take effect immediately
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for static assets (CSS, images, fonts)
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
    }).catch(() => caches.match('/greendoor/app/login'))
  );
});
