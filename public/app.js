const $ = id => document.getElementById(id);
const btn = $('enable');
const testBtn = $('test');
const clearBtn = $('clearAll');
const statusEl = $('status');
const list = $('list');
const emptyEl = $('empty');
const footerEl = $('footer');
const ptrEl = $('ptr');
const ptrText = $('ptrText');
const TOKEN_KEY = 'avisos_token';
const DATA_CACHE = 'avisos-data-v1';
const DATA_KEY = '/__local_data__';

let lastRenderedSig = null;
let isSwipingCard = false;

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch (_) { return null; }
}
function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (_) {}
}

async function readLocalData() {
  try {
    if ('caches' in window) {
      const c = await caches.open(DATA_CACHE);
      const res = await c.match(DATA_KEY);
      if (res) return await res.json();
    }
  } catch (_) {}
  return { items: [], deleted: [] };
}

async function writeLocalData(store) {
  try {
    if ('caches' in window) {
      const c = await caches.open(DATA_CACHE);
      await c.put(DATA_KEY, new Response(JSON.stringify(store), {
        headers: { 'Content-Type': 'application/json' },
      }));
    }
  } catch (_) {}
}

function itemId(n) {
  return Number(n.id) || Number(n.time) || 0;
}

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  const t = getToken();
  if (t) headers.Authorization = 'Bearer ' + t;
  const res = await fetch(path, Object.assign({ cache: 'no-store' }, opts, { headers }));
  if (res.status === 401) {
    setToken(null);
    showPairing();
    throw new Error('Esta app ya no está vinculada. Pide un código nuevo en el Mac.');
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res;
}

function showPairing() {
  $('pair').hidden = false;
  $('main').hidden = true;
  footerEl.hidden = true;
  emptyEl.hidden = true;
}

function showMain() {
  $('pair').hidden = true;
  $('main').hidden = false;
  footerEl.hidden = false;
}

function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function updateEmptyAndFooter(count) {
  if (!$('main').hidden) {
    emptyEl.hidden = count > 0;
    clearBtn.disabled = count === 0;
  }
}

async function deleteNotification(n, li) {
  const id = itemId(n);
  if (li && li.parentNode) li.remove();
  const store = await readLocalData();
  if (!store.deleted.includes(id)) store.deleted.push(id);
  store.deleted = store.deleted.slice(-300);
  store.items = store.items.filter(x => itemId(x) !== id);
  await writeLocalData(store);
  lastRenderedSig = JSON.stringify(store.items.map(x => [itemId(x), x.title, x.body, x.time]));
  updateEmptyAndFooter(store.items.length);
  api('/api/notifications/' + id, { method: 'DELETE' }).catch(() => {});
}

async function clearAllNotifications() {
  const store = await readLocalData();
  for (const n of store.items) {
    const id = itemId(n);
    if (!store.deleted.includes(id)) store.deleted.push(id);
  }
  store.deleted = store.deleted.slice(-300);
  store.items = [];
  await writeLocalData(store);
  renderList([], true);
  api('/api/notifications', { method: 'DELETE' }).catch(() => {});
}

function attachSwipeToDelete(li, card, n) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let tracking = false;
  let lockedHorizontal = null;
  let hideTimer = null;

  function resetVisual() {
    card.classList.remove('dragging');
    card.style.transform = '';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => li.classList.remove('swiping'), 180);
  }

  function onStart(x, y) {
    clearTimeout(hideTimer);
    startX = x;
    startY = y;
    dx = 0;
    tracking = true;
    lockedHorizontal = null;
  }

  function onMove(x, y, ev) {
    if (!tracking) return;
    const deltaX = x - startX;
    const deltaY = y - startY;
    if (lockedHorizontal === null) {
      if (Math.abs(deltaY) > 8 || deltaX < -8) {
        lockedHorizontal = false;
        tracking = false;
        return;
      }
      if (deltaX < 16 || deltaX < Math.abs(deltaY) * 2.5) return;
      lockedHorizontal = true;
      isSwipingCard = true;
      card.classList.add('dragging');
    }
    if (!lockedHorizontal) return;
    if (ev && ev.cancelable) ev.preventDefault();
    dx = Math.max(0, deltaX - 16);
    if (dx > 2) {
      li.classList.add('swiping');
    } else {
      li.classList.remove('swiping');
    }
    card.style.transform = dx > 0 ? `translateX(${dx}px)` : '';
  }

  function onEnd() {
    if (!tracking) return;
    tracking = false;
    isSwipingCard = false;
    if (!lockedHorizontal) return;
    card.classList.remove('dragging');
    const threshold = Math.min(95, (li.offsetWidth || 280) * 0.35);
    if (dx >= threshold) {
      li.classList.add('swiping');
      card.style.transform = 'translateX(105%)';
      card.style.opacity = '0';
      setTimeout(() => deleteNotification(n, li), 170);
    } else {
      resetVisual();
    }
  }

  card.addEventListener('touchstart', e => {
    if (e.touches.length === 1) onStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  card.addEventListener('touchmove', e => {
    if (e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY, e);
  }, { passive: false });
  card.addEventListener('touchend', onEnd);
  card.addEventListener('touchcancel', onEnd);

  card.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    onStart(e.clientX, e.clientY);
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    onMove(e.clientX, e.clientY, e);
  });
  card.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch') return;
    onEnd();
  });
}

function renderList(items, force = false) {
  if (isSwipingCard && !force) return;
  const sig = JSON.stringify(items.map(n => [itemId(n), n.title, n.body, n.time]));
  updateEmptyAndFooter(items.length);
  if (!force && sig === lastRenderedSig) return;
  lastRenderedSig = sig;

  const frag = document.createDocumentFragment();
  for (const n of items) {
    const li = document.createElement('li');
    const bg = document.createElement('div');
    bg.className = 'delete-bg';
    bg.textContent = 'Borrar';
    li.appendChild(bg);

    const card = document.createElement('div');
    card.className = 'card';
    for (const [cls, text] of [
      ['title', n.title],
      ['body', n.body],
      ['time', new Date(n.time * 1000).toLocaleString()],
    ]) {
      const div = document.createElement('div');
      div.className = cls;
      div.textContent = text;
      card.appendChild(div);
    }
    li.appendChild(card);
    attachSwipeToDelete(li, card, n);
    frag.appendChild(li);
  }
  list.replaceChildren(frag);
}

async function loadList() {
  if (!getToken()) return;
  const store = await readLocalData();
  renderList(store.items);

  try {
    const remote = await (await api('/api/notifications')).json();
    const byId = new Map();
    for (const n of [...remote, ...store.items]) {
      const id = itemId(n);
      if (store.deleted.includes(id)) continue;
      if (!byId.has(id)) byId.set(id, Object.assign({ id }, n));
    }
    store.items = Array.from(byId.values())
      .sort((a, b) => (b.time - a.time) || (itemId(b) - itemId(a)))
      .slice(0, 100);
    await writeLocalData(store);
    renderList(store.items);
  } catch (_) {
    // Túnel apagado: se mantienen los avisos guardados localmente por el Service Worker sin parpadear.
  }
}

async function refreshApp() {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update().catch(() => {});
    }
  } catch (_) {}
  await loadList();
}

function setupPullToRefresh() {
  let startY = 0;
  let startX = 0;
  let pull = 0;
  let active = false;
  let refreshing = false;

  window.addEventListener('touchstart', e => {
    if (refreshing || window.scrollY > 0 || e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    pull = 0;
    active = true;
  }, { passive: true });

  window.addEventListener('touchmove', e => {
    if (!active || refreshing) return;
    if (window.scrollY > 0 || isSwipingCard) {
      active = false;
      ptrEl.classList.remove('pulling');
      ptrEl.style.height = '0px';
      return;
    }
    const dy = e.touches[0].clientY - startY;
    const dx = Math.abs(e.touches[0].clientX - startX);
    if (dy <= 0 || dx > dy) {
      if (pull > 0) {
        pull = 0;
        ptrEl.style.height = '0px';
      }
      return;
    }
    pull = Math.min(72, Math.max(0, (dy - 12) * 0.5));
    if (pull > 0) {
      ptrEl.classList.add('pulling');
      ptrEl.style.height = `${pull}px`;
      ptrText.textContent = pull >= 48 ? 'Suelta para actualizar' : 'Desliza para actualizar';
    }
  }, { passive: true });

  async function finishPull() {
    if (!active) return;
    active = false;
    ptrEl.classList.remove('pulling');
    if (pull >= 48 && !refreshing) {
      refreshing = true;
      ptrEl.style.height = '40px';
      ptrText.textContent = 'Actualizando…';
      await refreshApp();
      setTimeout(() => {
        ptrEl.style.height = '0px';
        refreshing = false;
      }, 250);
    } else {
      ptrEl.style.height = '0px';
    }
    pull = 0;
  }

  window.addEventListener('touchend', finishPull);
  window.addEventListener('touchcancel', finishPull);
}

async function checkSubscriptionState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    btn.hidden = false;
    return;
  }
  try {
    if (Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      btn.hidden = Boolean(sub);
    } else {
      btn.hidden = false;
    }
  } catch (_) {
    btn.hidden = false;
  }
}

async function pair() {
  const code = $('code').value.trim();
  if (!/^\d{8}$/.test(code)) { statusEl.textContent = 'El código tiene 8 dígitos.'; return; }
  try {
    const res = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) { statusEl.textContent = 'Código incorrecto o vencido. Pide otro en el Mac.'; return; }
    setToken((await res.json()).token);
    showMain();
    await checkSubscriptionState();
    statusEl.textContent = 'Vinculado ✓ Ahora activa las notificaciones.';
    loadList();
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
  }
}

async function enable() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      statusEl.textContent = 'Instala la app en la pantalla de inicio (Compartir → Añadir) y ábrela desde ahí.';
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { statusEl.textContent = 'Permiso denegado.'; return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const key = (await (await fetch('/api/vapid-public-key')).text()).trim();
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToBytes(key),
      });
    }
    await api('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    btn.hidden = true;
    statusEl.textContent = 'Notificaciones activadas ✓';
    setTimeout(() => { if (statusEl.textContent === 'Notificaciones activadas ✓') statusEl.textContent = ''; }, 3000);
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
  }
}

async function sendTest() {
  try {
    statusEl.textContent = 'Enviando prueba en 5s...';
    await api('/api/test', { method: 'POST' });
    setTimeout(() => {
      if (statusEl.textContent === 'Enviando prueba en 5s...') statusEl.textContent = '';
      loadList();
    }, 5500);
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => {
    checkSubscriptionState();
  });
  navigator.serviceWorker.addEventListener('message', () => loadList());
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshApp();
});
window.addEventListener('pageshow', () => refreshApp());
window.addEventListener('focus', () => loadList());
setupPullToRefresh();
$('pairBtn').addEventListener('click', pair);
btn.addEventListener('click', enable);
testBtn.addEventListener('click', sendTest);
clearBtn.addEventListener('click', clearAllNotifications);
if (getToken()) { showMain(); loadList(); } else { showPairing(); }
setInterval(loadList, 10000);
