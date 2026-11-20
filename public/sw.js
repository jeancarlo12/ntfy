// Shell cacheado para que la app abra aunque el túnel esté apagado.
// Los avisos llegan desde Apple al service worker y se guardan localmente (store.js)
// para que se vean dentro de la app incluso con el túnel cerrado.
importScripts('/store.js');

const CACHE = 'avisos-v5';
const SHELL = ['/', '/index.html', '/app.js', '/store.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];

async function savePushLocally(data) {
  try {
    await AvisosStore.put({
      id: Number(data.id) || Date.now(),
      title: data.title,
      body: data.body,
      time: Number(data.time) || Math.floor(Date.now() / 1000),
    });
    await AvisosStore.prune();
  } catch (_) {}
}

async function notifyClients() {
  try {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) client.postMessage({ type: 'push' });
  } catch (_) {}
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    AvisosStore.migrateLegacy()
      .catch(() => {})
      .then(() => caches.keys())
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== AvisosStore.CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match('/')))
  );
});

self.addEventListener('push', event => {
  let data = { title: 'Aviso', body: '' };
  try {
    if (event.data) data = event.data.json();
  } catch (_) {
    data = { title: 'Aviso', body: event.data ? event.data.text() : '' };
  }
  const options = { body: data.body || '', icon: '/icon-192.png' };
  if (data.tag) options.tag = data.tag;
  // iOS exige mostrar siempre una notificación por cada push.
  event.waitUntil(
    Promise.all([
      savePushLocally(data).then(notifyClients),
      self.registration.showNotification(data.title || 'Aviso', options),
    ])
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          client.postMessage({ type: 'push' });
          return client.focus();
        }
      }
      return self.clients.openWindow('/');
    })
  );
});
