// Reads the generated QR back with an independent decoder (jsQR), at full size and scaled down like a small print.
const fs = require('fs');
const { PNG } = require('D:/Projects/TUKE_PLES_27/node_modules/pngjs');
const jsQR = require('C:/Users/matus/AppData/Local/Temp/claude/D--Projects-TUKE-PLES-27/d52288d5-1ab2-4016-a17b-1e4462120f75/scratchpad/qrcheck/node_modules/jsqr');

const png = PNG.sync.read(fs.readFileSync('D:/Projects/TUKE_PLES_27/qr/onboarding.png'));
const full = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
console.log('full size', png.width, 'px:', full ? JSON.stringify(full.data) : 'NOT READ');

// nearest-neighbour downscale to 150 px (about 1.3 cm at 300 dpi): still readable?
const size = 150, small = new Uint8ClampedArray(size * size * 4);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const sx = Math.floor((x * png.width) / size), sy = Math.floor((y * png.height) / size);
  for (let c = 0; c < 4; c++) small[(y * size + x) * 4 + c] = png.data[(sy * png.width + sx) * 4 + c];
}
const tiny = jsQR(small, size, size);
console.log('scaled to', size, 'px:', tiny ? JSON.stringify(tiny.data) : 'NOT READ');
