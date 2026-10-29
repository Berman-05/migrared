import { obtenerServicios, leerMeta, guardarMeta, borrarTodo } from './db.js';
import { sincronizar } from './sync.js';

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/** Categorías organizadas por necesidad del usuario, no por institución. */
const CATEGORIAS = [
  { id: 'salud', nombre: 'Salud', icono: '<path d="M12 6v12M6 12h12"/>', palabras: 'hospital medico doctor clinica enfermo herida embarazo vacuna medicina' },
  { id: 'refugio', nombre: 'Albergue', icono: '<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>', palabras: 'dormir casa comida alimento comer ducha hospedaje techo' },
  { id: 'legal', nombre: 'Asesoría legal', icono: '<path d="M12 4v16M8 20h8M5 8h14"/><path d="m5 8-2.5 6a3 3 0 0 0 5 0Z"/><path d="m19 8-2.5 6a3 3 0 0 0 5 0Z"/>', palabras: 'abogado refugio asilo juicio detenido defensa ley' },
  { id: 'migracion', nombre: 'Trámites migratorios', icono: '<rect x="6" y="3" width="12" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 16h6"/>', palabras: 'papeles documentos pasaporte permiso visa residencia regularizar' },
  { id: 'proteccion', nombre: 'Protección de derechos', icono: '<path d="M12 21s7-3.5 7-9V6l-7-3-7 3v6c0 5.5 7 9 7 9Z"/>', palabras: 'derechos denuncia abuso violencia nino nina menor familia mujer' },
  { id: 'emergencia', nombre: 'Emergencias', icono: '<path d="M12 8v5M12 16.5v.5"/><path d="M10.3 3.9 2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>', palabras: 'policia bomberos ambulancia urgencia peligro robo' },
];
const svgIcono = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const CAT = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c]));

const TIPO_INSTITUCION = { publica: 'Pública', ong: 'ONG', internacional: 'Organismo internacional' };
const COSTO = { gratuito: 'Gratuito', variable: 'Costo variable' };
const ESTADO = { activo: 'Activo', suspendido: 'Suspendido', pendiente: 'Pendiente de verificar' };

const CENTRO_GT = [15.6, -90.35];
const INTERVALO_SYNC_MS = 30 * 60 * 1000;
// Modo «Cerca»: solo se dibujan los N servicios más cercanos; es lo que mantiene fluido el mapa en teléfonos modestos.
const LIMITE_CERCA = 40;
const PAGINA_LISTA = 30;
const ORDEN_NOMBRE = new Intl.Collator('es').compare;

// Preferencias de interfaz (tema, modo): solo en este dispositivo y sin datos personales.
const pref = {
  leer: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  guardar: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const estado = {
  servicios: [],
  categoria: '',
  texto: '',
  departamento: '',
  tipo: '',
  soloGratuitos: false,
  soloEmergencia: false,
  soloGuardados: false,
  favoritos: new Set(),
  ubicacion: null, // { lat, lng } – solo en memoria, nunca se guarda ni se envía
  vista: 'mapa',
  modo: pref.leer('modo') === 'todo' ? 'todo' : 'cerca',
  totalFiltrados: 0,
  listaSucia: true,
  servidorAlcanzable: true, // navigator.onLine no detecta redes sin salida a Internet
};

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function normalizar(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function distanciaKm(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatoDistancia(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

function formatoFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' });
}

function toast(mensaje) {
  const el = $('#toast');
  el.textContent = mensaje;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3500);
}

/** Texto en el que se busca: campos del servicio + sinónimos de su categoría. */
function textoBusqueda(s) {
  const c = CAT[s.categoria];
  return normalizar(
    [s.nombre, s.institucion, s.descripcion, s.subcategoria, s.municipio, s.departamento, s.poblacion, c?.nombre, c?.palabras].join(' ')
  );
}

// ---------------------------------------------------------------------------
// Filtrado
// ---------------------------------------------------------------------------

function serviciosFiltrados() {
  const terminos = normalizar(estado.texto).split(/\s+/).filter(Boolean);
  let lista = estado.servicios.filter((s) => {
    if (s.estado === 'suspendido') return false;
    if (estado.categoria && s.categoria !== estado.categoria) return false;
    if (estado.departamento && s.departamento !== estado.departamento) return false;
    if (estado.tipo && s.tipoInstitucion !== estado.tipo) return false;
    if (estado.soloGratuitos && s.costo !== 'gratuito') return false;
    if (estado.soloEmergencia && !s.emergencia) return false;
    if (estado.soloGuardados && !estado.favoritos.has(s.id)) return false;
    if (terminos.length) {
      const t = s._busqueda;
      if (!terminos.every((p) => t.includes(p))) return false;
    }
    return true;
  });
  estado.totalFiltrados = lista.length;

  // Referencia para «Cerca»: la ubicación de la persona o, si no la compartió, el centro del mapa.
  const ref = estado.ubicacion || (estado.modo === 'cerca' && mapa ? mapa.getCenter() : null);
  if (ref) {
    for (const s of lista) s._dist = distanciaKm(ref, s);
    lista.sort((a, b) => a._dist - b._dist);
    if (estado.modo === 'cerca') lista = lista.slice(0, LIMITE_CERCA);
  } else {
    lista.sort((a, b) => ORDEN_NOMBRE(a.nombre, b.nombre));
  }
  return lista;
}

// ---------------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------------

let mapa;
let capaMarcadores;
let marcadorUsuario;

// Mosaico transparente para las zonas no guardadas sin conexión: deja ver el mapa base de abajo.
const MOSAICO_VACIO =
  'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>');

function iniciarMapa() {
  mapa = L.map('mapa', { zoomControl: false, attributionControl: true }).setView(CENTRO_GT, 7);
  L.control.zoom({ position: 'bottomleft' }).addTo(mapa);
  // En «Cerca» sin ubicación, la lista sigue a la zona que se está mirando.
  let t;
  mapa.on('moveend', () => {
    if (estado.modo !== 'cerca' || estado.ubicacion) return;
    clearTimeout(t);
    t = setTimeout(render, 180);
  });
  // El mapa base va debajo de los mosaicos (tilePane = 200): con conexión lo tapa OpenStreetMap.
  mapa.createPane('base').style.zIndex = 150;
  mapa.on('zoomend', marcarZoom);
  marcarZoom();
  cargarMapaBase();
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    subdomains: 'abc',
    errorTileUrl: MOSAICO_VACIO,
    // OpenStreetMap bloquea (403) los mosaicos pedidos sin Referer. Solo se envía el origen
    // del sitio (nunca la ruta ni datos de la persona); el resto de la página sigue sin referer.
    referrerPolicy: 'strict-origin',
    // Petición CORS: permite al Service Worker comprobar el estado y no guardar errores.
    crossOrigin: true,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);
  capaMarcadores = L.markerClusterGroup({
    iconCreateFunction: iconoGrupo,
    showCoverageOnHover: false,
    // Agrupa fuerte de lejos y poco al acercarse, para ver los pines individuales antes.
    maxClusterRadius: (z) => (z < 9 ? 45 : 28),
    disableClusteringAtZoom: 13,
    chunkedLoading: true,
  }).addTo(mapa);
}

/** Clases según el zoom, para mostrar u ocultar etiquetas del mapa base desde CSS. */
function marcarZoom() {
  const z = mapa.getZoom();
  const c = mapa.getContainer().classList;
  c.toggle('z-bajo', z < 8);
  c.toggle('z-medio', z >= 8 && z < 10);
  c.toggle('z-alto', z >= 10);
}

/**
 * Mapa base ligero incluido en la app (public/data/mapa-base.json, ~90 KB): departamentos, países
 * vecinos, carreteras principales y ciudades. Siempre está disponible sin conexión, aunque la
 * persona nunca haya visto esa zona del mapa con Internet.
 */
async function cargarMapaBase() {
  let base;
  try {
    base = await (await fetch('data/mapa-base.json')).json();
  } catch (err) {
    console.warn('Mapa base no disponible:', err);
    return;
  }
  const poligono = (anillos, clase) =>
    L.polygon(anillos.map((a) => a.map(([lng, lat]) => [lat, lng])), { pane: 'base', className: clase, interactive: false });
  const etiqueta = (lat, lng, texto, clase) =>
    L.marker([lat, lng], {
      pane: 'base',
      interactive: false,
      keyboard: false,
      icon: L.divIcon({ className: `etq ${clase}`, html: `<span>${esc(texto)}</span>`, iconSize: null }),
    });

  const capa = L.layerGroup();
  for (const v of base.vecinos) poligono(v.anillos, 'base-vecino').addTo(capa);
  for (const d of base.deptos) {
    const p = poligono(d.anillos, 'base-depto').addTo(capa);
    const c = p.getBounds().getCenter();
    etiqueta(c.lat, c.lng, d.nombre, 'etq-depto').addTo(capa);
  }
  for (const r of base.carreteras) {
    L.polyline(r.puntos.map(([lng, lat]) => [lat, lng]), {
      pane: 'base',
      className: r.principal ? 'base-ruta base-ruta-principal' : 'base-ruta',
      interactive: false,
    }).addTo(capa);
  }
  for (const c of base.ciudades) {
    L.circleMarker([c.lat, c.lng], { pane: 'base', radius: c.nivel === 1 ? 4 : 3, className: 'base-ciudad', interactive: false }).addTo(capa);
    etiqueta(c.lat, c.lng, c.nombre, `etq-ciudad etq-n${c.nivel}`).addTo(capa);
  }
  capa.addTo(mapa);
}

// Un ícono por categoría (no uno por servicio) y un marcador por servicio, creados una sola vez.
const iconos = new Map();
function iconoServicio(s) {
  if (!iconos.has(s.categoria)) {
    const c = CAT[s.categoria];
    iconos.set(
      s.categoria,
      L.divIcon({
        className: '',
        html: `<div class="pin pin-${esc(s.categoria)}">${c ? svgIcono(c.icono) : ''}</div>`,
        iconSize: [32, 40],
        iconAnchor: [16, 39],
      })
    );
  }
  return iconos.get(s.categoria);
}

const marcadores = new Map();
let enMapa = new Set();

function renderMapa(lista) {
  // Solo se agregan y quitan las diferencias: recrear cientos de marcadores en cada búsqueda trababa el mapa.
  const nuevos = new Set(lista.map((s) => s.id));
  const quitar = [...enMapa].filter((id) => !nuevos.has(id)).map((id) => marcadores.get(id));
  const poner = [];
  for (const s of lista) {
    if (enMapa.has(s.id)) continue;
    if (!marcadores.has(s.id)) {
      marcadores.set(s.id, L.marker([s.lat, s.lng], { icon: iconoServicio(s), title: s.nombre, categoria: s.categoria }).on('click', () => abrirFicha(s.id)));
    }
    poner.push(marcadores.get(s.id));
  }
  if (quitar.length) capaMarcadores.removeLayers(quitar);
  if (poner.length) capaMarcadores.addLayers(poner);
  enMapa = nuevos;
}

function reiniciarMarcadores() {
  capaMarcadores.clearLayers();
  marcadores.clear();
  enMapa = new Set();
}

/**
 * Círculo con el número de servicios agrupados y un anillo repartido por el color de cada
 * categoría, para saber qué hay dentro sin acercarse. Se arma con el DOM (no con un atributo
 * style en HTML) porque la Content-Security-Policy no permite estilos en línea.
 */
function iconoGrupo(grupo) {
  const n = grupo.getChildCount();
  const tam = n < 10 ? 38 : n < 100 ? 44 : 52;
  const cuenta = {};
  for (const m of grupo.getAllChildMarkers()) cuenta[m.options.categoria] = (cuenta[m.options.categoria] || 0) + 1;
  let acumulado = 0;
  const tramos = CATEGORIAS.filter((c) => cuenta[c.id]).map((c) => {
    const desde = (acumulado / n) * 100;
    acumulado += cuenta[c.id];
    return `var(--c-${c.id}) ${desde}% ${(acumulado / n) * 100}%`;
  });
  const el = document.createElement('div');
  el.className = 'grupo';
  if (tramos.length) el.style.background = `conic-gradient(${tramos.join(', ')})`;
  el.title = CATEGORIAS.filter((c) => cuenta[c.id]).map((c) => `${cuenta[c.id]} ${c.nombre}`).join(' · ');
  const num = document.createElement('span');
  num.textContent = n;
  el.append(num);
  return L.divIcon({ className: '', html: el, iconSize: [tam, tam] });
}

function ajustarMapa(lista) {
  if (!lista.length) return;
  const puntos = lista.slice(0, estado.ubicacion ? 5 : lista.length).map((s) => [s.lat, s.lng]);
  if (estado.ubicacion) puntos.push([estado.ubicacion.lat, estado.ubicacion.lng]);
  mapa.fitBounds(L.latLngBounds(puntos), { padding: [40, 40], maxZoom: 14 });
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

function etiquetas(s) {
  const c = CAT[s.categoria];
  const partes = [`<span class="badge badge-${esc(s.categoria)}">${esc(c?.nombre || s.categoria)}</span>`];
  if (s.costo === 'gratuito') partes.push('<span class="badge badge-gratis">Gratuito</span>');
  if (s.emergencia) partes.push('<span class="badge badge-24h">Emergencia</span>');
  return partes.join('');
}

function textoResumen(n) {
  if (n === 0) return 'No se encontraron servicios con esos filtros.';
  const plural = `${n} servicio${n === 1 ? '' : 's'}`;
  if (estado.modo === 'todo') return `${plural}${estado.ubicacion ? ', ordenados por cercanía' : ''}`;
  return estado.ubicacion ? `${plural} más cercanos a usted` : `${plural} más cercanos a la zona del mapa`;
}

function tarjeta(s) {
  return `
      <li>
        <button type="button" class="tarjeta" data-id="${esc(s.id)}">
          <div class="tarjeta-top">${etiquetas(s)}${s._dist != null && estado.ubicacion ? `<span class="dist">${formatoDistancia(s._dist)}</span>` : ''}</div>
          <h3>${esc(s.nombre)}${estado.favoritos.has(s.id) ? ' <span class="fav" aria-label="Guardado">★</span>' : ''}</h3>
          <p>${esc(s.descripcion)}</p>
          <p class="mini">${esc([s.municipio, s.departamento].filter(Boolean).join(', '))}${s.horario ? ' · ' + esc(s.horario) : ''}</p>
        </button>
      </li>`;
}

// La lista se pinta por páginas: cientos de tarjetas de golpe bloqueaban el teléfono.
let listaActual = [];
let mostrados = 0;

function renderLista(lista) {
  listaActual = lista;
  mostrados = 0;
  $('#resumen').textContent = textoResumen(lista.length);
  $('#lista').innerHTML = '';
  agregarPagina();
}

function agregarPagina() {
  const trozo = listaActual.slice(mostrados, mostrados + PAGINA_LISTA);
  $('#lista').insertAdjacentHTML('beforeend', trozo.map(tarjeta).join(''));
  mostrados += trozo.length;
  $('#btn-mas').hidden = mostrados >= listaActual.length;
}

// ---------------------------------------------------------------------------
// Ficha de servicio
// ---------------------------------------------------------------------------

function fila(titulo, valor) {
  return valor ? `<dt>${esc(titulo)}</dt><dd>${esc(valor)}</dd>` : '';
}

function abrirFicha(id) {
  const s = estado.servicios.find((x) => x.id === id);
  if (!s) return;
  const c = CAT[s.categoria];
  const guardado = estado.favoritos.has(s.id);
  const tel = String(s.telefono || '').replace(/[^\d+]/g, '');
  const dist = estado.ubicacion ? formatoDistancia(distanciaKm(estado.ubicacion, s)) : '';

  $('#ficha-cuerpo').innerHTML = `
    <div class="ficha-head">
      <div>${etiquetas(s)}</div>
      <button type="button" class="cerrar" data-accion="cerrar" aria-label="Cerrar">×</button>
    </div>
    <h2 id="ficha-titulo">${esc(s.nombre)}</h2>
    <p class="inst">${esc([s.institucion, TIPO_INSTITUCION[s.tipoInstitucion] || s.tipoInstitucion].filter(Boolean).join(' · '))}</p>
    ${s.estado !== 'activo' ? `<p class="alerta">${esc(ESTADO[s.estado] || s.estado)}: confirme antes de ir.</p>` : ''}
    <p class="desc">${esc(s.descripcion)}</p>

    <div class="ficha-acciones">
      ${tel ? `<a class="btn btn-primario" href="tel:${esc(tel)}">Llamar ${esc(s.telefono)}</a>` : ''}
      <button type="button" class="btn" data-accion="ver-mapa">Ver en el mapa</button>
      <a class="btn" href="geo:${s.lat},${s.lng}?q=${s.lat},${s.lng}" rel="noopener">Abrir en app de mapas</a>
      <button type="button" class="btn" data-accion="favorito">${guardado ? '★ Quitar de guardados' : '☆ Guardar'}</button>
    </div>

    <dl class="detalle">
      ${fila('Dirección', [s.direccion, s.municipio, s.departamento].filter(Boolean).join(', '))}
      ${fila('Distancia aproximada', dist)}
      ${fila('Horario', s.horario)}
      ${fila('Qué llevar / requisitos', s.requisitos)}
      ${fila('Costo', COSTO[s.costo] || s.costo)}
      ${fila('A quién atiende', s.poblacion)}
      ${fila('Idiomas', (s.idiomas || []).join(', '))}
      ${fila('Tipo de servicio', s.subcategoria || c?.nombre)}
      ${fila('Fuente del dato', s.fuente)}
      ${fila('Última verificación', s.fechaVerificacion || 'Sin verificar')}
    </dl>`;

  const dialogo = $('#ficha');
  dialogo.dataset.id = s.id;
  if (!dialogo.open) dialogo.showModal();
}

function manejarFicha(e) {
  const dialogo = $('#ficha');
  if (e.target === dialogo) return dialogo.close(); // clic fuera del contenido
  const accion = e.target.closest('[data-accion]')?.dataset.accion;
  const id = dialogo.dataset.id;
  if (accion === 'cerrar') dialogo.close();
  if (accion === 'favorito') alternarFavorito(id).then(() => abrirFicha(id));
  if (accion === 'ver-mapa') {
    const s = estado.servicios.find((x) => x.id === id);
    dialogo.close();
    cambiarVista('mapa');
    mapa.setView([s.lat, s.lng], 16);
  }
}

async function alternarFavorito(id) {
  if (estado.favoritos.has(id)) estado.favoritos.delete(id);
  else estado.favoritos.add(id);
  await guardarMeta('favoritos', [...estado.favoritos]);
  render();
}

// ---------------------------------------------------------------------------
// Render general y navegación
// ---------------------------------------------------------------------------

function render({ ajustar = false } = {}) {
  const lista = serviciosFiltrados();
  renderMapa(lista);
  // La lista oculta no se pinta: se marca y se pinta al abrir la pestaña.
  if (estado.vista === 'lista') renderLista(lista);
  else estado.listaSucia = true;
  renderModo(lista.length);
  // En «Cerca» sin ubicación el mapa manda; moverlo cambiaría la propia selección.
  if (ajustar && (estado.modo === 'todo' || estado.ubicacion)) ajustarMapa(lista);
}

function renderModo(n) {
  document.querySelectorAll('[data-modo]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.modo === estado.modo)));
  $('#total-todos').textContent = estado.totalFiltrados;
  const aviso = $('#mapa-aviso');
  aviso.hidden = estado.modo !== 'cerca' || n === 0;
  aviso.textContent = estado.ubicacion ? `${n} más cercanos a usted` : `${n} más cercanos · mueva el mapa para ver otra zona`;
}

function cambiarModo(modo) {
  if (modo === estado.modo) return;
  estado.modo = modo;
  pref.guardar('modo', modo);
  render({ ajustar: modo === 'todo' });
}

function renderCategorias() {
  $('#categorias').innerHTML =
    `<button type="button" class="chip activa" data-cat="" aria-pressed="true">Todos</button>` +
    CATEGORIAS.map(
      (c) =>
        `<button type="button" class="chip chip-${c.id}" data-cat="${c.id}" aria-pressed="false"><span class="chip-ico">${svgIcono(c.icono)}</span>${c.nombre}</button>`
    ).join('');
}

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  document.querySelector('meta[name="theme-color"]').content = tema === 'oscuro' ? '#0e1211' : '#ffffff';
  $('#btn-tema').setAttribute('aria-label', tema === 'oscuro' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
}

function renderDepartamentos() {
  const deps = [...new Set(estado.servicios.map((s) => s.departamento).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const sel = $('#f-departamento');
  const actual = sel.value;
  sel.innerHTML = '<option value="">Todos</option>' + deps.map((d) => `<option>${esc(d)}</option>`).join('');
  sel.value = deps.includes(actual) ? actual : '';
}

function cambiarVista(vista) {
  estado.vista = vista;
  document.querySelectorAll('.vista').forEach((v) => v.classList.toggle('activa', v.id === `vista-${vista}`));
  document.querySelectorAll('.tabs button').forEach((b) => {
    const activa = b.dataset.vista === vista;
    b.classList.toggle('activa', activa);
    if (activa) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.body.classList.toggle('sin-controles', vista === 'emergencia' || vista === 'info');
  if (vista === 'mapa') setTimeout(() => mapa.invalidateSize(), 0);
  if (vista === 'lista' && estado.listaSucia) {
    estado.listaSucia = false;
    renderLista(serviciosFiltrados());
  }
  if (vista === 'info') renderInfo();
}

// ---------------------------------------------------------------------------
// Conexión y sincronización
// ---------------------------------------------------------------------------

async function renderEstadoRed() {
  const enLinea = navigator.onLine && estado.servidorAlcanzable;
  const ultima = await leerMeta('ultimaSync');
  const el = $('#estado-red');
  el.classList.toggle('offline', !enLinea);
  el.querySelector('.net-label').textContent = enLinea
    ? 'En línea'
    : `Sin conexión${ultima ? ' · ' + new Date(ultima).toLocaleDateString('es-GT', { day: 'numeric', month: 'numeric' }) : ''}`;
  el.title = ultima ? `Datos guardados el ${formatoFecha(ultima)}` : '';
}

async function renderInfo() {
  $('#info-version').textContent = (await leerMeta('version')) || '—';
  $('#info-sync').textContent = formatoFecha(await leerMeta('ultimaSync'));
  $('#info-total').textContent = String(estado.servicios.length);
  $('#aviso-catalogo').textContent = (await leerMeta('aviso')) || '';
}

async function cargarDesdeDB() {
  estado.servicios = (await obtenerServicios()).map((s) => ({ ...s, _busqueda: textoBusqueda(s) }));
  reiniciarMarcadores();
  renderDepartamentos();
}

let sincronizando = false;
async function intentarSincronizar({ avisar = false } = {}) {
  if (sincronizando || !navigator.onLine) {
    if (avisar && !navigator.onLine) toast('Sin conexión. Se usarán los datos guardados.');
    return;
  }
  sincronizando = true;
  try {
    const r = await sincronizar();
    estado.servidorAlcanzable = true;
    if (r.actualizado) {
      await cargarDesdeDB();
      render();
      toast('Catálogo actualizado. Ya está disponible sin conexión.');
    } else if (avisar) {
      toast('Sus datos ya están al día.');
    }
  } catch (err) {
    estado.servidorAlcanzable = false;
    if (avisar) toast('No se pudo actualizar. Se usarán los datos guardados.');
    console.warn('Sincronización fallida:', err);
  } finally {
    sincronizando = false;
    renderEstadoRed();
    if (estado.vista === 'info') renderInfo();
  }
}

// ---------------------------------------------------------------------------
// Ubicación (solo bajo demanda, procesada en el dispositivo)
// ---------------------------------------------------------------------------

function pedirUbicacion() {
  if (!('geolocation' in navigator)) return toast('Este teléfono no permite obtener la ubicación.');
  const btn = $('#btn-ubicacion');
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false;
      estado.ubicacion = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (marcadorUsuario) marcadorUsuario.remove();
      marcadorUsuario = L.circleMarker([estado.ubicacion.lat, estado.ubicacion.lng], {
        radius: 9,
        color: '#fff',
        weight: 3,
        fillColor: '#1d6fd8',
        fillOpacity: 1,
      })
        .bindTooltip('Usted está aquí')
        .addTo(mapa);
      render({ ajustar: true });
      toast('Mostrando los servicios más cercanos. Su ubicación no se guarda.');
    },
    () => {
      btn.disabled = false;
      toast('No se pudo obtener su ubicación. Puede buscar por departamento.');
    },
    // Ubicación aproximada: basta para ordenar por cercanía y consume menos batería.
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 }
  );
}

// ---------------------------------------------------------------------------
// Instalación y borrado de datos
// ---------------------------------------------------------------------------

let eventoInstalar;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  eventoInstalar = e;
  $('#btn-instalar').hidden = false;
});

async function borrarDatos() {
  if (!confirm('Se borrarán el catálogo guardado, sus favoritos y el mapa guardado de este teléfono. ¿Continuar?')) return;
  await borrarTodo();
  try { localStorage.clear(); } catch {}
  if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
  if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  location.reload();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function conectarEventos() {
  let t;
  $('#buscar').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      estado.texto = e.target.value;
      render({ ajustar: true });
    }, 150);
  });

  $('#categorias').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    estado.categoria = chip.dataset.cat;
    document.querySelectorAll('.chip').forEach((c) => {
      const activa = c === chip;
      c.classList.toggle('activa', activa);
      c.setAttribute('aria-pressed', String(activa));
    });
    render({ ajustar: true });
  });

  const filtros = [
    ['#f-departamento', 'departamento', 'value'],
    ['#f-tipo', 'tipo', 'value'],
    ['#f-gratuito', 'soloGratuitos', 'checked'],
    ['#f-emergencia', 'soloEmergencia', 'checked'],
    ['#f-guardados', 'soloGuardados', 'checked'],
  ];
  for (const [sel, clave, prop] of filtros) {
    $(sel).addEventListener('change', (e) => {
      estado[clave] = e.target[prop];
      render({ ajustar: true });
    });
  }

  document.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => cambiarModo(b.dataset.modo)));

  $('#btn-filtros').addEventListener('click', (e) => {
    const abierto = e.currentTarget.getAttribute('aria-expanded') === 'true';
    e.currentTarget.setAttribute('aria-expanded', String(!abierto));
    $('#panel-filtros').hidden = abierto;
    setTimeout(() => mapa.invalidateSize(), 0);
  });

  $('#btn-tema').addEventListener('click', () => {
    const tema = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
    pref.guardar('tema', tema);
    aplicarTema(tema);
  });

  $('#btn-mas').addEventListener('click', agregarPagina);
  // Carga la siguiente página sola al llegar al final de la lista.
  new IntersectionObserver((e) => e[0].isIntersecting && !$('#btn-mas').hidden && agregarPagina(), {
    root: $('#vista-lista'),
    rootMargin: '400px',
  }).observe($('#btn-mas'));

  $('#lista').addEventListener('click', (e) => {
    const tarjeta = e.target.closest('.tarjeta');
    if (tarjeta) abrirFicha(tarjeta.dataset.id);
  });

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-vista]');
    if (b) cambiarVista(b.dataset.vista);
  });

  $('#ficha').addEventListener('click', manejarFicha);
  $('#btn-ubicacion').addEventListener('click', pedirUbicacion);
  $('#btn-actualizar').addEventListener('click', () => intentarSincronizar({ avisar: true }));
  $('#btn-borrar').addEventListener('click', borrarDatos);
  $('#estado-red').addEventListener('click', () => cambiarVista('info'));
  $('#btn-instalar').addEventListener('click', async () => {
    if (!eventoInstalar) return;
    eventoInstalar.prompt();
    await eventoInstalar.userChoice;
    eventoInstalar = null;
    $('#btn-instalar').hidden = true;
  });

  // Actualización automática: al recuperar conexión, al volver a la app y cada 30 minutos.
  window.addEventListener('online', () => intentarSincronizar());
  window.addEventListener('offline', () => {
    estado.servidorAlcanzable = false;
    renderEstadoRed();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') intentarSincronizar();
  });
  setInterval(() => intentarSincronizar(), INTERVALO_SYNC_MS);
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function iniciar() {
  if ('serviceWorker' in navigator) {
    // Cuando se publica una versión nueva de la app, el nuevo Service Worker toma el control
    // y se recarga una vez para usar el código actualizado.
    const habiaControlador = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (habiaControlador) location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker no registrado:', err));
  }

  aplicarTema(document.documentElement.dataset.tema);
  renderCategorias();
  iniciarMapa();
  conectarEventos();

  estado.favoritos = new Set((await leerMeta('favoritos')) || []);
  await cargarDesdeDB();

  if (!estado.servicios.length) {
    // Primer uso: se necesita descargar el catálogo una vez (o tomarlo del caché del Service Worker).
    try {
      await sincronizar();
      await cargarDesdeDB();
    } catch {
      toast('Conéctese a Internet una vez para descargar los servicios.');
    }
    render({ ajustar: true });
  } else {
    render({ ajustar: true });
    intentarSincronizar();
  }
  renderEstadoRed();
}

iniciar();
