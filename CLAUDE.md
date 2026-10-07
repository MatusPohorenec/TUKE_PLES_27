# Ples TUKE 2027 – „S TUKE rozsvieťme mapu sveta"

Live web app for the TUKE ball 2027, which celebrates **75 years of the Technical University of Košice (founded 8 July 1952)**.
A dark, "switched-off" rotating globe is shown on the LED wall at the ball: light flies from Košice to every place where TUKE
has documented cooperation, places light up as twinkling stars, and guests add the places they have been to via a QR code,
live. Theme: midnight blue + silver, light / play of light (svetlohra). Visual polish and correct, sourced data both matter.

- Production: https://tuke-ples-27.vercel.app (`/api/health` shows the deployed commit)
- Repo: https://github.com/MatusPohorenec/TUKE_PLES_27 (**public**: never commit secrets or personal data)
- Architecture document for reviewers (Slovak, private artifact): https://claude.ai/artifact/VvkL4spi4XUYJMMVuNB68A
- `README.md` (Slovak) = dev/deploy guide, `data/README.md` (Slovak) = data sources, pipeline, known limits

## Working agreements

- Talk to the user in Slovak. UI texts are Slovak. Code, comments and commit messages are English.
- Flow used throughout: implement → `npm run typecheck` → verify in the browser pane (local dev server) → commit → push to `main`
  (**this deploys production**) → wait until `/api/health` reports the new commit → verify on production → short report.
- Push over HTTPS without prompts: `GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0 git push` (SSH push is denied on this machine).
- Before big changes tag the current state (example: tag `pred-casovou-osou` = the wall before the timeline opening).
- Never type passwords/secrets into anything; the user sets `ADMIN_PASSWORD` in Vercel himself. Don't print `DATABASE_URL`.
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
apps/api         Hono 4 REST API under /api (routes: globe, events, gazetteer, admin, feedback); snapshot.ts = bundled
                 dataset fallback when the DB is unreachable; lib/http.ts (CACHE headers), lib/security.ts
packages/db      Drizzle schema (schema.ts), migrations (drizzle/), seed CLI; drivers: Neon HTTP / node-postgres / PGlite
packages/shared  constants.ts (ORIGIN, TUKE_FOUNDED, MILESTONES, CATEGORY_GROUPS, CATEGORIES, LIMITS …), api.ts (zod schemas,
                 response types); `@ples/shared/constants` has no zod, for the browser bundle
data/            tuke_cooperation.json (+ .csv) = the versioned dataset (source of truth for hard facts), raw/, evidence/
scripts/         Python pipeline that builds the dataset (order in data/README.md)
tools/           dev.mjs (web + api), build-vercel.mjs (Vercel Build Output API)
```

## Commands

```bash
npm install
npm run dev          # web http://localhost:5173 (proxies /api), api http://localhost:8787/api/health
npm run typecheck
npm run db:migrate
npm run db:seed      # imports data/tuke_cooperation.json when it changed (--force to re-import, --if-needed on Vercel)
node tools/build-vercel.mjs   # local check of the production build
```

- Without `DATABASE_URL` the API uses PGlite in `.data/pglite`. PGlite allows one process: **stop the dev server before `db:seed`**.
- In the browser pane the dev server is the launch config `app` (`.claude/launch.json`: `npm run dev`, port 5173).
- Windows machine: Git Bash and PowerShell; Python 3 with requests, beautifulsoup4, lxml. Temp scripts go to the session scratchpad.
- Local DB has 6 test guest lights (JP, AT, BR×2, MX, US); production has none. Test lights: POST `/api/events/ples-2027/pins`
  with header `x-device-id: <16–64 hex chars>` and body `{"places":[{"countryCode":"NP"}],"visitKind":"erasmus_study"}`;
  undo with DELETE `/api/events/ples-2027/submissions/<submissionId>` and the same header.

## Deploy (Vercel)

- Vercel project deploys every push to `main`. `vercel.json`: `npm ci`, build `npm run vercel-build`
  = migrate → seed `--if-needed` (re-imports when the dataset hash changes) → `tools/build-vercel.mjs`
  (static web + one function `api.func`, nodejs22.x, fra1; routes /api → function, then files, then SPA fallback).
  The build fails if the function bundle statically imports a package (PGlite is external).
- Env: `DATABASE_URL` (Neon via Vercel Marketplace, Free plan, Frankfurt, prefix DATABASE), `ADMIN_PASSWORD`,
  optional `SESSION_SECRET` (else generated and stored in table `app_settings`).
- CDN caching (apps/api/src/lib/http.ts): globe 1 h + ETag, gazetteer 24 h, summary 5 s, live 2 s (identical for all viewers;
  Vercel strips `s-maxage` from the response, check `X-Vercel-Cache: HIT`), everything else no-store.
- Hobby plan is non-commercial only: an official TUKE deployment needs Pro or a university account (open decision).
- Waiting for a deploy (foreground `sleep` is blocked for the agent): run in background
  `for i in $(seq 1 40); do curl -s https://tuke-ples-27.vercel.app/api/health | grep -q <commit> && exit 0; sleep 10; done`.

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
  country, distance, institutions/links and the top 3 partners; guest cards the guest count.
- Countries: per-country MeshBasicMaterial with fades; palette blue only: scene subject `[86,128,255,.42]`, other layer
  `[86,128,255,.2]`, unlit `[14,26,78,.55]`, Slovakia white `.55`. (A warm tint at low alpha rendered grey: don't.)
- Scenes (admin): `cooperation` (arcs + coop stars, guests beside) and `live` (arcs fade out, coop stars dimmed, guest countries
  lit). Guest lights: warm stars/arcs `#ffd9a0`, one-by-one arrivals (max 8 animated per poll), country tints when the beam lands.
- Live feed: wall polls `/live` every 2 s (map 5 s), CDN-cached newest 60; own cursor; resync from `/summary` after a gap
  bigger than the window and every 5 min (so hidden/undone lights disappear); polling pauses in hidden tabs.
- Layout: title fitted above the globe and faded when the globe is zoomed into it; `?kiosk=1` hides links/cursor, keeps the
  screen awake; `R` replays the opening. Phones (≤760 px): one row of buttons, counters in one row with short labels, globe
  sized to end above the counters.

## 2D view (`?view=2d`, added 2026-10-07 to compare readability; decision pending)

- MapScene draws the same wall on a Natural Earth projection (Antarctica left out): ocean shape with a blue rim, per-country
  meshes (triangulated from d3-geo projected rings, holes handled) using the shared country materials, outlines as one
  LineSegments, arcs bowing northwards (quadratic, same ArcLayer shader), stars with the same StarLayer (`sphere: false`),
  guest beams as a one-shot ArcLayer (`ambient: false`).
- No rotation. During the opening the view starts on Central Europe (12 % of the world's width) and only widens to hold
  Košice and every place whose beam is a third of the way there (+18 % padding), then shows the whole world.
- Layout differences: on the flat map the bottom right is Australia, so the QR panel sits top right (empty Arctic,
  Russia is hidden) as a narrow column (`.wall.view-2d .wall-join`). Cards sit on the map (no side margins).
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
- If the pane is hidden, rAF drops to ~1 fps and live timing tests are meaningless: measure fps first.
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
- Rebuild: run the scripts in the order in data/README.md, then `python scripts/build_dataset.py`; a changed dataset is
  re-imported on the next deploy. Sources and tricks: Wayback snapshots of erasmus.tuke.sk, EWP HEI registry, CORDIS CSV,
  OpenAlex `I183764125`, crz.gov.sk, keep.eu, ceepus.info.

## History (session of 2026-10-06)

- 0c71d06–9e728a4: initial app, Vercel + Neon deploy, server-generated session secret, title kept clear of the globe.
- 38ffaa8: CDN-cached live feed, hidden-tab pause, place cards, faster rotation over oceans.
- 7484cb4: cards avoid the title/panels, sit next to the globe. a900948: guest countries blue instead of grey.
- bcbc65a: smooth reveal (GPU arcs, per-country fades, merged borders), countries light when the beam lands, mutual light.
- 630c781: smooth count-up counters. 09d2c0f: no cards and slow rotation during the opening. 1eb2faa: phone layout.
- tag `pred-casovou-osou` (= 1eb2faa). 1c00003: start years in the dataset. bebc50d: opening as the 1952–2027 timeline.
- c5e0f22: this file. 2026-10-07: 2D view + /porovnanie, shared WallScene core, beams kept within 3 years of their landing.

## Open questions / next

- Organisers: 3D globe or 2D map for the wall (compare on /porovnanie), RU/BY on the map, what „kde si bol/a" means for
  guests, guest light colour, milestones wording, Vercel plan,
  confirmation of the Erasmus list by the international office (OZVaM).
- On site: LED wall resolution and playback PC test (dedicated GPU, Chrome kiosk `/?kiosk=1&k=CODE`), rehearsal.
- Load test with ~500 simulated guests; English version of the guest form; polish of /mapa on phones.
- Older cooperation (before 1980) would need archive sources; undated places (48) light up in the last year.
- Updating the architecture document: `Artifact` read by its URL, edit the saved file, publish with `url` set.
