"""Merge every raw source into one geocoded dataset for the globe.

Input : data/raw/*.json (see data/README.md for what each file is)
Output: data/tuke_cooperation.json  institutions with their cooperation links + per-city aggregation
        data/tuke_cooperation.csv   flat table for review in Excel
"""
import csv
import json
import math
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from geocode import geocode  # noqa: E402

ORIGIN = {"name": "Technická univerzita v Košiciach", "city": "Košice", "country_code": "SK", "lat": 48.7305, "lon": 21.2455}

CATEGORIES = {
    "erasmus_eu": "Erasmus+ bilaterálna zmluva (EÚ/EHP)",
    "erasmus_ka171": "Erasmus+ mobilita mimo EÚ (KA171)",
    "alliance": "Európska univerzita Ulysseus",
    "bilateral_agreement": "Zmluva / memorandum o spolupráci",
    "double_degree": "Dvojitý diplom",
    "network_membership": "Členstvo v medzinárodnej organizácii",
    "research_project_eu": "Spoločný projekt EÚ (FP7 / H2020 / Horizon Europe)",
    "research_cooperation": "Výskumná spolupráca",
    "research_infrastructure": "Veľká výskumná infraštruktúra",
    "industry_partner": "Zahraničný priemyselný partner",
    "eit_kic": "EIT znalostné a inovačné spoločenstvo",
    "crossborder_project": "Cezhraničný / regionálny projekt",
    "erasmus_ka2": "Erasmus+ projekt spolupráce (KA2)",
    "ceepus": "CEEPUS sieť",
    "cost": "COST akcia",
    "bilateral_st_project": "Bilaterálny vedecko-technický projekt",
    "student_org": "Medzinárodná študentská organizácia",
    "coauthorship": "Spoločné vedecké publikácie",
    "other": "Iná spolupráca",
}

COUNTRY_NAMES = json.loads((ROOT / "data" / "country_names.json").read_text(encoding="utf-8"))
# programme-specific codes -> ISO 3166-1 alpha-2
ISO_FIX = {"EL": "GR", "UK": "GB"}

STOP = {"the", "of", "and", "in", "at", "de", "di", "del", "la", "le", "v", "w", "im", "u", "na", "for", "e", "y", "et", "fur", "der", "des"}


def norm(text):
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    words = [w for w in re.sub(r"[^a-z0-9]+", " ", text).split() if w not in STOP]
    return " ".join(words)


def name_variants(name):
    """'English name (Local name)' -> normalized forms of the whole, the English and the local part."""
    out = {norm(name)}
    m = re.match(r"^(.*?)\s*\((.+)\)\s*$", name or "")
    if m:
        out |= {norm(m.group(1)), norm(m.group(2))}
    return {v for v in out if len(v) > 5}


institutions = {}
by_pic, by_name = {}, {}


def upsert(name, city, cc, lat, lon, link, pic=None, extra_names=()):
    cc = ISO_FIX.get((cc or "").upper(), (cc or "").upper())
    variants = set()
    for n in (name, *extra_names):
        variants |= name_variants(n)
    inst = by_pic.get(pic) if pic else None
    if inst is None:
        inst = next((by_name[(cc, v)] for v in variants if (cc, v) in by_name), None)
    if inst is None:
        inst = {
            "id": f"i{len(institutions) + 1:04d}",
            "name": name,
            "city": (city or "").split("|")[0].strip().title() if (city or "").isupper() else (city or "").split("|")[0].strip(),
            "country": COUNTRY_NAMES.get(cc, cc),
            "country_code": cc,
            "lat": lat,
            "lon": lon,
            "links": [],
        }
        institutions[inst["id"]] = inst
    if pic:
        by_pic[pic] = inst
    for v in variants:
        by_name.setdefault((cc, v), inst)
    if inst["lat"] is None and lat is not None:
        inst["lat"], inst["lon"] = lat, lon
    if not inst["city"] and city:
        inst["city"] = city
    inst["links"].append(link)
    return inst


def load(name):
    path = RAW / name
    if not path.exists():
        print("  (missing)", name)
        return None
    return json.loads(path.read_text(encoding="utf-8"))


# registry lists the legal seat, the partner named by TUKE sits elsewhere
ERASMUS_OVERRIDE = {"P LISBOA52": {"city": "Porto", "lat": 41.15022, "lon": -8.61035}}

squash = lambda code: re.sub(r"\s+", "", code).upper()  # noqa: E731
nominations = {squash(n["erasmus_code"]): n for n in (load("erasmus_nominations.json") or {"destinations": []})["destinations"]}

# 1) Erasmus+ EU/EEA bilateral agreements
for e in load("erasmus_eu.json") or []:
    e.update(ERASMUS_OVERRIDE.get(e["erasmus_code"], {}))
    nom = nominations.pop(squash(e["erasmus_code"]), None)
    upsert(
        e["name"], e["city"], e["country_code"], e["lat"], e["lon"],
        {
            "category": "erasmus_eu",
            "tuke_units": e["faculties"],
            "detail": ("študenti" if "student" in e["kinds"] else "") + (" + " if len(e["kinds"]) == 2 else "") + ("zamestnanci" if "staff" in e["kinds"] else "") + f"; Erasmus kód {e['erasmus_code']}",
            "subjects": e["subjects"],
            "nominated_students": nom["student"] if nom else 0,
            "nominated_staff": nom["staff"] if nom else 0,
            "source_url": "https://erasmus.tuke.sk/partnerske-institucie-v-eu-a-ehp/",
            "confidence": "high",
        },
        pic=e.get("pic"),
        extra_names=[e.get("registry_name") or ""],
    )

# destinations people were nominated to although the partner lists do not name them (newer agreements, Ulysseus, traineeships)
registry = {}
for path in (ROOT / "data" / "cache" / "hei").glob("*.json"):
    for item in json.loads(path.read_text(encoding="utf-8")).get("data", []):
        a = item["attributes"]
        ids = {o["type"]: o["value"] for o in a.get("other_id") or []}
        if "erasmus" in ids:
            registry[squash(ids["erasmus"])] = {"name": a["label"], "city": a["city"], "cc": a["country"], "pic": ids.get("pic")}
for code, nom in nominations.items():
    h = registry.get(code)
    if not h or h["cc"] == "SK":
        continue
    upsert(
        h["name"].title() if h["name"].isupper() else h["name"], h["city"], h["cc"], None, None,
        {
            "category": "erasmus_eu",
            "tuke_units": ["TUKE"],
            "detail": f"Erasmus+ mobilita (nominácie); Erasmus kód {nom['erasmus_code']}",
            "nominated_students": nom["student"],
            "nominated_staff": nom["staff"],
            "source_url": "https://erasmus.tuke.sk/vyzvy-na-studentsku-mobilitu/",
            "confidence": "medium",
        },
        pic=h["pic"],
    )

# 2) EU framework programme consortia (CORDIS)
for p in load("cordis_partners.json") or []:
    if p["country_code"] == "SK":
        continue
    acr = sorted({x["acronym"] for x in p["projects"]})
    upsert(
        p["name"].title() if p["name"].isupper() else p["name"], p["city"], p["country_code"], p["lat"], p["lon"],
        {
            "category": "research_project_eu",
            "tuke_units": ["TUKE"],
            "detail": f"{len(acr)} spoločných projektov: " + ", ".join(acr),
            "projects": p["projects"],
            "source_url": f"https://cordis.europa.eu/project/id/{p['projects'][0]['project_id']}",
            "confidence": "high",
        },
        pic=p["organisation_id"] or None,
    )

# 3) researched sources (agents): same record schema
for path in sorted(RAW.glob("researched_*.json")):
    for r in load(path.name) or []:
        if (r.get("country_code") or "").upper() == "SK":
            continue
        upsert(
            r["name"], r.get("city"), r.get("country_code"), r.get("lat"), r.get("lon"),
            {
                "category": r.get("category") if r.get("category") in CATEGORIES else "other",
                "tuke_units": [u.strip() for u in (r.get("tuke_unit") or "TUKE").split(",")],
                "detail": r.get("description", ""),
                "since": r.get("since", ""),
                "source_url": r.get("source_url", ""),
                "confidence": r.get("confidence", "medium"),
            },
            extra_names=[r.get("name_local") or ""],
        )

# 4) co-authored publications (OpenAlex); single shared papers are too weak a tie for the map
MIN_JOINT = 3
# OpenAlex matches affiliation strings to organisations by name, which misfires on generic words
# ("Faculty ... with a seat in Prešov" -> SEAT the car maker, "Department of Finance" -> a ministry).
# Universities and research facilities are matched reliably; other types only when the name is clearly a research body.
RESEARCH_BODY = re.compile(r"academ|research|recherche|investigaci|forschung|helmholtz|fraunhofer|eurocontrol|telecomunica|cern|nuclear", re.I)
oa = load("openalex_coauthors.json") or {"institutions": []}
for o in oa["institutions"]:
    if o["country_code"] in (None, "SK") or o["joint_works_core"] < MIN_JOINT:
        continue
    if o["type"] not in ("education", "facility") and not RESEARCH_BODY.search(o["name"]):
        continue
    upsert(
        o["name"], o["city"], o["country_code"], o["lat"], o["lon"],
        {
            "category": "coauthorship",
            "tuke_units": ["TUKE"],
            "detail": f"{o['joint_works_core']} spoločných publikácií od {oa['since']} (posledná {o['last_joint_year']})",
            "joint_works": o["joint_works_core"],
            "source_url": f"https://openalex.org/works?filter=authorships.institutions.lineage:I183764125,authorships.institutions.lineage:{o['openalex_id']}",
            "confidence": "high",
        },
    )

# city strings that the source platforms garbled
CITY_FIX = {"Galati, Galati county": "Galați", "Bsokivce": "Boskovice", "Crnogorskih Serdara 63Podgorica": "Podgorica",
            "Marka Marulica 2Sarajewo": "Sarajevo", "Podpgorica": "Podgorica"}
for inst in institutions.values():
    inst["city"] = CITY_FIX.get(inst["city"], inst["city"])
    if not inst["city"] and "Bucharest" in inst["name"]:
        inst["city"] = "Bucharest"

# fill coordinates that sources did not provide
for inst in institutions.values():
    if inst["lat"] is None and inst["city"]:
        g = geocode(inst["city"], inst["country_code"])
        if g:
            inst["lat"], inst["lon"] = g["lat"], g["lon"]

# Ties with Russian and Belarusian institutions are politically sensitive since 2022. They stay in the data
# (list "hidden") but are left off the map until the organisers decide otherwise.
HIDDEN_COUNTRIES = {"RU", "BY"}
hidden = [i for i in institutions.values() if i["country_code"] in HIDDEN_COUNTRIES]
placed = [i for i in institutions.values() if i["lat"] is not None and i["country_code"] not in HIDDEN_COUNTRIES]
unplaced = [i for i in institutions.values() if i["lat"] is None and i["country_code"] not in HIDDEN_COUNTRIES]


def km(a, b):
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b["lon"] - a["lon"]) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


# one node per city: sources spell cities differently (Praha / Prague / Praha 6), so cluster by distance instead of by name
CITY_RADIUS_KM = 15
cities = []
for i in sorted(placed, key=lambda i: -len(i["links"])):
    c = next((c for c in cities if c["country_code"] == i["country_code"] and km(c, i) <= CITY_RADIUS_KM), None)
    if c is None:
        c = {"country": i["country"], "country_code": i["country_code"], "lat": i["lat"], "lon": i["lon"], "names": {}, "institutions": [], "categories": set(), "links": 0}
        cities.append(c)
    if i["city"]:
        c["names"][i["city"]] = c["names"].get(i["city"], 0) + 1
    c["institutions"].append(i["id"])
    c["categories"] |= {l["category"] for l in i["links"]}
    c["links"] += len(i["links"])
city_list = []
for n, c in enumerate(sorted(cities, key=lambda c: -c["links"]), 1):
    name = max(c.pop("names").items(), key=lambda kv: (kv[1], -len(kv[0])))[0] if c["names"] else ""
    city_list.append({"id": f"c{n:04d}", "city": name, **c, "categories": sorted(c["categories"]), "distance_km": round(km(ORIGIN, c))})
city_of = {iid: c["id"] for c in city_list for iid in c["institutions"]}
for i in placed:
    i["city_id"] = city_of[i["id"]]

# per-country summary; country_level.json adds facts that are published without a partner institution
countries = {}
for i in placed:
    c = countries.setdefault(i["country_code"], {"country_code": i["country_code"], "country": i["country"], "institutions": 0, "cities": set(), "categories": set(), "facts": []})
    c["institutions"] += 1
    c["cities"].add(i["city_id"])
    c["categories"] |= {l["category"] for l in i["links"]}
for f in load("country_level.json") or []:
    cc = ISO_FIX.get(f["country_code"], f["country_code"])
    if cc in HIDDEN_COUNTRIES or cc == "SK":
        continue
    c = countries.setdefault(cc, {"country_code": cc, "country": COUNTRY_NAMES.get(cc, cc), "institutions": 0, "cities": set(), "categories": set(), "facts": []})
    c["categories"].add(f["category"])
    c["facts"].append({"category": f["category"], "detail": f["detail"], "source_url": f["source_url"]})
country_list = sorted(({**c, "cities": len(c["cities"]), "categories": sorted(c["categories"])} for c in countries.values()), key=lambda c: -c["institutions"])

out = {
    "generated": date.today().isoformat(),
    "origin": ORIGIN,
    "categories": CATEGORIES,
    "stats": {
        "institutions": len(placed),
        "cities": len(city_list),
        "countries": len(country_list),
        "countries_with_institution": len({i["country_code"] for i in placed}),
        "farthest": max(city_list, key=lambda c: c["distance_km"])["city"],
        "links": sum(len(i["links"]) for i in placed),
    },
    "institutions": sorted(placed, key=lambda i: (i["country"], i["city"], i["name"])),
    "cities": city_list,
    "countries": country_list,
    "unplaced": unplaced,
    "hidden": hidden,
}
(ROOT / "data" / "tuke_cooperation.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

with open(ROOT / "data" / "tuke_cooperation.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f, delimiter=";")
    w.writerow(["institution", "city", "country", "country_code", "lat", "lon", "category", "tuke_units", "detail", "confidence", "source_url"])
    for i in out["institutions"]:
        for l in i["links"]:
            w.writerow([i["name"], i["city"], i["country"], i["country_code"], i["lat"], i["lon"], l["category"], ", ".join(l["tuke_units"]), l["detail"], l["confidence"], l["source_url"]])

print(json.dumps(out["stats"], indent=1))
per_cat = {}
for i in placed:
    for c in {l["category"] for l in i["links"]}:
        per_cat[c] = per_cat.get(c, 0) + 1
for c, n in sorted(per_cat.items(), key=lambda kv: -kv[1]):
    print(f"  {n:5d}  {c}")
print("hidden (RU/BY):", len(hidden))
print("unplaced (no coordinates):", len(unplaced))
for i in unplaced[:30]:
    print("   ", i["name"], "|", i["city"], i["country_code"])
