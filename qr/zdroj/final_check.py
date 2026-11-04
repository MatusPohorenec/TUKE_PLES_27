# Checks the final plates: (1) the PDF rendered by Poppler against an independent raster of the same grid (emblem_qr),
# (2) the thinnest foil and the narrowest gap, (3) writes scaled copies for the QR readers (final_check.cjs).
import json, sys
from pathlib import Path
S = 'C:/Users/matus/AppData/Local/Temp/claude/D--Projects-TUKE-PLES-27/d52288d5-1ab2-4016-a17b-1e4462120f75/scratchpad'
sys.path.insert(0, S)
sys.path.insert(0, 'D:/Projects/TUKE_PLES_27/qr/zdroj')
import numpy as np
from PIL import Image
from scipy import ndimage
sys.argv = ['x']
import emblem_qr as eq
import final_print as fp

OUT = fp.OUT
CHK = Path(S) / 'finalcheck'
CHK.mkdir(exist_ok=True)

# (1) Poppler's render of the PDF vs emblem_qr's own raster of the grid, at 21 px per module
px, m = 65 * 21, 21
ref_pos = np.asarray(eq.flat_png(px, (0, 0, 0)).convert('L'), np.int16)
neg = Image.new('L', (px, px), 255)
neg.paste(0, (4 * m, 4 * m), eq.negative_mask(57 * m))
ref_neg = np.asarray(neg, np.int16)
for name, ref in (('qr-erb', ref_pos), ('qr-erb-negativ', ref_neg)):
    got = np.asarray(fp.render(OUT / f'{name}.pdf', px), np.int16)
    d = np.abs(got - ref)
    flip = (got < 128) != (ref < 128)
    lab, nlab = ndimage.label(flip)
    big = max((np.sum(lab == i) for i in range(1, nlab + 1)), default=0)
    print(f'{name}: mean |diff| {d.mean():.3f}, >64: {np.mean(d > 64) * 100:.3f} %, black/white flips {flip.sum()} px '
          f'({flip.sum() / max(1, (ref < 128).sum()) * 100:.3f} % of the ink) in {nlab} spots, largest {big} px, max {d.max()}')

# (2) thinnest foil / narrowest gap on the 2730 px PNG (1 px = 0.0209 mm): opening/closing with k x k squares
mm_per_px = fp.SIDE / fp.PT_PER_MM / 2730
for name in ('qr-erb', 'qr-erb-negativ'):
    g = np.asarray(Image.open(OUT / f'{name}.png').convert('L'))
    print(f'{name}.png: size {g.shape}, min {g.min()}, max {g.max()}, dpi {Image.open(OUT / f"{name}.png").info.get("dpi")}')
    foil = g < 128
    for k in (5, 7, 10, 14, 21):
        st = np.ones((k, k), bool)
        thin = foil & ~ndimage.binary_opening(foil, st)
        gap = ndimage.binary_closing(foil, st) & ~foil
        lt, nt = ndimage.label(thin)
        lg, ng = ndimage.label(gap)
        bt = max((np.sum(lt == i) for i in range(1, nt + 1)), default=0)
        bg = max((np.sum(lg == i) for i in range(1, ng + 1)), default=0)
        print(f'   k={k:2d} ({k * mm_per_px:.2f} mm): foil thinner {thin.sum():6d} px in {nt:3d} spots (largest {bt:4d}), '
              f'gaps narrower {gap.sum():6d} px in {ng:3d} spots (largest {bg:4d})')

# (3) copies for the readers: plates at several sizes, a direct Poppler render at an odd size, the colour previews
manifest = {}
for name in ('qr-erb', 'qr-erb-negativ'):
    im = Image.open(OUT / f'{name}.png').convert('RGB')
    for size in (2730, 1365, 900, 600, 400, 300, 200):
        f = f'{name}__{size}.png'
        (im if size == 2730 else im.resize((size, size), Image.LANCZOS)).save(CHK / f)
        manifest[f] = name
    fp.render(OUT / f'{name}.pdf', 777).convert('RGB').save(CHK / f'{name}__pdf777.png')
    manifest[f'{name}__pdf777.png'] = name
for dst in fp.PREVIEWS.values():
    im = Image.open(OUT / dst).convert('RGB')
    im.save(CHK / f'{dst[:-4]}__full.png')
    im.resize((630, 888), Image.LANCZOS).save(CHK / f'{dst[:-4]}__half.png')
    manifest[f'{dst[:-4]}__full.png'] = manifest[f'{dst[:-4]}__half.png'] = dst
(CHK / 'manifest.json').write_text(json.dumps(manifest, indent=1))
print('decode inputs', len(manifest), '->', CHK)
