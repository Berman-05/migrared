import { obtenerServicios, leerMeta, guardarMeta, borrarTodo } from './db.js';
import { sincronizar } from './sync.js';

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/** Categorías organizadas por necesidad del usuario, no por institución. */
const CATEGORIAS = [
  { id: 'salud', nombre: 'Salud', icono: '✚', palabras: 'hospital medico doctor clinica enfermo herida embarazo vacuna medicina' },
  { id: 'refugio', nombre: 'Albergue', icono: '⌂', palabras: 'dormir casa comida alimento comer ducha hospedaje techo' },
  { id: 'legal', nombre: 'Asesoría legal', icono: '§', palabras: 'abogado refugio asilo juicio detenido defensa ley' },
  { id: 'migracion', nombre: 'Trámites migratorios', icono: '▤', palabras: 'papeles documentos pasaporte permiso visa residencia regularizar' },
  { id: 'proteccion', nombre: 'Protección de derechos', icono: '◈', palabras: 'derechos denuncia abuso violencia nino nina menor familia mujer' },
  { id: 'emergencia', nombre: 'Emergencias', icono: '!', palabras: 'policia bomberos ambulancia urgencia peligro robo' },
];
const CAT = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c]));

const TIPO_INSTITUCION = { publica: 'Pública', ong: 'ONG', internacional: 'Organismo internacional' };
const COSTO = { gratuito: 'Gratuito', variable: 'Costo variable' };
const ESTADO = { activo: 'Activo', suspendido: 'Suspendido', pendiente: 'Pendiente de verificar' };

const CENTRO_GT = [15.6, -90.35];
const INTERVALO_SYNC_MS = 30 * 60 * 1000;

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

  if (estado.ubicacion) {
    for (const s of lista) s._dist = distanciaKm(estado.ubicacion, s);
    lista.sort((a, b) => a._dist - b._dist);
  } else {
    lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  return lista;
}

// ---------------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------------

let mapa;
let capaMarcadores;
let marcadorUsuario;

// Mosaico gris que se muestra cuando una zona del mapa no está guardada y no hay conexión.
const MOSAICO_VACIO =
  'data:image/svg+xml,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e7ebe9"/></svg>');

function iniciarMapa() {
  mapa = L.map('mapa', { zoomControl: true, attributionControl: true }).setView(CENTRO_GT, 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    subdomains: 'abc',
    errorTileUrl: MOSAICO_VACIO,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);
  capaMarcadores = L.layerGroup().addTo(mapa);
}

function iconoServicio(s) {
  const c = CAT[s.categoria] || { icono: '•' };
  return L.divIcon({
    className: '',
    html: `<div class="pin pin-${esc(s.categoria)}${s.emergencia ? ' pin-24h' : ''}"><span>${esc(c.icono)}</span></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
  });
}

function renderMapa(lista) {
  capaMarcadores.clearLayers();
  for (const s of lista) {
    L.marker([s.lat, s.lng], { icon: iconoServicio(s), title: s.nombre, keyboard: true })
      .on('click', () => abrirFicha(s.id))
      .addTo(capaMarcadores);
  }
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

function renderLista(lista) {
  const n = lista.length;
  $('#resumen').textContent =
    n === 0
      ? 'No se encontraron servicios con esos filtros.'
      : `${n} servicio${n === 1 ? '' : 's'}${estado.ubicacion ? ', ordenados por cercanía' : ''}`;

  $('#lista').innerHTML = lista
    .map(
      (s) => `
      <li>
        <button type="button" class="tarjeta" data-id="${esc(s.id)}">
          <div class="tarjeta-top">${etiquetas(s)}${s._dist != null && estado.ubicacion ? `<span class="dist">${formatoDistancia(s._dist)}</span>` : ''}</div>
          <h3>${esc(s.nombre)}${estado.favoritos.has(s.id) ? ' <span class="fav" aria-label="Guardado">★</span>' : ''}</h3>
          <p>${esc(s.descripcion)}</p>
          <p class="mini">${esc(s.municipio)}, ${esc(s.departamento)} · ${esc(s.horario)}</p>
        </button>
      </li>`
    )
    .join('');
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
    <p class="inst">${esc(s.institucion)} · ${esc(TIPO_INSTITUCION[s.tipoInstitucion] || s.tipoInstitucion)}</p>
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
  renderLista(lista);
  if (ajustar) ajustarMapa(lista);
}

function renderCategorias() {
  $('#categorias').innerHTML =
    `<button type="button" class="chip activa" data-cat="" aria-pressed="true">Todos</button>` +
    CATEGORIAS.map(
      (c) =>
        `<button type="button" class="chip chip-${c.id}" data-cat="${c.id}" aria-pressed="false"><span class="chip-ico" aria-hidden="true">${c.icono}</span>${c.nombre}</button>`
    ).join('');
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
