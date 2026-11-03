# Zdroj QR kódov na pozvánky

Skripty, ktoré 2026-11-03 vyrobili všetko v `qr/`. Spúšťali sa z dočasného priečinka relácie Claude, preto majú
na začiatku natvrdo cestu `S = '…/scratchpad'`. Pred ďalším behom ju treba zmeniť na tento priečinok
(`D:/Projects/TUKE_PLES_27/qr/zdroj`). Čítačky `jsqr` a `@zxing/library` boli v `scratchpad/qrcheck/node_modules`;
nainštalujú sa takto: `npm i jsqr@1.4.0 @zxing/library@0.21.3`. Cesty `D:/Projects/TUKE_PLES_27/…` (výstupy,
`node_modules` s `qrcode` a `pngjs`) platia na natívnom PC.

| skript | čo robí |
|---|---|
| `make_qr.cjs` | `qr/onboarding.svg/png`: klasický QR, oprava chýb Q |
| `qr_matrix.cjs` → `qr_matrix.json` | matice Q a H pre návrhy |
| `make_designs.py` | návrhy 1–6 (fólia na modrom), `prehlad.png`, platne v `navrhy/tlac` |
| `make_logo_qr.py` | znak TUKE v strede kódu: `onboarding-logo.*`, návrhy 7–9, `prehlad-logo.png` |
| `qrcore.py` | vlastný QR enkodér (byte mode, v1–9), ukáže blok/kódové slovo každého modulu |
| `qr_reference.cjs` + `check_qrcore.py` | kontrola enkodéra proti knižnici `qrcode` (40 matíc, všetky zhodné) |
| `emblem_qr.py` | **kód v tvare znaku TUKE**: `eval` (masky), `final` (`onboarding-tuke-erb*`, návrhy 10–13, `prehlad-erb.png`, `tlac/qr-erb*.svg`) |
| `decode_*.cjs`, `erb.html` | čítanie hotových PNG/SVG (jsQR, ZXing, prehliadač) |
| `stress_make.py` + `stress_decode.cjs` | záťažový test: zmenšenie, rozmazanie, šum, kontrast, svetlo, natočenie, perspektíva, JPEG |
| `mail_assets.py` | prílohy e-mailu (náhľady JPEG, ZIP pre tlačiareň) |

Kód v tvare znaku: znak TUKE je kreslený na mriežke 19 × 19, pri 3 moduloch na bunku má 57 × 57 modulov a každá
hrana jeho čiar leží na hrane modulu. QR verzia 5 (37 × 37, oprava chýb L) je otočená o 90°, aby správa ležala nad
priečkou T. Kódové slová za správou čítačka nedekóduje, preto sú dopočítané (lineárna algebra nad GF(2)) tak, aby
moduly pod čiarami boli tmavé a moduly okolo čiar svetlé. Čiary sú teda platnou súčasťou kódu a neberú opravu chýb.
Maska 2, medzera nad kódom 1 modul. Pri čiarach chýbajú 2 povinné tmavé moduly: „dark module“, ktorý čítačky
nečítajú, a 1 bit prvej kópie formátu (tá má potom 2 chybné bity z 3 opraviteľných; druhá kópia je celá).

Celý štít (od 2026-11-03 popoludní): štvorec kódu by sa so svojimi spodnými „očami“ do oblého spodku štítu
nezmestil, preto zvyšok vnútra vypĺňajú ozdobné moduly na tej istej mriežke (náhodné, `QR_SEED`, polovica tmavých),
ako pri okrúhlych QR kódoch. Okolo čiar ostáva svetlý okraj (pri oblúku aspoň pol modulu), okolo troch očí svetlý
rámik `QR_RING` = 1 modul. Rozloženie s falošným „okom“ (pomer 1:1:3:1:1 v riadku aj stĺpci) sa zahodí a berie
sa ďalší seed (`clean_grid`), lebo ZXing by ho vzal namiesto pravého. `QR_FILL=0` vráti prázdny spodok štítu.
Záťažový test (oba dekodéry, z 13 podmienok): čierny erb 11, zlatý 9, zlatá / strieborná fólia 8 / 9, negatív 9,
tlač na krémovom 8. Klasický QR má 12, skoršie fóliové návrhy 8 – 9. Vyplnenie štítu čítanie zlepšilo
(predtým 6 – 8 pri fólii), lebo veľká prázdna plocha pod kódom kazila prahovanie pri spodných očiach.

Ak sa zmení adresa v kóde, treba pregenerovať všetko (Q/H matice, `emblem_qr.py` má `URL` na začiatku).

Licencie: písma vo `fonts/` sú z Google Fonts pod licenciou SIL Open Font License 1.1 (jej text je v metadátach
každého súboru): Cormorant Garamond, Great Vibes, Manrope. Súbory `-LF` sú kópie Cormorant Garamond, v ktorých
číslice 0 – 9 ukazujú na glyfy `.lf`, teda verzálkové číslice (ako 23 | 01 | 2027 v návrhu tlačiarne). `jsQR.js`
je nezmenený `dist/jsQR.js` z npm balíka jsqr 1.4.0 (Apache License 2.0, text v `jsQR.LICENSE.txt`), potrebuje
ho `erb.html`. Znak TUKE (`tuke-logo/logo2.svg`) patrí TUKE.
