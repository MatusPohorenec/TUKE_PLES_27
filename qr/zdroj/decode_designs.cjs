// Reads the QR of every design mockup with jsQR: at full size and scaled down (a phone photo from further away),
// once as a normal code (dark on light) and once as an inverted one (light on dark).
const fs = require('fs');
const path = require('path');
const { PNG } = require('D:/Projects/TUKE_PLES_27/node_modules/pngjs');
const jsQR = require('C:/Users/matus/AppData/Local/Temp/claude/D--Projects-TUKE-PLES-27/d52288d5-1ab2-4016-a17b-1e4462120f75/scratchpad/qrcheck/node_modules/jsqr');

const dir = process.argv[2];
const want = 'https://srdcom.tuke.sk/onboarding/';
const scale = (png, k) => {
  const w = Math.round(png.width * k), h = Math.round(png.height * k), out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // box filter: the average of the source pixels under this one (like a camera sensor)
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
    const img = k === 1 ? { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height } : scale(png, k);
    const normal = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    // jsQR 1.4's own 'onlyInvert' crashes: invert the pixels here and read them as a normal code
    const neg = new Uint8ClampedArray(img.data.length);
    for (let i = 0; i < neg.length; i += 4) { neg[i] = 255 - img.data[i]; neg[i + 1] = 255 - img.data[i + 1]; neg[i + 2] = 255 - img.data[i + 2]; neg[i + 3] = 255; }
    const inverted = jsQR(neg, img.width, img.height, { inversionAttempts: 'dontInvert' });
    const ok = r => r && r.data === want;
    results.push(`${img.width}px: ${ok(normal) ? 'normal OK' : 'normal -'} / ${ok(inverted) ? 'inverted OK' : 'inverted -'}`);
  }
  console.log(file.padEnd(18), results.join(' | '));
}
