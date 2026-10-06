"""City-level geocoding through Nominatim with an on-disk cache (1 request/second)."""
import json
import os
import sys
import time

import requests

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CACHE = ROOT / "data" / "cache"

CACHE_PATH = CACHE / "geocache.json"
UA = "tuke-ples-2027-globe/0.1 (+https://github.com/MatusPohorenec/TUKE_PLES_27)"

cache = json.load(open(CACHE_PATH, encoding="utf-8")) if os.path.exists(CACHE_PATH) else {}


def geocode(city, country_code):
    city = (city or "").split("|")[0].strip()
    key = f"{city}|{country_code}".lower()
    if key in cache:
        return cache[key]
    params = {"format": "jsonv2", "limit": 1, "city": city, "accept-language": "en"}
    if country_code:
        params["countrycodes"] = country_code.lower()
    res = None
    free = {"format": "jsonv2", "limit": 1, "q": city, "countrycodes": (country_code or "").lower(), "accept-language": "en"}
    # last attempt drops the country filter: territories such as Macau are filed under another ISO code in OSM
    for attempt in (params, free, {k: v for k, v in free.items() if k != "countrycodes"}):
        try:
            r = requests.get("https://nominatim.openstreetmap.org/search", params=attempt, headers={"User-Agent": UA}, timeout=30)
            time.sleep(1.1)
            data = r.json() if r.status_code == 200 else []
        except Exception as exc:  # network hiccup: leave uncached so a rerun retries
            print("ERR", city, country_code, exc, file=sys.stderr)
            return None
        if data:
            res = {"lat": round(float(data[0]["lat"]), 5), "lon": round(float(data[0]["lon"]), 5), "display": data[0].get("display_name", "")}
            break
    cache[key] = res
    json.dump(cache, open(CACHE_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    return res


if __name__ == "__main__":
    inst = json.load(open(CACHE / "erasmus_institutions.json", encoding="utf-8"))
    # registry gap: Estonian Aviation Academy sits in Reola near Tartu
    for i in inst:
        if i["erasmus_code"] == "EE TARTU04":
            i["city"], i["country_code"] = "Tartu", "EE"
    miss = 0
    for n, i in enumerate(inst, 1):
        g = geocode(i["city"], i["country_code"])
        if g:
            i["lat"], i["lon"] = g["lat"], g["lon"]
        else:
            i["lat"] = i["lon"] = None
            miss += 1
            print("NO GEO", i["erasmus_code"], i["city"], i["country_code"])
        if n % 25 == 0:
            print(n, "/", len(inst), flush=True)
    json.dump(inst, open(RAW / "erasmus_eu.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("done, missing", miss)
