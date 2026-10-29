// Amplía el catálogo con servicios reales tomados de OpenStreetMap (OSM) en toda Guatemala:
// hospitales y centros de salud públicos, PNC, bomberos, consulados, albergues y organizaciones
// de apoyo a migrantes. Solo se incluye lo útil para la población migrante (no hospitales
// privados, oficinas de impuestos, etc.).
//
// Los registros de OSM se marcan con fuente "OpenStreetMap" y estado "pendiente": son lugares
// reales mapeados por voluntarios, pero sus datos (horario, teléfono) deben verificarse.
// Los servicios escritos a mano en servicios.json (id sin prefijo "osm-") se conservan.
//
// Uso:
//   node scripts/osm-servicios.js                          → consulta la API Overpass de OSM
//   node scripts/osm-servicios.js osm.json lugares.json    → usa respuestas de Overpass ya descargadas
// Después, subir "version" en servicios.json para que los teléfonos descarguen el cambio.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const RUTA_CATALOGO = path.join(RAIZ, 'public', 'data', 'servicios.json');
const RUTA_MAPA_BASE = path.join(RAIZ, 'public', 'data', 'mapa-base.json');

const CONSULTA = `[out:json][timeout:180];
area["ISO3166-1"="GT"][admin_level=2]->.gt;
(
  nwr[amenity=hospital](area.gt);
  nwr[amenity=clinic](area.gt);
  nwr[healthcare=centre](area.gt);
  nwr[amenity=police](area.gt);
  nwr[amenity=fire_station](area.gt);
  nwr[amenity=social_facility](area.gt);
  nwr[amenity=embassy](area.gt);
  nwr[office=diplomatic](area.gt);
  nwr[office=government](area.gt);
  nwr[office=ngo](area.gt);
);
out center tags;`;

// Ciudades, pueblos y aldeas: dan nombre a la localidad de cada servicio.
const CONSULTA_LUGARES = `[out:json][timeout:120];
area["ISO3166-1"="GT"][admin_level=2]->.gt;
node[place~"^(city|town|village)$"](area.gt);
out;`;

async function overpass(consulta, archivo) {
  if (archivo) return JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'MIGRARED/1.0 (proyecto universitario)' },
    body: 'data=' + encodeURIComponent(consulta),
  });
  if (!resp.ok) throw new Error(`Overpass respondió ${resp.status}`);
  return resp.json();
}

/** Localidad más cercana: ciudad o pueblo a menos de 8 km; si no hay, la aldea más cercana (3 km). */
function crearLocalidad(lugares) {
  const puntos = lugares.elements
    .filter((e) => e.tags?.name)
    .map((e) => ({ nombre: e.tags.name, lat: e.lat, lng: e.lon, grande: e.tags.place !== 'village' }));
  return (s) => {
    let mejor = null;
    for (const p of puntos) {
      const d = distanciaM(s, p);
      if (d > (p.grande ? 8000 : 3000)) continue;
      // Se prefiere una ciudad o pueblo cercano antes que una aldea un poco más cercana.
      const puntaje = p.grande ? d / 3 : d;
      if (!mejor || puntaje < mejor.puntaje) mejor = { nombre: p.nombre, puntaje };
    }
    return mejor?.nombre || '';
  };
}

// Nombres que no dicen dónde está el servicio: se les agrega la localidad.
const NOMBRE_GENERICO = /^(centro de salud( tipo "?[ab]"?)?|puesto de salud|caimi|cap|centro de atencion permanente|hospital|estacion de bomberos( voluntarios)?|bomberos (voluntarios|boluntarios|municipales)|policia nacional civil|ministerio publico|mp|ministerio publico \(mp\)|mp \(ministerio publico\)|procuraduria de los derechos humanos|migracion|subestacion|comisaria)$/;

// --- Utilidades ------------------------------------------------------------------------------
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function distanciaM(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Departamento que contiene el punto (polígonos del mapa base). */
function crearLocalizador() {
  const { deptos } = JSON.parse(fs.readFileSync(RUTA_MAPA_BASE, 'utf8'));
  const dentro = (x, y, anillo) => {
    let c = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return (lat, lng) => deptos.find((d) => d.anillos.some((a) => dentro(lng, lat, a)))?.nombre || '';
}

function telefono(t) {
  const tel = t.phone || t['contact:phone'] || t['phone:GT'] || '';
  return tel.split(';')[0].trim();
}

function direccion(t) {
  const calle = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  return t['addr:full'] || calle || '';
}

// --- Clasificación ---------------------------------------------------------------------------
// Devuelve los campos del servicio o null si el lugar no es útil para el catálogo.
const SALUD_PUBLICA = /hospital (nacional|regional|general|departamental|distrital|de distrito)|centro de salud|puesto de salud|caimi|\bcap\b|\bcais\b|centro de atencion permanente|area de salud|maternidad cantonal|hospital infantil|hospital roosevelt|san juan de dios/;
const POLICIA = /polic|pnc|comisar|subestaci|estacion|seccion/;
const PAISES_ORIGEN = /honduras|salvador|nicaragua|mexic|venezuela|cuba|haiti|colombia|ecuador|estados unidos|united states|usa|peru|brasil|brazil|costa rica|panama|republica dominicana|dominican|india|china|bangladesh|camer|congo|angola|senegal/;

function clasificar(t) {
  const nombre = (t.name || '').trim();
  const n = norm(nombre);
  const publico = ['government', 'public'].includes(t['operator:type']);

  // Va antes que la regla de albergue: algunas auxiliaturas están etiquetadas como social_facility.
  if (/derechos humanos|\bpdh\b|auxiliatura/.test(n)) {
    return { categoria: 'proteccion', tipo: 'publica', sub: 'Denuncias por violación de derechos humanos', desc: 'Procuraduría de los Derechos Humanos: recibe denuncias sin importar su nacionalidad.', tel: '1555' };
  }

  // Refugio y apoyo a personas migrantes
  if (/casa del migrante|scalabrin|albergue|casa de acogida/.test(n) || t.social_facility === 'shelter') {
    return { categoria: 'refugio', tipo: 'ong', sub: 'Albergue temporal', desc: 'Albergue o casa de acogida. Consulte requisitos y horario de ingreso.' };
  }
  if (/acnur|unhcr|\boim\b|\biom\b|retornad|pop no.?j|caritas|pastoral de movilidad|movilidad humana|migrante/.test(n)) {
    return { categoria: 'legal', tipo: /acnur|unhcr|\boim\b|\biom\b/.test(n) ? 'internacional' : 'ong', sub: 'Orientación y apoyo a personas migrantes', desc: 'Organización que brinda orientación, acompañamiento o referencia a otros servicios.' };
  }
  if (/banco de alimentos|comedor/.test(n) || t.social_facility === 'food_bank') {
    return { categoria: 'refugio', tipo: 'ong', sub: 'Alimentación', desc: 'Entrega de alimentos. Consulte días y requisitos.' };
  }

  // Trámites migratorios y representación diplomática
  if (t.government === 'border_control' || /^aduana/.test(n)) {
    return { categoria: 'migracion', tipo: 'publica', sub: 'Puesto fronterizo (aduana y migración)', desc: 'Paso fronterizo con control migratorio. Orientación sobre ingreso y salida del país.' };
  }
  if (t.government === 'migration' || /migraci|migration|\bigm\b/.test(n)) {
    return { categoria: 'migracion', tipo: 'publica', sub: 'Oficina o puesto migratorio', desc: 'Oficina del Instituto Guatemalteco de Migración o puesto fronterizo. Consultas y trámites migratorios.' };
  }
  if ((t.office === 'diplomatic' || t.amenity === 'embassy') && !/agency|usaid|cooperaci/.test(n) && PAISES_ORIGEN.test(n + ' ' + norm(t.country) + ' ' + norm(t.target))) {
    return { categoria: 'migracion', tipo: 'internacional', sub: t.diplomatic === 'consulate' ? 'Consulado' : 'Embajada / consulado', desc: 'Representación de un país extranjero: pasaportes, documentos de identidad y asistencia a sus ciudadanos.' };
  }

  // Protección de derechos
  if (/ministerio publico|\bmp\b|fiscal/.test(n) || t.government === 'prosecutor') {
    return { categoria: 'proteccion', tipo: 'publica', sub: 'Denuncias de delitos', desc: 'Ministerio Público: recibe denuncias de delitos, incluidos trata de personas y violencia.' };
  }
  if (/procuraduria general|\bpgn\b|sosep|bienestar social|direccion de la mujer|oficina municipal de la mujer|\bdmm\b|\bomm\b|aldeas infantiles/.test(n)) {
    return { categoria: 'proteccion', tipo: /aldeas/.test(n) ? 'ong' : 'publica', sub: 'Protección de mujeres, niñez y familia', desc: 'Atención y protección a mujeres, niñas, niños y familias.' };
  }
  if (/defensa publica/.test(n)) {
    return { categoria: 'legal', tipo: 'publica', sub: 'Defensa legal gratuita', desc: 'Abogados defensores gratuitos si usted es acusado de un delito o detenido.' };
  }

  // Emergencias
  if (t.amenity === 'fire_station') {
    const municipal = /municipal/.test(n);
    return { categoria: 'emergencia', tipo: 'publica', sub: 'Bomberos y ambulancia', desc: `Atención de emergencias, ambulancia y rescate. Llame al ${municipal ? '123' : '122'}.`, tel: municipal ? '123' : '122', emergencia: true, horario: '24 horas', nombre: nombre || 'Estación de Bomberos' };
  }
  if (t.amenity === 'police' && (!nombre || POLICIA.test(n)) && !/turismo camping|ministerio/.test(n)) {
    return { categoria: 'emergencia', tipo: 'publica', sub: 'Policía Nacional Civil', desc: 'Emergencias de seguridad y denuncias. Llame al 110.', tel: '110', emergencia: true, horario: '24 horas', nombre: nombre && !/^polic[ií]a$|^pnc$/i.test(nombre) ? nombre : 'Policía Nacional Civil' };
  }

  // Salud pública (se excluyen hospitales y clínicas privadas)
  if (t.amenity === 'hospital' || t.amenity === 'clinic' || t.healthcare) {
    if (/cruz roja|red cross/.test(n)) {
      return { categoria: 'salud', tipo: 'ong', sub: 'Primeros auxilios y ambulancia', desc: 'Cruz Roja Guatemalteca: primeros auxilios, ambulancia y apoyo en emergencias.', emergencia: true };
    }
    if (SALUD_PUBLICA.test(n) || (publico && !/igss|seguro social/.test(n))) {
      const hospital = t.amenity === 'hospital' && /hospital/.test(n);
      return {
        categoria: 'salud',
        tipo: 'publica',
        sub: hospital ? 'Hospital público' : 'Centro de salud público',
        desc: hospital
          ? 'Hospital público. La atención de emergencia no depende de su situación migratoria.'
          : 'Servicio público de salud: consulta general, vacunación y atención primaria.',
        emergencia: hospital,
        horario: hospital ? 'Emergencia 24 horas (confirmar)' : '',
      };
    }
  }
  return null;
}

// --- Principal -------------------------------------------------------------------------------
async function main() {
  const osm = await overpass(CONSULTA, process.argv[2]);
  const localidadDe = crearLocalidad(await overpass(CONSULTA_LUGARES, process.argv[3]));
  const departamentoDe = crearLocalizador();
  const catalogo = JSON.parse(fs.readFileSync(RUTA_CATALOGO, 'utf8'));
  const manuales = catalogo.servicios.filter((s) => !s.id.startsWith('osm-'));

  const nuevos = [];
  for (const el of osm.elements) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const c = clasificar(t);
    if (!c) continue;
    const departamento = departamentoDe(lat, lng);
    if (!departamento) continue; // fuera de Guatemala
    let nombre = c.nombre || (t.name || '').trim();
    if (!nombre) continue;
    const localidad = t['addr:city'] || localidadDe({ lat, lng });
    if (localidad && NOMBRE_GENERICO.test(norm(nombre)) && !norm(nombre).includes(norm(localidad))) {
      nombre = `${nombre} – ${localidad}`;
    }

    const s = {
      id: `osm-${el.type[0]}${el.id}`,
      nombre,
      institucion: t.operator || '',
      tipoInstitucion: c.tipo,
      categoria: c.categoria,
      subcategoria: c.sub,
      descripcion: c.desc,
      direccion: direccion(t),
      municipio: localidad,
      departamento,
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      telefono: telefono(t) || c.tel || '',
      horario: t.opening_hours === '24/7' ? '24 horas' : t.opening_hours || c.horario || 'Consultar horario',
      requisitos: c.emergencia ? 'En una emergencia no se exige documento.' : 'Consultar en el lugar.',
      costo: c.tipo === 'publica' && c.categoria !== 'migracion' ? 'gratuito' : 'variable',
      poblacion: 'Población en general',
      idiomas: ['Español'],
      emergencia: !!c.emergencia,
      fuente: `OpenStreetMap (https://www.openstreetmap.org/${el.type}/${el.id})`,
      fechaVerificacion: '',
      estado: 'pendiente',
    };

    // Evita duplicados: con los servicios escritos a mano y entre registros de OSM.
    const duplicado = [...manuales, ...nuevos].some(
      (o) => o.categoria === s.categoria && (distanciaM(o, s) < 60 || (norm(o.nombre) === norm(s.nombre) && distanciaM(o, s) < 1500))
    );
    if (!duplicado) nuevos.push(s);
  }

  nuevos.sort((a, b) => a.departamento.localeCompare(b.departamento, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
  catalogo.servicios = [...manuales, ...nuevos];
  fs.writeFileSync(RUTA_CATALOGO, JSON.stringify(catalogo, null, 2) + '\n');

  const porCat = {};
  for (const s of nuevos) porCat[s.categoria] = (porCat[s.categoria] || 0) + 1;
  const deps = new Set(catalogo.servicios.map((s) => s.departamento));
  console.log(`Manuales: ${manuales.length} · De OSM: ${nuevos.length} · Departamentos cubiertos: ${deps.size}/22`);
  console.log(porCat);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
