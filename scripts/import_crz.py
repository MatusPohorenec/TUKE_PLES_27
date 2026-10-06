"""Signed international agreements of TUKE from the Slovak Central Register of Contracts (crz.gov.sk).

Input : data/cache/extracts/crz_tuke_international.txt  (date | title | amount | party | party | /zmluva/<id>/)
Output: data/raw/researched_crz.json

Only partners listed in PARTNERS are taken, so grant agreements with individuals and domestic contracts are dropped.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "cache" / "extracts" / "crz_tuke_international.txt"
NAMES = json.loads((ROOT / "data" / "country_names.json").read_text(encoding="utf-8"))

# substring of the contract party (lowercase) -> (name, city, country code)
PARTNERS = {
    "technology silchar": ("National Institute of Technology Silchar", "Silchar", "IN"),
    "indian council for cultural relations": ("Indian Council for Cultural Relations", "New Delhi", "IN"),
    "technology roorkee": ("Indian Institute of Technology Roorkee", "Roorkee", "IN"),
    "information technology, allahabad": ("Indian Institute of Information Technology Allahabad", "Prayagraj", "IN"),
    "politecnico di bari": ("Politecnico di Bari", "Bari", "IT"),
    "libera università mediterranea": ("LUM Giuseppe Degennaro University", "Casamassima", "IT"),
    "university of bari": ("University of Bari Aldo Moro", "Bari", "IT"),
    "thales alenia space": ("Thales Alenia Space Italia", "Rome", "IT"),
    "university of salerno": ("University of Salerno", "Fisciano", "IT"),
    "studi sociali guido c": ("LUISS Guido Carli", "Rome", "IT"),
    "university of genoa": ("University of Genoa", "Genoa", "IT"),
    "degli studi di ge": ("University of Genoa", "Genoa", "IT"),
    "hong kong metropolitan": ("Hong Kong Metropolitan University", "Hong Kong", "HK"),
    "university of montenegro": ("University of Montenegro", "Podgorica", "ME"),
    "pomeroy academy": ("Pomeroy Academy", "Singapore", "SG"),
    "de sevilla": ("University of Seville", "Seville", "ES"),
    "of sevilla": ("University of Seville", "Seville", "ES"),
    "universidad de cantabria": ("University of Cantabria", "Santander", "ES"),
    "european space agency": ("European Space Agency (ESTEC)", "Noordwijk", "NL"),
    "teknikal malaysia melaka": ("Universiti Teknikal Malaysia Melaka", "Melaka", "MY"),
    "malaysia pahang": ("Universiti Malaysia Pahang Al-Sultan Abdullah", "Pekan", "MY"),
    "bergakademie freiberg": ("TU Bergakademie Freiberg", "Freiberg", "DE"),
    "lappeenranta": ("LUT University", "Lappeenranta", "FI"),
    "guericke": ("Otto von Guericke University Magdeburg", "Magdeburg", "DE"),
    "münster": ("University of Münster", "Münster", "DE"),
    "chartered certified accountants": ("ACCA – Association of Chartered Certified Accountants", "London", "GB"),
    "mci internationale": ("MCI | The Entrepreneurial School", "Innsbruck", "AT"),
    "haaga-helia": ("Haaga-Helia University of Applied Sciences", "Helsinki", "FI"),
    "lab university": ("LAB University of Applied Sciences", "Lahti", "FI"),
    "obuda university": ("Óbuda University", "Budapest", "HU"),
    "ludovika": ("Ludovika University of Public Service", "Budapest", "HU"),
    "university of miskolc": ("University of Miskolc", "Miskolc", "HU"),
    "miskolci egyetem": ("University of Miskolc", "Miskolc", "HU"),
    "kaunas university of technology": ("Kaunas University of Technology", "Kaunas", "LT"),
    "keimyung": ("Keimyung University", "Daegu", "KR"),
    "chungbuk": ("Chungbuk National University", "Cheongju", "KR"),
    "kookmin": ("Kookmin University", "Seoul", "KR"),
    "inha university": ("Inha University", "Incheon", "KR"),
    "daelim": ("Daelim University College", "Anyang", "KR"),
    "sun moon": ("Sun Moon University", "Asan", "KR"),
    "da nang": ("The University of Da Nang", "Da Nang", "VN"),
    "laval": ("Université Laval", "Québec", "CA"),
    "côte d": ("Université Côte d'Azur", "Nice", "FR"),
    "kyiv national university of technologies": ("Kyiv National University of Technologies and Design", "Kyiv", "UA"),
    "beketov": ("O. M. Beketov National University of Urban Economy", "Kharkiv", "UA"),
    "uzhhorod": ("Uzhhorod National University", "Uzhhorod", "UA"),
    "lviv polytechnic": ("Lviv Polytechnic National University", "Lviv", "UA"),
    "ternopil": ("Ternopil Ivan Puluj National Technical University", "Ternopil", "UA"),
    "kherson state maritime": ("Kherson State Maritime Academy", "Kherson", "UA"),
    "national metallurgical academy": ("National Metallurgical Academy of Ukraine", "Dnipro", "UA"),
    "kyjevský polytechnický": ("Igor Sikorsky Kyiv Polytechnic Institute", "Kyiv", "UA"),
    "rzeszow university": ("Rzeszów University of Technology", "Rzeszów", "PL"),
    "rzeszów university": ("Rzeszów University of Technology", "Rzeszów", "PL"),
    "politechniką rzeszowską": ("Rzeszów University of Technology", "Rzeszów", "PL"),
    "łukasiewicz research network": ("Łukasiewicz Research Network – Institute for Engineering of Polymer Materials and Dyes", "Toruń", "PL"),
    "instytut metali nieżelaznych": ("Łukasiewicz – Institute of Non-Ferrous Metals", "Gliwice", "PL"),
    "agh ust": ("AGH University of Krakow", "Kraków", "PL"),
    "economics in katowice": ("University of Economics in Katowice", "Katowice", "PL"),
    "silesian university": ("Silesian University of Technology", "Gliwice", "PL"),
    "sileslan university": ("Silesian University of Technology", "Gliwice", "PL"),
    "jacob of paradies": ("Jacob of Paradies University", "Gorzów Wielkopolski", "PL"),
    "jagiellonian": ("Jagiellonian University", "Kraków", "PL"),
    "university of novi sad": ("University of Novi Sad, Faculty of Technical Sciences", "Novi Sad", "RS"),
    "mendel university": ("Mendel University in Brno", "Brno", "CZ"),
    "hradec králové": ("University of Hradec Králové", "Hradec Králové", "CZ"),
    "tomas bata": ("Tomas Bata University in Zlín", "Zlín", "CZ"),
    "škoda auto": ("ŠKODA AUTO University", "Mladá Boleslav", "CZ"),
    "ural federal": ("Ural Federal University", "Yekaterinburg", "RU"),
    "hsinchu science park": ("Hsinchu Science Park Bureau", "Hsinchu", "TW"),
    "national taipei university of technology": ("National Taipei University of Technology", "Taipei", "TW"),
    "chung yuan": ("Chung Yuan Christian University", "Taoyuan", "TW"),
    "tunghai": ("Tunghai University", "Taichung", "TW"),
    "chung hua": ("Chung Hua University", "Hsinchu", "TW"),
    "qingdao": ("Qingdao University of Technology", "Qingdao", "CN"),
    "kapodistrian": ("National and Kapodistrian University of Athens", "Athens", "GR"),
    "moldova state": ("Moldova State University", "Chișinău", "MD"),
    "slavonski brod": ("University of Slavonski Brod", "Slavonski Brod", "HR"),
    "delta university": ("Delta University for Science and Technology", "Gamasa", "EG"),
    "armenian state": ("Armenian State University of Economics", "Yerevan", "AM"),
    "baranovichi": ("Baranovichi State University", "Baranavichy", "BY"),
    "dunarea de jos": ("Dunărea de Jos University of Galați", "Galați", "RO"),
    "estadual de campinas": ("University of Campinas (UNICAMP)", "Campinas", "BR"),
    "tel-aviv": ("Tel Aviv University", "Tel Aviv", "IL"),
    "university of toyama": ("University of Toyama", "Toyama", "JP"),
    "eit rawmaterials": ("EIT RawMaterials", "Berlin", "DE"),
    "eit kic urban mobility": ("EIT Urban Mobility", "Barcelona", "ES"),
}

UNIT = {"190102": "SjF", "104001": "FEI", "101001": "FBERG", "101401": "FBERG", "107001": "EkF", "190117": "TUKE", "190001": "TUKE"}


def categorize(title):
    t = title.lower()
    if "ulysseus" in t:
        return "alliance"
    if "esa " in t or "esa project" in t:
        return "research_infrastructure"
    if "joint study" in t or "double degree" in t or "joint supervision" in t:
        return "double_degree"
    if "visegrad" in t:
        return "crossborder_project"
    if "erasmus+" in t or "ka2" in t or "grant agreement" in t:
        return "erasmus_ka2"
    if "eit " in t or "sub-grant" in t or "project agreement" in t:
        return "eit_kic"
    if "consortium" in t or "invention" in t or "vynález" in t:
        return "research_cooperation"
    return "bilateral_agreement"


records = {}
for line in SRC.read_text(encoding="utf-8").splitlines():
    parts = [p.strip() for p in line.split(" | ")]
    if len(parts) < 6:
        continue
    date, title, _amount, a, b, link = parts[:6]
    parties = (a + " ; " + b).lower()
    year = date[-4:]
    clean_title = re.sub(r"\s+\S*\d+/\d{6}/\S+.*$", "", title).strip()
    unit = next((u for code, u in UNIT.items() if f"/{code}/" in title), "FMMR" if "FMMR" in title else "TUKE")
    for needle, (name, city, cc) in PARTNERS.items():
        if needle not in parties:
            continue
        category = categorize(title)
        key = (name, category)
        rec = records.setdefault(key, {
            "name": name, "name_local": "", "city": city, "country": NAMES.get(cc, cc), "country_code": cc, "lat": None, "lon": None,
            "category": category, "tuke_unit": unit, "description": "", "since": year,
            "source_url": "https://www.crz.gov.sk" + link, "confidence": "high", "_titles": [],
        })
        rec["since"] = min(rec["since"], year)
        item = f"{clean_title[:110]} ({year})"
        if item not in rec["_titles"]:
            rec["_titles"].append(item)

out = []
for rec in records.values():
    titles = rec.pop("_titles")
    rec["description"] = "; ".join(titles[:3]) + (f" (+{len(titles) - 3})" if len(titles) > 3 else "")
    out.append(rec)
(ROOT / "data" / "raw" / "researched_crz.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(out), "records |", len({r["name"] for r in out}), "partners |", len({r["country_code"] for r in out}), "countries")
by = {}
for r in out:
    by[r["category"]] = by.get(r["category"], 0) + 1
print(by)
