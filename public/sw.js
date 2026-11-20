// Shell cacheado para que la app abra aunque el túnel esté apagado.
// Los avisos llegan desde Apple al service worker (incluso con la app cerrada)
// y se guardan localmente para mostrarse al abrir la app.
const CACHE = 'avisos-v5';
const DATA_CACHE = 'avisos-data-v1';
const DATA_KEY = '/__local_data__';
const SHELL = ['/', '/index.html', '/app.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];

async function readLocalData() {
  try {
    const c = await caches.open(DATA_CACHE);
    const res = await c.match(DATA_KEY);
    if (res) return await res.json();
  } catch (_) {}
  return { items: [], deleted: [] };
}

async function savePushLocally(data) {
  try {
    const store = await readLocalData();
    const id = Number(data.id) || Date.now();
    const time = Number(data.time) || Math.floor(Date.now() / 1000);
    if (store.deleted.includes(id)) return;
    const item = { id, title: data.title || 'Aviso', body: data.body || '', time };
    store.items = [item, ...store.items.filter(x => (x.id || x.time) !== id)].slice(0, 100);
    const c = await caches.open(DATA_CACHE);
    await c.put(DATA_KEY, new Response(JSON.stringify(store), {
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch (_) {}
}

async function notifyClients(type = 'push') {
  try {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) client.postMessage({ type });
  } catch (_) {}
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== DATA_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => notifyClients('updated'))
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
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
  // iOS exige mostrar siempre una notificación inmediatamente en cada evento push
  // para entregar avisos cuando la app está cerrada o el teléfono bloqueado.
  const showPromise = self.registration.showNotification(data.title || 'Aviso', options);
  const savePromise = savePushLocally(data).then(() => notifyClients('push'));
  event.waitUntil(Promise.all([showPromise, savePromise]));
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
