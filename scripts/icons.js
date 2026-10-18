// Genera los íconos PNG (192 y 512 px) a partir de la misma forma que icons/icon.svg,
// sin dependencias externas. Uso: node scripts/icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const VERDE = [15, 94, 87];
const BLANCO = [255, 255, 255];
const NARANJA = [242, 165, 65];

function color(x, y) {
  // Coordenadas normalizadas a la cuadrícula 64×64 del SVG. Fondo de borde completo
  // (sin esquinas redondeadas) para que funcione como ícono "maskable".
  const cx = 32, cy = 27;
  const d = Math.hypot(x - cx, y - cy);
  if (d <= 6) return NARANJA;
  // Pin: círculo superior + triángulo hacia la punta (32, 52).
  if (Math.hypot(x - 32, y - 26.6) <= 15) return BLANCO;
  if (y >= 26.6 && y <= 52) {
    const media = 13.2 * (52 - y) / (52 - 26.6);
    if (Math.abs(x - 32) <= media) return BLANCO;
  }
  return VERDE;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tipo, datos) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(datos.length);
  const td = Buffer.concat([Buffer.from(tipo), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(tam) {
  const SS = 3; // supermuestreo para suavizar bordes
  const filas = [];
  for (let py = 0; py < tam; py++) {
    const fila = Buffer.alloc(1 + tam * 3);
    for (let px = 0; px < tam; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // Se reduce el dibujo al 80 % y se centra: zona segura de íconos maskable.
          const x = ((px + (sx + 0.5) / SS) / tam) * 64;
          const y = ((py + (sy + 0.5) / SS) / tam) * 64;
          const c = color(32 + (x - 32) / 0.8, 32 + (y - 32) / 0.8);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS;
      fila[1 + px * 3] = r / n;
      fila[2 + px * 3] = g / n;
      fila[3 + px * 3] = b / n;
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0);
  ihdr.writeUInt32BE(tam, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(filas))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, '..', 'public', 'icons');
for (const tam of [192, 512]) {
  fs.writeFileSync(path.join(dir, `icon-${tam}.png`), png(tam));
  console.log(`icons/icon-${tam}.png`);
}
