// Why ZXing fails: NotFound (no code located), Format (format info), Checksum (too many errors) per stress image.
const fs = require('fs'); const path = require('path');
const { PNG } = require('D:/Projects/TUKE_PLES_27/node_modules/pngjs');
const SP = 'C:/Users/matus/AppData/Local/Temp/claude/D--Projects-TUKE-PLES-27/d52288d5-1ab2-4016-a17b-1e4462120f75/scratchpad';
const Z = require(`${SP}/qrcheck/node_modules/@zxing/library`);
const dir = process.argv[2]; const only = process.argv[3] || '';
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
for (const [file, pol] of Object.entries(manifest)) {
  if (!file.includes(only)) continue;
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
  const n = png.width * png.height, l = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) { const v = (png.data[i*4]*299 + png.data[i*4+1]*587 + png.data[i*4+2]*114) / 1000; l[i] = pol === 'inverted' ? 255 - v : v; }
  const hints = new Map([[Z.DecodeHintType.TRY_HARDER, true], [Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.QR_CODE]]]);
  let res;
  try { res = 'OK ' + new Z.QRCodeReader().decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(l, png.width, png.height))), hints).getText().length; }
  catch (e) { res = e.constructor.name || e.name || String(e); }
  console.log(file.padEnd(44), `${png.width}x${png.height}`.padEnd(10), res);
}
