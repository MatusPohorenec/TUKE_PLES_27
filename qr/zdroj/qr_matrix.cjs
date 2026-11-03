// Dumps the QR module matrices of the invitation URL (error correction Q and H) as JSON for the design scripts.
const QRCode = require('D:/Projects/TUKE_PLES_27/node_modules/qrcode');
const url = 'https://srdcom.tuke.sk/onboarding/';
const out = {};
for (const level of ['Q', 'H']) {
  const qr = QRCode.create(url, { errorCorrectionLevel: level });
  const n = qr.modules.size;
  const rows = [];
  for (let y = 0; y < n; y++) rows.push(Array.from({ length: n }, (_, x) => qr.modules.get(y, x) ? 1 : 0).join(''));
  out[level] = { version: qr.version, size: n, rows };
}
out.url = url;
require('fs').writeFileSync(process.argv[2], JSON.stringify(out));
console.log(Object.entries(out).filter(([k]) => k !== 'url').map(([k, v]) => `${k}: version ${v.version}, ${v.size} modules`).join('; '));
