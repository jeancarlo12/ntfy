const $ = id => document.getElementById(id);
const btn = $('enable');
const testBtn = $('test');
const statusEl = $('status');
const list = $('list');
const TOKEN_KEY = 'avisos_token';
const DATA_CACHE = 'avisos-data-v1';
const DATA_KEY = '/__local_data__';

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
  const res = await fetch(path, Object.assign({}, opts, { headers }));
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
}

function showMain() {
  $('pair').hidden = true;
  $('main').hidden = false;
}

function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function deleteNotification(n, li) {
  const id = itemId(n);
  if (li && li.parentNode) li.remove();
  const store = await readLocalData();
  if (!store.deleted.includes(id)) store.deleted.push(id);
  store.deleted = store.deleted.slice(-200);
  store.items = store.items.filter(x => itemId(x) !== id);
  await writeLocalData(store);
  api('/api/notifications/' + id, { method: 'DELETE' }).catch(() => {});
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
      // Si se mueve verticalmente primero o hacia la izquierda, es scroll normal: cancelar swipe
      if (Math.abs(deltaY) > 8 || deltaX < -8) {
        lockedHorizontal = false;
        tracking = false;
        return;
      }
      // Exigir un desplazamiento claro hacia la derecha y ángulo horizontal (< ~22°)
      if (deltaX < 16 || deltaX < Math.abs(deltaY) * 2.5) return;
      lockedHorizontal = true;
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

function renderList(items) {
  list.innerHTML = '';
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
    list.appendChild(li);
  }
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
    // Túnel apagado: mostramos los avisos guardados localmente por el Service Worker.
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
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
  }
}

async function sendTest() {
  try {
    statusEl.textContent = 'Enviando prueba en 5s...';
    await api('/api/test', { method: 'POST' });
    setTimeout(loadList, 5500);
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(async () => {
    if ('PushManager' in window && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker.ready;
      if (await reg.pushManager.getSubscription()) btn.hidden = true;
    }
  });
  navigator.serviceWorker.addEventListener('message', () => loadList());
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadList();
});
$('pairBtn').addEventListener('click', pair);
btn.addEventListener('click', enable);
testBtn.addEventListener('click', sendTest);
if (getToken()) { showMain(); loadList(); } else { showPairing(); }
setInterval(loadList, 10000);
