"""Download the machine-readable sources into data/cache and data/evidence (safe to re-run)."""
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache"
SNAPSHOTS = ROOT / "data" / "evidence" / "erasmus_wayback"
UA = {"User-Agent": "tuke-ples-2027-globe/0.1 (+https://github.com/MatusPohorenec/TUKE_PLES_27)"}

FACULTIES = ["fei", "sjf", "svf", "ekf", "fberg", "fmmr", "fu", "fvt", "lf"]
# the per-faculty partner pages were removed from the live site in 2026; Wayback keeps the last version
ERASMUS_PAGES = (
    [f"institucie-{f}-eu-a-ehp" for f in FACULTIES]
    + [f"institucie-zamestnanecke-{f}-eu-a-ehp" for f in FACULTIES]
    + ["institucie-bilateralne-eu-a-ehp", "institucie-rektorat"]
)
HEI_COUNTRIES = "AT BE BG HR CY CZ EE FI FR DE GR HU IT LV LT LU MT NL MK NO PL PT RO RS SI ES TR".split()
CORDIS = {"HORIZON.zip": "HORIZON", "h2020.zip": "h2020", "fp7.zip": "fp7"}


def download(url, target, headers=None, force=False):
    if target.exists() and not force:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    r = requests.get(url, headers={**UA, **(headers or {})}, timeout=600)
    r.raise_for_status()
    target.write_bytes(r.content)
    print("saved", target.relative_to(ROOT), len(r.content))
    time.sleep(1)


for slug in ERASMUS_PAGES:
    live = requests.get(f"https://erasmus.tuke.sk/{slug}/", headers=UA, timeout=60)
    if live.status_code == 200 and "Page not found" not in live.text[:3000]:
        (SNAPSHOTS / f"{slug}.html").write_bytes(live.content)
        print("live", slug)
    else:
        download(f"https://web.archive.org/web/2026id_/https://erasmus.tuke.sk/{slug}/", SNAPSHOTS / f"{slug}.html")

for cc in HEI_COUNTRIES:
    download(f"https://hei.api.uni-foundation.eu/api/public/v1/country/{cc}/hei", CACHE / "hei" / f"{cc}.json", {"Accept": "application/vnd.api+json"})

for fname, key in CORDIS.items():
    download(f"https://cordis.europa.eu/data/cordis-{key}projects-csv.zip", CACHE / "cordis" / fname)
