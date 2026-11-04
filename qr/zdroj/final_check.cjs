// Reads every image of finalcheck/ with jsQR and ZXing, as it is and inverted (a phone sees foil light on the dark
// card, i.e. the plate inverted). Prints J/Z per polarity: "J" jsQR read the right URL, "Z" ZXing did, "-" not.
const fs = require('fs');
const path = require('path');
const { PNG } = require('D:/Projects/TUKE_PLES_27/node_modules/pngjs');
const SP = 'C:/Users/matus/AppData/Local/Temp/claude/D--Projects-TUKE-PLES-27/d52288d5-1ab2-4016-a17b-1e4462120f75/scratchpad';
const jsQR = require(`${SP}/qrcheck/node_modules/jsqr`);
const Z = require(`${SP}/qrcheck/node_modules/@zxing/library`);
const want = 'https://srdcom.tuke.sk/onboarding/';
const dir = path.join(SP, 'finalcheck');
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
  return r ? (r.data === want ? 'J' : '?') : '-';
}
function readZ(png, invert) {
  const src = new Z.RGBLuminanceSource(lum(png, invert), png.width, png.height);
  const hints = new Map([[Z.DecodeHintType.TRY_HARDER, true], [Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.QR_CODE]]]);
  try { return new Z.QRCodeReader().decode(new Z.BinaryBitmap(new Z.HybridBinarizer(src)), hints).getText() === want ? 'Z' : '?'; } catch { return '-'; }
}
console.log('image'.padEnd(52) + 'as is  inverted');
for (const file of Object.keys(manifest)) {
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
  console.log(file.padEnd(52) + (readJ(png, false) + readZ(png, false)).padEnd(7) + readJ(png, true) + readZ(png, true));
}
