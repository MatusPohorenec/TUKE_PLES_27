# Design proposals for the invitation's QR (https://srdcom.tuke.sk/onboarding/): one-colour foil (silver, gold, white)
# on the invitation's midnight-blue paper or frosted vellum, like the printer's draft (V3/V5) and the user's references.
# Writes A6 mockups (PNG), an overview sheet, and the QR element of every style as a one-colour vector SVG for the
# printer (black = the foil plate).   python -I make_designs.py <qr_matrix.json> <fonts dir> <out dir>
import json, math, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

MATRIX, FONTS, OUT = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'tlac').mkdir(exist_ok=True)
QR = json.loads(MATRIX.read_text())
URL = QR['url']

W_MM, H_MM = 105, 148          # A6 card
PX = 12                         # px per mm in the mockup (~305 dpi)
SS = 2                          # supersampling of the foil mask
W, H = W_MM * PX, H_MM * PX
NAVY = (30, 36, 86)             # the printer's midnight blue (draft V3/V5)

FOILS = {
    'silver': [(0.00, (118, 126, 146)), (0.22, (196, 203, 218)), (0.38, (246, 248, 252)), (0.52, (170, 178, 196)),
               (0.70, (226, 231, 241)), (0.86, (140, 148, 168)), (1.00, (205, 211, 225))],
    'gold':   [(0.00, (134, 99, 38)), (0.22, (206, 166, 84)), (0.38, (249, 228, 160)), (0.52, (184, 140, 58)),
               (0.70, (232, 200, 120)), (0.86, (150, 110, 42)), (1.00, (214, 176, 96))],
    'white':  [(0.00, (226, 230, 240)), (0.40, (250, 251, 254)), (0.70, (232, 236, 245)), (1.00, (246, 248, 252))],
}


def font(name, size_mm, wght=None):
    f = ImageFont.truetype(str(FONTS / name), max(1, round(size_mm * PX * SS)))
    if wght:
        f.set_variation_by_axes([wght])
    return f


# copies whose digits are the lining figures (23 | 01 | 2027 like the printer's draft), see the LF fonts
SERIF = lambda s, w=500: font('CormorantGaramond-LF.ttf', s, w)
ITALIC = lambda s, w=500: font('CormorantGaramond-Italic-LF.ttf', s, w)
SANS = lambda s, w=500: font('Manrope.ttf', s, w)
SCRIPT = lambda s: font('GreatVibes.ttf', s)


class Card:
    """An A6 card: a foil mask drawn at SS × resolution on top of a paper (or vellum) background."""

    def __init__(self, paper=NAVY, seed=1):
        self.paper, self.seed = paper, seed
        self.mask = Image.new('L', (W * SS, H * SS), 0)
        self.d = ImageDraw.Draw(self.mask)
        self.keep_out = []  # QR areas (mm) that decorations must leave free

    @staticmethod
    def s(v):
        return v * PX * SS

    # ------------------------------------------------------------------ text
    def text(self, txt, f, y_mm, track_em=0.0, x_mm=W_MM / 2, anchor='ms'):
        """Centred text on a baseline (y_mm); track_em spreads letters (small caps lines)."""
        x, y = self.s(x_mm), self.s(y_mm)
        if not track_em:
            self.d.text((x, y), txt, font=f, fill=255, anchor=anchor)
            return
        track = track_em * f.size
        widths = [f.getlength(ch) for ch in txt]
        total = sum(widths) + track * (len(txt) - 1)
        cx = x - total / 2
        for ch, w in zip(txt, widths):
            self.d.text((cx, y), ch, font=f, fill=255, anchor='ls')
            cx += w + track

    def rule(self, y_mm, half_mm, gap_mm=0.0, width_mm=0.18):
        """A thin centred line, optionally split around an ornament."""
        y, w = self.s(y_mm), max(1, round(self.s(width_mm)))
        cx = self.s(W_MM / 2)
        if gap_mm:
            self.d.line([(cx - self.s(half_mm), y), (cx - self.s(gap_mm), y)], fill=255, width=w)
            self.d.line([(cx + self.s(gap_mm), y), (cx + self.s(half_mm), y)], fill=255, width=w)
        else:
            self.d.line([(cx - self.s(half_mm), y), (cx + self.s(half_mm), y)], fill=255, width=w)

    def star(self, x_mm, y_mm, r_mm, p=2.6, fill=255):
        """A four-pointed star (✦, an astroid-like curve), the light motif of the ball."""
        pts = []
        for i in range(160):
            t = 2 * math.pi * i / 160
            c, s = math.cos(t), math.sin(t)
            pts.append((self.s(x_mm) + self.s(r_mm) * math.copysign(abs(c) ** p, c),
                        self.s(y_mm) + self.s(r_mm) * math.copysign(abs(s) ** p, s)))
        self.d.polygon(pts, fill=fill)

    # ------------------------------------------------------------------ the QR
    def qr(self, level, x_mm, y_mm, size_mm, style='squares', quiet=4, center_star=False, frame=False):
        """The code at (x, y) top left, size_mm without the quiet zone. Styles: squares, rounded, dots, plate."""
        rows = QR[level]['rows']
        n = len(rows)
        m = self.s(size_mm) / n
        ox, oy = self.s(x_mm), self.s(y_mm)
        self.keep_out.append((x_mm - quiet * size_mm / n, y_mm - quiet * size_mm / n,
                              x_mm + size_mm + quiet * size_mm / n, y_mm + size_mm + quiet * size_mm / n))
        finder = lambda r, c: (r < 7 and c < 7) or (r < 7 and c >= n - 7) or (r >= n - 7 and c < 7)
        dark = lambda r, c: rows[r][c] == '1'
        if style == 'plate':
            pad = 3 * m  # a 3-module light quiet zone on the plate itself
            self.d.rounded_rectangle([ox - pad, oy - pad, ox + n * m + pad, oy + n * m + pad], radius=1.2 * m, fill=255)
            for r in range(n):
                for c in range(n):
                    if dark(r, c):
                        self.d.rectangle([ox + c * m, oy + r * m, ox + (c + 1) * m, oy + (r + 1) * m], fill=0)
        else:
            for r in range(n):
                for c in range(n):
                    if not dark(r, c) or (style in ('dots', 'rounded') and finder(r, c)):
                        continue
                    x0, y0 = ox + c * m, oy + r * m
                    if style == 'squares':
                        self.d.rectangle([x0 - 0.3, y0 - 0.3, x0 + m + 0.3, y0 + m + 0.3], fill=255)
                    elif style == 'rounded':
                        k = 0.03 * m  # narrow gaps: the tiles still read as one code in a sharp camera image
                        self.d.rounded_rectangle([x0 + k, y0 + k, x0 + m - k, y0 + m - k], radius=0.30 * m, fill=255)
                    elif style == 'dots':
                        k = 0.03 * m  # nearly touching dots: with wide gaps a sharp camera image falls apart
                        self.d.ellipse([x0 + k, y0 + k, x0 + m - k, y0 + m - k], fill=255)
            if style in ('dots', 'rounded'):
                for fr, fc in ((0, 0), (0, n - 7), (n - 7, 0)):  # the three corner eyes, softly rounded
                    x0, y0 = ox + fc * m, oy + fr * m
                    self.d.rounded_rectangle([x0, y0, x0 + 7 * m, y0 + 7 * m], radius=2.2 * m, fill=255)
                    self.d.rounded_rectangle([x0 + m, y0 + m, x0 + 6 * m, y0 + 6 * m], radius=1.5 * m, fill=0)
                    self.d.rounded_rectangle([x0 + 2 * m, y0 + 2 * m, x0 + 5 * m, y0 + 5 * m], radius=1.0 * m, fill=255)
        if center_star:  # error correction H carries a star over the middle
            cxm, cym = x_mm + size_mm / 2, y_mm + size_mm / 2
            r = 3.1 * size_mm / n
            self.d.ellipse([self.s(cxm) - self.s(r * 1.25), self.s(cym) - self.s(r * 1.25),
                            self.s(cxm) + self.s(r * 1.25), self.s(cym) + self.s(r * 1.25)], fill=0)
            self.star(cxm, cym, r)
        if frame:
            for k, w in ((quiet * 0.85, 0.22), (quiet * 0.85 + 1.0, 0.12)):
                g = k * size_mm / n
                self.d.rectangle([self.s(x_mm - g), self.s(y_mm - g), self.s(x_mm + size_mm + g), self.s(y_mm + size_mm + g)],
                                 outline=255, width=max(1, round(self.s(w))))

    def sprinkle_stars(self, count, seed, avoid_mm):
        """Little lights scattered over the paper, never on the code, its quiet zone or the text bands."""
        rng = np.random.default_rng(seed)
        placed = 0
        while placed < count:
            x, y = rng.uniform(6, W_MM - 6), rng.uniform(6, H_MM - 6)
            if any(a[0] - 2 < x < a[2] + 2 and a[1] - 2 < y < a[3] + 2 for a in self.keep_out + avoid_mm):
                continue
            r = rng.choice([0.25, 0.3, 0.35, 0.5, 0.8, 1.1], p=[0.3, 0.25, 0.2, 0.12, 0.08, 0.05])
            if r < 0.6:
                self.d.ellipse([self.s(x - r), self.s(y - r), self.s(x + r), self.s(y + r)], fill=255)
            else:
                self.star(x, y, r)
            placed += 1

    # ------------------------------------------------------------------ rendering
    def _paper(self, base, seed, glow=False):
        rng = np.random.default_rng(seed)
        img = np.ones((H, W, 3), np.float32) * np.array(base, np.float32)
        coarse = Image.fromarray((rng.normal(0.5, 0.18, (H // 6, W // 6)).clip(0, 1) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
        fine = rng.normal(0, 1, (H, W)).astype(np.float32)
        tex = (np.asarray(coarse, np.float32) / 255 - 0.5) * 0.06 + fine * 0.012
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        r2 = ((xx - W / 2) / (W * 0.75)) ** 2 + ((yy - H / 2) / (H * 0.75)) ** 2
        vign = 1 - 0.22 * r2
        img *= (1 + tex)[..., None] * vign[..., None]
        if glow:  # the blue light of the printer's globe under the vellum
            g = np.exp(-(((xx - W * 0.62) / (W * 0.55)) ** 2 + ((yy - H * 1.02) / (H * 0.30)) ** 2))
            img += g[..., None] * np.array([40, 95, 220], np.float32) * 0.55
        return img

    def _foil(self, stops, seed):
        rng = np.random.default_rng(seed)
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        a = math.radians(32)
        u = (xx * math.cos(a) + yy * math.sin(a)) / (W * math.cos(a) + H * math.sin(a))
        # a smooth back-and-forth sweep through the stops: no hard edge where a band would start again
        t = 0.5 - 0.5 * np.cos(2 * math.pi * (u * 1.15 + 0.1))
        pos = np.array([p for p, _ in stops], np.float32)
        cols = np.array([c for _, c in stops], np.float32)
        img = np.stack([np.interp(t, pos, cols[:, k]) for k in range(3)], -1)
        img *= (1 + rng.normal(0, 0.025, (H, W)).astype(np.float32))[..., None]  # metallic grain
        spec = np.exp(-((u - 0.47) / 0.05) ** 2)  # a soft glint of light across the card
        img += spec[..., None] * 30
        return img

    def render(self, foil='silver', vellum=False, glow=False):
        m = np.asarray(self.mask.resize((W, H), Image.LANCZOS), np.float32) / 255
        paper = self._paper(self.paper, self.seed, glow=glow)
        if vellum:  # frosted vellum laid over the blue card, 5 mm smaller on every side
            inset = 5 * PX
            under = Image.fromarray(paper.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(7))
            frosted = np.asarray(under, np.float32) * 0.66 + 255 * 0.34
            frosted *= (1 + np.random.default_rng(self.seed + 9).normal(0, 0.01, (H, W)).astype(np.float32))[..., None]
            vm = np.zeros((H, W), np.float32)
            vm[inset:H - inset, inset:W - inset] = 1
            shadow = np.asarray(Image.fromarray((vm * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10)), np.float32) / 255
            shadow = np.roll(np.roll(shadow, 6, 0), 4, 1)
            paper *= (1 - 0.35 * shadow * (1 - vm))[..., None]
            edge = vm - np.asarray(Image.fromarray((vm * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)), np.float32) / 255
            paper = paper * (1 - vm[..., None]) + frosted * vm[..., None] + edge[..., None] * 40
        # foil stamping presses into the paper: a soft shadow along its lower right edges
        sh = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6)), np.float32) / 255
        sh = np.roll(np.roll(sh, 2, 0), 1, 1)
        paper *= (1 - 0.45 * sh * (1 - m))[..., None]
        out = paper * (1 - m[..., None]) + self._foil(FOILS[foil], self.seed + 3) * m[..., None]
        return Image.fromarray(out.clip(0, 255).astype(np.uint8))


# ---------------------------------------------------------------------- the designs
def common_footer(c, y_url, foil_note=True):
    c.text('Naskenujte QR kód alebo navštívte', SANS(2.6, 600), y_url, track_em=0.06)
    c.text('srdcom.tuke.sk', SERIF(5.2, 600), y_url + 6.4, track_em=0.04)


def d1():
    """Silver on the printer's blue: their QR block, made for foil."""
    c = Card(seed=11)
    c.text('XXIV. REPREZENTAČNÝ PLES', SANS(2.4, 600), 20, track_em=0.32)
    c.text('23 | 01 | 2027', SERIF(9.5, 500), 33.5, track_em=0.06)
    c.rule(41, 16, gap_mm=3); c.star(W_MM / 2, 41, 1.4)
    c.text('POTVRĎTE SVOJU ÚČASŤ', SERIF(4.6, 600), 52, track_em=0.18)
    c.qr('Q', (W_MM - 46) / 2, 60, 46, 'squares')
    common_footer(c, 118)
    c.text('R.S.V.P. do 13. januára 2027', ITALIC(4.6, 500), 135)
    return c.render('silver'), 'Strieborná fólia na modrej', 'klasický QR, strieborná fólia; čítajú ho telefóny so svetlým kódom na tmavom'


def d2():
    """Gold, the soft rounded code: warmer, like the reference cards."""
    c = Card(seed=12)
    c.text('Reprezentačný ples', SCRIPT(12.5), 29)
    c.text('TUKE  ·  23 | 01 | 2027', SERIF(4.4, 600), 38.5, track_em=0.12)
    c.text('POTVRĎTE SVOJU ÚČASŤ', SANS(2.6, 600), 50, track_em=0.3)
    c.qr('Q', (W_MM - 46) / 2, 58, 46, 'rounded')
    common_footer(c, 116)
    c.rule(127, 9)
    c.text('R.S.V.P. do 13. januára 2027', ITALIC(4.4, 500), 135)
    return c.render('gold'), 'Zlatá fólia, oblý kód', 'zaoblené moduly a „oči“, zlatá fólia; svetlý kód na tmavom'


def d3():
    """The negative: a silver plate with the code cut out. Dark modules on a light field: every scanner reads it."""
    c = Card(seed=13)
    c.text('TECHNICKÁ UNIVERZITA V KOŠICIACH', SANS(2.4, 600), 18, track_em=0.28)
    c.text('Reprezentačný ples', ITALIC(8.2, 500), 31)
    c.text('23 | 01 | 2027  ·  DOUBLETREE BY HILTON KOŠICE', SANS(2.4, 600), 39.5, track_em=0.12)
    c.qr('Q', (W_MM - 42) / 2, 53, 42, 'plate')
    c.text('POTVRĎTE SVOJU ÚČASŤ', SERIF(4.4, 600), 113, track_em=0.18)
    c.text('Naskenujte kód alebo navštívte srdcom.tuke.sk', SANS(2.55, 600), 121, track_em=0.03)
    c.text('R.S.V.P. do 13. januára 2027', ITALIC(4.4, 500), 135)
    return c.render('silver'), 'Negatív: strieborná plôška', 'kód vyrezaný zo striebornej plôšky: tmavý kód na svetlom, číta ho každý telefón'


def d4():
    """Little lights all around and a star in the middle of the code: the map of lights of the ball."""
    c = Card(seed=14)
    c.text('s TUKE', SERIF(4.6, 600), 22, track_em=0.12)
    c.text('rozsvieťme mapu sveta', SCRIPT(11.5), 33)
    c.qr('H', (W_MM - 46) / 2, 50, 46, 'dots', center_star=True)
    c.text('POTVRĎTE SVOJU ÚČASŤ', SANS(2.6, 600), 111, track_em=0.3)
    c.text('srdcom.tuke.sk', SERIF(5.2, 600), 119, track_em=0.04)
    c.text('Tešíme sa na Vás pod hviezdami', ITALIC(4.4, 500), 134)
    c.sprinkle_stars(46, 7, avoid_mm=[(14, 14, 91, 37), (14, 103, 91, 138)])
    return c.render('silver'), 'Hviezdy a svetielka', 'bodkovaný kód s hviezdou v strede (vyššia oprava chýb H), striebro'


def d5():
    """Frosted vellum over the blue card with the globe's light, like the printer's V3."""
    c = Card(seed=15)
    c.text('XXIV. REPREZENTAČNÝ PLES', SANS(2.5, 600), 21, track_em=0.3)
    c.text('23 | 01 | 2027', SERIF(9, 500), 33.5, track_em=0.06)
    c.text('POTVRĎTE SVOJU ÚČASŤ', SERIF(4.4, 600), 47, track_em=0.18)
    c.qr('Q', (W_MM - 44) / 2, 55, 44, 'squares')
    common_footer(c, 111)
    c.text('R.S.V.P. do 13. januára 2027', ITALIC(4.4, 500), 130)
    return c.render('white', vellum=True, glow=True), 'Pauzák nad modrou', 'biela fólia na matnom pauzáku, pod ním modrá karta so svetlom zemegule'


def d6():
    """A full R.S.V.P. insert card in gold with a double frame around the code."""
    c = Card(seed=16)
    c.text('REKTOR TECHNICKEJ UNIVERZITY V KOŠICIACH', SANS(2.35, 600), 15, track_em=0.18)
    c.text('Vás pozýva na', ITALIC(4.4, 500), 22)
    c.text('XXIV. REPREZENTAČNÝ PLES', SERIF(5.4, 600), 31, track_em=0.08)
    c.text('23 | 01 | 2027', SERIF(7.6, 500), 41.5, track_em=0.06)
    c.text('HOTEL DOUBLETREE BY HILTON KOŠICE', SANS(2.35, 600), 48, track_em=0.18)
    c.qr('Q', (W_MM - 38) / 2, 59, 38, 'squares', frame=True)
    c.text('POTVRĎTE SVOJU ÚČASŤ DO 13. JANUÁRA 2027', SANS(2.45, 600), 115, track_em=0.1)
    c.text('Naskenujte QR kód alebo navštívte srdcom.tuke.sk', ITALIC(4.2, 500), 122.5)
    c.rule(130, 11, gap_mm=2.6); c.star(W_MM / 2, 130, 1.2)
    c.text('75 rokov TUKE', ITALIC(6.2, 500), 140)
    return c.render('gold'), 'Kartička R.S.V.P. v zlatom', 'celá vkladacia kartička, kód v dvojitom rámiku, zlatá fólia'


DESIGNS = [('1-strieborna', d1), ('2-zlata-obla', d2), ('3-negativ', d3), ('4-hviezdy', d4), ('5-pauzak', d5), ('6-rsvp-zlata', d6)]


# ---------------------------------------------------------------------- vector foil plates for the printer
def outline(rows, n):
    """The dark modules as closed outlines (edges between two dark modules cancel): one seamless shape per region."""
    edges = {}
    for r in range(n):
        for c in range(n):
            if rows[r][c] != '1':
                continue
            for a, b in (((c, r), (c + 1, r)), ((c + 1, r), (c + 1, r + 1)), ((c + 1, r + 1), (c, r + 1)), ((c, r + 1), (c, r))):
                if (b, a) in edges:
                    del edges[(b, a)]  # shared with the neighbour
                else:
                    edges[(a, b)] = True
    starts = {}
    for a, b in edges:
        starts.setdefault(a, []).append(b)
    loops = []
    while starts:
        a = next(iter(starts))
        loop = [a]
        while True:
            b = starts[a].pop()
            if not starts[a]:
                del starts[a]
            if b == loop[0]:
                break
            loop.append(b)
            a = b
        # drop points in the middle of straight runs
        pts = [p for i, p in enumerate(loop)
               if not ((loop[i - 1][0] == p[0] == loop[(i + 1) % len(loop)][0]) or (loop[i - 1][1] == p[1] == loop[(i + 1) % len(loop)][1]))]
        loops.append('M' + 'L'.join(f'{x},{y}' for x, y in pts) + 'Z')
    return ' '.join(loops)


def svg_qr(level, style, center_star=False, frame=False, size_mm=40):
    rows = QR[level]['rows']
    n = len(rows)
    q = 4
    dark = lambda r, c: rows[r][c] == '1'
    finder = lambda r, c: (r < 7 and c < 7) or (r < 7 and c >= n - 7) or (r >= n - 7 and c < 7)
    parts = []
    rr = lambda x, y, w, h, rad: (f'M{x + rad},{y}h{w - 2 * rad}a{rad},{rad} 0 0 1 {rad},{rad}v{h - 2 * rad}a{rad},{rad} 0 0 1 -{rad},{rad}'
                                  f'h-{w - 2 * rad}a{rad},{rad} 0 0 1 -{rad},-{rad}v-{h - 2 * rad}a{rad},{rad} 0 0 1 {rad},-{rad}z')
    if style == 'plate':  # the plate with the dark modules cut out as seamless outlines
        parts.append(f'<path fill-rule="evenodd" d="{rr(-3, -3, n + 6, n + 6, 1.2)} {outline(rows, n)}"/>')
    elif style == 'squares':
        parts.append(f'<path fill-rule="evenodd" d="{outline(rows, n)}"/>')
    else:
        d = []
        for r in range(n):
            for c in range(n):
                if not dark(r, c) or finder(r, c):
                    continue
                if style == 'rounded':
                    d.append(rr(c + 0.03, r + 0.03, 0.94, 0.94, 0.30))
                if style == 'dots':
                    d.append(f'M{c + 0.5},{r + 0.03}a0.47,0.47 0 1 1 0,0.94a0.47,0.47 0 1 1 0,-0.94z')
        if style != 'squares':
            for fr, fc in ((0, 0), (0, n - 7), (n - 7, 0)):
                d.append(rr(fc, fr, 7, 7, 2.2))
                d.append(rr(fc + 1, fr + 1, 5, 5, 1.5))  # the hole (evenodd)
                d.append(rr(fc + 2, fr + 2, 3, 3, 1.0))
        parts.append(f'<path fill-rule="evenodd" d="{" ".join(d)}"/>')
    if center_star:
        cx = cy = n / 2
        r = 3.1
        pts = []
        for i in range(160):
            t = 2 * math.pi * i / 160
            ct, st = math.cos(t), math.sin(t)
            pts.append(f'{cx + r * math.copysign(abs(ct) ** 2.6, ct):.3f},{cy + r * math.copysign(abs(st) ** 2.6, st):.3f}')
        # the circle behind the star stays empty: a hole cut through the dots
        parts = [p.replace('<path fill-rule="evenodd" d="', f'<path fill-rule="evenodd" clip-path="url(#nostar)" d="') for p in parts]
        parts.insert(0, f'<defs><clipPath id="nostar"><path clip-rule="evenodd" d="M-5,-5h{n + 10}v{n + 10}h-{n + 10}z M{cx + r * 1.25},{cy} a{r * 1.25},{r * 1.25} 0 1 0 -{2 * r * 1.25},0 a{r * 1.25},{r * 1.25} 0 1 0 {2 * r * 1.25},0z"/></clipPath></defs>')
        parts.append(f'<polygon points="{" ".join(pts)}"/>')
    if frame:
        for k, w in ((q * 0.85, 0.16), (q * 0.85 + 0.75, 0.09)):
            parts.append(f'<rect x="{-k}" y="{-k}" width="{n + 2 * k}" height="{n + 2 * k}" fill="none" stroke="#000" stroke-width="{w}"/>')
    vb = n + 2 * q
    total_mm = size_mm * vb / n
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_mm:.2f}mm" height="{total_mm:.2f}mm" viewBox="{-q} {-q} {vb} {vb}">\n'
            f'<!-- QR {URL} · {style} · oprava chýb {level} · čierna = fólia (strieborná/zlatá/biela); kód {size_mm} mm, s tichou zónou {total_mm:.1f} mm -->\n'
            f'<g fill="#000">{"".join(parts)}</g>\n</svg>\n')


PLATES = [
    ('qr-klasicky.svg', svg_qr('Q', 'squares')),
    ('qr-obly.svg', svg_qr('Q', 'rounded')),
    ('qr-negativ.svg', svg_qr('Q', 'plate')),
    ('qr-bodky-hviezda.svg', svg_qr('H', 'dots', center_star=True)),
    ('qr-ramik.svg', svg_qr('Q', 'squares', frame=True)),
]

if __name__ == '__main__':
    made = []
    for key, fn in DESIGNS:
        img, title, note = fn()
        img.save(OUT / f'{key}.png', optimize=True)
        made.append((key, title, note, img))
        print('mockup', key, img.size)
    for name, svg in PLATES:
        (OUT / 'tlac' / name).write_text(svg, encoding='utf-8')
        print('plate', name, len(svg))
    # the overview: the six cards on a light table, with their names
    cw, gap, label = 420, 46, 96
    ch = round(cw * H / W)
    sheet = Image.new('RGB', (3 * cw + 4 * gap, 2 * (ch + label) + 3 * gap), (233, 231, 227))
    sd = ImageDraw.Draw(sheet)
    lf = ImageFont.truetype(str(FONTS / 'Manrope.ttf'), 21); lf.set_variation_by_axes([600])
    nf = ImageFont.truetype(str(FONTS / 'Manrope.ttf'), 15); nf.set_variation_by_axes([500])
    for i, (key, title, note, img) in enumerate(made):
        x = gap + (i % 3) * (cw + gap)
        y = gap + (i // 3) * (ch + label + gap)
        shadow = Image.new('L', sheet.size, 0)
        ImageDraw.Draw(shadow).rectangle([x + 6, y + 10, x + cw + 6, y + ch + 10], fill=120)
        shadow = shadow.filter(ImageFilter.GaussianBlur(12))
        sheet.paste((150, 146, 140), (0, 0), shadow)
        sheet.paste(img.resize((cw, ch), Image.LANCZOS), (x, y))
        sd.text((x, y + ch + 16), f'{i + 1} · {title}', font=lf, fill=(28, 32, 62))
        line, lines = '', []  # the note on up to two lines of the card's width
        for word in note.split():
            if nf.getlength(f'{line} {word}'.strip()) > cw:
                lines.append(line); line = word
            else:
                line = f'{line} {word}'.strip()
        lines.append(line)
        for k, text in enumerate(lines[:2]):
            sd.text((x, y + ch + 46 + k * 21), text, font=nf, fill=(90, 94, 110))
    sheet.save(OUT / 'prehlad.png', optimize=True)
    print('sheet', sheet.size)
