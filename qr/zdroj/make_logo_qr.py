# The invitation QR with the TUKE emblem in the middle (the official emblem of tuke.sk, one path, colour #95834d).
# Error correction H carries the emblem: a 9 × 9 module square in the middle is left for it (~7 % of the code).
# Writes: the plain code for screens and ordinary print (black, the emblem in TUKE gold) as SVG + PNG, the foil
# plates (one colour, black = foil) and three mockups on the invitation's blue.   python -I make_logo_qr.py
import math, re, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

S = 'C:/Users/matus/AppData/Local/Temp/claude/D--Projects-TUKE-PLES-27/d52288d5-1ab2-4016-a17b-1e4462120f75/scratchpad'
ROOT = Path('D:/Projects/TUKE_PLES_27/qr')
sys.argv = ['x', f'{S}/qr_matrix.json', f'{S}/fonts', str(ROOT / 'navrhy')]
sys.path.insert(0, S)
import make_designs as md

EMBLEM_D = Path(f'{S}/tuke-logo/logo2.svg').read_text()
EMBLEM_D = re.search(r'\sd="([^"]+)"', EMBLEM_D).group(1)
EMBLEM_BOX = 134.7
TUKE_GOLD = '#95834d'
ROWS = md.QR['H']['rows']
N = len(ROWS)
HOLE = 9           # modules left free in the middle …
EMB = 7            # … and the emblem's size inside it
H0 = (N - HOLE) // 2  # first row/column of the hole (12 for 33 modules)
in_hole = lambda r, c: H0 <= r < H0 + HOLE and H0 <= c < H0 + HOLE


def parse(d):
    """SVG path data (M H V L C Z, absolute and relative) as subpaths of segments in absolute coordinates."""
    toks = re.findall(r'[MmHhVvLlCcZz]|-?(?:\d+\.?\d*|\.\d+)', d)
    subs, cur, start, cmd, i = [], (0.0, 0.0), (0.0, 0.0), None, 0
    num = lambda: float(toks[i])
    while i < len(toks):
        if re.match(r'[A-Za-z]', toks[i]):
            cmd = toks[i]; i += 1
            if cmd in 'Zz':
                subs[-1].append(('Z',)); cur = start; continue
        rel = cmd.islower()
        C = cmd.upper()
        if C == 'M':
            x, y = float(toks[i]), float(toks[i + 1]); i += 2
            if rel: x, y = cur[0] + x, cur[1] + y
            cur = start = (x, y); subs.append([('M', cur)])
            cmd = 'l' if rel else 'L'  # further pairs are lines
        elif C == 'L':
            x, y = float(toks[i]), float(toks[i + 1]); i += 2
            if rel: x, y = cur[0] + x, cur[1] + y
            cur = (x, y); subs[-1].append(('L', cur))
        elif C == 'H':
            x = float(toks[i]); i += 1
            cur = (cur[0] + x if rel else x, cur[1]); subs[-1].append(('L', cur))
        elif C == 'V':
            y = float(toks[i]); i += 1
            cur = (cur[0], cur[1] + y if rel else y); subs[-1].append(('L', cur))
        elif C == 'C':
            v = [float(t) for t in toks[i:i + 6]]; i += 6
            if rel: v = [v[k] + cur[k % 2] for k in range(6)]
            subs[-1].append(('C', (v[0], v[1]), (v[2], v[3]), (v[4], v[5])))
            cur = (v[4], v[5])
    return subs


SUBS = parse(EMBLEM_D)


def flatten(sub, steps=24):
    pts, cur = [], None
    for seg in sub:
        if seg[0] in ('M', 'L'):
            cur = seg[1]; pts.append(cur)
        elif seg[0] == 'C':
            p0, c1, c2, p3 = cur, seg[1], seg[2], seg[3]
            for k in range(1, steps + 1):
                t = k / steps; u = 1 - t
                pts.append((u ** 3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p3[0],
                            u ** 3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p3[1]))
            cur = p3
    return pts


def emblem_mask(size_px):
    """The emblem filled (even-odd: its inner shapes are holes) in a size_px square, supersampled."""
    acc = np.zeros((size_px, size_px), bool)
    k = size_px / EMBLEM_BOX
    for sub in SUBS:
        im = Image.new('L', (size_px, size_px), 0)
        ImageDraw.Draw(im).polygon([(x * k, y * k) for x, y in flatten(sub)], fill=255)
        acc ^= np.asarray(im) > 127
    return Image.fromarray((acc * 255).astype(np.uint8))


def emblem_svg_path(x0, y0, size):
    """The emblem's path in the code's module coordinates (curves kept)."""
    k = size / EMBLEM_BOX
    f = lambda p: f'{x0 + p[0] * k:.3f},{y0 + p[1] * k:.3f}'
    out = []
    for sub in SUBS:
        for seg in sub:
            if seg[0] == 'M': out.append('M' + f(seg[1]))
            elif seg[0] == 'L': out.append('L' + f(seg[1]))
            elif seg[0] == 'C': out.append('C' + ' '.join(f(p) for p in seg[1:]))
            elif seg[0] == 'Z': out.append('Z')
    return ''.join(out)


ROWS_HOLE = [''.join('0' if in_hole(r, c) else ROWS[r][c] for c in range(N)) for r in range(N)]
EMB_X = EMB_Y = (N - EMB) / 2


# ---------------------------------------------------------------------- the plain code (screens, ordinary print)
def plain_svg(size_mm=40):
    q = 4
    vb = N + 2 * q
    total = size_mm * vb / N
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{total:.2f}mm" height="{total:.2f}mm" viewBox="{-q} {-q} {vb} {vb}">\n'
            f'<!-- QR {md.URL} s logom TUKE · oprava chýb H · kód {size_mm} mm, s tichou zónou {total:.1f} mm -->\n'
            f'<rect x="{-q}" y="{-q}" width="{vb}" height="{vb}" fill="#ffffff"/>\n'
            f'<path fill="#000000" fill-rule="evenodd" d="{md.outline(ROWS_HOLE, N)}"/>\n'
            f'<path fill="{TUKE_GOLD}" fill-rule="evenodd" d="{emblem_svg_path(EMB_X, EMB_Y, EMB)}"/>\n</svg>\n')


def plain_png(px=2048):
    q = 4
    vb = N + 2 * q
    m = px / vb
    ss = 2
    img = Image.new('RGB', (px * ss, px * ss), 'white')
    d = ImageDraw.Draw(img)
    for r in range(N):
        for c in range(N):
            if ROWS_HOLE[r][c] == '1':
                d.rectangle([(c + q) * m * ss - 0.5, (r + q) * m * ss - 0.5, (c + q + 1) * m * ss + 0.5, (r + q + 1) * m * ss + 0.5], fill='black')
    em = emblem_mask(round(EMB * m * ss))
    gold = Image.new('RGB', em.size, TUKE_GOLD)
    img.paste(gold, (round((EMB_X + q) * m * ss), round((EMB_Y + q) * m * ss)), em)
    return img.resize((px, px), Image.LANCZOS)


# ---------------------------------------------------------------------- foil plates (one colour, black = foil)
def plate_svg(negative, size_mm=40):
    q = 4
    vb = N + 2 * q
    total = size_mm * vb / N
    rr = lambda x, y, w, h, rad: (f'M{x + rad},{y}h{w - 2 * rad}a{rad},{rad} 0 0 1 {rad},{rad}v{h - 2 * rad}a{rad},{rad} 0 0 1 -{rad},{rad}'
                                  f'h-{w - 2 * rad}a{rad},{rad} 0 0 1 -{rad},-{rad}v-{h - 2 * rad}a{rad},{rad} 0 0 1 {rad},-{rad}z')
    emb = emblem_svg_path(EMB_X, EMB_Y, EMB)
    if negative:  # foil plate; the modules and the emblem are cut out (the paper shows through)
        body = f'<path fill-rule="evenodd" d="{rr(-3, -3, N + 6, N + 6, 1.2)} {md.outline(ROWS_HOLE, N)} {emb}"/>'
        kind = 'negatív: fólia je plôška, kód aj znak TUKE sú vyrezané'
    else:  # foil modules and a foil emblem; the paper around the emblem stays free
        body = f'<path fill-rule="evenodd" d="{md.outline(ROWS_HOLE, N)}"/><path fill-rule="evenodd" d="{emb}"/>'
        kind = 'fólia = moduly kódu a znak TUKE'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{total:.2f}mm" height="{total:.2f}mm" viewBox="{-q} {-q} {vb} {vb}">\n'
            f'<!-- QR {md.URL} s logom TUKE · oprava chýb H · {kind} · čierna = fólia; kód {size_mm} mm, s tichou zónou {total:.1f} mm -->\n'
            f'<g fill="#000">{body}</g>\n</svg>\n')


# ---------------------------------------------------------------------- mockups on the invitation's blue
def put_emblem(c, x_mm, y_mm, size_mm, cut):
    """The emblem into a card's foil mask: as foil (cut=False), or cut out of a foil plate (cut=True)."""
    n_mm = size_mm / N
    hx, hy = c.s(x_mm + H0 * n_mm), c.s(y_mm + H0 * n_mm)
    hw = c.s(HOLE * n_mm)
    c.d.rectangle([hx, hy, hx + hw, hy + hw], fill=255 if cut else 0)  # the hole: plate foil, or bare paper
    em = emblem_mask(round(c.s(EMB * n_mm)))
    ex, ey = round(c.s(x_mm + EMB_X * n_mm)), round(c.s(y_mm + EMB_Y * n_mm))
    c.mask.paste(0 if cut else 255, (ex, ey), em)


def card_silver():
    c = md.Card(seed=21)
    c.text('XXIV. REPREZENTAČNÝ PLES', md.SANS(2.6, 600), 20, track_em=0.32)
    c.text('23 | 01 | 2027', md.SERIF(9.5, 500), 33.5, track_em=0.06)
    c.rule(41, 16, gap_mm=3); c.star(md.W_MM / 2, 41, 1.4)
    c.text('POTVRĎTE SVOJU ÚČASŤ', md.SERIF(4.6, 600), 52, track_em=0.18)
    x = (md.W_MM - 46) / 2
    c.qr('H', x, 60, 46, 'squares')
    put_emblem(c, x, 60, 46, cut=False)
    md.common_footer(c, 118)
    c.text('R.S.V.P. do 13. januára 2027', md.ITALIC(4.6, 500), 135)
    return c.render('silver'), 'Strieborná s logom TUKE', 'znak TUKE v strede kódu, strieborná fólia; svetlý kód na tmavom'


def card_negative():
    c = md.Card(seed=23)
    c.text('TECHNICKÁ UNIVERZITA V KOŠICIACH', md.SANS(2.4, 600), 18, track_em=0.28)
    c.text('Reprezentačný ples', md.ITALIC(8.2, 500), 31)
    c.text('23 | 01 | 2027  ·  DOUBLETREE BY HILTON KOŠICE', md.SANS(2.4, 600), 39.5, track_em=0.12)
    x = (md.W_MM - 42) / 2
    c.qr('H', x, 53, 42, 'plate')
    put_emblem(c, x, 53, 42, cut=True)
    c.text('POTVRĎTE SVOJU ÚČASŤ', md.SERIF(4.4, 600), 113, track_em=0.18)
    c.text('Naskenujte kód alebo navštívte srdcom.tuke.sk', md.SANS(2.55, 600), 121, track_em=0.03)
    c.text('R.S.V.P. do 13. januára 2027', md.ITALIC(4.4, 500), 135)
    return c.render('silver'), 'Negatív s logom TUKE', 'strieborná plôška, kód aj znak TUKE vyrezané: číta ho každý telefón'


def card_gold():
    c = md.Card(seed=22)
    c.text('Reprezentačný ples', md.SCRIPT(12.5), 29)
    c.text('TUKE  ·  23 | 01 | 2027', md.SERIF(4.4, 600), 38.5, track_em=0.12)
    c.text('POTVRĎTE SVOJU ÚČASŤ', md.SANS(2.6, 600), 50, track_em=0.3)
    x = (md.W_MM - 46) / 2
    c.qr('H', x, 58, 46, 'squares')
    put_emblem(c, x, 58, 46, cut=False)
    md.common_footer(c, 116)
    c.rule(127, 9)
    c.text('R.S.V.P. do 13. januára 2027', md.ITALIC(4.4, 500), 135)
    return c.render('gold'), 'Zlatá s logom TUKE', 'znak v zlatej ako farba TUKE, zlatá fólia; svetlý kód na tmavom'


if __name__ == '__main__':
    (ROOT / 'onboarding-logo.svg').write_text(plain_svg(), encoding='utf-8')
    plain_png().save(ROOT / 'onboarding-logo.png', optimize=True)
    (ROOT / 'navrhy' / 'tlac' / 'qr-logo-folia.svg').write_text(plate_svg(False), encoding='utf-8')
    (ROOT / 'navrhy' / 'tlac' / 'qr-logo-negativ.svg').write_text(plate_svg(True), encoding='utf-8')
    cards = [('7-strieborna-logo', card_silver), ('8-negativ-logo', card_negative), ('9-zlata-logo', card_gold)]
    made = []
    for key, fn in cards:
        img, title, note = fn()
        img.save(ROOT / 'navrhy' / f'{key}.png', optimize=True)
        made.append((title, note, img))
        print('mockup', key)
    # a small overview of the three
    from PIL import ImageFilter, ImageFont
    cw, gap, label = 420, 46, 96
    ch = round(cw * md.H / md.W)
    sheet = Image.new('RGB', (3 * cw + 4 * gap, ch + label + 2 * gap), (233, 231, 227))
    sd = ImageDraw.Draw(sheet)
    lf = ImageFont.truetype(f'{S}/fonts/Manrope.ttf', 21); lf.set_variation_by_axes([600])
    nf = ImageFont.truetype(f'{S}/fonts/Manrope.ttf', 15); nf.set_variation_by_axes([500])
    for i, (title, note, img) in enumerate(made):
        x, y = gap + i * (cw + gap), gap
        shadow = Image.new('L', sheet.size, 0)
        ImageDraw.Draw(shadow).rectangle([x + 6, y + 10, x + cw + 6, y + ch + 10], fill=120)
        sheet.paste((150, 146, 140), (0, 0), shadow.filter(ImageFilter.GaussianBlur(12)))
        sheet.paste(img.resize((cw, ch), Image.LANCZOS), (x, y))
        sd.text((x, y + ch + 16), f'{7 + i} · {title}', font=lf, fill=(28, 32, 62))
        line, lines = '', []
        for word in note.split():
            if nf.getlength(f'{line} {word}'.strip()) > cw:
                lines.append(line); line = word
            else:
                line = f'{line} {word}'.strip()
        lines.append(line)
        for k, t in enumerate(lines[:2]):
            sd.text((x, y + ch + 46 + k * 21), t, font=nf, fill=(90, 94, 110))
    sheet.save(ROOT / 'navrhy' / 'prehlad-logo.png', optimize=True)
    print('done')
