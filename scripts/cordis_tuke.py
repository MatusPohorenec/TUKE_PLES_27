"""Extract every EU framework-programme project with TUKE and all consortium partners (CORDIS bulk CSV)."""
import csv
import io
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CACHE = ROOT / "data" / "cache"

csv.field_size_limit(10**9)
TUKE_PIC = "999839238"
PROGRAMMES = [("HORIZON.zip", "Horizon Europe"), ("h2020.zip", "Horizon 2020"), ("fp7.zip", "FP7")]


def rows(zf, suffix):
    name = [n for n in zf.namelist() if n.lower().endswith(suffix)][0]
    with zf.open(name) as f:
        rd = csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig"), delimiter=";", quotechar='"')
        hdr = next(rd)
        for row in rd:
            yield dict(zip(hdr, row))


projects, partners = [], {}
for zname, programme in PROGRAMMES:
    zf = zipfile.ZipFile(CACHE / "cordis" / zname)
    orgs = list(rows(zf, "organization.csv"))
    tuke = {o["projectID"]: o for o in orgs if o["organisationID"] == TUKE_PIC}
    meta = {p["id"]: p for p in rows(zf, "project.csv") if p["id"] in tuke}
    for pid, t in tuke.items():
        p = meta.get(pid, {})
        projects.append(
            {
                "project_id": pid,
                "acronym": t["projectAcronym"],
                "title": p.get("title", ""),
                "programme": programme,
                "start": p.get("startDate", ""),
                "end": p.get("endDate", ""),
                "tuke_role": t["role"],
                "url": f"https://cordis.europa.eu/project/id/{pid}",
            }
        )
    for o in orgs:
        if o["projectID"] not in tuke or o["organisationID"] == TUKE_PIC:
            continue
        lat = lon = None
        if "," in (o.get("geolocation") or ""):
            try:
                lat, lon = (round(float(x), 5) for x in o["geolocation"].strip("()").split(",")[:2])
            except ValueError:
                pass
        key = o["organisationID"] or o["name"]
        e = partners.setdefault(
            key,
            {
                "organisation_id": o["organisationID"],
                "name": o["name"],
                "short_name": o.get("shortName", ""),
                "activity_type": o.get("activityType", ""),
                "city": o.get("city", ""),
                "country_code": o.get("country", ""),
                "lat": lat,
                "lon": lon,
                "website": o.get("organizationURL", ""),
                "projects": [],
            },
        )
        if e["lat"] is None and lat is not None:
            e["lat"], e["lon"] = lat, lon
        e["projects"].append({"acronym": o["projectAcronym"], "programme": programme, "project_id": o["projectID"]})

out = sorted(partners.values(), key=lambda e: (-len(e["projects"]), e["name"]))
json.dump(projects, open(RAW / "cordis_projects.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(out, open(RAW / "cordis_partners.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("projects", len(projects), {pr: sum(1 for p in projects if p["programme"] == pr) for _, pr in PROGRAMMES})
print("partner orgs", len(out), "| without coords", sum(1 for e in out if e["lat"] is None))
print("countries", len({e["country_code"] for e in out}), sorted({e["country_code"] for e in out}))
for e in out[:12]:
    print(" ", len(e["projects"]), e["name"], "|", e["city"], e["country_code"])
