"""Co-authorship partners of TUKE from OpenAlex: walk every TUKE work since 2015 and count partner institutions.

Works with a huge author list (CERN ALICE etc.) would flood the map, so they are counted separately:
  joint_works_core = works with at most CORE_MAX_INST distinct institutions
  joint_works_all  = every shared work
"""
import json
import os
import time

import requests

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CACHE = ROOT / "data" / "cache"

TUKE = "I183764125"
SINCE = 2015
CORE_MAX_INST = 15
# optional contact for the OpenAlex "polite pool": OPENALEX_MAILTO=you@example.org
MAILTO = os.environ.get("OPENALEX_MAILTO", "")
BASE = "https://api.openalex.org"
S = requests.Session()


def get(path, **params):
    if MAILTO:
        params["mailto"] = MAILTO
    for attempt in range(6):
        try:
            r = S.get(f"{BASE}/{path}", params=params, timeout=120)
            if r.status_code == 200:
                return r.json()
        except requests.RequestException:
            pass
        time.sleep(2 + attempt * 4)
    raise SystemExit(f"OpenAlex request failed: {path} {params}")


flt = f"authorships.institutions.lineage:{TUKE},publication_year:>{SINCE - 1}"
cursor, n_works, n_mega = "*", 0, 0
core, allc, last_year = {}, {}, {}
while cursor:
    page = get("works", filter=flt, per_page=200, cursor=cursor, select="id,publication_year,institutions_distinct_count,authorships")
    for w in page["results"]:
        n_works += 1
        insts = set()
        for a in w.get("authorships") or []:
            for i in a.get("institutions") or []:
                if i.get("id"):
                    insts.add(i["id"].rsplit("/", 1)[-1])
        insts.discard(TUKE)
        mega = (w.get("institutions_distinct_count") or len(insts)) > CORE_MAX_INST
        n_mega += mega
        for iid in insts:
            allc[iid] = allc.get(iid, 0) + 1
            if not mega:
                core[iid] = core.get(iid, 0) + 1
            last_year[iid] = max(last_year.get(iid, 0), w.get("publication_year") or 0)
    cursor = page["meta"].get("next_cursor")
    if n_works % 2000 < 200:
        print("works", n_works, "institutions", len(allc), flush=True)
    time.sleep(0.12)
print("TUKE works:", n_works, "| mega-collaboration works:", n_mega, "| partner institutions:", len(allc))

ids = sorted(allc, key=lambda i: -allc[i])
out = []
for k in range(0, len(ids), 50):
    chunk = ids[k : k + 50]
    res = get("institutions", filter="openalex:" + "|".join(chunk), per_page=50, select="id,display_name,ror,country_code,type,geo,homepage_url")
    for r in res["results"]:
        iid = r["id"].rsplit("/", 1)[-1]
        geo = r.get("geo") or {}
        out.append(
            {
                "openalex_id": iid,
                "name": r["display_name"],
                "ror": r.get("ror"),
                "type": r.get("type"),
                "city": geo.get("city"),
                "country": geo.get("country"),
                "country_code": r.get("country_code"),
                "lat": geo.get("latitude"),
                "lon": geo.get("longitude"),
                "website": r.get("homepage_url"),
                "joint_works_core": core.get(iid, 0),
                "joint_works_all": allc[iid],
                "last_joint_year": last_year.get(iid),
            }
        )
    time.sleep(0.12)

out.sort(key=lambda e: (-e["joint_works_core"], -e["joint_works_all"]))
json.dump(
    {"tuke_works": n_works, "mega_works": n_mega, "since": SINCE, "core_max_institutions": CORE_MAX_INST, "institutions": out},
    open(RAW / "openalex_coauthors.json", "w", encoding="utf-8"),
    ensure_ascii=False,
    indent=1,
)
foreign = [e for e in out if e["country_code"] != "SK"]
print("with details:", len(out), "| foreign:", len(foreign), "| countries:", len({e["country_code"] for e in foreign}))
for t in (1, 2, 3, 5, 10):
    sel = [e for e in foreign if e["joint_works_core"] >= t]
    print(f"  foreign core >= {t}: {len(sel)} institutions, {len({e['country_code'] for e in sel})} countries")
for e in foreign[:25]:
    print("  ", e["joint_works_core"], "/", e["joint_works_all"], e["name"], "|", e["city"], e["country_code"])
