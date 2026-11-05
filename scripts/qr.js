// Genera los códigos QR del trifoliar. Uso: node scripts/qr.js
//  - public/trifoliar/qr-app.svg        → abre la app (va en la portada del trifoliar)
//  - public/trifoliar/qr-trifoliar.svg  → abre el trifoliar (para la diapositiva de la presentación)
//  - qr-trifoliar.png (raíz del repo)   → el mismo QR en PNG grande, para pegarlo en las diapositivas
const QRCode = require('qrcode');
const path = require('path');

const BASE = 'https://berman-05.github.io/migrared/';
const dir = path.join(__dirname, '..', 'public', 'trifoliar');
const opciones = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0b2e2a', light: '#ffffff' } };

(async () => {
  await QRCode.toFile(path.join(dir, 'qr-app.svg'), BASE, { ...opciones, type: 'svg' });
  await QRCode.toFile(path.join(dir, 'qr-trifoliar.svg'), BASE + 'trifoliar/', { ...opciones, type: 'svg' });
  await QRCode.toFile(path.join(__dirname, '..', 'qr-trifoliar.png'), BASE + 'trifoliar/', { ...opciones, type: 'png', width: 1200 });
  console.log('QR generados');
})();
