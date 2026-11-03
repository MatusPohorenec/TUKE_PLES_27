// Reference matrices from the qrcode library (byte mode, every mask) to check qrcore.py against.
const QRCode = require('D:/Projects/TUKE_PLES_27/node_modules/qrcode');
const url = 'https://srdcom.tuke.sk/onboarding/';
const out = {};
for (const [version, ecl] of [[5, 'L'], [7, 'L'], [7, 'H'], [8, 'L'], [6, 'Q']]) {
  for (let mask = 0; mask < 8; mask++) {
    const qr = QRCode.create([{ data: url, mode: 'byte' }], { errorCorrectionLevel: ecl, version, maskPattern: mask });
    const n = qr.modules.size, rows = [];
    for (let y = 0; y < n; y++) rows.push(Array.from({ length: n }, (_, x) => (qr.modules.get(y, x) ? 1 : 0)).join(''));
    out[`${version}${ecl}${mask}`] = rows;
  }
}
require('fs').writeFileSync(process.argv[2], JSON.stringify(out));
console.log(Object.keys(out).length, 'matrices');
