# The invitation QR in the shape of the TUKE emblem: the code fills the shield and the emblem's own lines run through it.
#
# The official emblem is drawn on a 19 x 19 grid (cells of 7.09 units, its lines one cell wide). With 3 modules per cell
# the emblem is 57 x 57 modules and every edge of its lines lies on a module edge. A version 5 code (37 x 37) fits in
# the shield. Its message (36 codewords) is kept above the crossbar by turning the code 90 degrees (the reader does not
# care), and the codewords after the message, which no reader decodes, are chosen (linear algebra over GF(2), as in
# Russ Cox's QArt codes) so that every module under a line is dark and every module around a line is light: the
# lines are a valid part of the code and cost no error correction at all. Error correction L (one block) keeps all of
# its 13 correctable codewords for real damage.
#   python -I emblem_qr.py eval     the candidates (masks, top gap)
#   python -I emblem_qr.py final    writes qr/onboarding-tuke-erb.* and the print plate, mockups, overview
import json, math, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

S = 'C:/Users/matus/AppData/Local/Temp/claude/D--Projects-TUKE-PLES-27/d52288d5-1ab2-4016-a17b-1e4462120f75/scratchpad'
ROOT = Path('D:/Projects/TUKE_PLES_27/qr')
MODE = sys.argv[1] if len(sys.argv) > 1 else 'eval'
sys.argv = ['x', f'{S}/qr_matrix.json', f'{S}/fonts', str(ROOT / 'navrhy')]
sys.path.insert(0, S)
import make_designs as md
import make_logo_qr as ml
from qrcore import Symbol, MASKS

URL = 'https://srdcom.tuke.sk/onboarding/'
B = 134.7                  # the emblem's box (official SVG units)
K = 3                      # modules per emblem cell
E = 19 * K                 # the emblem in modules (57)
import os
VERSION, ECL = int(os.environ.get('QR_VERSION', 5)), os.environ.get('QR_ECL', 'L')
TUKE_GOLD = '#95834d'


def layout(gap):
    sym = Symbol(VERSION, ECL)
    n = sym.n
    cx = (E - n) // 2           # 10: centred (57 and 37 are both odd)
    cy = K + gap                # under the outline's top line (one cell) and `gap` light modules
    return sym, n, cx, cy


def to_symbol(R, C, n):
    """Shield (row, col) -> symbol (row, col): the symbol turned 90 degrees counter-clockwise in the shield."""
    return C, n - 1 - R


def classify(n, cx, cy, px=24):
    """Per shield module of the code: 'line' (its centre under a line), 'halo' (touching a line), or None."""
    em = np.asarray(ml.emblem_mask(E * px)) > 127
    dist = ndimage.distance_transform_edt(~em)
    cls = {}
    for R in range(n):
        for C in range(n):
            x0, y0 = (cx + C) * px, (cy + R) * px
            core = em[y0 + px // 4:y0 + 3 * px // 4, x0 + px // 4:x0 + 3 * px // 4]
            if core.mean() > 0.5:
                cls[(R, C)] = 'line'
            elif dist[y0:y0 + px, x0:x0 + px].min() <= 0.15 * px:
                cls[(R, C)] = 'halo'
    # the outline's arcs must stay clear of the code: nothing of the outer ring may touch it
    return cls


class Solver:
    """Incremental Gaussian elimination over GF(2); rows are ints (bit v = variable v)."""

    def __init__(self):
        self.pivots = []  # (pivot bit, row, rhs), each row free of the earlier pivots

    def add(self, row, rhs):
        for pb, prow, prhs in self.pivots:
            if row >> pb & 1:
                row ^= prow
                rhs ^= prhs
        if row == 0:
            return rhs == 0  # already implied (True) or contradicting (False)
        pb = (row & -row).bit_length() - 1
        self.pivots.append((pb, row, rhs))
        return True

    def solve(self):
        x = 0
        for pb, row, rhs in reversed(self.pivots):
            v = rhs ^ (bin(row & x & ~(1 << pb)).count('1') & 1)
            if v:
                x |= 1 << pb
        return x


def design(gap, mask):
    """Solve the free codewords for one mask; returns the symbol matrix and a report."""
    sym, n, cx, cy = layout(gap)
    cls = classify(n, cx, cy)
    data, used = sym.message_codewords(URL.encode())
    base_blocks = sym.blocks_of(data)
    owner = sym.module_owner()
    f = MASKS[mask]
    # the free bits of every block: data codewords after the message
    free = {}
    for j in range(sym.num_blocks):
        t0 = max(0, used - sym.block_start[j])
        free[j] = list(range(t0, sym.block_data[j]))
    div_cache = {}
    from qrcore import rs_divisor, rs_remainder
    div = rs_divisor(sym.ecc_len)
    ec_rows = {}  # (block, ec index, bit) -> int over the block's variables
    for j in range(sym.num_blocks):
        nd = sym.block_data[j]
        rows = [[0] * 8 for _ in range(sym.ecc_len)]
        for vi, t in enumerate(free[j]):
            for p in range(8):
                e = [0] * nd
                e[t] = 1 << (7 - p)
                rem = rs_remainder(e, div)
                v = vi * 8 + p
                for ei, cw in enumerate(rem):
                    for q in range(8):
                        if cw >> (7 - q) & 1:
                            rows[ei][q] |= 1 << v
        ec_rows[j] = rows
    solvers = {j: Solver() for j in range(sym.num_blocks)}
    fixed_m = sym.build(data, mask)  # function modules (with this mask's format bits) and remainder bits
    report = {'line_bad': 0, 'halo_bad': 0, 'format_line': [0, 0], 'blemish': [], 'line_fixed_light': 0, 'cons': 0}
    fmt_cells = [set((y, x) for x, y in copy) for copy in sym.format_cells]
    # lines first, then the halo
    order = sorted(cls.items(), key=lambda kv: 0 if kv[1] == 'line' else 1)
    for (R, C), kind in order:
        r, c = to_symbol(R, C, n)
        target = 1 if kind == 'line' else 0
        if (r, c) not in owner:  # a function module or a remainder bit: fixed
            val = fixed_m[r][c]
            if val != target:
                if kind == 'line':
                    for k, cells in enumerate(fmt_cells):
                        if (r, c) in cells:
                            report['format_line'][k] += 1
                    report['line_fixed_light'] += 1
                else:
                    report['blemish'].append((R, C))
            continue
        j, i, p = owner[(r, c)]
        inv = 1 if f(c, r) == 0 else 0
        base = base_blocks[j][i] >> (7 - p) & 1
        if i < sym.block_data[j]:
            row = (1 << (free[j].index(i) * 8 + p)) if i in free[j] else 0
        else:
            row = ec_rows[j][i - sym.block_data[j]][p]
        report['cons'] += 1
        ok = solvers[j].add(row, target ^ base ^ inv)
        if not ok:
            report['line_bad' if kind == 'line' else 'halo_bad'] += 1
            if kind == 'halo':
                report['blemish'].append((R, C))
    # apply the solution
    data2 = list(data)
    for j in range(sym.num_blocks):
        x = solvers[j].solve()
        for vi, t in enumerate(free[j]):
            for p in range(8):
                if x >> (vi * 8 + p) & 1:
                    data2[sym.block_start[j] + t] ^= 1 << (7 - p)
    m = sym.build(data2, mask)
    # check every target on the built matrix
    miss = sum(1 for (R, C), kind in cls.items()
               if m[to_symbol(R, C, n)[0]][to_symbol(R, C, n)[1]] != (1 if kind == 'line' else 0))
    report['miss'] = miss
    report['free_bits'] = sum(len(v) * 8 for v in free.values())
    shield = [[m[to_symbol(R, C, n)[0]][to_symbol(R, C, n)[1]] for C in range(n)] for R in range(n)]
    return shield, cls, report, (sym, n, cx, cy, data2)


def penalty(m):
    """The standard's mask penalty (N1-N4) of a matrix, for choosing between equal candidates."""
    n = len(m)
    score = 0
    lines = [m[r] for r in range(n)] + [[m[r][c] for r in range(n)] for c in range(n)]
    for ln in lines:
        run = 1
        for k in range(1, n + 1):
            if k < n and ln[k] == ln[k - 1]:
                run += 1
            else:
                if run >= 5:
                    score += 3 + run - 5
                run = 1
        s = ''.join(map(str, ln))
        score += 40 * (s.count('10111010000') + s.count('00001011101'))
    for r in range(n - 1):
        for c in range(n - 1):
            if m[r][c] == m[r][c + 1] == m[r + 1][c] == m[r + 1][c + 1]:
                score += 3
    dark = sum(map(sum, m))
    score += 10 * (abs(dark * 20 - n * n * 10) // (n * n))
    return score


if __name__ == '__main__' and MODE == 'eval':
    for gap in (1, 2):
        sym, n, cx, cy = layout(gap)
        cls = classify(n, cx, cy)
        nl = sum(1 for v in cls.values() if v == 'line')
        print(f'gap {gap}: code at ({cx}, {cy}) modules of {E}; line modules {nl}, halo modules {len(cls) - nl}')
        for mask in range(8):
            shield, cls, rep, _ = design(gap, mask)
            print(f'  mask {mask}: constraints {rep["cons"]} / free bits {rep["free_bits"]}, line unsolved {rep["line_bad"]}, '
                  f'halo unsolved {rep["halo_bad"]}, fixed light under a line {rep["line_fixed_light"]} '
                  f'(format copy 1/2: {rep["format_line"]}), blemishes {rep["blemish"]}, check misses {rep["miss"]}, '
                  f'penalty {penalty(shield)}')


# ====================================================================== the chosen design and its outputs
GAP, MASK = 1, 2   # one light module under the outline's top line; mask 2 leaves 1 bad bit in the 1st format copy
_FINAL = None


def code_matrix():
    global _FINAL
    if _FINAL is None:
        shield, cls, rep, (sym, n, cx, cy, data) = design(GAP, MASK)
        assert rep['line_bad'] == 0 and rep['halo_bad'] == 0
        # Two fixed dark modules would touch a line: the always-dark module (no reader reads it) and bit 13 of the
        # first format copy (that copy then has 2 wrong bits of the 3 its code corrects; the second copy is whole).
        # They stay light, so the emblem's lines stay clean.
        for R, C in rep['blemish']:
            shield[R][C] = 0
        _FINAL = (shield, cls, n, cx, cy)
    return _FINAL


# The whole shield: the code is a square (its bottom corners carry finder patterns, which the round bottom of the
# shield would cut), so the rest of the shield's inside gets decoration: random modules on the same grid, like the
# round QR codes do around their square. Every line keeps its light module of halo (at least half a module along the
# round bottom), and the three finder patterns keep a light ring of FINDER_RING modules on their outer sides.
FILL = os.environ.get('QR_FILL', '1') == '1'
FINDER_RING = int(os.environ.get('QR_RING', 1))
SEED = int(os.environ.get('QR_SEED', 7))
_GRID = {}


def finder_boxes(n):
    return [(0, 0), (n - 7, 0), (n - 7, n - 7)]  # shield TL, BL, BR (the symbol is turned)


def false_finders(dark, real):
    """Centres where rows and columns both show the 1:1:3:1:1 finder ratio (with the readers' tolerance)."""
    size = len(dark)

    def hits(lines):
        out = set()
        for i, ln in enumerate(lines):
            runs, s = [], 0
            for k in range(1, size + 1):
                if k == size or ln[k] != ln[k - 1]:
                    runs.append((ln[s], s, k - s)); s = k
            for j in range(len(runs) - 4):
                v = [runs[j + t] for t in range(5)]
                if v[0][0] == 1 and [x[2] for x in v][:2] == [1, 1] and 2 <= v[2][2] <= 4 and [x[2] for x in v][3:] == [1, 1]:
                    out.add((i, v[2][1] + v[2][2] // 2))
        return out
    rows = hits(dark)
    cols = {(r, c) for (c, r) in hits([[dark[r][c] for r in range(size)] for c in range(size)])}
    return sorted(p for p in rows & cols if p not in real)


def full_grid(fill=None, ring=None, seed=None):
    fill = FILL if fill is None else fill
    ring = FINDER_RING if ring is None else ring
    seed = SEED if seed is None else seed
    key = (fill, ring, seed)
    if key in _GRID:
        return _GRID[key]
    shield, cls, n, cx, cy = code_matrix()
    px = 24
    em = np.asarray(ml.emblem_mask(E * px)) > 127
    sil_img = Image.new('L', (E * px, E * px), 0)
    ImageDraw.Draw(sil_img).polygon([(x * E * px / B, y * E * px / B) for x, y in ml.flatten(ml.SUBS[0], steps=160)], fill=255)
    holes = (np.asarray(sil_img) > 127) & ~em
    dist = ndimage.distance_transform_edt(~em)
    rng = np.random.default_rng(seed)
    grid = [[0] * E for _ in range(E)]
    gcls = {}
    for r in range(E):
        for c in range(E):
            y0, x0 = r * px, c * px
            if em[y0 + px // 4:y0 + 3 * px // 4, x0 + px // 4:x0 + 3 * px // 4].mean() > 0.5:
                gcls[(r, c)] = 'line'
                continue
            R, C = r - cy, c - cx
            if 0 <= R < n and 0 <= C < n:
                grid[r][c] = shield[R][C]
                if cls.get((R, C)) == 'line':
                    gcls[(r, c)] = 'line'
                continue
            if not fill or holes[y0:y0 + px, x0:x0 + px].mean() < 0.999 or dist[y0:y0 + px, x0:x0 + px].min() <= 0.5 * px:
                continue
            if any(max(fr - R, 0, R - (fr + 6)) <= ring and max(fc - C, 0, C - (fc + 6)) <= ring for fr, fc in finder_boxes(n)):
                continue
            grid[r][c] = int(rng.random() < 0.5)
            gcls[(r, c)] = 'decor'
    dark = [[1 if (grid[r][c] or gcls.get((r, c)) == 'line') else 0 for c in range(E)] for r in range(E)]
    real = {(cy + fr + 3, cx + fc + 3) for fr, fc in finder_boxes(n)}
    _GRID[key] = (grid, gcls, false_finders(dark, real))
    return _GRID[key]


def clean_grid(ring=None, seed=None):
    """The first decoration (from seed on) without a fake finder pattern: a reader would take it for a real one."""
    s = SEED if seed is None else seed
    while True:
        grid, gcls, ff = full_grid(ring=ring, seed=s)
        if not ff:
            return grid, gcls, s
        s += 1


def final_matrix():
    """What the renderers draw: the emblem's modules (code and decoration) as one E x E grid."""
    grid, gcls, _ = clean_grid()
    return grid, gcls, E, 0, 0


def emblem_fine(size_px, ss=4):
    """The emblem's lines, smooth: fine arcs, drawn 4x larger and scaled down (anti-aliased)."""
    big = size_px * ss
    acc = np.zeros((big, big), bool)
    k = big / ml.EMBLEM_BOX
    for sub in ml.SUBS:
        im = Image.new('L', (big, big), 0)
        ImageDraw.Draw(im).polygon([(x * k, y * k) for x, y in ml.flatten(sub, steps=160)], fill=255)
        acc ^= np.asarray(im) > 127
    return Image.fromarray((acc * 255).astype(np.uint8)).resize((size_px, size_px), Image.LANCZOS)


def ink_mask(size_px, shield, cls, n, cx, cy):
    """The emblem and the code as one ink mask (255 = ink) of size_px x size_px."""
    img = emblem_fine(size_px)
    d = ImageDraw.Draw(img)
    m = size_px / E
    for R in range(n):
        for C in range(n):
            if shield[R][C] and cls.get((R, C)) != 'line':
                x0, y0 = round((cx + C) * m), round((cy + R) * m)
                x1, y1 = round((cx + C + 1) * m), round((cy + R + 1) * m)
                d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=255)
    return img


def flat_png(px, ink, paper=(255, 255, 255), pad=4):
    shield, cls, n, cx, cy = final_matrix()
    ss = 2
    tot = E + 2 * pad
    mod = px * ss / tot
    big = Image.new('L', (px * ss, px * ss), 0)
    big.paste(ink_mask(round(E * mod), shield, cls, n, cx, cy), (round(pad * mod), round(pad * mod)))
    a = np.asarray(big.resize((px, px), Image.LANCZOS), np.float32)[..., None] / 255
    out = np.array(paper, np.float32) * (1 - a) + np.array(ink, np.float32) * a
    return Image.fromarray(out.round().clip(0, 255).astype(np.uint8))


def svg(fill, background=None, size_mm=50, pad=4):
    shield, cls, n, cx, cy = final_matrix()
    rows = [''.join('1' if shield[R][C] and cls.get((R, C)) != 'line' else '0' for C in range(n)) for R in range(n)]
    tot = E + 2 * pad
    total_mm = size_mm * tot / E
    bg = f'<rect x="{-pad}" y="{-pad}" width="{tot}" height="{tot}" fill="{background}"/>\n' if background else ''
    note = (f'QR {URL} v tvare znaku TUKE · verzia {VERSION}, oprava chýb {ECL} · čiary znaku sú súčasťou kódu'
            f'{", moduly mimo štvorca kódu sú ozdoba" if FILL else ""} · znak {size_mm} mm'
            f'{" · čierna = fólia" if fill == "#000" else ""}')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_mm:.2f}mm" height="{total_mm:.2f}mm" viewBox="{-pad} {-pad} {tot} {tot}">\n'
            f'<!-- {note} -->\n{bg}'
            f'<g fill="{fill}"><path fill-rule="evenodd" d="{ml.emblem_svg_path(0, 0, E)}"/>'
            f'<path transform="translate({cx} {cy})" d="{md.outline(rows, n)}"/></g>\n</svg>\n')


def put(c, x_mm, y_mm, size_mm):
    shield, cls, n, cx, cy = final_matrix()
    size_px = round(c.s(size_mm))
    c.mask.paste(255, (round(c.s(x_mm)), round(c.s(y_mm))), ink_mask(size_px, shield, cls, n, cx, cy))
    c.keep_out.append((x_mm, y_mm, x_mm + size_mm, y_mm + size_mm))


# The negative: the shield's silhouette in foil, the T-U lines and the dark modules cut out (the paper shows through).
# A phone sees a dark code on light, like the negative of the plain code, the sturdiest foil variant so far.
TU_POLY = [(7.1, 42.5), (49.7, 42.5), (49.7, 85.0), (85.1, 85.0), (85.1, 42.5), (127.6, 42.5), (127.6, 49.6),
           (92.1, 49.6), (92.1, 92.1), (42.5, 92.1), (42.5, 49.6), (7.1, 49.6)]  # the crossbar and the U (official)


def negative_mask(size_px, ss=4):
    shield, cls, n, cx, cy = final_matrix()
    big = size_px * ss
    k = big / ml.EMBLEM_BOX
    img = Image.new('L', (big, big), 0)
    d = ImageDraw.Draw(img)
    d.polygon([(x * k, y * k) for x, y in ml.flatten(ml.SUBS[0], steps=160)], fill=255)  # the silhouette
    d.polygon([(x * k, y * k) for x, y in TU_POLY], fill=0)
    m = big / E
    for R in range(n):
        for C in range(n):
            if shield[R][C] and cls.get((R, C)) != 'line':
                d.rectangle([round((cx + C) * m), round((cy + R) * m), round((cx + C + 1) * m) - 1, round((cy + R + 1) * m) - 1], fill=0)
    return img.resize((size_px, size_px), Image.LANCZOS)


def svg_negative(size_mm=50, pad=4):
    shield, cls, n, cx, cy = final_matrix()
    rows = [''.join('1' if shield[R][C] and cls.get((R, C)) != 'line' else '0' for C in range(n)) for R in range(n)]
    tot = E + 2 * pad
    total_mm = size_mm * tot / E
    k = E / ml.EMBLEM_BOX
    sil = ml.emblem_svg_path(0, 0, E).split('Z')[0] + 'Z'  # the outer outline only
    tu = 'M' + 'L'.join(f'{x * k:.3f},{y * k:.3f}' for x, y in TU_POLY) + 'Z'
    # the modules as holes: shifted into the emblem's coordinates (evenodd cuts them out of the silhouette)
    mods = md.outline(rows, n)
    import re
    mods = re.sub(r'(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)', lambda mm: f'{float(mm.group(1)) + cx:g},{float(mm.group(2)) + cy:g}', mods)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_mm:.2f}mm" height="{total_mm:.2f}mm" viewBox="{-pad} {-pad} {tot} {tot}">\n'
            f'<!-- QR {URL} v tvare znaku TUKE, negatív: fólia je štít, čiary T-U aj moduly kódu sú vyrezané · '
            f'verzia {VERSION}, oprava chýb {ECL} · čierna = fólia; znak {size_mm} mm -->\n'
            f'<path fill="#000" fill-rule="evenodd" d="{sil} {tu} {mods}"/>\n</svg>\n')


def card_negative():
    c = md.Card(seed=34)
    c.text('TECHNICKÁ UNIVERZITA V KOŠICIACH', md.SANS(2.4, 600), 18, track_em=0.28)
    c.text('Reprezentačný ples', md.ITALIC(8.2, 500), 31)
    c.text('23 | 01 | 2027  ·  DOUBLETREE BY HILTON KOŠICE', md.SANS(2.4, 600), 39.5, track_em=0.12)
    x, y, size = (md.W_MM - 50) / 2, 50, 50
    size_px = round(c.s(size))
    c.mask.paste(255, (round(c.s(x)), round(c.s(y))), negative_mask(size_px))
    c.text('POTVRĎTE SVOJU ÚČASŤ', md.SERIF(4.4, 600), 113, track_em=0.18)
    c.text('Naskenujte kód alebo navštívte srdcom.tuke.sk', md.SANS(2.55, 600), 121, track_em=0.03)
    c.text('R.S.V.P. do 13. januára 2027', md.ITALIC(4.4, 500), 135)
    return (c.render('silver'), 'Negatív: štít z fólie', 'T-U aj kód vyrezané z fólie: tmavý kód na svetlom, '
            'najistejšia fóliová verzia')


def card_gold():
    c = md.Card(seed=31)
    c.text('Reprezentačný ples', md.SCRIPT(12.5), 27)
    c.text('TUKE  ·  23 | 01 | 2027', md.SERIF(4.4, 600), 36.5, track_em=0.12)
    c.text('POTVRĎTE SVOJU ÚČASŤ', md.SANS(2.6, 600), 47, track_em=0.3)
    put(c, (md.W_MM - 50) / 2, 53, 50)
    md.common_footer(c, 117)
    c.rule(128, 9)
    c.text('R.S.V.P. do 13. januára 2027', md.ITALIC(4.4, 500), 136)
    return c.render('gold'), 'Zlatý znak TUKE z QR kódu', 'zlatá fólia; čiary znaku sú súčasťou kódu, svetlý kód na tmavom'


def card_silver():
    c = md.Card(seed=32)
    c.text('XXIV. REPREZENTAČNÝ PLES', md.SANS(2.6, 600), 20, track_em=0.32)
    c.text('23 | 01 | 2027', md.SERIF(9.5, 500), 33.5, track_em=0.06)
    c.rule(41, 16, gap_mm=3); c.star(md.W_MM / 2, 41, 1.4)
    c.text('POTVRĎTE SVOJU ÚČASŤ', md.SERIF(4.6, 600), 51, track_em=0.18)
    put(c, (md.W_MM - 50) / 2, 57, 50)
    md.common_footer(c, 119)
    c.text('R.S.V.P. do 13. januára 2027', md.ITALIC(4.6, 500), 136)
    return c.render('silver'), 'Strieborný znak TUKE z QR kódu', 'strieborná fólia na modrej, ten istý kód; platňa tlac/qr-erb.svg'


def card_print():
    """Ordinary print on light paper in the TUKE gold (no foil): dark code on light, read by every phone."""
    c = md.Card(paper=(247, 244, 236), seed=33)
    c.text('TECHNICKÁ UNIVERZITA V KOŠICIACH', md.SANS(2.4, 600), 18, track_em=0.28)
    c.text('Reprezentačný ples', md.ITALIC(8.2, 500), 30)
    c.text('23 | 01 | 2027  ·  DOUBLETREE BY HILTON KOŠICE', md.SANS(2.4, 600), 38.5, track_em=0.12)
    put(c, (md.W_MM - 50) / 2, 50, 50)
    c.text('POTVRĎTE SVOJU ÚČASŤ', md.SERIF(4.4, 600), 113, track_em=0.18)
    c.text('Naskenujte kód alebo navštívte srdcom.tuke.sk', md.SANS(2.55, 600), 121, track_em=0.03)
    c.text('R.S.V.P. do 13. januára 2027', md.ITALIC(4.4, 500), 135)
    m = np.asarray(c.mask.resize((md.W, md.H), Image.LANCZOS), np.float32)[..., None] / 255
    paper = c._paper(c.paper, c.seed)
    ink = np.array([149, 131, 77], np.float32)  # TUKE gold #95834d, flat ink
    out = paper * (1 - m) + ink * m
    return (Image.fromarray(out.clip(0, 255).astype(np.uint8)), 'Znak TUKE z QR kódu v zlatej TUKE',
            'bežná tlač bez fólie (#95834d); tmavý kód na svetlom prečíta každý telefón')


if __name__ == '__main__' and MODE == 'final':
    out = ROOT
    (out / 'onboarding-tuke-erb.svg').write_text(svg(TUKE_GOLD, '#ffffff'), encoding='utf-8')
    flat_png(2048, (149, 131, 77)).save(out / 'onboarding-tuke-erb.png', optimize=True)
    (out / 'onboarding-tuke-erb-cierny.svg').write_text(svg('#000000', '#ffffff'), encoding='utf-8')
    flat_png(2048, (0, 0, 0)).save(out / 'onboarding-tuke-erb-cierny.png', optimize=True)
    (out / 'navrhy' / 'tlac' / 'qr-erb.svg').write_text(svg('#000'), encoding='utf-8')
    (out / 'navrhy' / 'tlac' / 'qr-erb-negativ.svg').write_text(svg_negative(), encoding='utf-8')
    made = []
    for key, fn in (('10-zlaty-erb', card_gold), ('11-strieborny-erb', card_silver), ('12-negativ-erb', card_negative),
                    ('13-erb-tlac', card_print)):
        img, title, note = fn()
        img.save(out / 'navrhy' / f'{key}.png', optimize=True)
        made.append((title, note, img))
        print('mockup', key)
    cw, gap, label = 420, 46, 96
    ch = round(cw * md.H / md.W)
    sheet = Image.new('RGB', (len(made) * cw + (len(made) + 1) * gap, ch + label + 2 * gap), (233, 231, 227))
    sd = ImageDraw.Draw(sheet)
    lf = ImageFont.truetype(f'{S}/fonts/Manrope.ttf', 21); lf.set_variation_by_axes([600])
    nf = ImageFont.truetype(f'{S}/fonts/Manrope.ttf', 15); nf.set_variation_by_axes([500])
    for i, (title, note, img) in enumerate(made):
        x, y = gap + i * (cw + gap), gap
        shadow = Image.new('L', sheet.size, 0)
        ImageDraw.Draw(shadow).rectangle([x + 6, y + 10, x + cw + 6, y + ch + 10], fill=120)
        sheet.paste((150, 146, 140), (0, 0), shadow.filter(ImageFilter.GaussianBlur(12)))
        sheet.paste(img.resize((cw, ch), Image.LANCZOS), (x, y))
        sd.text((x, y + ch + 16), f'{10 + i} · {title}', font=lf, fill=(28, 32, 62))
        line, lines = '', []
        for word in note.split():
            if nf.getlength(f'{line} {word}'.strip()) > cw:
                lines.append(line); line = word
            else:
                line = f'{line} {word}'.strip()
        lines.append(line)
        for k, t in enumerate(lines[:2]):
            sd.text((x, y + ch + 46 + k * 21), t, font=nf, fill=(90, 94, 110))
    sheet.save(out / 'navrhy' / 'prehlad-erb.png', optimize=True)
    print('done')
