// Genera public/data/mapa-base.json: un mapa base ligero de Guatemala que viene dentro de la app,
// para que el mapa nunca se vea vacío sin conexión (aunque la persona no haya visto esa zona antes).
//
// Fuentes (descargarlas en una carpeta y pasarla como argumento):
//  - Departamentos: geoBoundaries GTM ADM1 simplificado (datos de OpenStreetMap, ODbL)
//    https://www.geoboundaries.org/api/current/gbOpen/GTM/ADM1/  → campo simplifiedGeometryGeoJSON
//    guardar como deptos.geojson
//  - Natural Earth v5.1.2 (dominio público) https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2/geojson
//    ne_50m_admin_0_countries.geojson, ne_10m_populated_places_simple.geojson, ne_10m_roads.geojson
//
// Uso: node scripts/mapa-base.js <carpeta-con-los-geojson>
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) {
  console.error('Uso: node scripts/mapa-base.js <carpeta-con-los-geojson>');
  process.exit(1);
}
const leer = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

// Región visible: Guatemala y alrededores.
const BBOX = { oeste: -93.5, sur: 12.8, este: -87.3, norte: 18.8 };
const dentro = ([lng, lat]) => lng >= BBOX.oeste && lng <= BBOX.este && lat >= BBOX.sur && lat <= BBOX.norte;

// --- Simplificación Douglas-Peucker y redondeo de coordenadas -------------------------------
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function dp(puntos, tol) {
  if (puntos.length < 3) return puntos;
  let max = 0, idx = 0;
  for (let i = 1; i < puntos.length - 1; i++) {
    const d = distSeg(puntos[i], puntos[0], puntos[puntos.length - 1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [puntos[0], puntos[puntos.length - 1]];
  return dp(puntos.slice(0, idx + 1), tol).slice(0, -1).concat(dp(puntos.slice(idx), tol));
}
const redondear = (p) => [Math.round(p[0] * 1e3) / 1e3, Math.round(p[1] * 1e3) / 1e3];
function linea(puntos, tol, minPuntos) {
  const r = dp(puntos, tol).map(redondear);
  return r.length >= minPuntos ? r : null;
}

/** Convierte Polygon/MultiPolygon en una lista de anillos simplificados. */
function anillos(geom, tol) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  const out = [];
  for (const poly of polys) {
    for (const anillo of poly) {
      if (!anillo.some(dentro)) continue;
      const a = linea(anillo, tol, 4);
      if (a) out.push(a);
    }
  }
  return out;
}

// --- Departamentos ---------------------------------------------------------------------------
const deptos = leer('deptos.geojson').features.map((f) => ({
  nombre: f.properties.shapeName,
  anillos: anillos(f.geometry, 0.003),
}));

// --- Países vecinos (solo contorno, para dar contexto) ----------------------------------------
const VECINOS = ['MEX', 'BLZ', 'HND', 'SLV'];
const vecinos = leer('ne_50m_admin_0_countries.geojson')
  .features.filter((f) => VECINOS.includes(f.properties.ADM0_A3))
  .map((f) => ({ nombre: f.properties.NAME_ES || f.properties.NAME, anillos: anillos(f.geometry, 0.01) }));

// --- Carreteras principales ------------------------------------------------------------------
const carreteras = [];
for (const f of leer('ne_10m_roads.geojson').features) {
  const p = f.properties;
  if (!['Major Highway', 'Secondary Highway'].includes(p.type)) continue;
  const g = f.geometry;
  const lineas = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const l of lineas) {
    if (!l.some(dentro)) continue;
    const s = linea(l, 0.004, 2);
    if (s) carreteras.push({ principal: p.type === 'Major Highway', puntos: s });
  }
}

// --- Ciudades --------------------------------------------------------------------------------
// Natural Earth usa algunos nombres en inglés o sin tildes.
const RENOMBRAR = {
  'Guatemala City': 'Ciudad de Guatemala',
  'Santa Cruz Del Quiche': 'Santa Cruz del Quiché',
  'El Progreso': 'Guastatoya',
  'San Jose': 'San José',
  'San Salvador': 'San Salvador',
  'Belmopan': 'Belmopán',
};
const ciudades = leer('ne_10m_populated_places_simple.geojson')
  .features.map((f) => f.properties)
  .filter((p) => dentro([p.longitude, p.latitude]) && (p.adm0_a3 === 'GTM' || p.scalerank <= 4))
  .map((p) => ({
    nombre: RENOMBRAR[p.name] || p.name,
    lat: Math.round(p.latitude * 1e4) / 1e4,
    lng: Math.round(p.longitude * 1e4) / 1e4,
    // 1 = capitales de país, 2 = cabeceras departamentales / ciudades grandes, 3 = resto
    nivel: p.featurecla === 'Admin-0 capital' ? 1 : p.featurecla === 'Admin-1 capital' || p.scalerank <= 5 ? 2 : 3,
    guatemala: p.adm0_a3 === 'GTM',
  }));

const salida = {
  fuentes: 'Departamentos: geoBoundaries (datos © colaboradores de OpenStreetMap, ODbL). Países, carreteras y ciudades: Natural Earth (dominio público).',
  deptos,
  vecinos,
  carreteras,
  ciudades,
};
const destino = path.join(__dirname, '..', 'public', 'data', 'mapa-base.json');
fs.writeFileSync(destino, JSON.stringify(salida));
const kb = (fs.statSync(destino).size / 1024).toFixed(0);
console.log(`mapa-base.json: ${kb} KB · ${deptos.length} departamentos · ${vecinos.length} vecinos · ${carreteras.length} tramos · ${ciudades.length} ciudades`);
