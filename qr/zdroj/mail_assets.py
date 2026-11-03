# The mail's attachments: three overview JPEGs for the body, and one ZIP for the printer (previews, foil plates,
# ready-made codes, a short guide).   python -I mail_assets.py <out dir>
import io, sys, zipfile
from pathlib import Path
from PIL import Image

OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
Q = Path('D:/Projects/TUKE_PLES_27/qr')
N = Q / 'navrhy'


def jpeg(path, width=None, quality=88):
    im = Image.open(path).convert('RGB')
    if width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


# inline pictures for the body
for name in ('prehlad', 'prehlad-logo', 'prehlad-erb'):
    (OUT / f'{name}.jpg').write_bytes(jpeg(N / f'{name}.png', width=1400, quality=84))

README = """QR kód na pozvánky – Reprezentačný ples TUKE 2027
Kód vedie na https://srdcom.tuke.sk/onboarding/ (hostia tam potvrdia účasť).

1-nahlady
  Náhľady pozvánky A6 (105 × 148 mm) s jednotlivými návrhmi, len na ukážku:
  01–06  kód vo fólii v štýle pozvánky (strieborná, zlatá oblá, negatív, hviezdy, pauzák, RSVP zlatá)
  07–09  kód so znakom TUKE v strede
  10–13  kód v tvare znaku TUKE, vypĺňa celý štít (zlatý, strieborný, negatív, bežná tlač bez fólie)
  prehlad*.jpg  všetky návrhy vedľa seba

2-tlacove-podklady  (pre tlačiareň)
  Vektorové SVG, čierna = fólia. Klasické kódy majú 40 mm (bez tichej zóny), znak TUKE 50 mm;
  zväčšiť sa dajú ľubovoľne, zmenšiť nie pod odporúčanú veľkosť nižšie.
  qr-klasicky.svg         návrhy 1 a 5
  qr-obly.svg             návrh 2
  qr-negativ.svg          návrh 3 (fólia je plôška, kód je vyrezaný)
  qr-bodky-hviezda.svg    návrh 4
  qr-ramik.svg            návrh 6
  qr-logo-folia.svg       návrhy 7 a 9 (znak TUKE v strede kódu)
  qr-logo-negativ.svg     návrh 8
  qr-erb.svg              návrhy 10 a 11 (kód v tvare znaku TUKE)
  qr-erb-negativ.svg      návrh 12 (štít z fólie, kód a T-U vyrezané)

3-qr-na-web-a-tlac
  Hotové kódy na web, prezentácie a bežnú tlač (SVG = vektor, PNG = 2048 px):
  onboarding.*                   klasický QR kód
  onboarding-logo.*              so znakom TUKE v strede
  onboarding-tuke-erb.*          v tvare znaku TUKE, zlatá TUKE (#95834d), aj pre návrh 13
  onboarding-tuke-erb-cierny.*   to isté v čiernej, najlepšie čitateľné

Pri tlači
  - kód aspoň 30 mm široký, znak TUKE s kódom aspoň 45 mm; najlepšie matná fólia
  - pred tlačou celého nákladu naskenovať skúšobný výtlačok viacerými telefónmi (iPhone aj Android)
  - kód nemeniť (farby, tvar modulov, pomer strán) a do tichej zóny okolo neho nič netlačiť
  - kód v tvare znaku TUKE: čiary znaku sú súčasťou kódu a moduly okolo štvorca kódu sú ozdoba na tej istej
    mriežke; všetko musí ostať presne tak, ako je (aj svetlé medzery okolo čiar a okolo troch „očí“ kódu)
"""

zpath = OUT / 'QR-pozvanka-ples-TUKE-2027.zip'
with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('CITAJ-MA.txt', '\ufeff' + README.replace('\n', '\r\n'))
    for p in sorted(N.glob('*.png')):
        if p.stem.startswith('prehlad'):
            z.writestr(f'1-nahlady/{p.stem}.jpg', jpeg(p, quality=90))
        else:
            num, rest = p.stem.split('-', 1)
            z.writestr(f'1-nahlady/{int(num):02d}-{rest}.jpg', jpeg(p, quality=88))
    for p in sorted((N / 'tlac').glob('*.svg')):
        z.write(p, f'2-tlacove-podklady/{p.name}')
    for p in sorted(Q.glob('onboarding*.*')):
        z.write(p, f'3-qr-na-web-a-tlac/{p.name}')
with zipfile.ZipFile(zpath) as z:
    for i in z.infolist():
        print(f'{i.file_size:>9}  {i.filename}')
print('zip', zpath.stat().st_size, 'B; inline', sum((OUT / f).stat().st_size for f in ('prehlad.jpg', 'prehlad-logo.jpg', 'prehlad-erb.jpg')), 'B')
