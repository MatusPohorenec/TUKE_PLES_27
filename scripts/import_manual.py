"""Hand-checked cooperation records read off TUKE and faculty pages (each row names the page that states it).

Output: data/raw/researched_manual.json
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = json.loads((ROOT / "data" / "country_names.json").read_text(encoding="utf-8"))

FBERG = "https://fberg.tuke.sk/en/academic-institutions"
FMMR = "https://fmmr.tuke.sk/wps/portal/fmmr/spolupraca/partneri-v-zahranici"
FVT = "https://fvt.tuke.sk/en/international-cooperation"
KA107 = "https://web.archive.org/web/2023/https://erasmus.tuke.sk/en/non-eu-countries/partner-institutions/"
CALL_UA_EG = "https://erasmus.tuke.sk/erasmus-vyzva-pre-mobilitu-ucitelov-a-zamestnancov-tuke-do-krajin-mimo-eu-ukrajina-a-egypt/"
CALL_VE = "https://erasmus.tuke.sk/erasmus-vyzva-pre-mobilitu-ucitelov-a-zamestnancov-tuke-do-krajin-mimo-eu-venezuela-2/"
CALL_EKF_UA = "https://erasmus.tuke.sk/erasmus-vyzva-pre-mobilitu-zamestnancov-ekf-tuke-do-krajin-mimo-eu-ukrajina/"
CALL_UZH = "https://erasmus.tuke.sk/vyzva-na-zamestnanecku-mobilitu-uzhorod-ukrajina/"

# (name, city, country code, category, TUKE unit, description, since, source)
ROWS = [
    # university level
    ("European University Association (EUA)", "Brussels", "BE", "network_membership", "TUKE", "TUKE je riadnym členom EUA (Individual Full Member)", "", "https://www.eua.eu"),
    ("Magna Charta Universitatum Observatory", "Bologna", "IT", "network_membership", "TUKE", "TUKE je signatárom Magna Charta Universitatum", "", "https://www.magna-charta.org/magna-charta-universitatum/signatory-universities"),
    ("Université Côte d'Azur", "Nice", "FR", "double_degree", "EkF", "Program dvojitého diplomu EkF TUKE a Université Côte d'Azur", "", "https://nicediplom.ekf.tuke.sk/"),
    # Erasmus+ outside the EU: partners named in TUKE calls
    ("Zagazig University", "Zagazig", "EG", "erasmus_ka171", "TUKE", "Erasmus+ KA171 – partnerská inštitúcia mimo EÚ", "2023", CALL_UA_EG),
    ("Lviv Polytechnic National University", "Lviv", "UA", "erasmus_ka171", "TUKE", "Erasmus+ KA171 – partnerská inštitúcia mimo EÚ", "2023", CALL_UA_EG),
    ("Sumy State University", "Sumy", "UA", "erasmus_ka171", "TUKE", "Erasmus+ KA171 – partnerská inštitúcia mimo EÚ", "2023", CALL_UA_EG),
    ("Universidad Central de Venezuela", "Caracas", "VE", "erasmus_ka171", "TUKE", "Erasmus+ KA171 – partnerská inštitúcia mimo EÚ", "2024", CALL_VE),
    ("Uzhhorod National University", "Uzhhorod", "UA", "erasmus_ka171", "TUKE", "Erasmus+ KA171 – partnerská univerzita", "2024", CALL_UZH),
    ("National Academy of Management", "Kyiv", "UA", "erasmus_ka171", "EkF", "Erasmus+ KA171 – partnerská inštitúcia EkF", "2024", CALL_EKF_UA),
    ("University of Zanjan", "Zanjan", "IR", "erasmus_ka171", "FBERG, EkF", "Erasmus+ KA107 – partnerská inštitúcia mimo EÚ", "2018", KA107),
    ("University of Prishtina", "Pristina", "XK", "erasmus_ka171", "SjF, EkF, LF", "Erasmus+ KA107 – partnerská inštitúcia mimo EÚ", "2018", KA107),
    # FBERG: contracts with academic institutions
    ("University of Belgrade, Faculty of Mining and Geology", "Belgrade", "RS", "bilateral_agreement", "FBERG", "Všeobecná zmluva o spolupráci", "2015", FBERG),
    ("Igor Sikorsky Kyiv Polytechnic Institute", "Kyiv", "UA", "bilateral_agreement", "FBERG", "Všeobecná zmluva o spolupráci (Institute of Energy Saving and Energy Management)", "2016", FBERG),
    ("Ivano-Frankivsk National Technical University of Oil and Gas", "Ivano-Frankivsk", "UA", "bilateral_agreement", "FBERG", "Všeobecná zmluva o spolupráci", "2016", FBERG),
    ("Kryvyi Rih College of National Aviation University", "Kryvyi Rih", "UA", "bilateral_agreement", "FBERG", "Všeobecná zmluva o spolupráci", "2015", FBERG),
    ("Rzeszów School of Engineering and Economics", "Rzeszów", "PL", "bilateral_agreement", "FBERG", "Všeobecná zmluva o spolupráci", "2017", FBERG),
    ("Nosov Magnitogorsk State Technical University", "Magnitogorsk", "RU", "bilateral_agreement", "FBERG", "Všeobecná zmluva o spolupráci", "2018", FBERG),
    ("University of Zielona Góra", "Zielona Góra", "PL", "bilateral_agreement", "FBERG", "Všeobecná zmluva o spolupráci", "2018", FBERG),
    ("T. F. Gorbachev Kuzbass State Technical University", "Kemerovo", "RU", "bilateral_agreement", "FBERG", "Všeobecná zmluva o spolupráci", "2018", FBERG),
    ("UPAEP – Universidad Popular Autónoma del Estado de Puebla", "Puebla", "MX", "bilateral_agreement", "FBERG", "Všeobecná zmluva o spolupráci", "2019", FBERG),
    ("Siberian Federal University", "Krasnoyarsk", "RU", "bilateral_agreement", "FBERG", "Všeobecná zmluva o spolupráci", "2021", FBERG),
    ("Kitami Institute of Technology", "Kitami", "JP", "bilateral_agreement", "FBERG", "Všeobecná zmluva o spolupráci", "2021", FBERG),
    ("National Taipei University", "New Taipei", "TW", "bilateral_agreement", "FBERG", "Zmluva o spolupráci s akademickým partnerom", "2023", FBERG),
    ("National Central University, College of Earth Sciences", "Taoyuan", "TW", "bilateral_agreement", "FBERG", "Zmluva o spolupráci s akademickým partnerom", "2023", FBERG),
    ("Samarkand International University of Technology", "Samarkand", "UZ", "bilateral_agreement", "FBERG", "Zmluva o spolupráci s akademickým partnerom", "2024", FBERG),
    # FMMR: partners abroad
    ("VSB – Technical University of Ostrava", "Ostrava", "CZ", "research_cooperation", "FMMR", "Partner FMMR v zahraničí (Fakulta materiálově-technologická)", "", FMMR),
    ("University of Chemistry and Technology, Prague", "Prague", "CZ", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("Czech Technical University in Prague", "Prague", "CZ", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("Jan Evangelista Purkyně University in Ústí nad Labem", "Ústí nad Labem", "CZ", "research_cooperation", "FMMR", "Partner FMMR v zahraničí (Fakulta strojního inženýrství)", "", FMMR),
    ("University of Pardubice", "Pardubice", "CZ", "research_cooperation", "FMMR", "Partner FMMR v zahraničí (Fakulta chemicko-technologická)", "", FMMR),
    ("Czestochowa University of Technology", "Częstochowa", "PL", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("Łukasiewicz – Institute of Non-Ferrous Metals", "Gliwice", "PL", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("University of Rzeszów", "Rzeszów", "PL", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("AGH University of Krakow", "Kraków", "PL", "research_cooperation", "FMMR", "Partner FMMR v zahraničí (vr. Faculty of Non-Ferrous Metals)", "", FMMR),
    ("Jagiellonian University", "Kraków", "PL", "research_cooperation", "FMMR", "Partner FMMR v zahraničí (Faculty of Chemistry)", "", FMMR),
    ("Jan Długosz University in Częstochowa", "Częstochowa", "PL", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("Silesian University of Technology", "Gliwice", "PL", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("University of Split", "Split", "HR", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("University of Zagreb", "Zagreb", "HR", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("Vienna University of Technology", "Vienna", "AT", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("Montanuniversität Leoben", "Leoben", "AT", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("VITO – Flemish Institute for Technological Research", "Mol", "BE", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("KTH Royal Institute of Technology", "Stockholm", "SE", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("Chalmers University of Technology", "Gothenburg", "SE", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("RWTH Aachen University", "Aachen", "DE", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("DESY – Deutsches Elektronen-Synchrotron", "Hamburg", "DE", "research_infrastructure", "FMMR", "Partner FMMR v zahraničí (synchrotrónové merania)", "", FMMR),
    ("Instituto Superior Técnico", "Lisbon", "PT", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("CNR – Institute of Environmental Geology and Geoengineering (IGAG)", "Rome", "IT", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("University of Belgrade, Faculty of Technology and Metallurgy", "Belgrade", "RS", "research_cooperation", "FMMR", "Partner FMMR v zahraničí (aj Faculty of Mechanical Engineering)", "", FMMR),
    ("Joint Institute for Nuclear Research", "Dubna", "RU", "research_infrastructure", "FMMR", "Partner FMMR v zahraničí (SÚJV Dubna)", "", FMMR),
    ("Vietnam Academy of Science and Technology", "Hanoi", "VN", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("University of Toyama", "Toyama", "JP", "research_cooperation", "FMMR", "Partner FMMR v zahraničí (Faculty of Sustainable Design)", "", FMMR),
    ("Hitit University", "Çorum", "TR", "research_cooperation", "FMMR", "Partner FMMR v zahraničí (Engineering Faculty)", "", FMMR),
    ("Gebze Technical University", "Gebze", "TR", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("Technion – Israel Institute of Technology", "Haifa", "IL", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("Purdue University", "West Lafayette", "US", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("Chulalongkorn University", "Bangkok", "TH", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("Changzhou University", "Changzhou", "CN", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("University of Mauritius", "Réduit", "MU", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("Ss. Cyril and Methodius University in Skopje", "Skopje", "MK", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("EKA University of Applied Sciences", "Riga", "LV", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    ("Mondragon University", "Mondragón", "ES", "research_cooperation", "FMMR", "Partner FMMR v zahraničí", "", FMMR),
    # FVT: contractual cooperation with foreign institutions at faculty level
    ("Global Raymac Surveys Inc.", "Calgary", "CA", "industry_partner", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("Technical University of Cluj-Napoca", "Cluj-Napoca", "RO", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty (Faculty of Engineering)", "", FVT),
    ("Casimir Pulaski University of Radom", "Radom", "PL", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("University of Zagreb, Faculty of Mechanical Engineering and Naval Architecture", "Zagreb", "HR", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("University of Banja Luka", "Banja Luka", "BA", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty (Faculty of Mechanical Engineering)", "", FVT),
    ("Riga Technical University", "Riga", "LV", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("Sulkhan-Saba Orbeliani University", "Tbilisi", "GE", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty (Faculty of Business and Technology)", "", FVT),
    ("University of Belgrade, Faculty of Mechanical Engineering", "Belgrade", "RS", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("Vietnam National University, Hanoi", "Hanoi", "VN", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty (Faculty of Electronics and Telecommunications)", "", FVT),
    ("Vellore Institute of Technology", "Vellore", "IN", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("Chiang Mai University", "Chiang Mai", "TH", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty (Faculty of Mechanical Engineering)", "", FVT),
    ("Pro2Future Research Centre", "Graz", "AT", "research_cooperation", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("Qingdao University of Technology", "Qingdao", "CN", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty (School of Mechanical and Automotive Engineering)", "", FVT),
    ("University of Slavonski Brod", "Slavonski Brod", "HR", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("University of Business Engineering and Management Banja Luka", "Banja Luka", "BA", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("ELKEME – Hellenic Research Centre for Metals", "Athens", "GR", "research_cooperation", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("Jordan University of Science and Technology", "Irbid", "JO", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("Sumy State University", "Sumy", "UA", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty (Faculty of Technical Systems and Energy Engineering)", "", FVT),
    ("Northeast Forestry University", "Harbin", "CN", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty (Faculty of Transport)", "", FVT),
    ("University of Szeged", "Szeged", "HU", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty (Faculty of Engineering)", "", FVT),
    ("University of Rzeszów", "Rzeszów", "PL", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty (Faculty of Mechanics and Technology)", "", FVT),
    ("Tomas Bata University in Zlín", "Zlín", "CZ", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty (FAI, FT)", "", FVT),
    ("Indian Institute of Technology (Indian School of Mines) Dhanbad", "Dhanbad", "IN", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty (Department of Mechanical Engineering)", "", FVT),
    ("Rzeszów School of Engineering and Economics", "Rzeszów", "PL", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("Lucian Blaga University of Sibiu", "Sibiu", "RO", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("École Nationale d'Ingénieurs de Tarbes", "Tarbes", "FR", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("Institute of Geonics of the Czech Academy of Sciences", "Ostrava", "CZ", "research_cooperation", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("VSB – Technical University of Ostrava", "Ostrava", "CZ", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty (HGF, FS)", "", FVT),
    ("University of Osijek, Faculty of Mechanical Engineering in Slavonski Brod", "Slavonski Brod", "HR", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("Kielce University of Technology", "Kielce", "PL", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("Poznan University of Technology", "Poznań", "PL", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("University of Nyíregyháza", "Nyíregyháza", "HU", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("University of Bielsko-Biała", "Bielsko-Biała", "PL", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("University of Rijeka, Faculty of Engineering", "Rijeka", "HR", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
    ("Technical University of Applied Sciences Wildau", "Wildau", "DE", "bilateral_agreement", "FVT", "Zmluvná spolupráca na úrovni fakulty", "", FVT),
]

out = [
    {"name": n, "name_local": "", "city": city, "country": NAMES.get(cc, cc), "country_code": cc, "lat": None, "lon": None,
     "category": cat, "tuke_unit": unit, "description": desc, "since": since, "source_url": src, "confidence": "high"}
    for n, city, cc, cat, unit, desc, since, src in ROWS
]
(ROOT / "data" / "raw" / "researched_manual.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(out), "records |", len({r["country_code"] for r in out}), "countries")
