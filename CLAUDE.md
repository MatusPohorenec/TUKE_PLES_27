# Ples TUKE 2027 – „S TUKE rozsvieťme mapu sveta"

Live web app for the TUKE ball 2027, which celebrates **75 years of the Technical University of Košice (founded 8 July 1952)**.
A dark, "switched-off" rotating globe is shown on the LED wall at the ball: light flies from Košice to every place where TUKE
has documented cooperation, places light up as twinkling stars, and guests add the places they have been to via a QR code,
live. Theme: midnight blue + silver, light / play of light (svetlohra). Visual polish and correct, sourced data both matter.

- Production (TUKE, Plesk for Windows): web https://srdcom.tuke.sk, API https://api.srdcom.tuke.sk (`/api/health` shows the
  deployed commit), database MS SQL Server 2022 on portal.msweb.tuke.sk. The old Vercel + Neon version
  (https://tuke-ples-27.vercel.app) is frozen at tag `pred-mssql`; `vercel.json` disables Git deployments since the port.
- Repo: https://github.com/MatusPohorenec/TUKE_PLES_27 (**public**: never commit secrets or personal data)
- Architecture document for reviewers (Slovak, private artifact): https://claude.ai/artifact/VvkL4spi4XUYJMMVuNB68A
- `README.md` (Slovak) = dev/deploy guide, `data/README.md` (Slovak) = data sources, pipeline, known limits

## Working agreements

- Talk to the user in Slovak. UI texts are Slovak. Code, comments and commit messages are English.
- Flow used throughout: implement → `npm run typecheck` → verify in the browser pane (local dev server, local SQL Server) →
  commit → push → `npm run build:tuke` → the user uploads the zips in Plesk (README „Nasadenie na TUKE") → check that
  https://api.srdcom.tuke.sk/api/health reports the new commit → verify on production → short report. A push deploys nothing.
- Push over HTTPS without prompts: `GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0 git push` (SSH push is denied on this machine).
- Before big changes tag the current state (example: tag `pred-casovou-osou` = the wall before the timeline opening).
- Never type passwords/secrets into anything; the user fills `env.config` on the server himself. Never print `MSSQL_PASSWORD`,
  `.env`, `.env.tuke` or `db_pass.txt` (repo root, excluded via .git/info/exclude).
- Never develop or experiment against the TUKE database; it is written only by `db:migrate` / `db:seed` with `--env .env.tuke`,
  and only with the user's OK.
- Guest data stays anonymous (device/IP only as HMAC hashes). Nomination PDFs contain names/e-mails: store aggregates only.

## Layout

```
apps/web         Vite + React 19 + TypeScript; globe = globe.gl 2.46 + three r186 with own shaders
  src/pages        Wall.tsx (/ – the LED wall, `?view=2d` = flat map), MapPage.tsx (/mapa), Join.tsx (/zapoj-sa),
                   Admin.tsx (/admin), About.tsx (/o-projekte), Compare.tsx (/porovnanie – 3D and 2D side by side)
  src/globe        core.ts (abstract WallScene: timeline, cooperation/guest state, country colours, counters, year, picking),
                   scene.ts (GlobeScene: globe.gl, rotation, title fit), map2d.ts (MapScene: Natural Earth map in an
                   orthographic three.js scene, d3-geo, camera that widens with the light), arcs.ts (all cooperation arcs,
                   one mesh, time-driven shader; path function per view), stars.ts (StarLayer, GPU-timed births),
                   borders.ts (globe outlines, one LineSegments), useGlobeScene.ts (creates the 3D or 2D scene)
  src/components   PlaceSpotlight.tsx (cards on the wall), CountUp.tsx (smooth counters), GlobeTooltip, QrCode, Starfield,
                   FeedbackButton („Pripomienka"), PlaceSearch
  src/lib          api.ts, useGuests.ts (summary + shared live feed), usePoll.ts (pauses in hidden tabs), useGlobeData.ts,
                   router.tsx (tiny router), format.ts (Slovak plural, number format), device.ts
apps/api         Hono 4 REST API under /api (routes: globe, events, gazetteer, admin, feedback); server.ts = the one entry
                 (local port 8787, or the iisnode named pipe in PORT); app.ts (CORS by WEB_ORIGIN); snapshot.ts = bundled
                 dataset fallback when the DB is unreachable; lib/http.ts (CACHE headers, shared() = per-process cache of
                 live/summary), lib/security.ts (HMACs, client IP = last X-Forwarded-For entry, admin cookie)
packages/db      MS SQL Server via Kysely 0.29 + tedious: migrations/*.sql (T-SQL, GO batches, applied by src/migrations.ts,
                 recorded in dbo.schema_migrations), schema.ts (Kysely types, SQL names), client.ts (MSSQL_* env, pool,
                 loadEnv with --env), cli/migrate.ts, cli/seed.ts
packages/shared  constants.ts (ORIGIN, TUKE_FOUNDED, MILESTONES, CATEGORY_GROUPS, CATEGORIES, LIMITS …), api.ts (zod schemas,
                 response types); `@ples/shared/constants` has no zod, for the browser bundle
data/            tuke_cooperation.json (+ .csv) = the versioned dataset (source of truth for hard facts), raw/, evidence/
scripts/         Python pipeline that builds the dataset (order in data/README.md)
tools/           dev.mjs (web + api), build-tuke.mjs (deploy/web + deploy/api + zips), iis/ (web.config of both sites,
                 env.config.example), mssql-dev-setup.mjs (local SQL Server login/database + .env)
```

## Commands

```bash
npm install
npm run dev          # web http://localhost:5173 (proxies /api), api http://localhost:8787/api/health
npm run typecheck
npm run db:migrate   # add -- --env .env.tuke for the TUKE database (only with the user's OK)
npm run db:seed      # imports data/tuke_cooperation.json when it changed (--force to re-import, --if-needed)
npm run db:dev-setup # once: .data/mssql-dev-setup.sql (run in SSMS) + MSSQL_* in .env, new local password
npm run build:tuke   # deploy/ for the TUKE servers (-- --api-url <url> for another API address)
```

- Node 24 (nvm-windows; `nvm use 24.14.1` was done 2026-10-20, engines need >= 22.12).
- Local DB: SQL Server 2022 Developer, default instance MSSQLSERVER on localhost:1433 (TCP/IP enabled), database and login
  `ples_dev` set up like the TUKE login (own default schema, db_ddladmin + db_datareader + db_datawriter, collation
  SQL_Latin1_General_CP1_CI_AI). Self-signed certificate, so `MSSQL_TRUST_SERVER_CERTIFICATE=true` (also at TUKE).
- In the browser pane the dev server is the launch config `app` (`.claude/launch.json`: `npm run dev`, port 5173).
- Windows machine: Git Bash and PowerShell; Python 3 with requests, beautifulsoup4, lxml. Temp scripts go to the session scratchpad.
- Test lights: POST `/api/events/ples-2027/pins` with header `x-device-id: <16–64 hex chars>` and body
  `{"places":[{"countryCode":"NP"}],"visitKind":"erasmus_study"}`; undo with DELETE
  `/api/events/ples-2027/submissions/<submissionId>` and the same header. Production has none.
- Cross-origin mode locally (like TUKE): run the API with `WEB_ORIGIN=http://localhost:4173` and serve a web build made with
  `VITE_API_URL=http://localhost:8787/api` (e.g. `npm run preview -w @ples/web -- --port 4173`).

## Deploy (TUKE, Plesk for Windows; README „Nasadenie na TUKE" has the user's steps)

- Two Plesk sites on msweb.tuke.sk (147.232.16.54, IIS, `X-Powered-By-Plesk: PleskWin`): srdcom.tuke.sk = static web
  (`deploy/web`), api.srdcom.tuke.sk = Node via iisnode (`deploy/api`). `npm run build:tuke` also writes
  `deploy/srdcom-web.zip` / `srdcom-api.zip` for Plesk File Manager (Upload → Extract). Manual zip upload is the chosen
  deploy path for the ball (Plesk Git would build on the server; GitHub Actions + FTPS is the later option: FTP 21,
  Web Deploy 8172 and the panel 8443 are reachable from outside, FTPS 990 is not).
- iisnode facts (checked in its source): it loads the startup file with require(), so `app.js` (CommonJS) imports `api.mjs`;
  PORT is a named pipe; `<appSettings>` entries become env vars (converted to ANSI: ASCII values only); enableXFF appends
  the client IP to X-Forwarded-For (last entry trusted); Node gets the original URL (X-Original-URL) after the rewrite;
  defaults devErrorsEnabled/debuggingEnabled = true are switched off in tools/iis/api.web.config; watchedFiles restart Node.
- Plesk for Windows: one Node.js version for the whole server (the admin picks it; we need ≥ 22, tedious 20 / kysely 0.29
  require it), Application Root must equal Document Root, no environment-variable UI (Linux only) → settings live in
  `env.config` (appSettings configSource of web.config; not in the build, never overwritten; missing file = 500.19).
- Env: MSSQL_SERVER/DATABASE/USER/PASSWORD (+ MSSQL_ENCRYPT, MSSQL_TRUST_SERVER_CERTIFICATE=true: TUKE's SQL Server has a
  self-signed certificate), ADMIN_PASSWORD, optional SESSION_SECRET (else generated into `app_settings`), WEB_ORIGIN
  (CORS), NODE_ENV=production (under iisnode the API is production anyway). Build time: VITE_API_URL.
- TUKE database and login (names in the local `.env.tuke`, kept out of the public repo; the login is spelled like the
  database, with an underscore): roles db_ddladmin + db_datareader + db_datawriter, not db_owner, and a default schema
  of its own → all tables are in `dbo` and every name is qualified. Collation SQL_Latin1_General_CP1_CI_AI, RCSI off, Enterprise 16.0.1160.1.
- Cross-origin: the web sends `credentials: 'include'`, reads carry no x-device-id (simple requests, no preflight); the
  admin cookie is host-only on api.srdcom.tuke.sk with SameSite=Strict (same site tuke.sk, so it is sent).
- No CDN at TUKE: `shared()` in lib/http.ts computes /live once per 2 s and /summary once per 5 s per process.
- DNS 2026-10-20: srdcom.tuke.sk resolved everywhere except TUKE's resolver rs1.tuke.sk (cached NXDOMAIN, SOA minimum 1 day).
  Before the ball check the site from the TUKE network.
- Second database (student lobby / vestibule, later): same migrations + seed with another env file; the API uses one database
  at a time (switch = new values in env.config).

## The wall (/) – behaviour as built

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
- Scenes (admin): `cooperation` (arcs + coop stars, guests beside) and `live` (arcs fade out, coop stars dimmed, guest countries
  lit). Guest lights: warm stars/arcs `#ffd9a0`, one-by-one arrivals (max 8 animated per poll), country tints when the beam lands.
- Live feed: wall polls `/live` every 2 s (map 5 s), shared newest 60; own cursor; resync from `/summary` after a gap
  bigger than the window and every 5 min (so hidden/undone lights disappear); polling pauses in hidden tabs.
- Layout: title fitted above the globe and faded when the globe is zoomed into it; `?kiosk=1` hides links/cursor, keeps the
  screen awake; `R` replays the opening. Phones (≤760 px): one row of buttons, counters in one row with short labels, globe
  sized to end above the counters.

## 2D view (`?view=2d`, added 2026-10-07 to compare readability; decision pending)

- MapScene draws the same wall on a Natural Earth projection (Antarctica left out): per-country meshes (triangulated from
  d3-geo projected rings, holes handled) using the shared country materials, outlines as one LineSegments, arcs bowing
  northwards (quadratic, same ArcLayer shader), stars with the same StarLayer (`sphere: false`), guest beams as a one-shot
  ArcLayer (`ambient: false`). The sea is a lon/lat grid whose vertex alpha fades out at the antimeridian and the far
  north/south, so the map floats in the night (the user disliked the hard cut-out edge: "okliestené").
- Europe must not burn white on the whole-world view: stars scale with zoom (`setSizeScale`, 0.55·zoom^0.4), rays 0.45
  (`setRays`), stars with many neighbours (within 16 units) are dimmer (`starDim`, faded out by `setDimAmount` when zoomed
  in), short arcs keep less steady light after landing (`arcGlow` 0.2 → 1 between 400 and 3 500 km; the beam stays full).
- No rotation. During the opening the view starts on Central Europe (12 % of the world's width) and only widens to hold
  Košice and every place whose beam is a third of the way there (+18 % padding), then shows the whole world.
- Layout differences: on the flat map the bottom right is Australia, so the QR panel sits top right (empty Arctic,
  Russia is hidden) as a narrow column (`.wall.view-2d .wall-join`).
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
  ArcLayer (one draw call); globe.gl arcs only carry the few guest arrivals.
- Result: draw calls 2 221 → 568, triangles 700k → 114k, longest frame 92 ms → 13 ms, no long tasks during the opening.

## Verifying in the browser pane

- The pane is portrait (~560–690 px wide), so its native size gets the phone layout. Use `resize_window` (1280×720, 1536×730 =
  laptop at 125 %, 1920×1080 = wall); large emulated sizes come back as tiny screenshots, so check layout numerically
  (`getBoundingClientRect`, `Range` rects of the title text) rather than by eye.
- If the pane is hidden, rAF drops to ~1 fps and live timing tests are meaningless: measure fps first. Workaround: replace
  `requestAnimationFrame`/`cancelAnimationFrame` with 16 ms timeouts, then remount the wall by SPA navigation
  (`history.pushState` + `popstate` to `/o-projekte` and back) so the new scene uses them. A hidden pane also delivers no
  ResizeObserver callbacks: after `resize_window` call `renderer.setSize(el.clientWidth, el.clientHeight)` + `placeCamera()`.
- Visual check without screenshots: render the scene, draw the canvases into a 2D canvas, add the DOM as an SVG
  `foreignObject` clone with inlined computed styles (remove `<style>` from the clone, else CSS animations keep cards at
  opacity 0; skip animation/transition/opacity/filter/backdrop-filter) and POST the JPEG to a tiny local receiver
  (python http.server on 127.0.0.1). Web fonts fall back there, so text may overlap in the picture but not on screen.
- Reach the scene from JS: walk React fibers from `#root`'s `__reactContainer$…` key and pick the object having
  `coopStars`, `guestStars` and `globe` (production minifies class names). Perf: rAF frame-time stats +
  `PerformanceObserver({ type: 'longtask' })` + `scene.globe.renderer().info.render.calls`.

## Data (data/README.md has the details)

- 815 places (cities merged within 15 km), 2 075 institutions, 2 511 links, 84 countries on the globe; Russia/Belarus
  (43 institutions) are hidden pending the organisers' decision (`HIDDEN_COUNTRIES` in scripts/build_dataset.py).
- `since` (start year) on 2 285 links / 767 places, 1980–2027: first joint publication (OpenAlex, all years, works with
  ≤ 15 institutions; scripts/openalex_first_years.py), start of the earliest shared EU project (CORDIS), first Erasmus
  nomination (agreements themselves are undated), dates from contracts/projects/CEEPUS. It is the earliest evidence, not
  necessarily the true start. Earliest: Praha 1980, Budapest 1982, Jena 1984. Nothing in the sources before 1980.
- Rebuild: run the scripts in the order in data/README.md, then `python scripts/build_dataset.py`; then import it with
  `npm run db:seed -- --env .env.tuke` (nothing imports on deploy any more) and redeploy the API (it carries the snapshot).
  Sources and tricks: Wayback snapshots of erasmus.tuke.sk, EWP HEI registry, CORDIS CSV, OpenAlex `I183764125`,
  crz.gov.sk, keep.eu, ceepus.info.

## History (session of 2026-10-06)

- 0c71d06–9e728a4: initial app, Vercel + Neon deploy, server-generated session secret, title kept clear of the globe.
- 38ffaa8: CDN-cached live feed, hidden-tab pause, place cards, faster rotation over oceans.
- 7484cb4: cards avoid the title/panels, sit next to the globe. a900948: guest countries blue instead of grey.
- bcbc65a: smooth reveal (GPU arcs, per-country fades, merged borders), countries light when the beam lands, mutual light.
- 630c781: smooth count-up counters. 09d2c0f: no cards and slow rotation during the opening. 1eb2faa: phone layout.
- tag `pred-casovou-osou` (= 1eb2faa). 1c00003: start years in the dataset. bebc50d: opening as the 1952–2027 timeline.
- c5e0f22: this file. f9744e8: 2D view + /porovnanie, shared WallScene core, beams kept within 3 years of their landing.
- 2026-10-07: 2D calmer (soft sea edge, dimmer dense Europe, short arcs glow less), cards docked as a lower third,
  `setCooperation` always clears star births (a replay without reveal showed no stars), year counter box fits the year.
- 2026-10-20 (branch `mssql-tuke`, tag `pred-mssql` = 96b7446 before it): the user moved the official deployment to TUKE
  infrastructure. 0b4d69d: database layer on MS SQL Server (Kysely + tedious, T-SQL migrations, MERGE seed), Vercel Git
  deployments off. 1def69f: build for IIS + iisnode, web and API on two hosts (CORS, VITE_API_URL).

## Open questions / next

- Organisers: 3D globe or 2D map for the wall (compare on /porovnanie), RU/BY on the map, what „kde si bol/a" means for
  guests, guest light colour, milestones wording, confirmation of the Erasmus list by the international office (OZVaM).
- TUKE hosting: Node.js version on the Plesk server (≥ 22 needed), go-live of srdcom.tuke.sk, the second database for the
  student lobby, deleting the Vercel project afterwards; merge `mssql-tuke` into `main` once TUKE is live.
- On site: LED wall resolution and playback PC test (dedicated GPU, Chrome kiosk `/?kiosk=1&k=CODE`), rehearsal.
- Load test with ~500 simulated guests; English version of the guest form; polish of /mapa on phones.
- Older cooperation (before 1980) would need archive sources; undated places (48) light up in the last year.
- Updating the architecture document: `Artifact` read by its URL, edit the saved file, publish with `url` set.
