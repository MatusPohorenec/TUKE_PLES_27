"""Collapse parsed Erasmus rows to one record per institution and attach HEI registry data."""
import glob
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CACHE = ROOT / "data" / "cache"

raw = json.load(open(RAW / "erasmus_eu_rows.json", encoding="utf-8"))

# Erasmus code -> registry entry
hei = {}
for path in glob.glob(str(CACHE / "hei" / "*.json")):
    try:
        data = json.load(open(path, encoding="utf-8")).get("data", [])
    except Exception:
        continue
    for item in data:
        a = item["attributes"]
        pic = next((o["value"] for o in a.get("other_id") or [] if o.get("type") == "pic"), None)
        for oid in a.get("other_id") or []:
            if oid.get("type") == "erasmus":
                key = re.sub(r"\s+", "", oid["value"]).upper()
                hei[key] = {
                    "hei_id": a.get("hei_id"),
                    "pic": pic,
                    "label": a.get("label"),
                    "city": a.get("city"),
                    "country_code": a.get("country"),
                    "address": (a.get("mailing_address") or {}),
                    "website": a.get("website_url"),
                }

FAC = {
    "FEI": "FEI", "SJF": "SjF", "SVF": "SvF", "EKF": "EkF", "FBERG": "FBERG", "FMMR": "FMMR",
    "FU": "FU", "FVT": "FVT", "LF": "LF", "BILATERALNE": "TUKE", "REKTORAT": "TUKE",
}

# codes mistyped or outdated on the source page -> current registry code
ALIAS = {
    "FLILE11": "F LILLE11",
    "GEGALEO01": "G EGALEO02",  # Piraeus UAS merged into University of West Attica
    "IBENVEN02": "I BENEVEN02",
    "ICAGLIARI01": "I CAGLIAR01",
    "ICONSENZA01": "I COSENZA01",
    "IMILANO016": "I MILANO16",
}

inst = {}
for r in raw:
    key = re.sub(r"\s+", "", r["code"]).upper()
    if key in ALIAS:
        r["code"] = ALIAS[key]
        key = re.sub(r"\s+", "", r["code"]).upper()
    e = inst.setdefault(
        key,
        {"erasmus_code": r["code"], "names": {}, "country": r["country"], "faculties": set(), "kinds": set(), "subjects": set()},
    )
    e["names"][r["name"]] = e["names"].get(r["name"], 0) + 1
    e["faculties"].add(FAC.get(r["faculty"], r["faculty"]))
    e["kinds"].add(r["kind"])
    for s in r["subjects"]:
        s = re.sub(r"\s*\(\d{3,4}\)\s*$", "", s).strip()
        if s:
            e["subjects"].add(s[0].upper() + s[1:])

out, missing = [], []
for key, e in sorted(inst.items()):
    name = max(e["names"].items(), key=lambda kv: (kv[1], len(kv[0])))[0]
    h = hei.get(key)
    if not h:
        missing.append((e["erasmus_code"], name))
    out.append(
        {
            "erasmus_code": e["erasmus_code"],
            "name": name,
            "registry_name": h["label"] if h else None,
            "pic": h["pic"] if h else None,
            "city": h["city"] if h else None,
            "country": e["country"],
            "country_code": h["country_code"] if h else None,
            "address": h["address"] if h else None,
            "website": h["website"] if h else None,
            "faculties": sorted(e["faculties"]),
            "kinds": sorted(e["kinds"]),
            "subjects": sorted(e["subjects"]),
        }
    )

json.dump(out, open(CACHE / "erasmus_institutions.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("institutions", len(out), "| registry hits", len(out) - len(missing), "| missing", len(missing))
for m in missing:
    print("  MISSING", m)
