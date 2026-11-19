const btn = document.getElementById('enable');
const testBtn = document.getElementById('test');
const statusEl = document.getElementById('status');
const list = document.getElementById('list');

function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function loadList() {
  const items = await (await fetch('/api/notifications')).json();
  list.innerHTML = '';
  for (const n of items) {
    const li = document.createElement('li');
    for (const [cls, text] of [
      ['title', n.title],
      ['body', n.body],
      ['time', new Date(n.time * 1000).toLocaleString()],
    ]) {
      const div = document.createElement('div');
      div.className = cls;
      div.textContent = text;
      li.appendChild(div);
    }
    list.appendChild(li);
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
    await fetch('/api/subscribe', {
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
  statusEl.textContent = 'Enviando prueba en 5s...';
  await fetch('/api/test', { method: 'POST' });
  setTimeout(loadList, 5500);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(async () => {
    if ('PushManager' in window && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker.ready;
      if (await reg.pushManager.getSubscription()) btn.hidden = true;
    }
  });
}
btn.addEventListener('click', enable);
testBtn.addEventListener('click', sendTest);
loadList();
setInterval(loadList, 10000);
