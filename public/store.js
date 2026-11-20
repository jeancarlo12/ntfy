// Almacén local de avisos, compartido por la página (app.js) y el service worker (sw.js).
// Una entrada de Cache Storage por aviso y otra por borrado: así dos avisos que llegan a la vez,
// o un aviso que llega mientras borras otro, no se pisan (antes todo vivía en un único JSON).
self.AvisosStore = (() => {
  const CACHE = 'avisos-data-v2';
  const ITEM = '/__local__/item/';
  const DELETED = '/__local__/deleted/';
  const MAX_ITEMS = 100;
  const MAX_DELETED = 500;
  const LEGACY_CACHE = 'avisos-data-v1';
  const LEGACY_KEY = '/__local_data__';

  const idOf = n => Number(n && n.id) || Number(n && n.time) || 0;
  const open = () => caches.open(CACHE);
  const asJson = obj => new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } });
  const pathOf = req => new URL(req.url).pathname;

  async function keysUnder(c, prefix) {
    return (await c.keys()).filter(r => pathOf(r).startsWith(prefix));
  }

  async function deletedIds(c = null) {
    c = c || (await open());
    return new Set((await keysUnder(c, DELETED)).map(r => Number(pathOf(r).slice(DELETED.length))));
  }

  // Avisos guardados, más reciente primero, sin los borrados.
  async function list() {
    const c = await open();
    const [reqs, deleted] = await Promise.all([keysUnder(c, ITEM), deletedIds(c)]);
    const items = await Promise.all(
      reqs.map(r => c.match(r).then(res => (res ? res.json() : null)).catch(() => null))
    );
    return items
      .filter(n => n && !deleted.has(idOf(n)))
      .sort((a, b) => (b.time - a.time) || (idOf(b) - idOf(a)));
  }

  // Guarda un aviso. Devuelve false si no tiene id o el usuario ya lo borró.
  async function put(n) {
    const id = idOf(n);
    if (!id) return false;
    const c = await open();
    if (await c.match(DELETED + id)) return false;
    const time = Number(n.time) || Math.floor(Date.now() / 1000);
    await c.put(ITEM + id, asJson({ id, title: n.title || 'Aviso', body: n.body || '', time }));
    return true;
  }

  // Marca como borrado (para que no vuelva desde el servidor) y quita la copia local.
  async function remove(id) {
    const c = await open();
    await c.put(DELETED + id, asJson({ id, at: Date.now() }));
    await c.delete(ITEM + id);
  }

  async function prune() {
    const c = await open();
    const items = await list();
    await Promise.all(items.slice(MAX_ITEMS).map(n => c.delete(ITEM + idOf(n))));
    const dels = await keysUnder(c, DELETED);
    if (dels.length > MAX_DELETED) {
      const oldest = dels
        .map(r => ({ r, id: Number(pathOf(r).slice(DELETED.length)) }))
        .sort((a, b) => a.id - b.id)
        .slice(0, dels.length - MAX_DELETED);
      await Promise.all(oldest.map(x => c.delete(x.r)));
    }
  }

  // Importa el formato anterior (un único JSON en avisos-data-v1) y lo elimina.
  async function migrateLegacy() {
    if (!(await caches.has(LEGACY_CACHE))) return;
    try {
      const res = await (await caches.open(LEGACY_CACHE)).match(LEGACY_KEY);
      if (res) {
        const old = await res.json();
        for (const id of old.deleted || []) await remove(Number(id));
        for (const n of old.items || []) await put(n);
      }
    } catch (_) {}
    await caches.delete(LEGACY_CACHE);
  }

  return { CACHE, idOf, list, put, remove, prune, deletedIds, migrateLegacy };
})();
