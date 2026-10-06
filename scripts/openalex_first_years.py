"""First year of joint publications between TUKE and each co-authorship partner (OpenAlex), for the timeline.

openalex_tuke.py counts partners from 2015 on. This asks OpenAlex once per partner how their joint works spread
over all years, with the same limit on mega-collaborations (at most CORE_MAX_INST institutions per work), and
keeps the first year. Resumable: partners already in the output are skipped.

Output: data/raw/openalex_first_years.json  {openalex_id: {"first": 1998, "years": {"1998": 1, ...}}}
"""
import json
import os
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = RAW / "openalex_first_years.json"

TUKE = "I183764125"
CORE_MAX_INST = 15
MIN_JOINT = 3  # the same threshold build_dataset.py uses for the map
# optional contact for the OpenAlex "polite pool": OPENALEX_MAILTO=you@example.org
MAILTO = os.environ.get("OPENALEX_MAILTO", "")
BASE = "https://api.openalex.org"
S = requests.Session()


def get(path, **params):
    if MAILTO:
        params["mailto"] = MAILTO
    for attempt in range(6):
        try:
            r = S.get(f"{BASE}/{path}", params=params, timeout=60)
            if r.status_code == 200:
                return r.json()
        except requests.RequestException:
            pass
        time.sleep(2 + attempt * 4)
    raise SystemExit(f"OpenAlex request failed: {path} {params}")


def save(data):
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")


coauthors = json.loads((RAW / "openalex_coauthors.json").read_text(encoding="utf-8"))
ids = [o["openalex_id"] for o in coauthors["institutions"] if o["country_code"] not in (None, "SK") and o["joint_works_core"] >= MIN_JOINT]
out = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
todo = [i for i in ids if i not in out]
print(f"{len(ids)} partners, {len(todo)} to ask")
for n, oid in enumerate(todo, 1):
    flt = f"authorships.institutions.lineage:{TUKE},authorships.institutions.lineage:{oid},institutions_distinct_count:<{CORE_MAX_INST + 1}"
    page = get("works", filter=flt, group_by="publication_year")
    years = {str(g["key"]): g["count"] for g in page.get("group_by", []) if str(g.get("key", "")).isdigit()}
    out[oid] = {"first": min(int(y) for y in years) if years else None, "years": years}
    if n % 25 == 0:
        save(out)
        print(f"  {n}/{len(todo)}")
    time.sleep(0.12)
save(out)
firsts = [v["first"] for v in out.values() if v["first"]]
print(f"done: {len(out)} partners, first joint year from {min(firsts)} to {max(firsts)}")
