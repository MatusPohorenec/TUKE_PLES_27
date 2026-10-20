# S TUKE rozsvieťme mapu sveta

Živá zemeguľa pre Ples TUKE 2027. Z Košíc letia svetlá do miest, kde má Technická univerzita v Košiciach doloženú spoluprácu. Hostia plesu cez QR kód pridávajú miesta, kde boli, a tie sa v reálnom čase rozsvietia na LED stene.

| Adresa | Čo ukazuje |
|---|---|
| `/` | Stena: obrazovka pre LED stenu. Na prehrávacom PC sa otvára s `?kiosk=1` (bez odkazov, kurzor sa skryje). S `?view=2d` tá istá stena na plochej mape sveta namiesto zemegule. |
| `/porovnanie` | 3D zemeguľa a 2D mapa vedľa seba v rozlíšení LED steny, spustené naraz (na rozhodnutie, čo sa číta lepšie). |
| `/mapa` | Interaktívna mapa: filtre podľa typu spolupráce, detail miesta so zdrojmi. |
| `/zapoj-sa` | Formulár pre hostí (cieľ QR kódu). |
| `/admin` | Administrácia: scéna steny, zbieranie svetiel, kód v QR, moderovanie, pripomienky. |
| `/o-projekte` | Zdroje dát a licencie. |

Prevádzka: hosting TUKE (Plesk pre Windows, IIS) – web na https://srdcom.tuke.sk, API na https://api.srdcom.tuke.sk, databáza Microsoft SQL Server 2022.

## Štruktúra

```
apps/web        FE – Vite + React + TypeScript, zemeguľa globe.gl + three.js (vlastný shader hviezd)
apps/api        BE – Hono (TypeScript), REST API pod /api
packages/db     databáza: SQL migrácie pre MS SQL Server (migrations/), klient Kysely + tedious, migrate a seed
packages/shared spoločné konštanty, zod schémy požiadaviek, typy odpovedí API
data/           dátový balík o spolupráci TUKE (zdroj pravdy pre tvrdé fakty, pozri data/README.md)
scripts/        Python pipeline, ktorá dátový balík vyrába
tools/          dev server, build pre TUKE (build-tuke.mjs), konfigurácie IIS (tools/iis), lokálny SQL Server
```

Architektúra, schéma databázy a otvorené otázky sú v dokumente „Architektúra aplikácie“ (odkaz posiela tím).

## Lokálny vývoj

Potrebné: Node.js 22.12 alebo novší (odporúčaný 24) a lokálny Microsoft SQL Server. Nikdy nevyvíjaj proti databáze na serveri TUKE.

### SQL Server na vlastnom počítači (raz)

1. Stiahni **SQL Server Developer** (zadarmo na vývoj) z https://www.microsoft.com/sql-server/sql-server-downloads a nainštaluj typ **Basic**. Webový inštalátor verzie 2022 už Microsoft nepodporuje, preto 2025 (`aka.ms/sql2025developer`). Lokálna databáza sa prepne na kompatibilitu 2022 (úroveň 160) ako na TUKE. Vznikne inštancia `MSSQLSERVER` a tvoj Windows účet bude jej správca. Na pripájanie stačí SSMS.
2. **SQL Server Configuration Manager** → *SQL Server Network Configuration* → *Protocols for MSSQLSERVER* → **TCP/IP** → **Enable**.
3. Vygeneruj skript a nastavenia (`.env` a `.data/mssql-dev-setup.sql`, oba sú mimo gitu):

   ```bash
   npm run db:dev-setup
   ```

4. V SSMS sa pripoj na `localhost` (Windows Authentication), otvor `.data/mssql-dev-setup.sql` a spusti ho. Zapne prihlasovanie heslom (Mixed Mode) a vytvorí databázu `ples_dev` s loginom `ples_dev`. Login má rovnaké práva ako login na TUKE: vlastnú predvolenú schému a roly `db_ddladmin`, `db_datareader`, `db_datawriter`. Databáza má rovnakú collation ako TUKE (`SQL_Latin1_General_CP1_CI_AI`) a úroveň kompatibility 160.
5. V Configuration Manageri → *SQL Server Services* → **SQL Server (MSSQLSERVER)** → **Restart**.

### Spustenie

```bash
npm install
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Web beží na http://localhost:5173, API na http://localhost:8787/api/health (Vite posiela `/api` na API, takže web a API sú pri vývoji na jednej adrese).

Ďalšie príkazy:

- `npm run typecheck` – kontrola typov všetkých balíkov
- `npm run db:seed -- --force` – znova naimportuje dátový balík aj keď sa nezmenil
- `npm run build:tuke` – build na nasadenie na TUKE (pozri nižšie)

Zmena schémy databázy: pridaj nový súbor `packages/db/migrations/NNNN_popis.sql` (T-SQL, dávky oddelené riadkom `GO` ako v SSMS) a uprav typy v `packages/db/src/schema.ts`. Aplikované migrácie sú v tabuľke `dbo.schema_migrations`, už aplikovaný súbor sa nemení.

## Nasadenie na TUKE (Plesk pre Windows)

| Čo | Kde | Obsah |
|---|---|---|
| Web | https://srdcom.tuke.sk | statické súbory z `deploy/web` + `web.config` (presmerovanie stránok na `index.html`, cache, MIME typy) |
| API | https://api.srdcom.tuke.sk | Node.js cez iisnode: `app.js` (štartovací súbor), `api.mjs` (celé API v jednom súbore, bez `node_modules`), `tuke_cooperation.json`, `web.config`, `env.config` (nastavenia, len na serveri) |
| Databáza | `portal.msweb.tuke.sk`, databáza a login z Plesku (*Databases*) | SQL Server 2022; login má roly `db_ddladmin`, `db_datareader`, `db_datawriter` a vlastnú predvolenú schému, tabuľky sú v schéme `dbo` |

Web volá API na inej adrese (`VITE_API_URL`), API to povolí cez CORS (`WEB_ORIGIN`). Prihlásenie do `/admin` funguje aj naprieč adresami: cookie patrí `api.srdcom.tuke.sk` a obe adresy sú pod tou istou doménou `tuke.sk`, takže `SameSite=Strict` platí. Kým sa API nespojí s databázou, zemeguľa beží z dátového balíka pribaleného k API a formulár hostí hlási, že zbieranie ešte nie je spustené.

### Nastavenia (premenné prostredia)

Plesk pre Windows nemá pri Node.js políčko na premenné prostredia (to má len Plesk pre Linux). Nastavenia API sú preto v súbore **`env.config`** v koreni stránky `api.srdcom.tuke.sk`, vedľa `web.config`. `web.config` ho načíta (`<appSettings configSource="env.config" />`) a iisnode z neho urobí premenné prostredia pre Node. Vzor je `env.config.example`. `env.config` nie je v builde, nasadenie ho neprepíše a do gitu nepatrí. Hodnoty majú byť len ASCII (bez diakritiky), lebo iisnode ich prevádza do ANSI. V XML treba zapísať `&` ako `&amp;`, `<` ako `&lt;` a `"` ako `&quot;`. Po zmene sa API reštartuje samo.

| Premenná | Hodnota na TUKE | Načo |
|---|---|---|
| `MSSQL_SERVER` | `portal.msweb.tuke.sk` | server databázy (pri pomenovanej inštancii `server\inštancia`) |
| `MSSQL_DATABASE` | názov databázy z Plesku | databáza |
| `MSSQL_USER`, `MSSQL_PASSWORD` | login z Plesku (Databases) | SQL Server authentication |
| `MSSQL_ENCRYPT` | `true` | šifrované spojenie (TLS) |
| `MSSQL_TRUST_SERVER_CERTIFICATE` | `true` | server nemá certifikát od verejnej autority |
| `MSSQL_PORT` | (nevypĺňať) | iný port ako 1433 |
| `ADMIN_PASSWORD` | heslo do `/admin` | povinné, inak je administrácia vypnutá |
| `SESSION_SECRET` | (voliteľné) | aspoň 16 znakov; bez neho si server vygeneruje kľúč a uloží ho do tabuľky `app_settings` |
| `NODE_ENV` | `production` | pod iisnode sa API aj tak správa produkčne (napr. cookie len cez HTTPS) |
| `WEB_ORIGIN` | `https://srdcom.tuke.sk` | adresa webu pre CORS, viac adries oddeľ čiarkou |

Pri builde webu: **`VITE_API_URL`** = `https://api.srdcom.tuke.sk/api` (predvolené v `npm run build:tuke`, iná adresa cez `npm run build:tuke -- --api-url <url>`). Bez nej web volá `/api` na vlastnej adrese.

### Databáza: migrácie a seed

Migrácie a seed sa spúšťajú z vývojového počítača priamo proti databáze TUKE. Databáza prijíma vzdialené spojenia, preto netreba nič spúšťať na serveri. Pripojenie je v súbore `.env.tuke` v koreni repozitára (`.env.*` je v `.gitignore`) a načíta sa len vtedy, keď ho výslovne uvedieš:

```
MSSQL_SERVER=portal.msweb.tuke.sk
MSSQL_DATABASE=<databáza z Plesku>
MSSQL_USER=<login z Plesku>
MSSQL_PASSWORD=...
MSSQL_ENCRYPT=true
MSSQL_TRUST_SERVER_CERTIFICATE=true
```

```bash
npm run db:migrate -- --env .env.tuke
```

```bash
npm run db:seed -- --env .env.tuke
```

Oba príkazy najprv vypíšu, kam sa pripájajú. Seed sa dá spustiť opakovane: so `--if-needed` neurobí nič, keď je databáza aktuálna. Nový dátový balík (`data/tuke_cooperation.json`) sa do databázy dostane len týmto príkazom, nasadenie ho samo neimportuje. Nový balík treba zároveň nasadiť s API, lebo API z neho servíruje zemeguľu, keď databáza neodpovedá.

### Prvé nasadenie

Build na vývojovom počítači:

```bash
npm run build:tuke
```

Vznikne `deploy/srdcom-web.zip` a `deploy/srdcom-api.zip` (a tie isté súbory rozbalené v `deploy/web` a `deploy/api`). Súbor `build.txt` v oboch ukazuje commit.

**api.srdcom.tuke.sk**

1. Plesk → *Websites & Domains* → `api.srdcom.tuke.sk` → **Node.js**: verzia Node.js **22 alebo novšia** (na Windows je jedna verzia pre celý server, vyberá ju správca), *Application Root* = *Document Root* = koreňový priečinok stránky (na Windows musia byť rovnaké), *Application Startup File* = `app.js`, *Application Mode* = production. **Enable Node.js**. Netreba *NPM install*, `api.mjs` obsahuje všetky knižnice.
2. *File Manager* → koreňový priečinok stránky: ak tam Plesk vytvoril `web.config`, stiahni si ho a nechaj si ho na porovnanie (obsahuje len cesty, žiadne heslá). Zmaž predvolené súbory Plesku (`index.html` a pod.). **Upload** `srdcom-api.zip` → pravý klik → **Extract Files**.
3. Skopíruj `env.config.example` na **`env.config`** a vyplň hodnoty (heslo k databáze a `ADMIN_PASSWORD`).
4. Over https://api.srdcom.tuke.sk/api/health: `"database":"up"` a `"commit"` podľa `build.txt`.

**srdcom.tuke.sk**

1. Node.js na tejto stránke **nezapínaj**, je statická.
2. *File Manager* → koreňový priečinok (`httpdocs`): zmaž predvolené súbory Plesku, **Upload** `srdcom-web.zip` → **Extract Files**.
3. Over https://srdcom.tuke.sk, https://srdcom.tuke.sk/mapa a prihlásenie na https://srdcom.tuke.sk/admin.

### Ďalšie nasadenia

`npm run build:tuke`, potom nahraj a rozbaľ zip do tých istých priečinkov (súbory sa prepíšu, `env.config` ostane). Nové API sa spustí samo pri prvej požiadavke, lebo `web.config` sleduje `app.js`, `api.mjs` a `env.config`. Staré súbory v `assets/` môžu na webe ostať, nevadia. Ak sa zmenila schéma alebo dátový balík, najprv spusti migrácie a seed s `--env .env.tuke`.

### Spôsob nasadenia

| | Ručne (zip cez Plesk) | GitHub Actions + FTPS | Plesk Git |
|---|---|---|---|
| Kde sa robí build | vývojový počítač | GitHub runner | server TUKE (deployment actions) |
| Čo treba | prihlásenie do Plesku | FTP účet v Plesku ako GitHub secret; port 21 je zvonku otvorený | Git a deployment actions povolené v Plesku; na serveri `npm ci` s dev balíkmi a prístupom na registry.npmjs.org |
| Riziká | ručné kroky | heslo k FTP v GitHube (verejný repozitár, secrets sú však skryté) | build (vite, esbuild) na produkčnom serveri, celý repozitár na serveri, ťažké ladenie bez prístupu k shellu |

Odporúčanie: na ples **ručné nasadenie zo zipu**. Build sa robí lokálne a overí sa ešte pred nahratím. Netreba žiadne ďalšie prístupy a nasadení bude len pár. Ak bude stena neskôr trvalo vo vestibule a nasadzovať sa bude častejšie, oplatí sa GitHub Actions: rovnaký `npm run build:tuke` a upload `deploy/web` a `deploy/api` cez FTPS (napr. `lftp mirror -R`, bez mazania, aby ostal `env.config`). Plesk Git sa nehodí, lebo by build bežal na produkčnom serveri.

### Riešenie problémov

- **HTTP 500.19** na `api.srdcom.tuke.sk`: chýba `env.config`, alebo server nepovoľuje niektorý atribút `<iisnode>` vo `web.config` (potom ho zmaž).
- **HTTP 500.1xxx (iisnode)**: Node sa nespustil. Log je v priečinku `iisnode` vedľa `web.config` (File Manager). Najčastejšie príčiny sú stará verzia Node.js (treba 22+) alebo chyba v `env.config`.
- **CORS chyba v prehliadači**: `WEB_ORIGIN` sa musí presne zhodovať s adresou webu (`https://srdcom.tuke.sk`, bez lomky na konci).
- **`"database":"down"`**: zlé údaje v `env.config` alebo firewall databázy. Stena aj tak beží z pribaleného dátového balíka.

### Vercel (pôvodné nasadenie)

Predtým aplikácia bežala na Verceli s Postgres (Neon), posledný stav tej verzie je v tagu `pred-mssql`. Od prechodu na MS SQL je vo `vercel.json` vypnuté nasadzovanie z gitu: push už na Vercel nič nenasadí a posledné nasadenie tam ostane, kým projekt na Verceli nezmažeš.
