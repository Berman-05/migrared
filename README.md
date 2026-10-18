# MIGRARED

Aplicación web **offline-first** (PWA) para que la población migrante en Guatemala localice y consulte
servicios públicos y de apoyo —salud, albergue, asesoría legal, trámites migratorios, protección de
derechos y emergencias— en un mapa, **incluso sin conexión a Internet**. Los datos se actualizan
automáticamente cada vez que el teléfono vuelve a tener conexión.

Proyecto social – Ética Aplicada, Universidad Rafael Landívar, Campus de Quetzaltenango.

## Cómo ejecutarla

Requiere Node.js 18 o superior.

```bash
npm install
```

```bash
npm start
```

Luego abrir <http://localhost:8080>. `npm install` descarga Leaflet y lo copia a `public/vendor/`,
para que la app no dependa de ningún CDN.

Para publicarla basta con subir la carpeta `public/` a cualquier hosting estático **con HTTPS**
(GitHub Pages, Netlify, un servidor institucional…). El Service Worker solo funciona en HTTPS o en `localhost`.

## Arquitectura (según el capítulo 3)

| Componente | Implementación |
|---|---|
| Aplicación cliente (PWA) | `public/index.html`, `public/js/app.js`, `public/css/app.css` – buscador, filtros, categorías, mapa, lista y fichas |
| Recursos offline | `public/sw.js` – Service Worker: guarda la app, el catálogo y las zonas del mapa ya vistas |
| Base de datos local | `public/js/db.js` – IndexedDB con el catálogo de servicios, versión y favoritos |
| Sincronización | `public/js/sync.js` – descarga el catálogo al abrir la app, al recuperar conexión, al volver a la app y cada 30 min; solo reemplaza los datos si cambió la `version` |
| Catálogo | `public/data/servicios.json` – estructura de campos de la tabla de arquitectura de la información |

Flujo sin conexión: la persona abre la app → se carga desde la caché del Service Worker → los
servicios se leen de IndexedDB → puede buscar, filtrar, ver fichas, ordenar por cercanía y llamar.
El mapa muestra las zonas que ya se vieron con conexión; el resto aparece en gris, pero los
marcadores y la lista siguen funcionando.

## Privacidad y protección de datos

- No hay cuentas, formularios, cookies, analítica ni scripts de terceros (lo impone la
  Content-Security-Policy de `index.html`).
- La ubicación se pide solo al tocar **Cerca de mí**, se procesa en el teléfono y nunca se guarda ni se envía.
- La sincronización es una descarga anónima del catálogo (`credentials: 'omit'`, sin referer).
- Los favoritos quedan solo en el dispositivo; **Privacidad → Borrar todos los datos** elimina
  IndexedDB, cachés y el Service Worker.
- Los únicos recursos externos son los mosaicos de OpenStreetMap: el servidor de mapas puede ver
  qué zona se consulta (no quién). Una mejora futura es servir mosaicos propios.

## Actualizar el catálogo

1. Editar `public/data/servicios.json` (cada servicio sigue la tabla de campos del capítulo 3).
2. Cambiar el campo `version` (por ejemplo `2026-11-02.1`).
3. Publicar. Los teléfonos lo descargarán la próxima vez que tengan conexión.

Valores usados en los campos codificados:
`tipoInstitucion`: `publica` | `ong` | `internacional` ·
`categoria`: `salud` | `refugio` | `legal` | `migracion` | `proteccion` | `emergencia` ·
`costo`: `gratuito` | `variable` · `estado`: `activo` | `suspendido` | `pendiente`.
Los servicios `suspendido` no se muestran.

## Actualizar el código

Después de cambiar HTML, CSS o JS, subir `VERSION` en `public/sw.js` (`v3` → `v4`). Si no, los
teléfonos seguirán usando la versión guardada. La app se recarga sola cuando detecta la versión nueva.

## ⚠️ Datos de demostración

El catálogo incluido es **de ejemplo**: direcciones, coordenadas, teléfonos y horarios son
aproximados y todos están marcados como `pendiente`. Antes de usarlo con personas reales, hay que
verificar cada registro con la institución (Casa del Migrante, IGM, ACNUR, etc.), completar `fuente` y
`fechaVerificacion` y cambiar `estado` a `activo`.

## Íconos

`node scripts/icons.js` regenera `icon-192.png` e `icon-512.png` (sin dependencias).
