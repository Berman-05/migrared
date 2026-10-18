// Service Worker de MIGRARED.
//  - App shell: se guarda al instalar y se sirve desde caché (funciona sin conexión).
//  - Catálogo (data/servicios.json): red primero, caché como respaldo.
//  - Mosaicos del mapa: caché primero; se guardan las zonas que la persona ya vio con conexión
//    (con un límite para no llenar la memoria del teléfono).

const VERSION = 'v4';
const CACHE_APP = `migrared-app-${VERSION}`;
const CACHE_DATOS = 'migrared-datos';
// v2: la versión anterior guardó por error respuestas 403 de OpenStreetMap.
const CACHE_MAPA = 'migrared-mapa-v2';
const MAX_MOSAICOS = 1500; // ~15–25 MB aprox.

const APP_SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/sync.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-shadow.png',
  'vendor/leaflet/images/layers.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await (await caches.open(CACHE_APP)).addAll(APP_SHELL);
      // El catálogo inicial también se guarda, para que la app sea útil desde el primer momento.
      await (await caches.open(CACHE_DATOS)).add('data/servicios.json');
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const clave of await caches.keys()) {
        const appVieja = clave.startsWith('migrared-app-') && clave !== CACHE_APP;
        const mapaViejo = clave.startsWith('migrared-mapa') && clave !== CACHE_MAPA;
        if (appVieja || mapaViejo) await caches.delete(clave);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(mosaico(req));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/data/servicios.json')) {
    event.respondWith(catalogo(req));
    return;
  }

  event.respondWith(appShell(req));
});

async function appShell(req) {
  const cache = await caches.open(CACHE_APP);
  const enCache = await cache.match(req, { ignoreSearch: true });
  if (enCache) return enCache;
  try {
    return await fetch(req);
  } catch {
    // Navegación sin conexión a una ruta no guardada: se devuelve la app.
    if (req.mode === 'navigate') return cache.match('index.html');
    throw new Error('Sin conexión');
  }
}

async function catalogo(req) {
  const cache = await caches.open(CACHE_DATOS);
  // Las peticiones de sincronización deben saber si realmente hay red; no se les responde desde caché.
  const esSync = req.headers.get('X-Migrared-Sync') === '1';
  try {
    const resp = await fetch(req, { cache: 'no-store' });
    if (resp.ok) await cache.put('data/servicios.json', resp.clone());
    return resp;
  } catch (err) {
    if (esSync) throw err;
    const enCache = await cache.match('data/servicios.json');
    if (enCache) return enCache;
    throw err;
  }
}

async function mosaico(req) {
  const cache = await caches.open(CACHE_MAPA);
  const enCache = await cache.match(req);
  if (enCache) return enCache;
  const resp = await fetch(req);
  // Solo se guardan mosaicos válidos; un error (403, 429…) no debe quedar fijo sin conexión.
  if (resp.ok) {
    await cache.put(req, resp.clone());
    recortar(cache);
  }
  return resp;
}

let recortando = false;
async function recortar(cache) {
  if (recortando) return;
  recortando = true;
  try {
    const claves = await cache.keys();
    // Se eliminan los mosaicos más antiguos (orden de inserción).
    for (let i = 0; i < claves.length - MAX_MOSAICOS; i++) await cache.delete(claves[i]);
  } finally {
    recortando = false;
  }
}
