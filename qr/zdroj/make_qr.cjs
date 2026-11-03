// The QR code of the invitations: https://srdcom.tuke.sk/onboarding/ as SVG (print) and PNG (2048 px), black on white,
// error correction Q (25 % of the code may be damaged), quiet zone of 4 modules.
const fs = require('fs');
const path = require('path');
const QRCode = require('D:/Projects/TUKE_PLES_27/node_modules/qrcode');

const url = 'https://srdcom.tuke.sk/onboarding/';
const out = 'D:/Projects/TUKE_PLES_27/qr';
const opts = { errorCorrectionLevel: 'Q', margin: 4, color: { dark: '#000000', light: '#ffffff' } };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const svg = await QRCode.toString(url, { ...opts, type: 'svg' });
  fs.writeFileSync(path.join(out, 'onboarding.svg'), svg);
  await QRCode.toFile(path.join(out, 'onboarding.png'), url, { ...opts, type: 'png', width: 2048 });
  const info = QRCode.create(url, { errorCorrectionLevel: 'Q' });
  console.log(JSON.stringify({ url, version: info.version, modules: info.modules.size, svgBytes: svg.length, png: fs.statSync(path.join(out, 'onboarding.png')).size }));
})();
