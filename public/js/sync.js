// Sincronización del catálogo: cada vez que hay conexión se descarga el catálogo y, si la
// versión cambió, se reemplaza el contenido de IndexedDB. Sin conexión, la app sigue
// funcionando con lo último que se guardó.
//
// La petición no lleva cookies, identificadores ni ubicación: el servidor no puede saber quién
// consulta ni desde dónde.

import { reemplazarServicios, leerMeta, guardarMeta } from './db.js';

export const URL_CATALOGO = 'data/servicios.json';
const CAMPOS_OBLIGATORIOS = ['id', 'nombre', 'categoria', 'lat', 'lng'];

function validar(catalogo) {
  if (!catalogo || typeof catalogo.version !== 'string' || !Array.isArray(catalogo.servicios)) {
    throw new Error('Formato de catálogo inválido');
  }
  // Se descartan registros incompletos o con coordenadas fuera de rango en lugar de fallar todo.
  return catalogo.servicios.filter(
    (s) =>
      CAMPOS_OBLIGATORIOS.every((c) => s[c] !== undefined && s[c] !== '') &&
      Math.abs(s.lat) <= 90 &&
      Math.abs(s.lng) <= 180
  );
}

/**
 * Descarga el catálogo y lo guarda si es más reciente.
 * @returns {Promise<{actualizado: boolean, version: string}>}
 */
export async function sincronizar() {
  const resp = await fetch(URL_CATALOGO, {
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { 'X-Migrared-Sync': '1' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const catalogo = await resp.json();
  const servicios = validar(catalogo);

  const versionLocal = await leerMeta('version');
  const ahora = new Date().toISOString();
  await guardarMeta('ultimaSync', ahora);

  if (versionLocal === catalogo.version) return { actualizado: false, version: versionLocal };

  await reemplazarServicios(servicios);
  await guardarMeta('version', catalogo.version);
  await guardarMeta('aviso', catalogo.aviso || '');
  return { actualizado: true, version: catalogo.version };
}
