# S TUKE rozsvieťme mapu sveta

Živá zemeguľa pre Ples TUKE 2027. Z Košíc letia svetlá do miest, kde má Technická univerzita v Košiciach doloženú spoluprácu. Hostia plesu cez QR kód pridávajú miesta, kde boli, a tie sa v reálnom čase rozsvietia na LED stene.

| Adresa | Čo ukazuje |
|---|---|
| `/` | Stena: obrazovka pre LED stenu. Na prehrávacom PC sa otvára s `?kiosk=1` (bez odkazov, kurzor sa skryje). |
| `/mapa` | Interaktívna mapa: filtre podľa typu spolupráce, detail miesta so zdrojmi. |
| `/zapoj-sa` | Formulár pre hostí (cieľ QR kódu). |
| `/admin` | Administrácia: scéna steny, zbieranie svetiel, kód v QR, moderovanie, pripomienky. |
| `/o-projekte` | Zdroje dát a licencie. |

## Štruktúra

```
apps/web        FE – Vite + React + TypeScript, zemeguľa globe.gl + three.js (vlastný shader hviezd)
apps/api        BE – Hono (TypeScript), REST API pod /api
packages/db     schéma databázy (Drizzle ORM), migrácie, seed, klient pre Neon / Postgres / PGlite
packages/shared spoločné konštanty, zod schémy požiadaviek, typy odpovedí API
data/           dátový balík o spolupráci TUKE (zdroj pravdy pre tvrdé fakty, pozri data/README.md)
scripts/        Python pipeline, ktorá dátový balík vyrába
tools/          dev server a build pre Vercel
```

Architektúra, schéma databázy a otvorené otázky sú v dokumente „Architektúra aplikácie“ (odkaz posiela tím).

## Lokálny vývoj

Potrebné: Node.js 22.12 alebo novší.

```bash
npm install
```

```bash
cp .env.example .env
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

Web beží na http://localhost:5173, API na http://localhost:8787/api/health. Bez `DATABASE_URL` sa použije vstavaný Postgres (PGlite) v priečinku `.data/pglite`. PGlite nevie pracovať z dvoch procesov naraz, preto `db:seed` spúšťaj pri zastavenom `npm run dev`.

Ďalšie príkazy:

- `npm run typecheck` – kontrola typov všetkých balíkov
- `npm run db:generate` – po zmene `packages/db/src/schema.ts` vyrobí novú SQL migráciu do `packages/db/drizzle`
- `npm run db:seed -- --force` – znova naimportuje dátový balík aj keď sa nezmenil

## Nasadenie na Vercel

Build vyrába výstup podľa Vercel Build Output API (`tools/build-vercel.mjs`): statický web + jedna Vercel Function pre celé `/api`. Kým nie je pripojená databáza, zemeguľa beží z dátového balíka pribaleného k funkcii a formulár hostí hlási, že zbieranie ešte nie je spustené.

1. Nahraj repozitár na GitHub (súkromný repozitár stačí).
2. Vo Vercel: **Add New → Project**, vyber repozitár. Framework nechaj **Other**, Root Directory koreň repozitára. Build a install príkazy sú vo `vercel.json`.
3. Vo Vercel projekte: **Storage → Create Database → Neon (Postgres)**, región Frankfurt (`aws-eu-central-1`). Vercel doplní `DATABASE_URL` sám.
4. **Settings → Environment Variables**: `ADMIN_PASSWORD` (heslo do /admin) a `SESSION_SECRET` (náhodný reťazec, aspoň 32 znakov).
5. Redeploy. Migrácie sa spustia pri builde (`npm run vercel-build`).
6. Jednorazovo naplň produkčnú databázu zo svojho počítača:

```bash
DATABASE_URL="postgresql://…(z Vercel → Storage → Neon)…" npm run db:seed
```

Každá vetva a pull request dostane vlastnú preview adresu; s integráciou Neon aj vlastnú vetvu databázy.

Plán Hobby je podľa podmienok Vercelu len na osobné nekomerčné použitie. Pre oficiálny projekt TUKE treba tím na pláne Pro alebo účet univerzity.

## Prechod mimo Vercelu

API je obyčajná Node aplikácia (`apps/api/src/server.ts`, alebo zbalená funkcia z `tools/build-vercel.mjs`), web je statický priečinok `apps/web/dist`, databáza je štandardný Postgres. Na serveri TUKE stačí Node 22, Postgres 16+ s rozšírením `pg_trgm` a `DATABASE_URL`. Nepoužívajú sa žiadne služby viazané na Vercel.
