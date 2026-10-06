"""Parse archived erasmus.tuke.sk per-faculty partner pages into flat records."""
import glob
import json
import os
import re

from bs4 import BeautifulSoup

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CACHE = ROOT / "data" / "cache"
SNAPSHOTS = ROOT / "data" / "evidence" / "erasmus_wayback"

CODE_RE = re.compile(r"\b([A-Z]{1,3})\s{1,3}([A-Z][A-Z\-\.]{2,})\s?(\d{2,3})\b")
LOOSE_RE = re.compile(r"\(([A-Za-z][A-Za-z\- ]{3,}\d{2,3})\)\s*$")
# codes typed wrongly on the source page -> official Erasmus code
FIX = {
    "AINNSBRU08": "A INNSBRU08",
    "I-MILANO02": "I MILANO02",
    "MONDRAG01": "E MONDRAG01",
    "INAPOLI03": "I NAPOLI03",
    "LUXLUX-VIL08": "LUX LUX-VIL08",
    "Pl OLSYTYN01": "PL OLSZTYN01",
}

records = []
unparsed = []


def find_code(txt):
    m = CODE_RE.search(txt)
    if m:
        return f"{m.group(1)} {m.group(2)}{m.group(3)}", txt[: m.start()].strip(" (–-")
    m = LOOSE_RE.search(txt)
    if m and m.group(1) in FIX:
        return FIX[m.group(1)], txt[: m.start()].strip(" (–-")
    return None, None


for path in sorted(glob.glob(str(SNAPSHOTS / "institucie-*.html"))):
    slug = os.path.basename(path)[:-5]
    staff = "zamestnanecke" in slug or "rektorat" in slug
    fac = slug.replace("institucie-", "").replace("zamestnanecke-", "").replace("-eu-a-ehp", "")
    soup = BeautifulSoup(open(path, encoding="utf-8").read(), "lxml")
    main = soup.find(id="main-content") or soup

    # staff pages: 4-column rows Country | University | Code | Area
    for row in main.select("table.tablepress tbody tr"):
        cols = [c.get_text(" ", strip=True) for c in row.find_all("td")]
        if len(cols) != 4:
            continue
        code, _ = find_code(cols[2])
        if not code:
            if cols[2] and cols[2] != "Code":
                unparsed.append((slug, cols[0], " / ".join(cols)))
            continue
        records.append(
            {
                "faculty": fac.upper(),
                "kind": "staff",
                "level": "",
                "country": cols[0].split("|")[-1].strip(),
                "name": cols[1],
                "code": code,
                "subjects": [cols[3]] if cols[3] else [],
                "source": slug,
            }
        )

    # student pages: Divi tabs, one tab per country, h3 = university, li = subject area
    for tabs in main.select(".et_pb_tabs"):
        labels = [a.get_text(" ", strip=True) for a in tabs.select("ul.et_pb_tabs_controls > li > a")]
        contents = tabs.select(".et_pb_all_tabs > .et_pb_tab")
        intro = contents[0].get_text(" ", strip=True) if contents else ""
        m = re.search(r"pre\s+(\S+)\s+stupe", intro)
        level = m.group(1) if m else ""
        for label, content in zip(labels, contents):
            country = label.split("|")[-1].strip()
            current = None
            for el in content.find_all(["h2", "h3", "h4", "p", "li"]):
                txt = el.get_text(" ", strip=True)
                if not txt:
                    continue
                if el.name == "li":
                    if current is not None:
                        current["subjects"].append(txt)
                    continue
                code, name = find_code(txt)
                if code:
                    current = {
                        "faculty": fac.upper(),
                        "kind": "staff" if staff else "student",
                        "level": level,
                        "country": country,
                        "name": name,
                        "code": code,
                        "subjects": [],
                        "source": slug,
                    }
                    records.append(current)
                elif el.name != "p" and len(txt) > 8:
                    unparsed.append((slug, country, txt))

json.dump(records, open(RAW / "erasmus_eu_rows.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("records", len(records))
print("unique codes", len({r["code"] for r in records}))
by = {}
for r in records:
    by.setdefault(r["source"], set()).add(r["code"])
for k, v in by.items():
    print(f"  {k}: {len(v)}")
print("levels:", sorted({r["level"] for r in records}))
print("countries:", sorted({r["country"] for r in records}))
print("unparsed:", len(unparsed))
for u in unparsed[:40]:
    print("  ?", u)
