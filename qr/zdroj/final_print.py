# The two final plates for the printer (qr-erb and qr-erb-negativ, chosen 2026-11-03), made from the SVGs in navrhy/tlac:
#   final/<plate>.pdf    vector, 1:1: emblem 50 mm, page 57.02 mm with the SVG's 4-module margin, 100 % K, curves only
#   final/<plate>.svg    the same SVG
#   final/<plate>.png    black on white, 42 px per module (2730 px, 1216 dpi = 57.02 mm), the PDF rendered by Poppler
#   final/*-nahlad-*.png the colour mockups on the blue card (A6, 12 px per mm)
#   final/CITAJ-MA.txt and final/QR-erb-final-ples-TUKE-2027.zip (all of the above, for the chat)
#   python final_print.py      (needs pdftoppm from Poppler, e.g. MiKTeX's; or set PDFTOPPM)
import hashlib, os, re, shutil, subprocess, tempfile, zipfile, zlib
from datetime import datetime
from pathlib import Path
from PIL import Image

QR = Path(__file__).resolve().parents[1]
SRC, OUT = QR / 'navrhy' / 'tlac', QR / 'final'
PDFTOPPM = (os.environ.get('PDFTOPPM') or shutil.which('pdftoppm')
            or str(Path.home() / 'AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftoppm.exe'))
E, PAD, EMBLEM_MM = 57, 4, 50.0   # the emblem in modules, the SVG's margin in modules, the emblem's width
PX_PER_MODULE = 42                # PNG: every module edge on a pixel edge
PT_PER_MM = 72 / 25.4
UNIT = EMBLEM_MM / E * PT_PER_MM  # one module in points
SIDE = (E + 2 * PAD) * UNIT       # the page in points
PLATES = {
    'qr-erb': ('QR kód v tvare znaku TUKE – fólia',
               'Čierna = fólia: čiary znaku TUKE aj moduly kódu. Znak 50 mm, 100 % K.'),
    'qr-erb-negativ': ('QR kód v tvare znaku TUKE, negatív – fólia',
                       'Čierna = fólia: celý štít; čiary T-U a moduly kódu sú vyrezané. Znak 50 mm, 100 % K.'),
}
PREVIEWS = {'10-zlaty-erb': 'qr-erb-nahlad-zlata-folia.png',
            '11-strieborny-erb': 'qr-erb-nahlad-strieborna-folia.png',
            '12-negativ-erb': 'qr-erb-negativ-nahlad-strieborna-folia.png'}
ZIP_NAME = 'QR-erb-final-ples-TUKE-2027.zip'

README = """QR kód v tvare znaku TUKE – finálne podklady
Reprezentačný ples TUKE 2027 · kód vedie na https://srdcom.tuke.sk/onboarding/

Dve platne pre fóliu (čierna = fólia)
  qr-erb           znak TUKE z QR kódu: fólia sú čiary znaku aj moduly kódu
  qr-erb-negativ   negatív: fólia je celý štít, čiary T-U a moduly kódu sú vyrezané (presvitá papier)

Súbory ku každej platni
  .pdf   na tlač: vektor v mierke 1:1, znak 50 × 50 mm, strana 57,02 mm aj s voľným okrajom 3,5 mm,
         100 % K (C0 M0 Y0 K100), len krivky, bez písma a obrázkov
  .svg   ten istý vektor
  .png   2730 × 2730 px (pri 1216 dpi presne 57,02 mm), čierna na bielej

Farebné náhľady na modrej pozvánke (len ukážka, nie podklad na tlač)
  qr-erb-nahlad-zlata-folia.png
  qr-erb-nahlad-strieborna-folia.png
  qr-erb-negativ-nahlad-strieborna-folia.png

Pri tlači
  - znak nezmenšovať pod 45 mm (zväčšiť sa dá ľubovoľne), najlepšie matná fólia
  - najmenšie detaily pri 50 mm: modul kódu 0,88 mm, najužšia medzera 0,37 mm (pri oblúkoch štítu)
  - tvar nemeniť: čiary znaku sú súčasťou kódu, medzery okolo nich aj okolo troch „očí“ kódu musia ostať
  - okolo znaku nechať voľný okraj aspoň 3,5 mm
  - skúšobný výtlačok pred celým nákladom naskenovať viacerými telefónmi (iPhone aj Android)
"""


def svg_paths(text):
    """The SVG's viewBox and its paths as (d, fill rule, dx, dy); only black fills, only translate()."""
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', text).group(1).split()]
    assert vb == [-PAD, -PAD, E + 2 * PAD, E + 2 * PAD], vb
    assert set(re.findall(r'fill="([^"]*)"', text)) == {'#000'}, 'only black fills expected'
    paths = []
    for m in re.finditer(r'<path\b([^>]*)/>', text):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
        dx = dy = 0.0
        if 'transform' in attrs:
            t = re.fullmatch(r'translate\((-?[\d.]+)[ ,]+(-?[\d.]+)\)', attrs['transform'])
            assert t, attrs['transform']
            dx, dy = float(t.group(1)), float(t.group(2))
        paths.append((attrs['d'], attrs.get('fill-rule', 'nonzero'), dx, dy))
    return vb, paths


def pdf_path(d, dx, dy, vb):
    """SVG path data (absolute M L C Z) as PDF path operators in points, y up."""
    assert re.fullmatch(r'[MLCZ0-9.,\s-]*', d), 'only absolute M L C Z expected'
    toks = re.findall(r'[MLCZ]|-?(?:\d+\.?\d*|\.\d+)', d)

    def pt(x, y):
        return f'{(float(x) + dx - vb[0]) * UNIT:.4f} {SIDE - (float(y) + dy - vb[1]) * UNIT:.4f}'

    ops, i, cmd = [], 0, None
    while i < len(toks):
        if toks[i] in 'MLCZ':
            if cmd == 'Z':
                assert toks[i] == 'M', 'a subpath after Z must start with M'
            cmd = toks[i]
            i += 1
            if cmd == 'Z':
                ops.append('h')
            continue
        if cmd == 'M':
            ops.append(f'{pt(*toks[i:i + 2])} m'); i += 2; cmd = 'L'
        elif cmd == 'L':
            ops.append(f'{pt(*toks[i:i + 2])} l'); i += 2
        elif cmd == 'C':
            ops.append(f'{pt(*toks[i:i + 2])} {pt(*toks[i + 2:i + 4])} {pt(*toks[i + 4:i + 6])} c'); i += 6
        else:
            raise ValueError(f'numbers after {cmd}')
    return ops


def pdf_text(s):
    return '<FEFF' + s.encode('utf-16-be').hex().upper() + '>'


def pdf_bytes(svg_text, title, subject):
    vb, paths = svg_paths(svg_text)
    content = ['q', '0 0 0 1 k']  # CMYK 0/0/0/100
    for d, rule, dx, dy in paths:
        content += pdf_path(d, dx, dy, vb)
        content.append('f*' if rule == 'evenodd' else 'f')
    content.append('Q')
    raw = ('\n'.join(content) + '\n').encode('ascii')
    stream = zlib.compress(raw, 9)
    now = datetime.now().astimezone()
    off = int(now.utcoffset().total_seconds() // 60)
    date = now.strftime('D:%Y%m%d%H%M%S') + f"{'+' if off >= 0 else '-'}{abs(off) // 60:02d}'{abs(off) % 60:02d}'"
    box = f'[0 0 {SIDE:.4f} {SIDE:.4f}]'
    objs = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        f'<< /Type /Page /Parent 2 0 R /MediaBox {box} /TrimBox {box} /Resources << /ProcSet [/PDF] >> '
        f'/Contents 4 0 R >>'.encode(),
        f'<< /Length {len(stream)} /Filter /FlateDecode >>\nstream\n'.encode() + stream + b'\nendstream',
        f'<< /Title {pdf_text(title)} /Subject {pdf_text(subject + " " + "Kód: https://srdcom.tuke.sk/onboarding/")} '
        f'/Creator {pdf_text("Ples TUKE 2027, qr/zdroj/final_print.py")} /Producer (final_print.py) '
        f'/CreationDate ({date}) /ModDate ({date}) /Trapped /False >>'.encode(),
    ]
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = []
    for n, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f'{n} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode()
    for o in offsets:
        out += f'{o:010d} 00000 n \n'.encode()
    fid = hashlib.md5(raw).hexdigest().upper()
    out += (f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info 5 0 R /ID [<{fid}> <{fid}>] >>\n'
            f'startxref\n{xref}\n%%EOF\n').encode()
    return bytes(out)


def render(pdf, px):
    """The PDF rendered by Poppler as a px x px grayscale image."""
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp) / 'page'
        subprocess.run([PDFTOPPM, '-png', '-gray', '-aaVector', 'yes', '-scale-to', str(px), '-singlefile',
                        str(pdf), str(base)], check=True)
        im = Image.open(f'{base}.png')
        im.load()
    assert im.size == (px, px), im.size
    return im.convert('L')


if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    px = (E + 2 * PAD) * PX_PER_MODULE
    dpi = px / (SIDE / 72)
    files = []
    for name, (title, subject) in PLATES.items():
        text = (SRC / f'{name}.svg').read_text(encoding='utf-8')
        (OUT / f'{name}.svg').write_text(text, encoding='utf-8')
        (OUT / f'{name}.pdf').write_bytes(pdf_bytes(text, title, subject))
        render(OUT / f'{name}.pdf', px).save(OUT / f'{name}.png', dpi=(dpi, dpi), optimize=True)
        files += [f'{name}.pdf', f'{name}.svg', f'{name}.png']
    for src, dst in PREVIEWS.items():
        Image.open(QR / 'navrhy' / f'{src}.png').save(OUT / dst, dpi=(304.8, 304.8), optimize=True)
        files.append(dst)
    readme = ('﻿' + README.replace('\n', '\r\n')).encode('utf-8')
    (OUT / 'CITAJ-MA.txt').write_bytes(readme)
    with zipfile.ZipFile(OUT / ZIP_NAME, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('CITAJ-MA.txt', readme)
        for f in files:
            z.write(OUT / f, f)
    print(f'page {SIDE:.4f} pt = {SIDE / PT_PER_MM:.4f} mm, emblem {E * UNIT / PT_PER_MM:.4f} mm, png {px} px at {dpi:.2f} dpi')
    for f in sorted(OUT.iterdir()):
        print(f'{f.stat().st_size:>9}  {f.name}')
