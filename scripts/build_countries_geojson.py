"""Country outlines for the globe: Natural Earth 1:110m admin-0 (public domain), slimmed for the web app.

Input : data/cache/ne_110m_admin_0_countries.geojson
        (https://cdn.jsdelivr.net/gh/vasturiano/globe.gl/example/datasets/ne_110m_admin_0_countries.geojson)
Output: apps/web/public/geo/countries-110m.json  features with {iso2, name} and coordinates rounded to 0.01 degree
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "cache" / "ne_110m_admin_0_countries.geojson"
OUT = ROOT / "apps" / "web" / "public" / "geo" / "countries-110m.json"

# Natural Earth leaves ISO_A2 at -99 for France and Norway (overseas territories); disputed areas stay unassigned
ISO_FIX = {"FRA": "FR", "NOR": "NO"}


def rnd(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 2), round(coords[1], 2)]
    return [rnd(c) for c in coords]


features = []
for f in json.loads(SRC.read_text(encoding="utf-8"))["features"]:
    p = f["properties"]
    if p["ISO_A2"] == "AQ":
        continue
    iso2 = ISO_FIX.get(p["ADM0_A3"], p["ISO_A2"])
    features.append({
        "type": "Feature",
        "properties": {"iso2": iso2 if iso2 != "-99" else "", "name": p["NAME"]},
        "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"])},
    })

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")), encoding="utf-8")
print(len(features), "countries,", round(OUT.stat().st_size / 1024), "KB ->", OUT.relative_to(ROOT))
