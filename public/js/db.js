// Base de datos local (IndexedDB). Guarda el catálogo de servicios y algunos metadatos
// (versión del catálogo, fecha de la última sincronización y favoritos).
// Nunca se guardan datos personales del usuario.

const DB_NAME = 'migrared';
const DB_VERSION = 1;

let dbPromise;

function abrir() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('servicios')) {
          const s = db.createObjectStore('servicios', { keyPath: 'id' });
          s.createIndex('categoria', 'categoria');
          s.createIndex('departamento', 'departamento');
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, modo, fn) {
  return abrir().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, modo);
        const resultado = fn(t.objectStore(store));
        t.oncomplete = () => resolve(resultado && 'result' in resultado ? resultado.result : resultado);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export function obtenerServicios() {
  return tx('servicios', 'readonly', (s) => s.getAll());
}

/** Reemplaza todo el catálogo en una sola transacción (atómica: o se aplica completo o no se aplica). */
export function reemplazarServicios(servicios) {
  return tx('servicios', 'readwrite', (s) => {
    s.clear();
    for (const servicio of servicios) s.put(servicio);
  });
}

export function leerMeta(clave) {
  return tx('meta', 'readonly', (s) => s.get(clave));
}

export function guardarMeta(clave, valor) {
  return tx('meta', 'readwrite', (s) => s.put(valor, clave));
}

export async function borrarTodo() {
  const db = await abrir();
  db.close();
  dbPromise = null;
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
    req.onblocked = resolve;
  });
}
