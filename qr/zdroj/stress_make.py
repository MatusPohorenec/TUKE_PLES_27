# Hard conditions for every QR design, normalised to the same module size: small (2-4 px per module), blur,
# noise, low contrast, uneven light, rotation, perspective, JPEG, and all of it at once.
#   python -I stress_make.py <out dir>
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
Q = Path('D:/Projects/TUKE_PLES_27/qr')
S = Path('C:/Users/matus/AppData/Local/Temp/claude/D--Projects-TUKE-PLES-27/d52288d5-1ab2-4016-a17b-1e4462120f75/scratchpad')
CARD_PX = 12  # px per mm in the mockups


def crop_card(path, x_mm, y_mm, size_mm, margin_mm=6):
    im = Image.open(path).convert('RGB')
    a = CARD_PX
    return im.crop((round((x_mm - margin_mm) * a), round((y_mm - margin_mm) * a),
                    round((x_mm + size_mm + margin_mm) * a), round((y_mm + size_mm + margin_mm) * a)))


def plain_gold():
    """The classic code (Q, 33 modules) in the TUKE gold on white: the colour alone, without the emblem."""
    import json
    rows = json.loads((S / 'qr_matrix.json').read_text())['Q']['rows']
    n, m = len(rows), 30
    im = Image.new('RGB', ((n + 8) * m, (n + 8) * m), 'white')
    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    for r in range(n):
        for c in range(n):
            if rows[r][c] == '1':
                d.rectangle([(c + 4) * m, (r + 4) * m, (c + 5) * m - 1, (r + 5) * m - 1], fill=(149, 131, 77))
    return im


# name -> (image, px per module, polarity the phone sees)
DESIGNS = {
    'qr-klasicky-zlaty': (plain_gold(), 30, 'normal'),
    'navrh1-strieborny': (crop_card(Q / 'navrhy/1-strieborna.png', 29.5, 60, 46), 46 * CARD_PX / 33, 'inverted'),
    'navrh3-negativ': (crop_card(Q / 'navrhy/3-negativ.png', 31.5, 53, 42), 42 * CARD_PX / 33, 'normal'),
    'navrh9-zlaty-logo': (crop_card(Q / 'navrhy/9-zlata-logo.png', 29.5, 58, 46), 46 * CARD_PX / 33, 'inverted'),
    'erb-zlaty': (Image.open(Q / 'onboarding-tuke-erb.png').convert('RGB'), 2048 / 65, 'normal'),
    'erb-cierny': (Image.open(Q / 'onboarding-tuke-erb-cierny.png').convert('RGB'), 2048 / 65, 'normal'),
    'erb-folia-zlata': (crop_card(Q / 'navrhy/10-zlaty-erb.png', 27.5, 53, 50), 50 * CARD_PX / 57, 'inverted'),
    'erb-folia-striebro': (crop_card(Q / 'navrhy/11-strieborny-erb.png', 27.5, 57, 50), 50 * CARD_PX / 57, 'inverted'),
    'erb-negativ-folia': (crop_card(Q / 'navrhy/12-negativ-erb.png', 27.5, 50, 50), 50 * CARD_PX / 57, 'normal'),
    'erb-tlac-zlata': (crop_card(Q / 'navrhy/13-erb-tlac.png', 27.5, 50, 50), 50 * CARD_PX / 57, 'normal'),
    'proto-v7-zlate-ciary': (Image.open(S / 'emblem/71.5squares/3-v7-gap1.5-squares.png').convert('RGB'), 99.5 / 45 * 900 / 134.7, 'normal'),
    'qr-klasicky-Q': (Image.open(Q / 'onboarding.png').convert('RGB'), 2048 / 41, 'normal'),
    'qr-logo-v-strede-H': (Image.open(Q / 'onboarding-logo.png').convert('RGB'), 2048 / 41, 'normal'),
}


def at(img, mpx, target):
    k = target / mpx
    return img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.BOX)


def arr(im):
    return np.asarray(im, np.float32)


def img(a):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def variants(im, mpx, seed):
    rng = np.random.default_rng(seed)
    bg = im.getpixel((2, 2))
    v = {}
    for t in (4, 3, 2.5, 2):
        v[f's{t}'] = at(im, mpx, t)
    b6 = at(im, mpx, 6)
    v['blur0.4'] = b6.filter(ImageFilter.GaussianBlur(6 * 0.4))
    v['blur0.6'] = b6.filter(ImageFilter.GaussianBlur(6 * 0.6))
    b4 = at(im, mpx, 4)
    v['noise35'] = img(arr(b4) + rng.normal(0, 35, arr(b4).shape))
    v['contrast'] = img(arr(b4) * 0.35 + 255 * 0.33)
    h, w = arr(b4).shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    v['light'] = img(arr(b4) * (0.3 + 0.7 * (xx + yy) / (w + h))[..., None])
    b5 = at(im, mpx, 5)
    v['rot20'] = b5.rotate(20, resample=Image.BICUBIC, expand=True, fillcolor=bg)
    W, H = b5.size
    # a real perspective (camera tilted, top farther away): output corners -> input points, solved as a homography
    src = [(0, 0), (W, 0), (W, H), (0, H)]
    dst = [(-0.15 * W, -0.04 * H), (1.15 * W, -0.04 * H), (W, H), (0, H)]
    A, bvec = [], []
    for (x, y), (u, w) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); bvec.append(u)
        A.append([0, 0, 0, x, y, 1, -w * x, -w * y]); bvec.append(w)
    coeffs = np.linalg.solve(np.array(A, float), np.array(bvec, float))
    v['persp'] = b5.transform((W, H), Image.PERSPECTIVE, tuple(coeffs), resample=Image.BICUBIC, fillcolor=bg)
    import io
    buf = io.BytesIO(); at(im, mpx, 3).save(buf, 'JPEG', quality=30); v['jpeg30'] = Image.open(io.BytesIO(buf.getvalue())).convert('RGB')
    c = at(im, mpx, 3.5).filter(ImageFilter.GaussianBlur(3.5 * 0.35))
    c = img(arr(c) + rng.normal(0, 20, arr(c).shape))
    buf = io.BytesIO(); c.save(buf, 'JPEG', quality=50); v['combo'] = Image.open(io.BytesIO(buf.getvalue())).convert('RGB')
    return v


manifest = {}
for i, (name, (im, mpx, pol)) in enumerate(DESIGNS.items()):
    for key, vim in variants(im, mpx, 7 + i).items():
        f = f'{name}__{key}.png'
        vim.save(OUT / f)
        manifest[f] = pol
import json
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=0))
print(len(manifest), 'images')
