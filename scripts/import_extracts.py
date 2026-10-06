"""Convert platform extracts (data/cache/extracts) into researched_*.json records for build_dataset.py.

Extracts were pulled on 2026-09-21 from:
  eplus_tuke.json          Erasmus+ Project Results Platform, projects with TUKE as coordinator or partner
  keep_tuke_projects.json  keep.eu, Interreg / ENI CBC projects with TUKE
  ceepus_networks.json     ceepus.info, networks of 2024/25 and 2026/27 with a TUKE unit
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTRACTS = ROOT / "data" / "cache" / "extracts"
RAW = ROOT / "data" / "raw"
NAMES = json.loads((ROOT / "data" / "country_names.json").read_text(encoding="utf-8"))
CODES = {v.lower(): k for k, v in NAMES.items()}
CODES.update({"czech republic": "CZ", "republic of moldova": "MD", "moldova, republic of": "MD", "north macedonia": "MK", "russian federation": "RU",
              "bosnia and herzegovina": "BA", "united kingdom": "GB", "türkiye": "TR", "kosovo*": "XK", "serbia": "RS"})
ISO_FIX = {"EL": "GR", "UK": "GB"}


def nice(name):
    name = re.sub(r"\s+", " ", name or "").strip()
    return name.title() if name.isupper() else name


def record(name, city, cc, category, description, source_url, lat=None, lon=None, since="", unit="TUKE"):
    cc = ISO_FIX.get((cc or "").upper(), (cc or "").upper())
    return {
        "name": nice(name), "name_local": "", "city": nice(city), "country": NAMES.get(cc, cc), "country_code": cc,
        "lat": lat, "lon": lon, "category": category, "tuke_unit": unit, "description": description,
        "since": since, "source_url": source_url, "confidence": "high",
    }


def is_tuke(name):
    n = (name or "").upper()
    return "KOSIC" in n.replace("Š", "S") and ("TECHNIC" in n or "TUKE" in n)


def collapse(records):
    """One record per partner and category: merge the project lists into a single description."""
    out = {}
    for r in records:
        key = (r["name"].lower(), r["country_code"], r["category"])
        if key not in out:
            out[key] = {**r, "_items": []}
        e = out[key]
        if r["description"] not in e["_items"]:
            e["_items"].append(r["description"])
        e["since"] = min(filter(None, [e["since"], r["since"]]), default="")
        if e["lat"] is None and r["lat"] is not None:
            e["lat"], e["lon"] = r["lat"], r["lon"]
    for e in out.values():
        items = e.pop("_items")
        e["description"] = "; ".join(items[:6]) + (f" (+{len(items) - 6})" if len(items) > 6 else "")
    return list(out.values())


# --- Erasmus+ Project Results Platform
eplus = []
for p in json.loads((EXTRACTS / "eplus_tuke.json").read_text(encoding="utf-8")).values():
    level3 = p.get("projectLevel3Label") or ""
    if re.search(r"external policy funds|Partner Countries", level3):
        category, label = "erasmus_ka171", "Erasmus+ mobilita mimo EÚ"
    elif "Mobility of higher education" in level3 or "within programme countries" in level3:
        category, label = "erasmus_eu", "Erasmus+ mobilitný projekt"
    else:
        category, label = "erasmus_ka2", level3 or p.get("projectLevel2Label") or "Erasmus+ projekt"
    url = f"https://erasmus-plus.ec.europa.eu/projects/search/details/{p['projectName']}"
    for o in p.get("organisations") or []:
        if o.get("organisationCountry") == "SK" or is_tuke(o.get("organisationName")):
            continue
        lat = lon = None
        if o.get("organisationAccuracy") in ("address", "city") and "," in (o.get("organisationLocation") or ""):
            lat, lon = (round(float(x), 5) for x in o["organisationLocation"].split(","))
        title = re.sub(r"\s+", " ", p.get("projectTitle") or "").strip()
        eplus.append(record(o["organisationName"], o.get("organisationCity"), o["organisationCountry"], category,
                            f"{label}: {title[:90]} ({p['projectName']})", url, lat, lon, since=(p.get("projectStartDate") or "")[:4]))
eplus = collapse(eplus)

# --- keep.eu (Interreg, ENI CBC)
keep = []
for p in json.loads((EXTRACTS / "keep_tuke_projects.json").read_text(encoding="utf-8")).values():
    for o in p["partners"]:
        parts = [x.strip() for x in o["address"].split(",") if x.strip()]
        if len(parts) < 2:
            continue
        cc = CODES.get(parts[-1].lower())
        if not cc or cc == "SK" or is_tuke(o["name"]):
            continue
        city = re.sub(r"^[\w\-]*\d[\w\-]*\s+|\s+Cedex.*$|^\d+\s*", "", parts[-2]).strip()
        city = re.sub(r"^(?:[A-Z]{1,2}-)?\d[\d\s]*", "", city).strip()
        keep.append(record(o["name"], city, cc, "crossborder_project", f"{p['acronym']} – {p['programme']}", p["url"], since=(p.get("start") or "")[:4]))
keep = collapse(keep)

# --- CEEPUS networks
ceepus = []
for n in json.loads((EXTRACTS / "ceepus_networks.json").read_text(encoding="utf-8")):
    if not n.get("tuke_idx"):
        continue
    title = n["title"].split(" - ", 1)
    for k, u in enumerate(n["units"]):
        name, _street, place, country = (u["univ"] + ["", "", "", ""])[:4]
        cc = CODES.get(country.lower())
        if k in n["tuke_idx"] or not cc or cc == "SK":
            continue
        city = re.sub(r"^[A-Z\-]*\d[\d\s\-]*", "", place).strip()
        ceepus.append(record(name, city, cc, "ceepus", f"CEEPUS {title[0]}: {title[-1][:80]}", n["url"], since="20" + n["first_period"][:2]))
ceepus = collapse(ceepus)

# --- country-level facts: KA171 flows are published per country only, APVV bilateral calls name the country, not the partner
country_level = [
    {"country_code": r["country_code"], "country": r["country"], "category": "erasmus_ka171", "detail": r["description"], "source_url": r["source_url"]}
    for r in eplus if r["name"].startswith("Mobilities - ")
]
eplus = [r for r in eplus if not r["name"].startswith("Mobilities - ")]

APVV_COUNTRIES = {"Poľsko": "PL", "Česko": "CZ", "Srbsko": "RS", "Rakúsko": "AT", "Maďarsko": "HU", "Portugalsko": "PT", "Ukrajina": "UA", "Bulharsko": "BG",
                  "Čína": "CN", "Slovinsko": "SI", "Rumunsko": "RO", "Taiwan": "TW", "Francúzsko": "FR", "Čierna Hora": "ME"}
apvv = {}
for row in json.loads((EXTRACTS / "apvv_tuke_bilateral.json").read_text(encoding="utf-8")):
    cc = next((code for sk, code in APVV_COUNTRIES.items() if sk in row["call"]), None)
    if cc:
        apvv[cc] = apvv.get(cc, 0) + 1
country_level += [
    {"country_code": cc, "country": NAMES.get(cc, cc), "category": "bilateral_st_project",
     "detail": f"{n} bilaterálnych vedecko-technických projektov APVV s účasťou TUKE", "source_url": "https://www.apvv.sk/databaza-financovanych-projektov.html"}
    for cc, n in sorted(apvv.items(), key=lambda kv: -kv[1])
]
(RAW / "country_level.json").write_text(json.dumps(country_level, ensure_ascii=False, indent=1), encoding="utf-8")
print("country_level.json", len(country_level), "facts |", len({c["country_code"] for c in country_level}), "countries")

for fname, rows in (("researched_eplus.json", eplus), ("researched_keep.json", keep), ("researched_ceepus.json", ceepus)):
    (RAW / fname).write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(fname, len(rows), "records |", len({r["country_code"] for r in rows}), "countries |", sum(1 for r in rows if not r["city"]), "without city")
