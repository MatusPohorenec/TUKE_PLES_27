# Dáta: kde všade má TUKE spoluprácu

Podklad pre zemeguľu na Ples 2027 („S TUKE rozsvieťme mapu sveta"). Každý záznam má zdroj, z ktorého sa dá overiť.

## Výstupy

| Súbor | Čo obsahuje |
|---|---|
| `tuke_cooperation.json` | Zlúčený dataset: `institutions` (inštitúcia + zoznam väzieb `links`), `cities` (uzly pre zemeguľu, zlúčené do 15 km), `categories`, `stats`, `origin` (Košice). |
| `tuke_cooperation.csv` | To isté ako plochá tabuľka (1 riadok = 1 väzba), oddeľovač `;`, otvorí sa v Exceli. |
| `raw/` | Dáta po jednotlivých zdrojoch pred zlúčením. |
| `evidence/erasmus_wayback/` | Uložené HTML stránky erasmus.tuke.sk, z ktorých sú Erasmus zmluvy. |
| `cache/` | Medzivýsledky (geokódovanie, register vysokých škôl). Dá sa zmazať, skripty si ho vytvoria znova. |

## Zdroje

| Kategória | Zdroj | Poznámka |
|---|---|---|
| `erasmus_eu` | erasmus.tuke.sk – stránky „Partnerské inštitúcie" po fakultách (študentské aj zamestnanecké zmluvy, rektorátne a univerzitné bilaterálne zmluvy) | V septembri 2026 stránky na webe vracali 404, použité sú posledné snapshoty z Wayback Machine (apríl 2025 – jún 2026). Mesto a PIC doplnené z oficiálneho registra EWP/ECHE (`hei.api.uni-foundation.eu`). |
| `erasmus_eu` – počty nominácií | PDF „výsledky nominácií" na erasmus.tuke.sk (2022 – 2026), `raw/erasmus_nominations.json` | PDF obsahujú mená a e-maily, preto sa neukladajú. V dátach sú len počty nominovaných študentov a zamestnancov na destináciu (`nominated_students`, `nominated_staff`). Roky sú dátumy nahratia súboru, nie akademický rok. Rok prvej nominácie je `since` zmluvy (zmluva samotná dátum nemá). |
| `research_project_eu` | CORDIS – hromadné CSV (FP7, Horizon 2020, Horizon Europe), TUKE PIC `999839238` | Všetci partneri v konzorciách projektov, kde je TUKE účastníkom. Súradnice priamo z CORDIS. `since` = rok začiatku najstaršieho spoločného projektu. |
| `coauthorship` | OpenAlex, inštitúcia `I183764125` | Publikácie TUKE od 2015. Do mapy idú len univerzity, výskumné ústavy a akadémie vied s aspoň 3 spoločnými prácami. Práce s viac ako 15 inštitúciami (napr. CERN ALICE) sa do počtu nerátajú, aby nezahltili mapu. `since` = rok prvej spoločnej publikácie za všetky roky (`raw/openalex_first_years.json`, rovnaký limit 15 inštitúcií). |
| `bilateral_agreement`, `double_degree`, `alliance`, `eit_kic`, ESA | Centrálny register zmlúv (crz.gov.sk) – podpísané memorandá, zmluvy o spolupráci, spoločné študijné programy, zmluvy Ulysseus, ESA, EIT | `raw/researched_crz.json`. Každý záznam odkazuje na konkrétnu zmluvu. Zmluvy s fyzickými osobami (granty na mobilitu) sa nepreberajú. |
| `bilateral_agreement`, `research_cooperation`, `erasmus_ka171`, `network_membership` | Stránky fakúlt (FBERG – zmluvy s akademickými inštitúciami, FMMR – partneri v zahraničí, FVT – zmluvná spolupráca), výzvy KA171 na erasmus.tuke.sk, adresár členov EUA, signatári Magna Charta | `raw/researched_manual.json`, ručne prepísané, pri každom riadku zdrojová stránka. |
| `erasmus_ka2`, `erasmus_ka171` | Erasmus+ Project Results Platform – 104 projektov s TUKE | `raw/researched_eplus.json`. Toky KA171 sú zverejnené len po krajinách, preto sú v `raw/country_level.json`. |
| `crossborder_project` | keep.eu – 56 projektov Interreg / ENI CBC s TUKE | `raw/researched_keep.json` |
| `ceepus` | ceepus.info – siete 2024/25 a 2026/27 s pracoviskom TUKE | `raw/researched_ceepus.json` |
| `bilateral_st_project` | Databáza financovaných projektov APVV – 95 bilaterálnych projektov TUKE | Len na úrovni krajiny (`raw/country_level.json`), zahraničný partner v databáze nie je. |

## Ako to obnoviť

```bash
python scripts/fetch_sources.py    # stiahne snapshoty Erasmus stránok, register VŠ, CORDIS (cca 120 MB)
python scripts/parse_erasmus.py    # HTML -> raw/erasmus_eu_rows.json
python scripts/merge_erasmus.py    # 1 záznam na inštitúciu + mesto/PIC z registra
python scripts/geocode.py          # súradnice miest (Nominatim, 1 dopyt/s, cache)
python scripts/cordis_tuke.py      # raw/cordis_projects.json, raw/cordis_partners.json
python scripts/openalex_tuke.py    # raw/openalex_coauthors.json (cca 5 min)
python scripts/openalex_first_years.py  # raw/openalex_first_years.json: rok prvej spoločnej publikácie (cca 3 min)
python scripts/nominations_tuke.py # raw/erasmus_nominations.json (len agregované počty)
python scripts/import_extracts.py  # Erasmus+ projekty, keep.eu, CEEPUS, APVV z data/cache/extracts
python scripts/import_crz.py       # zmluvy z Centrálneho registra zmlúv
python scripts/import_manual.py    # ručne overené záznamy z webov fakúlt
python scripts/build_dataset.py    # tuke_cooperation.json + .csv
```

Potrebné balíky: `requests`, `beautifulsoup4`, `lxml`.

## Známe obmedzenia

- Časová os na stene (od 1952): miesto sa rozsvieti v roku svojej najstaršej datovanej väzby. Je to najstarší doklad v zdrojoch (prvá spoločná publikácia, začiatok projektu, zmluva, prvá nominácia), skutočná spolupráca mohla začať skôr. Miesta bez roka (asi 6 %) sa rozsvietia v poslednom roku.
- Rusko a Bielorusko: 43 inštitúcií je v dátach (zoznam `hidden`), ale na mape nie sú. Je to citlivá téma od roku 2022, rozhodnutie je na organizátoroch (`HIDDEN_COUNTRIES` v `build_dataset.py`).
- Výťažky v `cache/extracts` (Erasmus+ platforma, keep.eu, CEEPUS, APVV, CRZ) sú zo dňa 21. 9. 2026; skripty na ich opätovné stiahnutie zatiaľ nie sú.
- Nespracované: výročné správy TUKE a fakúlt (štatistiky mobilít po krajinách), FEI, SjF, SvF, EkF, FU a LF mimo Erasmu, CERN ALICE, študentské organizácie (BEST, IAESTE, ESN).
- Zoznam Erasmus zmlúv je stav z posledného snapshotu, nie zo živého webu. Pred plesom ho treba dať potvrdiť zahraničnému oddeleniu (OZVaM).
- Na stránke TUKE boli preklepy v Erasmus kódoch (napr. `I CONSENZA01`, `F LILE11`); opravy sú v `merge_erasmus.py` (`ALIAS`) a `parse_erasmus.py` (`FIX`).
- Inštitúcie z rôznych zdrojov sa párujú cez PIC, inak cez normalizovaný názov v rámci krajiny. Zopár duplicít môže zostať; počty krajín a miest tým nie sú ovplyvnené.
