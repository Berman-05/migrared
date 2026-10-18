// Copia Leaflet desde node_modules a public/vendor para que la app no dependa de un CDN
// (requisito offline: todo el código debe poder guardarse en caché localmente).
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist');
const dest = path.join(__dirname, '..', 'public', 'vendor', 'leaflet');

fs.mkdirSync(path.join(dest, 'images'), { recursive: true });
for (const f of ['leaflet.js', 'leaflet.css']) {
  fs.copyFileSync(path.join(src, f), path.join(dest, f));
}
for (const f of fs.readdirSync(path.join(src, 'images'))) {
  fs.copyFileSync(path.join(src, 'images', f), path.join(dest, 'images', f));
}
console.log('Leaflet copiado a public/vendor/leaflet');
