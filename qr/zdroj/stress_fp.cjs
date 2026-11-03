// The finder pattern candidates ZXing sees in a stress image (position, module size, how often confirmed).
const fs = require('fs');
const { PNG } = require('D:/Projects/TUKE_PLES_27/node_modules/pngjs');
const SP = 'C:/Users/matus/AppData/Local/Temp/claude/D--Projects-TUKE-PLES-27/d52288d5-1ab2-4016-a17b-1e4462120f75/scratchpad';
const Z = require(`${SP}/qrcheck/node_modules/@zxing/library`);
const FPF = require(`${SP}/qrcheck/node_modules/@zxing/library/cjs/core/qrcode/detector/FinderPatternFinder.js`).default;
const DET = require(`${SP}/qrcheck/node_modules/@zxing/library/cjs/core/qrcode/detector/Detector.js`).default;
for (const [file, pol] of process.argv.slice(2).map(a => a.split(':'))) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const n = png.width * png.height, l = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) { const v = (png.data[i*4]*299 + png.data[i*4+1]*587 + png.data[i*4+2]*114) / 1000; l[i] = pol === 'inverted' ? 255 - v : v; }
  const bm = new Z.HybridBinarizer(new Z.RGBLuminanceSource(l, png.width, png.height)).getBlackMatrix();
  const hints = new Map([[Z.DecodeHintType.TRY_HARDER, true]]);
  const f = new FPF(bm, null);
  let info = 'found 3';
  try { f.find(hints); } catch (e) { info = 'find: ' + (e.constructor.name || e); }
  const cs = (f.getPossibleCenters ? f.getPossibleCenters() : f.possibleCenters) || [];
  console.log(file.split('/').pop(), `${png.width}px`, info);
  for (const c of cs) console.log('   ', c.getX().toFixed(1), c.getY().toFixed(1), 'module', c.getEstimatedModuleSize().toFixed(2), 'count', c.getCount());
  try { const r = new DET(bm).detect(hints); console.log('   detect OK, points', r.getPoints().map(p => `${p.getX().toFixed(0)},${p.getY().toFixed(0)}`).join(' ')); }
  catch (e) { console.log('   detect:', e.constructor.name || e); }
}
