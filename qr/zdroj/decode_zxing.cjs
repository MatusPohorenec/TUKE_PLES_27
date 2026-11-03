// A second, independent decoder: ZXing (the engine behind most Android scanner apps). Each design at three sizes;
// "normal" = read as printed, "inverted" = with ZXing told to also try light-on-dark (as phone cameras do).
const fs = require('fs');
const path = require('path');
const { PNG } = require('D:/Projects/TUKE_PLES_27/node_modules/pngjs');
const Z = require('C:/Users/matus/AppData/Local/Temp/claude/D--Projects-TUKE-PLES-27/d52288d5-1ab2-4016-a17b-1e4462120f75/scratchpad/qrcheck/node_modules/@zxing/library');

const want = 'https://srdcom.tuke.sk/onboarding/';
const dir = process.argv[2];

function read(rgba, w, h, inverted) {
  const lum = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
    lum[i] = inverted ? 255 - v : v;
  }
  const source = new Z.RGBLuminanceSource(lum, w, h);
  const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(source));
  const hints = new Map([[Z.DecodeHintType.TRY_HARDER, true], [Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.QR_CODE]]]);
  try { return new Z.QRCodeReader().decode(bitmap, hints).getText() === want; } catch { return false; }
}

const scale = (png, k) => {
  const w = Math.round(png.width * k), h = Math.round(png.height * k), out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x / k), x1 = Math.max(x0 + 1, Math.floor((x + 1) / k)), y0 = Math.floor(y / k), y1 = Math.max(y0 + 1, Math.floor((y + 1) / k));
    const acc = [0, 0, 0, 0]; let n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * png.width + xx) * 4; for (let c = 0; c < 4; c++) acc[c] += png.data[i + c]; n++; }
    for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = acc[c] / n;
  }
  return { data: out, width: w, height: h };
};

for (const file of fs.readdirSync(dir).filter(f => /^\d-.*\.png$/.test(f)).sort()) {
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
  const results = [];
  for (const k of [1, 0.4, 0.25]) {
    const img = k === 1 ? { data: png.data, width: png.width, height: png.height } : scale(png, k);
    results.push(`${img.width}px: ${read(img.data, img.width, img.height, false) ? 'normal OK' : 'normal -'} / ${read(img.data, img.width, img.height, true) ? 'inverted OK' : 'inverted -'}`);
  }
  console.log(file.padEnd(28), results.join(' | '));
}
