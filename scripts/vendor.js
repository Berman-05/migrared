// Copia Leaflet y Leaflet.markercluster desde node_modules a public/vendor para que la app no
// dependa de un CDN (requisito offline: todo el código debe poder guardarse en caché localmente).
const fs = require('fs');
const path = require('path');

const nm = path.join(__dirname, '..', 'node_modules');
const vendor = path.join(__dirname, '..', 'public', 'vendor');

function copiar(origen, destino, archivos) {
  fs.mkdirSync(destino, { recursive: true });
  for (const f of archivos) fs.copyFileSync(path.join(origen, f), path.join(destino, f));
}

const leaflet = path.join(nm, 'leaflet', 'dist');
copiar(leaflet, path.join(vendor, 'leaflet'), ['leaflet.js', 'leaflet.css']);
copiar(path.join(leaflet, 'images'), path.join(vendor, 'leaflet', 'images'), fs.readdirSync(path.join(leaflet, 'images')));

copiar(path.join(nm, 'leaflet.markercluster', 'dist'), path.join(vendor, 'markercluster'), ['leaflet.markercluster.js', 'MarkerCluster.css']);

console.log('Leaflet y markercluster copiados a public/vendor');
