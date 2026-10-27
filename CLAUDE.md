# Ples TUKE 2027 – „S TUKE rozsvieťme mapu sveta"

Live web app for the TUKE ball 2027, which celebrates **75 years of the Technical University of Košice (founded 8 July 1952)**.
A dark, "switched-off" rotating globe is shown on the LED wall at the ball: light flies from Košice to every place where TUKE
has documented cooperation, places light up as twinkling stars, and guests add the places they have been to via a QR code,
live, with a photo if they like (in a place they lit, or at the ball), which flies onto the wall as a postcard. Theme: midnight blue + silver, light / play of light (svetlohra). Visual polish and correct, sourced data both matter.
After the ball the wall moves permanently to the student lobby (vestibul): `/vestibul` is the same app on a database of its
own, running beside the ball (built 2026-10-27, see „Venues"; switched off for now). Before the ball the site shows only
/onboarding (guests confirm their attendance; the QR on the invitations) and a teaser elsewhere; the admin switches the
ball on in /admin. The wall alternates the 2D map and the 3D globe (see „Before the ball" and „The wall").

- **Production = TUKE hosting** (Plesk for Windows on msweb.tuke.sk, live since 2026-10-20):
  web https://srdcom.tuke.sk, API https://api.srdcom.tuke.sk/app.js/api (health with the deployed commit:
  https://api.srdcom.tuke.sk/app.js/api/health), database Microsoft SQL Server 2022 on portal.msweb.tuke.sk (same machine).
- Git: `main` is the TUKE version (branch `mssql-tuke` merged 2026-10-20). Tags: `pred-mssql` = last Vercel/Postgres version,
  `pred-node18` = the Node 22 dependency set, `pred-casovou-osou` = the wall before the timeline opening,
  `pred-vestibulom` = the last single-database version (ff62be7), `pred-fotkami` = before the guests' photos (0ba788c).
- Vercel (https://tuke-ples-27.vercel.app, Neon Postgres) is being retired: the user deletes the project himself. Until it is
  gone `vercel.json` keeps Git deployments off (`git.deploymentEnabled: false`); after that `vercel.json` can be deleted.
- Repo: https://github.com/MatusPohorenec/TUKE_PLES_27 (**public**: never commit secrets, personal data or the TUKE database
  and login names)
- Architecture document for reviewers (Slovak, private artifact): https://claude.ai/artifact/VvkL4spi4XUYJMMVuNB68A
- `README.md` (Slovak) = dev/deploy guide incl. the Plesk steps, `data/README.md` (Slovak) = data sources, pipeline, limits

## Working agreements

- Talk to the user in Slovak. UI texts are Slovak. Code, comments and commit messages are English.
- Flow: implement → `npm run typecheck` → verify locally (dev server + local SQL Server, browser pane, `tools/api-smoke.mjs`)
  → commit → push → `npm run build:tuke` → the user uploads the zip(s) in Plesk → check that
  https://api.srdcom.tuke.sk/app.js/api/health (API) and https://srdcom.tuke.sk/build.txt (web) show the new commit →
  verify on production → short report. **A push deploys nothing**; only the zips the user uploads do.
- Push over HTTPS without prompts: `GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0 git push`.
- Before big changes tag the current state (see the tags above).
- Never type passwords/secrets into anything (the production admin password included: the user tests /admin himself).
  The user fills `App_Data\.env` on the server. Never print `MSSQL_PASSWORD`, `.env`, `.env.tuke` or `db_pass.txt`
  (repo root, excluded via .git/info/exclude); read them only from scripts.
- Never develop or experiment against the TUKE database; it is written only by `db:migrate` / `db:seed` with
  `--env .env.tuke`, and only with the user's OK. Test lights on production only with the user's OK (they show on the wall).
- Guest lights stay anonymous (device/IP only as HMAC hashes). The onboarding stores a name and an affiliation (personal
  data, the user's decision 2026-10-27): only in the ball's database, shown only in /admin (and its CSV), deleted after the
  ball, never linked to lights, never in the repo or in logs. Nomination PDFs contain names/e-mails: store aggregates only.
  Guests' photos (faces) are personal data too: only in the venue's database, shown on the wall once approved (or at
  once in mode auto) and in /admin, metadata (EXIF/GPS) stripped, deleted after the ball („Zmazať všetky fotky").

## Layout

```
apps/web         Vite + React 19 + TypeScript; globe = globe.gl 2.46 + three r186 with own shaders
  src/pages        Wall.tsx (/ – the LED wall: the 2D/3D cycle, `?view=2d`/`?view=3d` keeps one), MapPage.tsx (/mapa),
                   Join.tsx (/zapoj-sa, + PhotoPanel), Onboarding.tsx (/onboarding), Teaser.tsx (closed pages), Admin.tsx (/admin),
                   About.tsx (/o-projekte), Compare.tsx (/porovnanie – 3D and 2D side by side);
                   the routes are listed in src/main.tsx (ROUTES; build:tuke makes a folder per route, also under
                   /vestibul); every page also runs under /vestibul for the student lobby (lib/venue.ts)
  src/globe        core.ts (abstract WallScene: timeline, cooperation/guest state, country colours, counters, year, picking),
                   scene.ts (GlobeScene: globe.gl, rotation, title fit), map2d.ts (MapScene: Natural Earth map in an
                   orthographic three.js scene, d3-geo, camera that widens with the light), arcs.ts (all cooperation arcs,
                   one mesh, time-driven shader; path function per view), stars.ts (StarLayer, GPU-timed births),
                   borders.ts (globe outlines, one LineSegments), useGlobeScene.ts (creates the 3D or 2D scene)
  src/components   PlaceSpotlight.tsx (cards on the wall; `Stage` shared with the photos), PhotoMoments.tsx (guests' photos
                   on the wall), PhotoPanel.tsx (photo upload on /zapoj-sa), AdminPhotos.tsx (photo moderation in /admin),
                   CountUp.tsx (smooth counters), GlobeTooltip, QrCode, Starfield, FeedbackButton („Pripomienka"), PlaceSearch
  src/lib          api.ts (VITE_API_URL base + the venue prefix, credentials, fallback error messages), useGuests.ts
                   (summary + shared live feed), usePoll.ts (pauses in hidden tabs), useGlobeData.ts, router.tsx (tiny
                   router, ignores a trailing slash; Link keeps paths inside the open venue; useVenue), venue.ts
                   (currentVenue, pageOf, venueHref), gate.ts (useGate, pageAllowed, refreshGate), format.ts (Slovak
                   plural, number format), device.ts, photo.ts (resize + re-encode a guest's photo in the browser)
apps/api         Hono 4 REST API under /api (routes: gate, globe, events, photos, gazetteer, admin, feedback), the same routes again
                 under /api/vestibul on the lobby's database; server.ts = the one entry (local port 8787, or the iisnode
                 named pipe in PORT; loads App_Data/.env under iisnode; strips a leading /app.js); app.ts (CORS by
                 WEB_ORIGIN, routes per venue, health); snapshot.ts = bundled dataset fallback when the DB is down;
                 lib/http.ts (CACHE headers, shared() = per-process cache of live and summary, 2 s), lib/security.ts
                 (HMACs, client IP = last X-Forwarded-For entry, admin cookie Path=/ SameSite=Strict), lib/venue.ts
                 (venueOf(c) from the path), lib/jpeg.ts (cleanJpeg: check a JPEG, drop its metadata), lib/photos.ts
                 (photo metadata for the wall, the live feed and the admin)
packages/db      MS SQL Server via Kysely 0.27 + tedious 19: migrations/*.sql (T-SQL, GO batches, applied by
                 src/migrations.ts, recorded in dbo.schema_migrations), schema.ts (Kysely types = SQL names), client.ts
                 (per venue: MSSQL_* / MSSQL_VESTIBUL_* env, one pool each, withSchema('dbo'); loadEnv with --env,
                 venueArg for --venue, applyEnvFile), cli/migrate.ts, cli/seed.ts
packages/shared  constants.ts (ORIGIN, TUKE_FOUNDED, MILESTONES, VENUES, CATEGORY_GROUPS, CATEGORIES, LIMITS …), api.ts (zod
                 schemas, response types); `@ples/shared/constants` has no zod, for the browser bundle
data/            tuke_cooperation.json (+ .csv) = the versioned dataset (source of truth for hard facts), raw/, evidence/
scripts/         Python pipeline that builds the dataset (order in data/README.md)
tools/           dev.mjs (web + api), build-tuke.mjs (deploy/ + zips), iis/iisnode.yml + iis/env.example (template of
                 App_Data/.env), mssql-dev-setup.mjs (local SQL Server login/database + .env), api-smoke.mjs
```

## Commands

```bash
npm install
npm run dev          # web http://localhost:5173 (proxies /api), api http://localhost:8787/api/health
npm run typecheck
npm run db:migrate   # local SQL Server; add -- --env .env.tuke for the TUKE database (only with the user's OK)
npm run db:seed      # imports data/tuke_cooperation.json when it changed (--force re-imports, --if-needed, --env <file>)
                     # both take --venue vestibul: the lobby's database (MSSQL_VESTIBUL_*) instead of the ball's
npm run db:dev-setup # once per machine: .data/mssql-dev-setup.sql (SSMS, or sqlcmd in the Docker container) + MSSQL_* in .env
npm run build:tuke   # deploy/web, deploy/api, deploy/srdcom-web.zip, deploy/srdcom-api.zip (-- --api-url <url>)
node tools/api-smoke.mjs [api] [origin] [--venue vestibul]   # every API route against a LOCAL API (+ the lights stay in
                                          # their venue); with an origin also CORS everywhere
docker start ples-mssql                   # Docker PC only: the local SQL Server (Docker Desktop must be running)
```

## Local environment (two Windows PCs)

The user works on two Windows PCs and syncs them through GitHub (pull before work, push after; on 2026-10-27 the native PC
was 8 commits behind and on the stale branch `mssql-tuke`: switch to `main` and fast-forward first). Repo path: native PC
`D:\Projects\TUKE_PLES_27`, Docker PC `C:\Users\Matus\Desktop\Ples 2027`. Git-ignored files (`.env`, `.env.tuke`, `db_pass.txt`, `deploy/`, `.data/`,
`.claude/launch.json`) exist per PC. Check which PC this is before relying on the details below: `docker ps --filter
name=ples-mssql` (Docker PC) or `Get-Service MSSQLSERVER` (native PC); `git reflog` shows whether the latest commits came by pull.

- **Native PC** (the MS SQL port was made here; README variant A): Node 24.14.1 via nvm-windows (global), Node 18.20.6 (the
  server's version) in nvm for testing the API bundle: `/c/Users/matus/AppData/Local/nvm/v18.20.6/node.exe`. SQL Server 2025
  Developer (Microsoft retired the 2022 web installer; the winget package fails), default instance MSSQLSERVER (MSSQL17) on
  localhost:1433, TCP/IP on, Mixed Mode; Windows auth over shared memory works for the account `matus` (sysadmin), e.g.
  `"C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\180\Tools\Binn\SQLCMD.EXE" -S localhost -E -C -b -i file.sql`.
- **Docker PC** (set up 2026-10-20; README variant B): Node 24.14.0 in `C:\Program Files\nodejs` (no nvm, no Node 18 yet).
  Docker Desktop (WSL 2) runs the container `ples-mssql`: image mcr.microsoft.com/mssql/server:2022-latest (Developer
  16.0.4305), published on 127.0.0.1:1433 only, volume `ples-mssql-data`, `--restart unless-stopped` (starts with Docker
  Desktop), server collation SQL_Latin1_General_CP1_CI_AI, MSSQL_MEMORY_LIMIT_MB=2048. The sa password exists only in the
  container env, so run sa scripts inside the container: `docker exec -i ples-mssql bash -c 'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD"
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b' < file.sql`. In Git Bash prefix `MSYS_NO_PATHCONV=1`, otherwise
  it rewrites `/opt/…` to `C:/Program Files/Git/opt/…`. The TUKE VPN (Check Point Endpoint) is not always connected there.
- Both PCs: database and login `ples_dev` mirror the TUKE login (own default schema, db_ddladmin + db_datareader +
  db_datawriter, not db_owner; collation SQL_Latin1_General_CP1_CI_AI, compatibility level 160 = 2022, RCSI off), created by
  `npm run db:dev-setup` and its .sql file. Self-signed certificate → `MSSQL_TRUST_SERVER_CERTIFICATE=true` (also at TUKE).
  The lobby's database `ples_vestibul_dev` (same login and settings, `MSSQL_VESTIBUL_DATABASE` in .env): on the native PC
  since 2026-10-27 (created with sqlcmd, migrated, seeded); the Docker PC does not have it yet: rerun `npm run db:dev-setup`
  and its .sql in the container (both databases; ples_dev gets a new password, written into .env), then
  `npm run db:migrate -- --venue vestibul` and `npm run db:seed -- --venue vestibul`.
  Git Bash and PowerShell; Python 3 with requests, beautifulsoup4, lxml. Temp scripts go to the session scratchpad.
- After a pull that changes package-lock.json run `npm ci`: the Docker PC still had node_modules of the Postgres era
  (no kysely/tedious, @hono/node-server 2.x) until 2026-10-20.
- Env files (all git-ignored, per PC): `.env` = local (MSSQL_* of ples_dev, MSSQL_VESTIBUL_DATABASE=ples_vestibul_dev,
  ADMIN_PASSWORD, WEB_ORIGIN=http://localhost:4173); `.env.tuke` = the TUKE database (MSSQL_* only; MSSQL_VESTIBUL_* once
  the lobby's TUKE database exists), used only with `--env .env.tuke`; `db_pass.txt` = the TUKE DB password,
  listed in `.git/info/exclude` on each PC (that file is per PC too: check it, else `git add -A` would stage the password).
- Browser pane launch configs (`.claude/launch.json`, git-ignored): `app` = `npm run dev` (5173) on both PCs; on the native
  PC also `web-cross-origin` = `npm run preview -w @ples/web -- --port 4173 --strictPort` for the two-host setup like TUKE
  (build the web first with `VITE_API_URL=http://localhost:8787/api npm run build -w @ples/web`; the API allows 4173
  through WEB_ORIGIN in .env).
- Local test lights: POST `/api/events/ples-2027/pins` with header `x-device-id: <16–64 hex chars>` and body
  `{"places":[{"countryCode":"NP"}],"visitKind":"erasmus_study"}`; undo with DELETE
  `/api/events/ples-2027/submissions/<submissionId>` and the same header. The lobby: `/api/vestibul/events/vestibul/…`.
  Lights need the status live (or the admin cookie while open); the wall is visible to visitors only while live/closed:
  for a local wall test set the local status to live (PATCH /api/admin/events/ples-2027 after login) and back to open.

## Production: TUKE hosting (Plesk for Windows)

**Deploy** (README „Nasadenie na TUKE" has the user's steps): `npm run build:tuke`, then the user uploads in Plesk File
Manager and extracts with overwrite: `deploy/srdcom-web.zip` → `httpdocs` of srdcom.tuke.sk, `deploy/srdcom-api.zip` →
root of api.srdcom.tuke.sk (folder `/api.srdcom.tuke.sk`). iisnode restarts the API by itself when app.js, api.mjs,
iisnode.yml or App_Data\.env change (otherwise Plesk → Node.js → Restart App). Check the commit on /app.js/api/health and
/build.txt. Data changes: `npm run db:seed -- --env .env.tuke` (with OK; once the lobby's database exists also with
`--venue vestibul`, each venue has its own copy), then also redeploy the API (it carries the snapshot).

**What is on the server**
- srdcom.tuke.sk (`httpdocs`): static `deploy/web`; every page route has a folder with a copy of index.html (`/mapa` →
  301 → `/mapa/` → index.html; the query string survives, e.g. `/zapoj-sa?k=CODE`). Plesk's own web.config stays.
- api.srdcom.tuke.sk: `app.js` (CommonJS startup file for iisnode, imports `api.mjs`), `api.mjs` (the whole API, no
  node_modules), `tuke_cooperation.json` (snapshot), `iisnode.yml`, `package.json`, `build.txt`, and `App_Data\` with
  `api.mjs.map`, `.env.example`, the server-only **`.env`** (MSSQL_SERVER/DATABASE/USER/PASSWORD, MSSQL_ENCRYPT=true,
  MSSQL_TRUST_SERVER_CERTIFICATE=true, NODE_ENV=production, WEB_ORIGIN=https://srdcom.tuke.sk, ADMIN_PASSWORD, optional
  SESSION_SECRET – else generated into `app_settings`; MSSQL_VESTIBUL_DATABASE (+ _USER/_PASSWORD) once the lobby's
  database exists) and the iisnode logs (`App_Data\iisnode`). IIS never serves App_Data.
- Plesk Node.js settings of api.srdcom.tuke.sk: Application Root = Document Root = /api.srdcom.tuke.sk, startup file app.js,
  mode production. Never click NPM install or Auto-configure.

**Server constraints and how the app works around them** (all verified 2026-10-20)
- **web.config of both sites is generated by Plesk and a deploy never changes it** (TUKE rule). Hence route folders on the
  web, settings in App_Data\.env (read by server.ts with `applyEnvFile`), iisnode settings in `iisnode.yml` (iisnode reads it
  next to app.js; enableXFF, devErrorsEnabled/debuggingEnabled off, logs in App_Data\iisnode, watchedFiles; it is honoured).
- **Node.js 18.20.6** server-wide (Plesk for Windows has one version per server; EOL). The API stays Node-18-compatible:
  kysely 0.27.6, tedious 19, @hono/node-server 1.19 (by their engines), esbuild target node18, no Node 20+ APIs (no
  process.loadEnvFile). Test bundle changes with the Node 18 binary. If TUKE upgrades to 22/24, the tag `pred-node18` has
  the newer set.
- **No rewrite to app.js**: Plesk maps only the iisnode handler for app.js, so `/api/*` is a static 404, but IIS hands
  `/app.js/<path>` to iisnode (path info). The web calls `https://api.srdcom.tuke.sk/app.js/api` (build:tuke default) and
  server.ts strips `/app.js`; plain `/api/…` would work too if a rewrite were ever added. `/` and `/api/…` give Plesk's 404.
- **Plesk custom error pages replace the body of every API error** (iisnode does not set fTrySkipCustomErrors); status and
  headers (CORS, nosniff) survive, so apps/web/src/lib/api.ts shows Slovak fallback messages by status and route.
  `existingResponse="PassThrough"` on the API site would keep the JSON bodies (admin change, optional).
- iisnode facts (from its source): require() of the startup file (hence CommonJS app.js + import()), PORT is a named pipe,
  `<appSettings>` would become env vars (ANSI only; unused), enableXFF appends the client IP to X-Forwarded-For (the last
  entry is trusted), Node gets the original URL (X-Original-URL), iisnode.yml keys = `<iisnode>` attributes (`key: value`).
- Cross-origin: the web sends `credentials: 'include'`; GETs carry no custom header (no preflight); writes send x-device-id
  (preflight → 204 from the API's CORS middleware, max-age 86400). The admin cookie is host-only on api.srdcom.tuke.sk,
  SameSite=Strict (same site tuke.sk), Path=/.
- No CDN: `shared()` computes /live and /summary once per 2 s per process; /globe is memoised for 60 s. The two feeds
  carry no `stale-while-revalidate` and the web fetches them with `cache: 'no-store'`: with the old Vercel header
  (summary `stale-while-revalidate=30`) Chrome answered the wall's resync from its own cache, up to 30 s old.
- Rate limits per 10 min: lights 5 per browser and 2 000 per address (was 300 until 2026-10-27: the venue Wi-Fi puts
  ~450 guests behind one address), attendances 8 / 300. The per-address count is skipped when the address is unknown.
- TUKE database (names only in `.env.tuke`): the login has roles db_ddladmin + db_datareader + db_datawriter (not db_owner)
  and a default schema of its own → all tables live in `dbo` and every name is qualified. SQL Server 2022 Enterprise
  16.0.1160.1, collation SQL_Latin1_General_CP1_CI_AI, RCSI off, self-signed certificate. Migrated and seeded 2026-10-20;
  re-seeded the same evening with dataset 2026-10-20+aeb9797b (from the Docker PC over the TUKE VPN, 51 s; the seed adds
  the new import beside the old one and switches `is_current` in one UPDATE, so the API never sees half a dataset).
- Reachable from the TUKE network: 80, 443, FTP 21, Web Deploy 8172, Plesk 8443 (FTPS 990 not); SQL Server 1433 answered
  the native PC on 2026-10-20 (migrate + seed of the TUKE DB). From outside the TUKE network only 443 answers (checked
  2026-10-20 from the Docker PC: 1433, 8443, 21 and 8172 time out), so Plesk and every `--env .env.tuke` run need the TUKE
  network or the TUKE VPN (Check Point Endpoint). Manual zip upload is the deploy path; GitHub Actions + FTPS would be the
  automation later. Plesk Git (build on the server) was rejected.
- DNS: TUKE's resolver rs1.tuke.sk cached NXDOMAIN for srdcom.tuke.sk on 2026-10-20 (cleared the same day). Before the ball
  open the site from the TUKE network.
- The student lobby's TUKE database (since 2026-10-27; names only in `.env.tuke` as MSSQL_VESTIBUL_DATABASE/USER/PASSWORD –
  the user first wrote them as *_LOBBY, renamed): same server, its own login (db_ddladmin + db_datareader + db_datawriter,
  own default schema, HAS_DBACCESS to the ball's database = 0), same collation/level 160/RCSI off. Migrated + seeded
  2026-10-27 from the native PC (54.5 s): dataset 2026-10-20+aeb9797b, event `vestibul` open, no code, no lights.
  App_Data\.env has the MSSQL_VESTIBUL_* lines and SESSION_SECRET since 2026-10-27, so /vestibul is live (without them it
  would show the cooperation from the snapshot and collect nothing, health `databases.vestibul = not_configured`).
  Steps in README „Vestibul: druhá databáza".
- Editing App_Data\.env is risky: on 2026-10-27 the edit lost WEB_ORIGIN and ADMIN_PASSWORD. Without WEB_ORIGIN the API
  registers no CORS middleware: no Access-Control-Allow-Origin on any response, preflights 404 (carrying `nosniff`, so
  from Node), and the web shows no data in either venue. Without ADMIN_PASSWORD /admin/me returns 503 in both venues
  („Administrácia nie je zapnutá"). After any edit check health, a GET with `Origin: https://srdcom.tuke.sk` (header
  present), an OPTIONS preflight (204) and /app.js/api/admin/me (401).

## Venues: the ball and the student lobby (built 2026-10-27)

The user wants the ball's data completely separate from the lobby's, both reachable at once: `/` = the ball, `/vestibul` =
the lobby. `VENUES` in packages/shared/constants.ts: `ples` (prefix '', event `ples-2027`) and `vestibul` (prefix
`/vestibul`, event `vestibul`, name „Vestibul TUKE", brand „TUKE · Vestibul").
- Database per venue: the ball MSSQL_*, the lobby MSSQL_VESTIBUL_*; only MSSQL_VESTIBUL_DATABASE is required, server/port/
  TLS/login fall back to the ball's (MSSQL_VESTIBUL_USER needs its own _PASSWORD). dbConfig refuses a lobby database equal
  to the ball's (same server + name → error, health `down`). One pool per venue (`getDb(venue)`).
- API: app.ts mounts every route twice, `/api/…` and `/api/vestibul/…`; handlers take the venue from the path
  (`venueOf(c)`), so a venue never reads or writes the other's database. Caches are keyed per venue (/live and /summary
  `${venue}/${slug}`, /globe memo, gazetteer countries). Health reports `venue`, `database` (that venue) and `databases`
  (all). The session secret comes from SESSION_SECRET, else app_settings of the first configured venue (the ball), so one
  admin login (cookie Path=/) opens both consoles; with SESSION_SECRET the lobby does not depend on the ball's database.
- Web: the router strips the venue prefix (`pageOf`), so every page also exists under /vestibul; `Link` keeps hrefs inside
  the open venue (`venueHref`); api.ts prefixes calls with the venue; the page is keyed by venue; document.title and the
  brand follow the venue; the wall's QR leads to `${prefix}/zapoj-sa`; localStorage globe cache and the sessionStorage
  access code are per venue; /admin and /vestibul/admin have a switch (plain links, full page load). Texts that say „ples"
  have lobby variants (403 hint, „Skús to neskôr", status labels, About sentence).
- build:tuke adds the folders `vestibul/` and `vestibul/<route>/` (prefixes parsed from constants.ts).
- Verified 2026-10-27 on the native PC: api-smoke passes for both venues on the dev API and on the Node 18 bundle (also
  `/app.js/api/vestibul/…`), incl. „the lights stay in this venue"; a light sent from /vestibul/zapoj-sa showed on /vestibul
  only; without the lobby database the bundle serves the ball normally and /vestibul from the snapshot (events, search,
  admin 503).

## Before the ball: gate and onboarding (built 2026-10-27, tag `pred-onboardingom` = before)

The user: before the ball everybody who types srdcom.tuke.sk gets only the onboarding (the invitations carry a QR code to
it); every other page is blocked with a playful, poetic hint of the ball; just before the ball the user logs in to /admin
and switches „Ples prebieha".
- The switch is the event status (`EVENT_STATUSES`), `gateOf()` in constants.ts maps it for visitors: draft → `off`
  (teaser only), open → `onboarding` (only /onboarding), live/closed → `open` (every page). GET `/api/gate` (per venue,
  no-store) returns `{ state, admin }` (admin = valid session cookie). The web asks once per venue (`useGate`, last answer
  kept in localStorage for an API hiccup at the ball), `pageAllowed()` decides, main.tsx shows the page, the Teaser, or
  replaces `/` with `/onboarding`; /admin is always open; `refreshGate()` after login/logout. A logged-in admin sees what
  the guests see (until 2026-10-27 the admin saw every page, and the user, still logged in after switching „Pred
  plesom", took the map for a bug); every page only in the admin's **preview** (`usePreview` in gate.ts): „Náhľad
  stránky" in /admin opens `/?kiosk=0&nahlad=1` in a new tab, the flag lives in sessionStorage per venue (this tab only;
  „Ukončiť náhľad" or `?nahlad=0` ends it), and outside kiosk mode a golden pill (`PreviewBadge`) says „Náhľad pre
  admina. Hostia teraz vidia …". LED rehearsal before the ball: log in on the playback PC, open `/?nahlad=1` (kiosk, no
  pill). The gate is a client-side curtain: the API's read endpoints stay public; lights are refused server-side unless
  live (or open + admin), attendance unless open/live.
- Admin labels (Admin.tsx `STATUS`): ball open „Pred plesom", live „Ples prebieha", closed „Po plese", draft „Vypnuté";
  lobby draft „Vypnutý", open „Pripravený", live „Zapnutý", closed „Len na pozeranie". The seed creates a new ball as open
  and a new lobby as draft. The lobby has no onboarding (`VENUES[…].onboarding`), so it shows the teaser unless live.
- Onboarding (/onboarding, Onboarding.tsx): name + affiliation (free text with a datalist: roles, faculties „FEI TUKE",
  partner, guest) + optional companion (the user, 2026-10-27: „nech vedia pridať aj doprovod"; pill „Prídem s
  doprovodom" reveals „Meno a priezvisko doprovodu", one companion per confirmation), button „Záväzne potvrdiť účasť",
  privacy line, thank-you card („… aj s doprovodom (…) je potvrdená. Uvidíme sa pod hviezdami."), „Potvrdiť účasť ďalšej
  osoby"; names confirmed from the browser are remembered (localStorage). During the ball it links to /zapoj-sa.
  POST `/api/events/:slug/attendees` (zod AttendeeSchema: name/companion 2–120, affiliation 2–160 chars; 8 per device and
  300 per IP per 10 min) → table `dbo.attendees` (migration 0002; `companion_name` from 0003; device/IP as HMACs). Admin:
  GET/DELETE `/api/admin/attendees`, card „Potvrdená účasť (N osôb: X potvrdení, Y s doprovodom)" with the list (column
  Doprovod), „Stiahnuť CSV" (Meno;Príslušnosť;Doprovod;Osôb;Potvrdené – semicolons, UTF-8 BOM, formula cells defused) and
  delete (audit without the name).
- Teaser (Teaser.tsx): breathing star, „Pst… ešte je zhasnuté.", the hint (remember every place you have been to, at the
  ball they become stars that accompany you through the night), button „Potvrdiť účasť na plese", „75 rokov TUKE · Do
  videnia pod hviezdami". The lobby's variant has no button. Unknown addresses (no route) get it too (`lost`): before the
  ball they look like any closed page; while open: „Sem svetlo nedoletelo." + the hint + „Na stenu". The old NotFound page
  is gone. On IIS an unknown address only reaches the SPA through the site's 404 error document: Plesk → Virtual
  Directories → Error Documents → 404 → Type URL → /index.html (set by the user 2026-10-27; web.config untouched; README
  step 3). Plesk made it a 302 to https://srdcom.tuke.sk/index.html (also for /vestibul/…), and /index.html is no route,
  so the SPA shows the lost teaser. Production CSS can load join.css after teaser.css: page rules need a second class
  (`.join.teaser`) to beat `.join`. Backgrounds (stage light, Starfield) sit outside `<main>`:
  `.join > *` would make the fixed canvas a full-screen grid item.
- api-smoke walks the states (open: visitor light 409, admin light 201, attendance; live; closed: 409s) and puts the
  starting status back; a random device per run keeps the rate limits clear.

## Guests' photos (built 2026-10-27, tag `pred-fotkami` = before)

The user: guests who scan the QR may add a photo of themselves in a place they lit, or at the ball right now, and the
photos show live on the wall in popups.
- Form (PhotoPanel.tsx, a card „Pridaj fotku na stenu" under the lights on /zapoj-sa; the done card points to it):
  buttons „Práve na plese" (lobby: „Práve tu na TUKE") and one per light sent from this browser (localStorage
  `ples-lit-<venue>`, newest first, max 12; an undone light leaves). lib/photo.ts prepares the photo: `<img>.decode()`
  applies the EXIF orientation, a canvas scales it in two steps to 1280 px (+ a 360 px thumb), JPEG 0.82/0.72; the
  re-encode drops EXIF/GPS. The guest sees it as a postcard, ticks „Ľudia na fotke súhlasia…", sends; „Zlá fotka?
  Zmazať ju" within 15 min. The file input is hidden; an option button calls `input.click()` inside the tap.
- API (routes/photos.ts, mounted under /events beside events.ts): POST `/events/:slug/photos`, multipart: `meta` =
  JSON of PhotoUploadSchema (kind place + pinId | ball, code), `photo` + `thumb` JPEG files. Accepted like lights (live,
  or open + admin), photo_mode not off, access code, 6 per device / 300 per IP per 10 min, 1 000 per event; hono/body-limit
  → 413. A place photo must name a light of the same browser (pins ⨝ submissions.device_hash), the place is copied
  from the pin. `cleanJpeg` walks the markers (progressive scans too), drops APP1–15 except APP14, COM and anything after
  EOI, and gives the size (≤ 2048 px, thumb ≤ 720). Status pending (review) or approved (auto). GET `/photos` = the
  wall's gallery (approved, shared 2 s); GET `/photos/:id[?size=thumb]` = the JPEG (approved and mode not off: public,
  `max-age=604800, immutable`; else only with the admin session, `private, no-store`); DELETE `/photos/:id` = the guest's
  undo. Undoing a submission deletes its pins' photos (photos.pin_id has no FK: one cascade path). /live carries
  `photos: { latest (newest 12 approvals), total }`. Without migration 0004 the API runs on: eventInfo says photos 'off',
  the feed is empty (photoFeed catches), the admin card shows an error.
- DB (migration 0004): events.photo_mode (off | review | auto, default review); dbo.photos: GUID id, kind, pin_id, place
  copy, status pending/approved/hidden, width/height, image + thumb VARBINARY(MAX), device/IP HMACs, created_at,
  reviewed_at (= approval time, the wall's order). About 150–300 kB per photo.
- Admin (AdminPhotos.tsx, right under the status card, polls every 4 s): modes Vypnuté / Po schválení / Hneď na stenu,
  tabs Čakajú / Na stene / Skryté with thumbnails (click = the full JPEG), Schváliť / Skryť / Zmazať, „Zmazať všetky
  fotky". API GET `/admin/photos`, PATCH/DELETE `/admin/photos/:id`, DELETE `/admin/photos` (the whole venue), EventPatch
  `photos`; audit photo_status, photo_delete, photos_delete_all.
- Wall (PhotoMoments.tsx + photo-moments.css): a silver postcard (kicker „Fotka hosťa", the place, country · visit kind;
  a ball photo: the venue's name and „Košice · HH:MM"), own slight tilt, gold glow. It flies out of its star (Web
  Animations, 1.2 s), a glint sweeps over it, it stays 9 s (a returning one 7 s) and flies back (0.8 s); the star flares
  (guest star by pinKey, a ball photo: 'origin'). The globe holds still and first turns to the place (`showPlace`: 2.2 s,
  lat clamped to 8–45°, no turn when facing > 0.8; `endShowPlace` restarts the rotation from 0; turns() counts only while
  auto-rotating, so photos lengthen the 3D phase). `placeCard` tries every position (16 px grid, scales 1–0.6), never over
  obstacles (title text, counters, QR, nav) or the light's ring; cost = 1000 × (1 − scale) + 15 per lit place covered
  (summed-area table, 24 px cells) + in the globe's disc 220 + 2.5/px + 0.1/px from its light. Globe: a gold line to the
  light; flat map: the ring only. Measured 2026-10-27: 2D 1920×1080 and 960×540 top left at scale 0.8 (the title text
  limits it; picture 576×384 unscaled at 1920), 3D 960×540 right of the globe with the line to Nepal; no long tasks.
- Order: the wall loads `/photos` once (approved in the last 3 min = new), new ids from /live queue up in approval order,
  a total that differs from the gallery reloads it (hidden/deleted photos leave, even while shown). With an empty queue
  an older photo returns every 40 s (least recently shown, the first 20 s after the page opens); nothing while busy()
  and 5 s after an opening. Mode off empties the gallery; switching back on shows every photo once more as new. `Stage`:
  while a photo comes or shows no place card starts and a shown card leaves after 2.5 s; a photo waits for a card to
  leave. `?photos=0` keeps photos off the wall.
- Verified 2026-10-27 (native PC): api-smoke (+31 photo checks: review/approve/hide/off/auto, EXIF and GPS stripped,
  someone else's light 404, undone light → photo gone, 413, cut JPEG 400) passes for both venues on the dev API and on
  the Node 18 bundle (multipart via undici; Node 18 logs `ExperimentalWarning: buffer.File`, harmless); a 540 kB photo
  uploads in 64 ms locally. In the pane: the form on a phone (1500×2000 → 960×1280, preview, consent, sent, pending),
  the admin card, the wall in 2D and 3D and in the fast cycle. Not tested: an upload through IIS/iisnode at TUKE, real
  phone photos (iOS converts HEIC to JPEG in the picker; a browser that cannot decode a format shows an error).

## The wall (/) – behaviour as built

**The cycle** (default without `?view`; Wall.tsx `CYCLE`, on site `?hold=<min>`, `?turns=<n>`, test `?cycle=fast` = 15 s
hold, 0.3 turns, 9 s fade): 2D opening → 2D hold 30 min → `fadeOut(20)` → cross-fade to the globe → 3D opening → 3 turns
(`GlobeScene.turns()`, counted from the camera azimuth after the opening) → `fadeOut` → `turnTo(Košice)` 2.5 s → cross-fade
to the flat map, which starts on the whole world and flies in to Košice (`zoomIn`, opening `delay` 4 s; the globe's 2.4 s)
→ again. useGlobeScene puts each scene into its own `.scene-layer` (base.css): on a view change the new one fades in
(2D→3D: the map shrinks to 0.8, the globe settles from 1.12; 3D→2D: 1.08 / from 0.92) and the old one is disposed after
`CROSSFADE_MS` (2.6 s); disposal calls `forceContextLoss()` (a new WebGL context every round). The QR panel fades out
before the view changes (`.wall.switching`), because 2D and 3D place it differently. `fadeOut` = the timeline backwards:
places go out in reverse landing order over 70 % of the duration (arc withdraws from Košice to the place, `aDeath` in
arcs.ts, then the star dims and shrinks, `aDeath` in stars.ts, then the country darkens), the guests' gold lights in the
last third; Košice's star stays; counters count down; `busy()` (revealing or fading/dark) keeps cards away. The guests'
lights are the finale of every opening: `setGuests` during a reveal (and `setCooperation` with reveal) schedules their
beams 0.8 s after the last landing, all within 6 s (`scheduleGuests`), stars ignite on landing (per-star delay from
`guestLanding`), countries follow via `nextGuestEvent`. Verified 2026-10-27 at 1280×720: the whole fast cycle (2D → 3D →
2D), finale, fade schedule (832 → 0 on time), zoom-in (2000 → 240 units); a pane without focus runs at 1 fps, so counters
lag there (the playback PC's browser must stay in front).

Opening = **timeline 1952 → 2027** (~30 s), `GlobeScene.setCooperation(places, { reveal: true })`:
- Every year from `TUKE_FOUNDED` to max(current year, latest `since`) gets a slot: empty 0.09 s, else 0.16 s + 0.018 s per new
  place (max 1.6 s); milestone years at least 1.8 s. A place lands in the year of `since` (earliest dated cooperation),
  nearest first within a year; places without a year land in the last year. Beam launch = landing − travel
  (`beamSeconds = 0.6 + km/8000`); a beam may leave at most 3 timeline years before its landing year
  (`LAUNCH_WINDOW`: the year before is held longer), else far beams would fly through decades of quiet years.
  Total ≈ 37 s. If no place has a year, the reveal falls back to distance order over 24 s.
- Year counter + milestone caption (`MILESTONES` in packages/shared/constants.ts: 1952 VŠT, 1991 TUKE, 2004 EU, 2020 Ulysseus,
  2027 75 rokov) at the top of the counters column (`.wall-year` inside `.wall-stats`); captions carry their own year
  („2004 · …") and stay 3.2 s; on phones only the year, top right. It fades 3 s after the last landing and leaves the layout.
- A beam flies on the GPU (arcs.ts): bright head with tail; when it lands the star flares (StarLayer birth time), the country
  fades in over 0.8 s, the counters (CountUp, eased every frame) follow the landings (scene notifies at most every 150 ms).
- After landing, light flows **both ways** (cooperation is mutual): first a pulse back to Košice, then out again, repeating.
- Rotation: 30 % of base speed during the reveal (`REVEAL_SPEED`), then eases up; afterwards up to 3× base over empty areas
  (Pacific), base where a few dozen lit places face the viewer, at most 1.6× while a card is shown. Base autoRotateSpeed 0.45.
- Cards (PlaceSpotlight.tsx): none during the reveal; first card 4.5 s after the last landing; one per ~10 s (7 s shown) for
  a central place that stays visible; placement modes `margin` (free space next to the globe, preferred), `beside`,
  `above`/`below` (phones). Cards never cover the title text, counters, QR panel, buttons or their own place; coop cards show
  country, distance, institutions/links and the top 3 partners; guest cards the guest count. (The 2D map docks them, below.)
- Countries: per-country MeshBasicMaterial with fades; palette blue only: scene subject `[86,128,255,.42]`, other layer
  `[86,128,255,.2]`, unlit `[14,26,78,.55]`, Slovakia white `.55`. (A warm tint at low alpha rendered grey: don't.)
- Scenes (admin): `cooperation` (arcs + coop stars, guests beside) and `live` (cooperation arcs fade out, coop stars dimmed,
  guest countries lit); the guest arcs stay in both.
- Guest lights are gold, `GUEST_COLOR` `#ffb52e` in core.ts = `--warm` in base.css (the cooperation colours are all cool).
  Every guest place keeps a golden arc from Košice in its own ArcLayer (`guestArcs`, one draw call; `GUEST_ARC_STYLE`: steady
  light 0.35 instead of 0.02, gold from 6 % of the way instead of 30 %). A new light (live feed, max 8 animated per poll,
  450 ms apart) sends a beam along its arc (1.82 s, also for a known place); then the star ignites and the country tints,
  and light flows both ways. Places from the summary (page load, resync) get their arc without a beam, each at its own point
  of the pulse round (`spread(key)`). Guest stars: `whiteCore` 0.3 (stay gold), size 26 + 8·√count. Before 2026-10-20 the
  arrival was a 2.6 s globe.gl dash that vanished, which read as "no connection".
- Live feed: wall polls `/live` every 2 s (map 5 s), shared newest 60; own cursor; resync from `/summary` after a gap
  bigger than the window, every 5 min, and as soon as `live.totals.pins` differs from the lights the wall counted (summary
  count + new feed lights): a guest's undo or an admin's hide/show shows within seconds, and names that left the feed leave
  the „recent" list (useGuests.ts). Polling pauses in hidden tabs (`document.hidden`; override it when testing in the pane).
  Once the feed has answered, the counters and the event follow `/live` only (a resync's summary may be a moment older,
  so the counters never step back). A country chosen as a whole sits on its capital, so the summary can list two places
  with one key (Island + Reykjavík): `setGuests` adds their counts into one star.
- Guest form (/zapoj-sa): after sending, the main action is „Pridať ďalšie miesta"; undo is a text link „Zrušiť toto svetlo"
  (it deletes the lights, 15 min, same browser) followed by a notice in the form. It used to be a button „Vrátiť späť",
  which read as "back" (the user lost lights that way, 2026-10-20).
- Counters: the label's Slovak form follows the number on screen (CountUp `onShow`), e.g. 1 krajina, 3 krajiny, 86 krajín,
  1 svetlo hosťa.
- Layout: title fitted above the globe and faded when the globe is zoomed into it. The wall is a kiosk by default
  (`kioskMode()` in router.tsx, since 2026-10-27 when the user saw the top bar on the live production wall): no links,
  no comment button, no tooltips, cursor hides, screen stays awake; `?kiosk=0` shows the bar (other pages are kiosks only
  with `?kiosk`). `R` replays the opening. Phones (≤760 px): counters in one row with short labels, globe sized to end
  above them; in kiosk mode a full-width „Pridaj svoje svetlo" button (`.wall-join-phone`, while collecting) replaces the
  hidden QR panel, with `?kiosk=0` one row of buttons. The comment button („Pripomienka") shows only to a logged-in admin.

## 2D view (`?view=2d`, added 2026-10-07 to compare readability; decision pending)

- MapScene draws the same wall on a Natural Earth projection (Antarctica left out): per-country meshes (triangulated from
  d3-geo projected rings, holes handled) using the shared country materials, outlines as one LineSegments, arcs bowing
  northwards (quadratic, same ArcLayer shader), stars with the same StarLayer (`sphere: false`), the golden guest arcs as on
  the globe (width 2.2; guest stars shrink less with zoom, ×1.5). The sea is a lon/lat grid whose vertex alpha fades out at
  the antimeridian and the far north/south, so the map floats in the night (the user disliked the hard cut-out edge:
  "okliestené").
- Europe must not burn white on the whole-world view: stars scale with zoom (`setSizeScale`, 0.55·zoom^0.4), rays 0.45
  (`setRays`), stars with many neighbours (within 16 units) are dimmer (`starDim`, faded out by `setDimAmount` when zoomed
  in), short arcs keep less steady light after landing (`arcGlow` 0.2 → 1 between 400 and 3 500 km; the beam stays full).
- No rotation. During the opening the view starts on Central Europe (12 % of the world's width) and only widens to hold
  Košice and every place whose beam is a third of the way there (+18 % padding), then shows the whole world.
- Layout differences: on the flat map the bottom right is Australia, so the QR panel sits top right as a row (QR beside
  the text, `.wall.view-2d .wall-join`), beside the title and above the map's northern edge. How much room that corner has
  depends on the screen, so once the light has spread Wall.tsx scales the panel (`--join-scale`, 1 → 0.5 in 0.05 steps,
  transform-origin top right) until no lit place (coop + guests via `screenPoint`), the title text or a button lies under
  it (+8 px); it re-checks every 2 s and on resize, never during the opening. Measured 2026-10-20 (Russia shown): scale 1 at
  1920×1080, 0.95 at 1536×730 kiosk, 0.8 / 0.85 at 1280×720 kiosk / not (QR 120 / 95 px), nothing covered, also with three
  guest names in the list. (The old narrow column covered Yakutsk, Beijing, Kitami, Tokyo … below 1920×1080.)
- Cards never cover the map (the user: cards over half the map). Like TV lower thirds / docked map panels
  (Flightradar24, Esri dock, Datawrapper callouts), `MapScene.cardDock()` offers the empty southern ocean south of 38° S
  between 52° W and 138° E (stars there narrow it); the card docks there as wide as the band (`--dock-w`) and the place gets
  a name tag (`.spot-chip`) instead of a leader line. PlaceSpotlight measures and steps down: `dock` (two lines: group,
  name, country / numbers, top partners; 1920×1080, 1280×720) → `compact` (one line; 1536×730) → `tag` (name tag with the
  main number only; `cardsFloat() = false` on the map, phones). The globe keeps floating cards (`cardDock() = null`).
- The nav has a 2D/3D switch (full page load). `/porovnanie` shows both in 1920×1080 iframes, scaled, restartable together.
- Measured: 2D p95 frame 4.3 ms, longest 8.4 ms (lighter than the globe).

## Performance lessons (measured 2026-10-06)

- Never re-colour countries with `globe.polygonCapColor(...)` during animation: globe.gl rebuilds all polygons (50–60 ms long
  tasks). Use the per-country materials in scene.ts.
- Never add arcs one by one through `globe.arcsData` during the reveal (one mesh each, frame spikes). Cooperation arcs live in
  ArcLayer (one draw call), the guest arcs in a second one; globe.gl's own arc layer is unused.
- Result: draw calls 2 221 → 568, triangles 700k → 114k, longest frame 92 ms → 13 ms, no long tasks during the opening.
- Guest arcs (2026-10-20, 300 guest places): +1 draw call, rebuild on an arrival 1 ms, summary load 5 ms, render CPU 4 ms
  (globe) / 2.4 ms (map).
- Load test 2026-10-27 (native PC; script in the session scratchpad: 450 simulated guests start within 20 s, each opens
  the gate and the event, searches 2× per place, sends 1–3 places, ~700 lights): every request answered (no 4xx/5xx),
  POST /pins p50 23 ms / p95 52 ms / max 83 ms warm (p95 1.3–2.1 s while the 3D wall rendered on the same PC), peak 75–141
  lights per 2 s. The wall (3D, 1920×1080) stayed at 48–69 fps without long tasks: `setGuests` 8–9 ms, `renderGuestArcs`
  ≤ 7 ms; bursts over the 60-light window resync from the summary (lights appear at once, no beams). Production reads
  (read only): 50–90 parallel requests (gate, event, live, search) p95 ≤ 241 ms. The guest form loads ~75 kB (brotli);
  the globe chunk (0.8 MB) only on the wall and /mapa. Not tested: writes on the TUKE server itself.

## Verifying in the browser pane

- The pane is portrait (~560–690 px wide), so its native size gets the phone layout. Use `resize_window` (1280×720, 1536×730 =
  laptop at 125 %, 1920×1080 = wall); large emulated sizes come back as tiny screenshots, so check layout numerically
  (`getBoundingClientRect`, `Range` rects of the title text) rather than by eye.
- If the pane is hidden, rAF drops to ~1 fps and live timing tests are meaningless: measure fps first. Workaround: replace
  `requestAnimationFrame`/`cancelAnimationFrame` with 16 ms timeouts, then remount the wall by SPA navigation
  (`history.pushState` + `popstate` to `/o-projekte` and back) so the new scene uses them. A hidden pane also delivers no
  ResizeObserver callbacks: after `resize_window` call `renderer.setSize(el.clientWidth, el.clientHeight)` + `placeCamera()`.
  On 2026-10-27 the pane reported `document.hidden` whenever no tool was acting on it and throttled page timers to 1 s:
  a dedicated Worker (`setInterval` → `postMessage`) drove timers and rAF at full speed, but rendering the 3D wall that way
  in the hidden pane hung the renderer after a few minutes (close the tab). Do not dispatch `visibilitychange` after
  patching the timers: usePoll then starts a second poll chain (its old timer cannot be cleared).
- Visual check without screenshots: render the scene, draw the canvases into a 2D canvas, add the DOM as an SVG
  `foreignObject` clone with inlined computed styles (remove `<style>` from the clone, else CSS animations keep cards at
  opacity 0; skip animation/transition/opacity/filter/backdrop-filter) and POST the JPEG to a tiny local receiver
  (python http.server on 127.0.0.1). Web fonts fall back there, so text may overlap in the picture but not on screen.
- Reach the scene from JS: walk React fibers from `#root`'s `__reactContainer$…` key and pick the object having
  `coopStars`, `guestStars` and `globe` (production minifies class names). Perf: rAF frame-time stats +
  `PerformanceObserver({ type: 'longtask' })` + `scene.globe.renderer().info.render.calls`.

## Data (data/README.md has the details)

- Dataset 2026-10-20+aeb9797b: 832 places (cities merged within 15 km), 2 118 institutions, 2 558 links, 86 countries on
  the globe. Russia and Belarus are shown since 2026-10-20 (the user's decision; 43 institutions, 24 places; until then they
  were hidden as politically sensitive): `HIDDEN_COUNTRIES` in scripts/build_dataset.py is empty. The DB column
  `countries.is_hidden` and the API filters on it exist but the seed never sets it.
- build_dataset.py checks source coordinates: points shared by institutions of different cities, far from other
  institutions of the same city or from the cached city are re-geocoded; a point > 50 km from its city is replaced when
  confirmed (another institution of the city nearby, or a default point far from 2+ of its cities). 25 fixed on 2026-10-20,
  e.g. Tashkent for 4 Russian partners of one Erasmus+ KA2 project, a Greek federation in India, Purdue in Louisiana,
  Luleå/Umeå at Stockholm, DLR Köln at Berlin, Milano/Bologna at Rome. Place name = the most common city regardless of
  spelling, written with diacritics when any source has them (München, Poznań, Łódź); Italian province suffixes dropped.
- `since` (start year) on 2 325 links / 782 places, 1980–2027: first joint publication (OpenAlex, all years, works with
  ≤ 15 institutions; scripts/openalex_first_years.py), start of the earliest shared EU project (CORDIS), first Erasmus
  nomination (agreements themselves are undated), dates from contracts/projects/CEEPUS. It is the earliest evidence, not
  necessarily the true start. Earliest: Praha 1980, Budapest 1982, Jena 1984. Nothing in the sources before 1980.
- Rebuild: run the scripts in the order in data/README.md, then `python scripts/build_dataset.py`; then import it with
  `npm run db:seed -- --env .env.tuke` (nothing imports on deploy any more) and redeploy the API (it carries the snapshot).
  Sources and tricks: Wayback snapshots of erasmus.tuke.sk, EWP HEI registry, CORDIS CSV, OpenAlex `I183764125`,
  crz.gov.sk, keep.eu, ceepus.info.

## History

- 2026-10-06: 0c71d06–9e728a4 initial app on Vercel + Neon; 38ffaa8 live feed, place cards, faster rotation over oceans;
  7484cb4/a900948 card placement, blue guest countries; bcbc65a smooth GPU reveal, mutual light; 630c781 count-up counters;
  09d2c0f no cards during the opening; 1eb2faa phone layout (tag `pred-casovou-osou`); 1c00003 start years in the dataset;
  bebc50d opening as the 1952–2027 timeline; c5e0f22 this file; f9744e8 2D view + /porovnanie.
- 2026-10-07: 2D calmer (soft sea edge, dimmer dense Europe, short arcs glow less), cards docked as a lower third,
  `setCooperation` always clears star births, year counter box fits the year (96b7446 = tag `pred-mssql`).
- 2026-10-20: the user moved the official deployment to TUKE (hosting requested from TUKE IT; Plesk sites + MS SQL database).
  0b4d69d MS SQL port (Kysely + tedious, T-SQL migration, MERGE seed, CORS, Vercel Git deploys off); 1684f04 IIS build;
  0628a06 docs; de9b76e api-smoke; TUKE DB migrated + seeded; 9d0a37c no web.config dependency (route folders,
  App_Data\.env, iisnode.yml); f980fd7 Node 18 + /app.js path info; 9a3e639 fallback error messages; then docs. Production
  went live the same evening (verified: health up, CORS, preflight, wall timeline, place detail, search). Branch merged to main.
  Later that evening the second PC (Docker PC) pulled it: `npm ci`, local SQL Server 2022 in the Docker container
  `ples-mssql`, ples_dev migrated + seeded, api-smoke passes; README got the Docker variant (B), this file the two-PC notes.
  Then, at the user's request, Russia and Belarus went on the map (the About page no longer says they are left out), with a
  coordinate check and diacritic place names in build_dataset.py: dataset 2026-10-20+aeb9797b (832 places, 86 countries).
  The 2D QR panel became a row that scales itself so no lit place lies under it on smaller screens. Guest lights became
  gold with a lasting golden arc from Košice (beam on arrival, then light both ways) on the globe and the map.
  00f355d deployed the same evening (API + web; verified: health and /build.txt 00f355d, /globe 2026-10-20+aeb9797b from the
  DB, new snapshot served, bundle has the fallback messages, `--join-scale`, the gold and the guest arcs, About text without
  RU/BY, wall 3D + 2D running with API 200 and no console errors). The user then tested guest lights on production:
  the golden arc to Niger worked, but „Vrátiť späť" deleted the light and the wall kept showing undone lights until the
  5-minute resync; fixed (undo link + notice, resync on a count mismatch, counter grammar).
- 2026-10-27 (native PC, after fast-forwarding main from 5a9dd1f to ff62be7): the user asked how the database stands and
  decided the ball's data must stay completely separate from the lobby's, with the lobby at /vestibul. Tag `pred-vestibulom`,
  then the venues (section above): second database per venue in the API, /vestibul pages, `--venue` for migrate/seed/smoke,
  db:dev-setup with both databases, README „Vestibul: druhá databáza". Local ples_dev re-seeded (dataset 2026-10-20+aeb9797b),
  ples_vestibul_dev created. Production still ran 00f355d (6abb1f4 had never been uploaded), so the next upload carries both.
  8c9a61e pushed, zips built. The user then created the lobby's TUKE database with its own login (keys in .env.tuke); a
  read-only check passed, the keys were renamed to MSSQL_VESTIBUL_*, and with the user's OK it was migrated and seeded.
  The user uploaded both zips and added the lobby lines + SESSION_SECRET to App_Data\.env; that edit dropped WEB_ORIGIN
  and ADMIN_PASSWORD (web without data, admin 503), both restored. Verified on production: health 8c9a61e with both
  databases up; CORS and preflights (204) in both venues; /vestibul ran the whole timeline (86 countries, 832 places,
  2 118 institutions; QR → /vestibul/zapoj-sa); /vestibul/zapoj-sa loads the event and searches places; the ball's wall and
  form; /admin and /vestibul/admin show the login (401).
  Then the user asked for the pre-ball onboarding + gate (section „Before the ball"), the 2D/3D cycle as the ball's
  default wall (section „The wall") and the lobby switched off. Tag `pred-onboardingom`; built and verified locally
  (api-smoke both venues, the gate as visitor and as admin, onboarding submit, teaser, the fast cycle in the pane).
  Later the same day, at the user's request, 361 test lights went to production (170 submissions from the pane, 120
  places; the wall kept 60 fps at 1920×1080) to be deleted when the user says so. The user then asked whether ~450 guests
  at once would bring the site down: load test (section „Performance lessons"). It found the browser answering the wall's
  resync with a summary up to 30 s old (`stale-while-revalidate`): during the burst the counter fell from 484 to 261 and
  lights left the wall for a while. Fixed (no SWR on the feeds, `cache: 'no-store'`, summary shared 2 s instead of 5 s,
  counters follow /live), the light limit per address 300 → 2 000, and a country's lights now add up with its capital's.
  b643def deployed and verified. The user then switched „Pred plesom" and still saw the map on srdcom.tuke.sk until
  deleting cookies: the admin session opened every page. Since then the admin sees what the guests see, every page only
  in the opt-in preview from /admin (section „Before the ball").
  Then the user asked for guests' photos on the form and as popups on the wall (section „Guests' photos"): tag
  `pred-fotkami`, migration 0004 on ples_dev and ples_vestibul_dev, built and verified locally (not deployed yet).

## Open questions / next

- Guests' photos (section above) are built and committed but not deployed: first migration 0004 on both TUKE databases
  (only with the user's OK: `npm run db:migrate -- --env .env.tuke` and the same with `--venue vestibul`), then the user
  uploads both zips; check health/build.txt, /admin „Fotky hostí", a photo from a phone (it needs „Ples prebieha" or an
  admin preview) and the postcard on the wall. Organisers: who moderates during the ball (review is the default), the
  consent and privacy wording, deleting the photos after the ball, whether the lobby wants photos (mode off there?),
  the size limit of the TUKE database (~300 kB per photo, max 1 000 per event).

- Web 8e73e5e deployed and verified 2026-10-27 (the admin preview; API stays b643def): /build.txt 8e73e5e; with a
  valid admin session (pane) and „Pred plesom" srdcom.tuke.sk → /onboarding, /mapa → teaser; /admin shows „Náhľad
  stránky" (/?kiosk=0&nahlad=1, new tab); the preview shows the wall with the bar and the golden pill, /?nahlad=1 the
  kiosk wall without pill or comment button, /mapa the map with the pill; „Ukončiť náhľad" → teaser, / → /onboarding.
- Production: API b643def (web b643def until 8e73e5e) (the load-test fixes, deployed and verified 2026-10-27: health b643def with both
  databases up, /build.txt b643def, /live and /summary `public, max-age=0, s-maxage=2` with CORS, preflight 204,
  /admin/me 401, the web bundle fetches both feeds with `no-store`; the 3D wall in the pane: counter 362 lights /
  120 places / 57 countries, the scene's stars hold the same 362 lights on 119 stars (a country merged with its
  capital), no failed request). Before it: web 5ddcd1f (unknown addresses → 302 → /index.html → the centred teaser),
  068c935 (the kiosk wall), API 62362ab.
- Ball status: the production light test (10:48–10:51 UTC) ran while the ball was „Pred plesom" (lights from the admin
  session only); at the b643def check the ball was „Ples prebieha" (live: visitors see every page and may send lights),
  switched in /admin after the test. Before the ball it must be „Pred plesom" again (the user's call). Check the status
  in /admin (or /app.js/api/gate) before assuming it. The lobby is „Vypnutý" (gate `off`).
- Production still holds the 361 test lights of 2026-10-27 on ples-2027 (+1, probably the user's phone): delete them all
  when the user says so (a script with `--env .env.tuke`, every submission of the event; pins cascade), and check that
  /summary shows 0 before the ball. A write load test on the TUKE server itself (with the user's OK) is still open.

- Deployed 62362ab (API + web, 2026-10-27): both TUKE databases migrated with 0002 + 0003 (with the user's OK).
  Verified: health 62362ab with both databases up, web /build.txt 62362ab, CORS + preflight 204 (also attendees), gate
  ball `onboarding` for visitors, POST attendees `{}` → 400 (nothing stored), admin routes 401 without login; in the pane
  (which holds the user's admin login, so the gate lets it see every page) the admin console shows „Stav plesu: Pred
  plesom" and „Potvrdená účasť (0 osôb…)", and the production build with a visitor's gate sends / to /onboarding (form
  with „Prídem s doprovodom") and shows the teaser on /mapa. The lobby is „Vypnutý" (draft) since 2026-10-27: gate `off`,
  its event 404 for visitors, /vestibul shows the lobby teaser without a button. After the upload
  production (status open) shows visitors only /onboarding and the teaser; the wall only to a logged-in admin until
  „Ples prebieha". Check: /app.js/api/gate (`onboarding`), srdcom.tuke.sk → /onboarding, /mapa → teaser, an attendance
  (then delete it in /admin), /admin card „Potvrdená účasť". The user sets the lobby to „Vypnutý" in /vestibul/admin.
- Production checks only the user can do: log in at /admin and /vestibul/admin (one password); the wall cycle on the LED
  wall PC (browser in front; `?hold`, `?turns`); a guest light from a phone during a test with „Ples prebieha" (golden arc,
  „Zrušiť toto svetlo": the 6abb1f4 fix); hide/show a light; scene switch.
- Organisers: the onboarding and teaser texts, the privacy line of the onboarding (TUKE's data protection), whether names
  are deleted right after the ball, the hold time and number of turns of the cycle.
- Docker PC: create ples_vestibul_dev (see Local environment).
- Vercel retirement (the user, in the Vercel dashboard): copy any reviewer comments from https://tuke-ples-27.vercel.app/admin
  (Pripomienky) first, then delete the project tuke-ples-27 and its Neon database. Afterwards delete `vercel.json` and the
  Vercel paragraph in README.md.
- Docker PC: install Node 18.20.6 (nvm-windows or the portable zip) before the next API change, to test the bundle.
- TUKE IT (optional): Node.js 22/24 LTS instead of 18 (then restore the newer dependencies from tag `pred-node18`);
  `existingResponse="PassThrough"` on the API site; a rewrite of all URLs to app.js would allow plain /api.
- The architecture document (v0.2) still says env.config / web.config, /api and Node 22: refresh it to App_Data\.env,
  iisnode.yml, /app.js/api, Node 18 and the two venues/databases (Artifact read by its URL, edit the saved file, publish
  with `url` set).
- Organisers: 3D globe or 2D map for the wall (compare on /porovnanie), what „kde si bol/a" means for guests, guest light
  colour (gold since 2026-10-20, one constant + `--warm`), milestones wording, confirmation of the Erasmus list by the
  international office (OZVaM).
- On site: LED wall resolution and playback PC test (dedicated GPU, Chrome fullscreen `/?k=CODE`, before „Ples
  prebieha" `/?nahlad=1&k=CODE` after logging in, the wall is a kiosk
  anyway), rehearsal.
- English version of the guest form; polish of /mapa on phones. For the ball night: an access code (`?k=CODE` on the
  wall's QR) keeps strangers from sending lights now that the per-address limit is loose.
- Student lobby: wording of the lobby texts (name „Vestibul TUKE", status labels) and whether its QR needs an access code.
- Older cooperation (before 1980) would need archive sources; undated places (50) light up in the last year.
