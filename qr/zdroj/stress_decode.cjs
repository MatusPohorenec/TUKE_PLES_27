// Reads every stress image with jsQR and ZXing in the polarity a phone would see (light codes on dark are inverted
// first, as phone scanners do) and prints a table: design x condition, "JZ" = both read it, "J-"/"-Z" = one, "--" none.
const fs = require('fs');
const path = require('path');
const { PNG } = require('D:/Projects/TUKE_PLES_27/node_modules/pngjs');
const SP = 'C:/Users/matus/AppData/Local/Temp/claude/D--Projects-TUKE-PLES-27/d52288d5-1ab2-4016-a17b-1e4462120f75/scratchpad';
const jsQR = require(`${SP}/qrcheck/node_modules/jsqr`);
const Z = require(`${SP}/qrcheck/node_modules/@zxing/library`);
const want = 'https://srdcom.tuke.sk/onboarding/';
const dir = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

function lum(png, invert) {
  const n = png.width * png.height, out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const v = (png.data[i * 4] * 299 + png.data[i * 4 + 1] * 587 + png.data[i * 4 + 2] * 114) / 1000;
    out[i] = invert ? 255 - v : v;
  }
  return out;
}
function readJ(png, invert) {
  const l = lum(png, invert), rgba = new Uint8ClampedArray(l.length * 4);
  for (let i = 0; i < l.length; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = l[i]; rgba[i * 4 + 3] = 255; }
  const r = jsQR(rgba, png.width, png.height, { inversionAttempts: 'dontInvert' });
  return !!(r && r.data === want);
}
function readZ(png, invert) {
  const src = new Z.RGBLuminanceSource(lum(png, invert), png.width, png.height);
  const hints = new Map([[Z.DecodeHintType.TRY_HARDER, true], [Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.QR_CODE]]]);
  try { return new Z.QRCodeReader().decode(new Z.BinaryBitmap(new Z.HybridBinarizer(src)), hints).getText() === want; } catch { return false; }
}

const table = {}, conds = [];
for (const [file, pol] of Object.entries(manifest)) {
  const [design, cond] = file.replace('.png', '').split('__');
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
  const inv = pol === 'inverted';
  (table[design] ||= {})[cond] = (readJ(png, inv) ? 'J' : '-') + (readZ(png, inv) ? 'Z' : '-');
  if (!conds.includes(cond)) conds.push(cond);
}
console.log('design'.padEnd(22) + conds.map(c => c.padStart(9)).join('') + '   both  one');
for (const [design, row] of Object.entries(table)) {
  const cells = conds.map(c => row[c] || '  ');
  const both = cells.filter(c => c === 'JZ').length, one = cells.filter(c => c === 'J-' || c === '-Z').length;
  console.log(design.padEnd(22) + cells.map(c => c.padStart(9)).join('') + `   ${String(both).padStart(2)}/${conds.length}  ${one}`);
}
