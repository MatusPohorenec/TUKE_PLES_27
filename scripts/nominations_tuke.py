"""Count Erasmus+ nominations per destination from the result PDFs published on erasmus.tuke.sk.

The PDFs list students by name and e-mail. Nothing personal is stored: PDFs are read in memory,
e-mails are used only to drop repeated uploads of the same list, and the output holds counts per Erasmus code.
"""
import hashlib
import io
import json
import re
import time
from pathlib import Path

import pypdf
import requests

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
UA = {"User-Agent": "Mozilla/5.0 tuke-ples-2027-globe/0.1"}
API = "https://erasmus.tuke.sk/wp-json/wp/v2/media"
CODE_RE = re.compile(r"\b([A-Z]{1,3})\s{1,2}([A-Z][A-Z\-\.]{2,}?)\s?(\d)\s?(\d{1,2})\b")
MAIL_RE = re.compile(r"[\w.\-]+@[\w.\-\s]{3,30}?\.s\s?k", re.I)

urls = []
for page in range(1, 6):
    r = requests.get(API, params={"per_page": 100, "page": page, "mime_type": "application/pdf", "_fields": "date,source_url"}, headers=UA, timeout=60)
    if r.status_code != 200:
        break
    urls += [(m["date"][:10], m["source_url"]) for m in r.json() if re.search(r"nominaci|teaching|training|trening|staz", m["source_url"], re.I)]

seen, counts, files = set(), {}, 0
for date, url in sorted(urls):
    try:
        pdf = pypdf.PdfReader(io.BytesIO(requests.get(url, headers=UA, timeout=120).content))
        text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    except Exception as exc:
        print("skip", url, exc)
        continue
    files += 1
    kind = "staff" if re.search(r"teaching|training|trening", url, re.I) else "student"
    for line in text.splitlines():
        code = CODE_RE.search(line)
        if not code:
            continue
        key = f"{code.group(1)} {code.group(2)}{code.group(3)}{code.group(4)}"
        mail = MAIL_RE.search(line)
        person = hashlib.sha256((mail.group(0) if mail else line).lower().replace(" ", "").encode()).hexdigest()
        if (person, key) in seen:
            continue
        seen.add((person, key))
        c = counts.setdefault(key, {"erasmus_code": key, "student": 0, "staff": 0, "first": date[:4], "last": date[:4]})
        c[kind] += 1
        c["last"] = max(c["last"], date[:4])
    time.sleep(0.3)

out = sorted(counts.values(), key=lambda c: -(c["student"] + c["staff"]))
json.dump({"source": "https://erasmus.tuke.sk (PDF výsledky nominácií 2022–2026)", "files": files, "destinations": out}, open(RAW / "erasmus_nominations.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("files", files, "| destinations", len(out), "| nominations", sum(c["student"] + c["staff"] for c in out))
for c in out[:15]:
    print(" ", c)
