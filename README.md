# S TUKE rozsvieťme mapu sveta

Živá zemeguľa pre Ples TUKE 2027. Z Košíc letia svetlá do miest, kde má Technická univerzita v Košiciach doloženú spoluprácu. Hostia plesu cez QR kód pridávajú miesta, kde boli, a tie sa v reálnom čase rozsvietia na LED stene.

| Adresa | Čo ukazuje |
|---|---|
| `/` | Stena: obrazovka pre LED stenu, vždy v režime kiosku (bez odkazov a tlačidiel, kurzor sa skryje, obrazovka nezhasne); lištu s odkazmi ukáže `?kiosk=0`. Na mobile namiesto QR panelu tlačidlo „Pridaj svoje svetlo". Predvolene sa strieda 2D mapa a 3D zemeguľa (pozri [Stena: striedanie 2D a 3D](#stena-striedanie-2d-a-3d)); `?view=2d` ukazuje len mapu, `?view=3d` len zemeguľu. |
| `/onboarding` | Potvrdenie účasti: meno, príslušnosť a voliteľne doprovod. Cieľ QR kódu na pozvánkach; pred plesom jediná otvorená stránka. |
| `/porovnanie` | 3D zemeguľa a 2D mapa vedľa seba v rozlíšení LED steny, spustené naraz. |
| `/mapa` | Interaktívna mapa: filtre podľa typu spolupráce, detail miesta so zdrojmi. |
| `/zapoj-sa` | Formulár pre hostí na plese (cieľ QR kódu na stene). |
| `/admin` | Administrácia: stav plesu, potvrdená účasť (CSV), scéna steny, kód v QR, moderovanie, pripomienky. Vždy dostupná. |
| `/o-projekte` | Zdroje dát a licencie. |

**Pred plesom, na plese, po plese.** Čo vidia návštevníci, prepína admin v `/admin` (Stav plesu):

| Stav | Čo vidia návštevníci |
|---|---|
| Pred plesom | len `/onboarding`; `srdcom.tuke.sk` naň presmeruje, ostatné stránky ukazujú teaser („Pst… ešte je zhasnuté.") s odkazom na potvrdenie účasti. Svetlá pridáva len prihlásený admin v náhľade (skúška na stene). |
| Ples prebieha | všetky stránky; hostia pridávajú svetlá cez QR na stene, onboarding funguje ďalej |
| Po plese | všetky stránky len na pozeranie; svetlá ani potvrdenia sa už nepridávajú |
| Vypnuté | len teaser |

Prihlásený admin vidí to isté čo hostia, takže po prepnutí stavu hneď vidí, čo dostanú všetci. Všetky stránky (napr. skúšku steny pred plesom) uvidí v **náhľade**: tlačidlo „Náhľad stránky" v `/admin` otvorí novú kartu s `/?kiosk=0&nahlad=1`. Náhľad platí len v tej karte, dole ho pripomína pás „Náhľad pre admina … Ukončiť náhľad" (na stene v režime kiosku nie). Skúška na PC LED steny: prihlásiť sa v `/admin` a otvoriť `/?nahlad=1`. Admin ako jediný má na stránkach tlačidlo „Pripomienka". Mená, príslušnosť a mená doprovodu z onboardingu sú osobné údaje: vidia ich len organizátori v `/admin` (s počtom osôb, aj ako CSV) a po plese ich treba zmazať. Svetlá hostí sú naďalej anonymné a s menami nie sú prepojené.
| `/vestibul` | Stena vo vestibule s **vlastnou databázou**: rovnaké stránky pod `/vestibul` (`/vestibul/zapoj-sa`, `/vestibul/mapa`, `/vestibul/admin` …). Svetlá, udalosť, kód v QR aj pripomienky sú oddelené od plesu. Zapína a vypína sa v `/vestibul/admin` (Stav vestibulu); vypnutý ukazuje len teaser. |

Prevádzka: hosting TUKE (Plesk pre Windows, IIS) – web na https://srdcom.tuke.sk, API na https://api.srdcom.tuke.sk, databáza Microsoft SQL Server 2022 (pre ples a pre vestibul dve samostatné databázy, pozri [Vestibul](#vestibul-druhá-databáza)).

### Stena: striedanie 2D a 3D

Bez `?view` beží stena v slučke:

1. **2D mapa**: otvorenie, časová os 1952 → 2027 (asi 40 s); na konci priletia zlaté svetlá hostí.
2. Mapa ostane svietiť **30 minút** (`?hold=<minúty>`).
3. Svetlá zhasínajú odzadu, najnovšie spolupráce prvé, Košice ostanú svietiť (asi 20 s). Mapa sa potom prelinie do zemegule.
4. **3D zemeguľa**: to isté otvorenie, potom sa **3-krát otočí** (`?turns=<počet>`).
5. Svetlá zhasnú, zemeguľa sa natočí na Košice a prelinie sa do mapy, ktorá sa priblíži na Košice. Znova od bodu 1.

Prehrávacie PC: `https://srdcom.tuke.sk/?k=KÓD` (kiosk je predvolený; bez kódu stačí `https://srdcom.tuke.sk`), časy sa dajú upraviť priamo v adrese, napr. `?hold=20&turns=2`. `?cycle=fast` slučku skráti na test (15 s, 0,3 otáčky). Okno prehliadača musí byť v popredí, inak prehliadač animácie brzdí. Klávesa R prehrá otvorenie znova.

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

Potrebné: Node.js 22.12 alebo novší (odporúčaný 24) na vývoj a build a lokálny Microsoft SQL Server, buď nainštalovaný vo Windows (variant A), alebo v Dockeri (variant B). Samotné API (`deploy/api`) beží aj na Node.js 18, ktorý má server TUKE. Nikdy nevyvíjaj proti databáze na serveri TUKE.

Projekt sa vyvíja na dvoch počítačoch: jeden má variant A, druhý variant B. Oba majú rovnaké databázy `ples_dev` (ples) a `ples_vestibul_dev` (vestibul), takže `.env` aj príkazy v časti Spustenie sú rovnaké. Súbory mimo gitu (`.env`, `.env.tuke`, `deploy/`) má každý počítač vlastné. Keď `git pull` prinesie zmenený `package-lock.json`, spusti `npm ci`.

Počítač, ktorý má len `ples_dev` (nastavený pred vestibulom): spusti znova `npm run db:dev-setup` a jeho `.sql` (krok 4 vo variante A alebo B). Pridá databázu `ples_vestibul_dev` a do `.env` riadok `MSSQL_VESTIBUL_DATABASE`; login `ples_dev` dostane nové heslo a `.env` sa zapíše s ním. Potom migrácie a seed pre vestibul (časť Spustenie).

### SQL Server, variant A: inštalácia vo Windows (raz)

1. Stiahni **SQL Server Developer** (zadarmo na vývoj) z https://www.microsoft.com/sql-server/sql-server-downloads a nainštaluj typ **Basic**. Webový inštalátor verzie 2022 už Microsoft nepodporuje, preto 2025 (`aka.ms/sql2025developer`). Lokálna databáza sa prepne na kompatibilitu 2022 (úroveň 160) ako na TUKE. Vznikne inštancia `MSSQLSERVER` a tvoj Windows účet bude jej správca. Na pripájanie stačí SSMS.
2. **SQL Server Configuration Manager** → *SQL Server Network Configuration* → *Protocols for MSSQLSERVER* → **TCP/IP** → **Enable**.
3. Vygeneruj skript a nastavenia (`.env` a `.data/mssql-dev-setup.sql`, oba sú mimo gitu):

   ```bash
   npm run db:dev-setup
   ```

4. V SSMS sa pripoj na `localhost` (Windows Authentication), otvor `.data/mssql-dev-setup.sql` a spusti ho. Zapne prihlasovanie heslom (Mixed Mode) a vytvorí databázy `ples_dev` (ples) a `ples_vestibul_dev` (vestibul) s loginom `ples_dev`. Login má v oboch rovnaké práva ako login na TUKE: vlastnú predvolenú schému a roly `db_ddladmin`, `db_datareader`, `db_datawriter`. Databázy majú rovnakú collation ako TUKE (`SQL_Latin1_General_CP1_CI_AI`) a úroveň kompatibility 160.
5. V Configuration Manageri → *SQL Server Services* → **SQL Server (MSSQLSERVER)** → **Restart**.

### SQL Server, variant B: Docker (raz)

SQL Server 2022 (tá istá verzia ako na TUKE) beží v kontajneri `ples-mssql`. Netreba ho inštalovať, zapínať TCP/IP ani reštartovať. Príkazy sú pre Git Bash: `MSYS_NO_PATHCONV=1` mu bráni prepísať cesty v kontajneri (napr. `/opt/...`) na cesty Windows.

1. Nainštaluj a spusti **Docker Desktop** (WSL 2, Linux kontajnery).
2. Vytvor kontajner. Príkaz stiahne image `mcr.microsoft.com/mssql/server:2022-latest` (asi 2,4 GB) a nastaví collation servera ako na TUKE. Heslo pre `sa` si vygeneruje sám a zostane len v nastaveniach kontajnera (`docker inspect ples-mssql`). Port je otvorený len pre tento počítač (`127.0.0.1`), dáta sú vo volume `ples-mssql-data` a kontajner sa spúšťa spolu s Dockerom. `ACCEPT_EULA=Y` je súhlas s licenciou SQL Server Developer (len na vývoj a testy).

   ```bash
   MSYS_NO_PATHCONV=1 docker run -d --name ples-mssql --hostname ples-mssql \
     -p 127.0.0.1:1433:1433 -v ples-mssql-data:/var/opt/mssql \
     -e ACCEPT_EULA=Y -e MSSQL_PID=Developer -e MSSQL_COLLATION=SQL_Latin1_General_CP1_CI_AI -e MSSQL_MEMORY_LIMIT_MB=2048 \
     -e MSSQL_SA_PASSWORD="Sa9-$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")" \
     --restart unless-stopped mcr.microsoft.com/mssql/server:2022-latest
   ```

   Prvý štart trvá niekoľko sekúnd, najviac asi pol minúty. Server je pripravený, keď `docker logs ples-mssql` vypíše `SQL Server is now ready for client connections`.
3. Vygeneruj skript a nastavenia (rovnako ako vo variante A):

   ```bash
   npm run db:dev-setup
   ```

4. Spusti skript v kontajneri ako `sa`. Kroky so SSMS a reštartom, ktoré vypíše `db:dev-setup`, vo variante B odpadajú.

   ```bash
   MSYS_NO_PATHCONV=1 docker exec -i ples-mssql bash -c 'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b' < .data/mssql-dev-setup.sql
   ```

   Vypíše `ok: databases ples_dev and ples_vestibul_dev with the login ples_dev are ready…`. Databázy a login sú rovnaké ako vo variante A.

Bežne stačí mať spustený Docker Desktop, kontajner sa zapne sám. Ručne ho spustíš príkazom `docker start ples-mssql` a zastavíš príkazom `docker stop ples-mssql`. `docker rm -f ples-mssql` zmaže kontajner, ale dáta zostanú vo volume. `docker volume rm ples-mssql-data` zmaže aj dáta.

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

Databáza vestibulu (`--venue vestibul` = premenné `MSSQL_VESTIBUL_*`):

```bash
npm run db:migrate -- --venue vestibul
```

```bash
npm run db:seed -- --venue vestibul
```

```bash
npm run dev
```

Web beží na http://localhost:5173 (vestibul na http://localhost:5173/vestibul), API na http://localhost:8787/api/health (vestibul `/api/vestibul/health`). Vite posiela `/api` na API, takže web a API sú pri vývoji na jednej adrese.

Ďalšie príkazy:

- `npm run typecheck` – kontrola typov všetkých balíkov
- `npm run db:seed -- --force` – znova naimportuje dátový balík aj keď sa nezmenil
- `node tools/api-smoke.mjs` a `node tools/api-smoke.mjs --venue vestibul` – test všetkých adries API proti lokálnemu API, aj s kontrolou, že svetlá jedného miesta sa v druhom neukážu
- `npm run build:tuke` – build na nasadenie na TUKE (pozri nižšie)

Zmena schémy databázy: pridaj nový súbor `packages/db/migrations/NNNN_popis.sql` (T-SQL, dávky oddelené riadkom `GO` ako v SSMS) a uprav typy v `packages/db/src/schema.ts`. Aplikované migrácie sú v tabuľke `dbo.schema_migrations`, už aplikovaný súbor sa nemení.

## Nasadenie na TUKE (Plesk pre Windows)

| Čo | Kde | Obsah |
|---|---|---|
| Web | https://srdcom.tuke.sk | statické súbory z `deploy/web`; každá stránka (`/mapa`, `/zapoj-sa`, `/admin` …) má vlastný priečinok s kópiou `index.html` |
| API | https://api.srdcom.tuke.sk | Node.js cez iisnode: `app.js` (štartovací súbor), `api.mjs` (celé API v jednom súbore, bez `node_modules`), `tuke_cooperation.json`, `iisnode.yml` (nastavenia iisnode), `App_Data\.env` (nastavenia s heslami, len na serveri) |
| Databáza | `portal.msweb.tuke.sk`, databáza a login z Plesku (*Databases*) | SQL Server 2022; login má roly `db_ddladmin`, `db_datareader`, `db_datawriter` a vlastnú predvolenú schému, tabuľky sú v schéme `dbo` |
| Databáza vestibulu | ten istý server, druhá databáza | rovnaká schéma (rovnaké migrácie a seed s `--venue vestibul`), vlastné svetlá, udalosť a pripomienky |

`web.config` oboch stránok spravuje Plesk a nasadenie ho nemení (pravidlo TUKE). Preto nič z aplikácie na ňom nestojí: stránky webu sú skutočné priečinky, nastavenia iisnode sú v `iisnode.yml` (iisnode ho číta popri `web.config`) a nastavenia API v `App_Data\.env`. `web.config` od Plesku posiela na iisnode len adresy začínajúce `/app.js`, preto je adresa API `https://api.srdcom.tuke.sk/app.js/api` (API predponu `/app.js` samo odstráni; keby správcovia doplnili pravidlo pre všetky adresy, funguje aj `/api`). Web volá API na inej adrese (`VITE_API_URL`), API to povolí cez CORS (`WEB_ORIGIN`). Prihlásenie do `/admin` funguje aj naprieč adresami: cookie patrí `api.srdcom.tuke.sk` a obe adresy sú pod tou istou doménou `tuke.sk`, takže `SameSite=Strict` platí. Kým sa API nespojí s databázou, zemeguľa beží z dátového balíka pribaleného k API a formulár hostí hlási, že zbieranie ešte nie je spustené.

### Nastavenia (premenné prostredia)

Plesk pre Windows nemá pri Node.js políčko na premenné prostredia (to má len Plesk pre Linux) a `web.config` sa na TUKE nemení. Nastavenia API sú preto v súbore **`App_Data\.env`** na stránke `api.srdcom.tuke.sk`, vo formáte `KĽÚČ=hodnota` ako `.env` pri vývoji; API ho pri štarte načíta samo. Vzor je `App_Data\.env.example`. IIS z priečinka `App_Data` nikdy nič nevydá, build tento súbor neobsahuje, nasadenie ho neprepíše a do gitu nepatrí. Po zmene sa API reštartuje samo (`iisnode.yml` ho sleduje). Ak súbor chýba, API beží bez databázy a zapíše to do logu.

| Premenná | Hodnota na TUKE | Načo |
|---|---|---|
| `MSSQL_SERVER` | `portal.msweb.tuke.sk` | server databázy (pri pomenovanej inštancii `server\inštancia`) |
| `MSSQL_DATABASE` | názov databázy z Plesku | databáza |
| `MSSQL_USER`, `MSSQL_PASSWORD` | login z Plesku (Databases) | SQL Server authentication |
| `MSSQL_ENCRYPT` | `true` | šifrované spojenie (TLS) |
| `MSSQL_TRUST_SERVER_CERTIFICATE` | `true` | server nemá certifikát od verejnej autority |
| `MSSQL_PORT` | (nevypĺňať) | iný port ako 1433 |
| `MSSQL_VESTIBUL_DATABASE` | názov druhej databázy | databáza vestibulu (`/vestibul`); nikdy nie tá istá ako `MSSQL_DATABASE`, API to odmietne. Prázdne = vestibul zatiaľ bez databázy |
| `MSSQL_VESTIBUL_USER`, `MSSQL_VESTIBUL_PASSWORD` | (len ak má druhá databáza vlastný login) | inak sa použije login plesu; rovnako `MSSQL_VESTIBUL_SERVER`, `_PORT`, `_ENCRYPT`, `_TRUST_SERVER_CERTIFICATE` |
| `ADMIN_PASSWORD` | heslo do `/admin` | povinné, inak je administrácia vypnutá; platí aj pre `/vestibul/admin` |
| `SESSION_SECRET` | (odporúčané pri dvoch databázach) | aspoň 16 znakov; bez neho si server vygeneruje kľúč a uloží ho do tabuľky `app_settings` databázy plesu (vestibul potom od nej závisí) |
| `NODE_ENV` | `production` | pod iisnode sa API aj tak správa produkčne (napr. cookie len cez HTTPS) |
| `WEB_ORIGIN` | `https://srdcom.tuke.sk` | adresa webu pre CORS, viac adries oddeľ čiarkou |

Pri builde webu: **`VITE_API_URL`** = `https://api.srdcom.tuke.sk/app.js/api` (predvolené v `npm run build:tuke`, iná adresa cez `npm run build:tuke -- --api-url <url>`). Bez nej web volá `/api` na vlastnej adrese.

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

Oba príkazy najprv vypíšu, kam sa pripájajú. Seed sa dá spustiť opakovane: so `--if-needed` neurobí nič, keď je databáza aktuálna. Nový dátový balík (`data/tuke_cooperation.json`) sa do databázy dostane len týmto príkazom, nasadenie ho samo neimportuje. Nový balík treba zároveň nasadiť s API, lebo API z neho servíruje zemeguľu, keď databáza neodpovedá. Databáza vestibulu má balík vlastný: rovnaké príkazy s `--venue vestibul` (pozri nižšie).

### Vestibul: druhá databáza

Po plese ostane stena natrvalo vo vestibule a dáta plesu musia ostať oddelené. Preto má vestibul **vlastnú databázu** a vlastné adresy: web `https://srdcom.tuke.sk/vestibul` (formulár `/vestibul/zapoj-sa`, administrácia `/vestibul/admin`, na prehrávacom PC `/vestibul?k=KÓD`), API `https://api.srdcom.tuke.sk/app.js/api/vestibul/…`. Ples ostáva na pôvodných adresách. Obe bežia naraz z toho istého nasadenia: API podľa adresy použije jednu alebo druhú databázu a nikdy nečíta ani nezapisuje do tej druhej. Kým databáza vestibulu nie je nastavená, `/vestibul` ukazuje spoluprácu z dátového balíka a svetlá nezbiera.

1. Druhá databáza na tom istom serveri (Plesk → *Databases* → *Add Database*, alebo cez správcov TUKE): collation `SQL_Latin1_General_CP1_CI_AI`, login s rolami `db_ddladmin`, `db_datareader`, `db_datawriter` (môže to byť ten istý login ako pri plese).
2. Do `App_Data\.env` na `api.srdcom.tuke.sk` pridaj `MSSQL_VESTIBUL_DATABASE=<názov>` (a `MSSQL_VESTIBUL_USER` + `MSSQL_VESTIBUL_PASSWORD`, ak má vlastný login). Odporúčané je aj `SESSION_SECRET`. API sa reštartuje samo.
3. Ten istý riadok (riadky) pridaj do `.env.tuke` na vývojovom počítači a spusti (zo siete TUKE alebo cez VPN TUKE):

   ```bash
   npm run db:migrate -- --env .env.tuke --venue vestibul
   ```

   ```bash
   npm run db:seed -- --env .env.tuke --venue vestibul
   ```

4. Over https://api.srdcom.tuke.sk/app.js/api/vestibul/health: `"database":"up"` a v `databases` oba stavy `up`. Potom https://srdcom.tuke.sk/vestibul a prihlásenie na https://srdcom.tuke.sk/vestibul/admin (to isté heslo ako pri plese).

### Prvé nasadenie

Build na vývojovom počítači:

```bash
npm run build:tuke
```

Vznikne `deploy/srdcom-web.zip` a `deploy/srdcom-api.zip` (a tie isté súbory rozbalené v `deploy/web` a `deploy/api`). Súbor `build.txt` v oboch ukazuje commit.

**api.srdcom.tuke.sk**

1. Plesk → *Websites & Domains* → `api.srdcom.tuke.sk` → **Node.js**: *Application Root* = *Document Root* = koreňový priečinok stránky (na Windows musia byť rovnaké), *Application Startup File* = `app.js`, *Application Mode* = production. **Enable Node.js**. Netreba *NPM install* ani *Auto-configure*, `api.mjs` obsahuje všetky knižnice. Verziu Node.js vyberá správca pre celý server, 20. 10. 2026 to bola 18.20.6 a API je na ňu prispôsobené.
2. *File Manager* → koreňový priečinok stránky: zmaž predvolený `index.html` od Plesku (`web.config` nechaj tak). **Upload** `srdcom-api.zip` → pravý klik → **Extract Files** (pridá aj súbory do existujúceho priečinka `App_Data`).
3. V `App_Data` skopíruj `.env.example` na **`.env`** a vyplň hodnoty (databáza a login z Plesku, heslo k databáze, `ADMIN_PASSWORD`).
4. Over https://api.srdcom.tuke.sk/app.js/api/health: `"database":"up"` a `"commit"` podľa `build.txt`.

**srdcom.tuke.sk**

1. Node.js na tejto stránke **nezapínaj**, je statická.
2. *File Manager* → koreňový priečinok (`httpdocs`): zmaž predvolené súbory Plesku okrem `web.config`, **Upload** `srdcom-web.zip` → **Extract Files**.
3. Neznáme adresy (preklep, `srdcom.tuke.sk/blabla`) majú namiesto chybovej stránky Plesku ukázať naš teaser s indíciou: Plesk → *Websites & Domains* → `srdcom.tuke.sk` → **Virtual Directories** → záložka **Error Documents** → **404** (zoznam môže mať viac strán) → *Type* **URL**, *Location* `/index.html` (ak Plesk chce celú adresu, `https://srdcom.tuke.sk/index.html`) → **OK**. Musí byť zapnuté *Hosting Settings* → **Custom error documents**. Ak to Plesk nedovolí, požiadaj správcov TUKE o rovnaké nastavenie. `web.config` sa ručne nemení.
4. Over https://srdcom.tuke.sk, https://srdcom.tuke.sk/mapa, https://srdcom.tuke.sk/blabla a prihlásenie na https://srdcom.tuke.sk/admin.

### Ďalšie nasadenia

`npm run build:tuke`, potom nahraj a rozbaľ zip do tých istých priečinkov (súbory sa prepíšu, `App_Data\.env` aj `web.config` ostanú). Nové API sa spustí samo pri prvej požiadavke, lebo iisnode sleduje `app.js`, `api.mjs`, `iisnode.yml` a `App_Data\.env`. Staré súbory v `assets/` môžu na webe ostať, nevadia. Ak sa zmenila schéma alebo dátový balík, najprv spusti migrácie a seed s `--env .env.tuke`.

### Spôsob nasadenia

| | Ručne (zip cez Plesk) | GitHub Actions + FTPS | Plesk Git |
|---|---|---|---|
| Kde sa robí build | vývojový počítač | GitHub runner | server TUKE (deployment actions) |
| Čo treba | prihlásenie do Plesku | FTP účet v Plesku ako GitHub secret; port 21 je zvonku otvorený | Git a deployment actions povolené v Plesku; na serveri `npm ci` s dev balíkmi a prístupom na registry.npmjs.org |
| Riziká | ručné kroky | heslo k FTP v GitHube (verejný repozitár, secrets sú však skryté) | build (vite, esbuild) na produkčnom serveri, celý repozitár na serveri, ťažké ladenie bez prístupu k shellu |

Odporúčanie: na ples **ručné nasadenie zo zipu**. Build sa robí lokálne a overí sa ešte pred nahratím. Netreba žiadne ďalšie prístupy a nasadení bude len pár. Ak bude stena neskôr trvalo vo vestibule a nasadzovať sa bude častejšie, oplatí sa GitHub Actions: rovnaký `npm run build:tuke` a upload `deploy/web` a `deploy/api` cez FTPS (napr. `lftp mirror -R`, bez mazania, aby ostali `App_Data\.env` a `web.config`). Plesk Git sa nehodí, lebo by build bežal na produkčnom serveri.

### Riešenie problémov

- **HTTP 404 na `/api/...`**: `web.config` od Plesku nemá pravidlo, ktoré posiela `/api/...` na `app.js`. Preto web volá API cez `/app.js/api/...` (IIS posiela `/app.js/...` na iisnode sám). Ak 404 vracia aj `/app.js/api/health`, Node.js na stránke nie je zapnutý.
- **HTTP 500 na `/app.js/...`**: Node sa nespustil. Log je v `App_Data\iisnode` (File Manager). Najčastejšie príčiny sú verzia Node.js staršia ako 18.17 alebo chyba v `App_Data\.env`.
- **CORS chyba v prehliadači**: `WEB_ORIGIN` sa musí presne zhodovať s adresou webu (`https://srdcom.tuke.sk`, bez lomky na konci).
- **`"database":"down"`** alebo **`"not_configured"`**: zlé údaje v `App_Data\.env`, súbor chýba, alebo firewall databázy. Stena aj tak beží z pribaleného dátového balíka.

### Vercel (pôvodné nasadenie, ruší sa)

Pôvodný prototyp bežal na Verceli s Postgres (Neon) na https://tuke-ples-27.vercel.app, jeho posledný stav je v tagu `pred-mssql`. Od 20. 10. 2026 je produkcia na hostingu TUKE a Vercel sa ruší: vo Verceli najprv skopíruj prípadné pripomienky z `/admin`, potom zmaž projekt `tuke-ples-27` aj jeho databázu Neon. Kým projekt existuje, `vercel.json` má vypnuté nasadzovanie z gitu, takže push nič nenasadí. Po zmazaní projektu sa `vercel.json` môže z repozitára odstrániť.
