/**
 * Guest lights.
 *   GET    /api/events/:slug                    event info for the form and the wall
 *   POST   /api/events/:slug/pins               a guest adds places (one submission = up to 10 lights)
 *   DELETE /api/events/:slug/submissions/:id    undo from the same browser within LIMITS.undoMinutes
 *   GET    /api/events/:slug/live               newest lights, CDN cached 2 s (the wall polls every 2 s)
 *   GET    /api/events/:slug/live?after=<id>    lights since a cursor, uncached (debugging, tools)
 *   GET    /api/events/:slug/summary            all lights aggregated per place (initial load, CDN cached 5 s)
 */
import { Hono } from 'hono';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  LIMITS, PinSubmitSchema, type EventInfo, type LivePin, type LiveTotals, type SubmitResponse, type SummaryPlace,
} from '@ples/shared';
import { countries, events, gazetteer, getDb, isDatabaseConfigured, pins, submissions, type Db } from '@ples/db';
import { CACHE, fail, readJson } from '../lib/http.ts';
import { deviceHash, ipHash, safeEqual, sha256 } from '../lib/security.ts';

type EventRow = typeof events.$inferSelect;

async function db(): Promise<Db> {
  if (!isDatabaseConfigured()) fail(503, 'database_missing', 'Zbieranie svetiel ešte nie je spustené (chýba databáza).');
  return getDb();
}

async function loadEvent(slug: string): Promise<EventRow> {
  const [ev] = await (await db()).select().from(events).where(eq(events.slug, slug)).limit(1);
  if (!ev || ev.status === 'draft') fail(404, 'event_not_found', 'Udalosť neexistuje.');
  return ev!;
}

export const eventInfo = (ev: EventRow): EventInfo => ({
  slug: ev.slug, name: ev.name, status: ev.status, requiresCode: Boolean(ev.codeHash), displayScene: ev.displayScene,
});

const visible = (eventId: number) => and(eq(pins.eventId, eventId), eq(pins.status, 'visible'), eq(countries.isHidden, false));

async function totals(d: Db, eventId: number): Promise<LiveTotals> {
  const [t] = await d.select({
    pins: sql<number>`count(*)::int`,
    places: sql<number>`count(distinct coalesce(${pins.geonameId}::text, ${pins.countryCode}))::int`,
    countries: sql<number>`count(distinct ${pins.countryCode})::int`,
  }).from(pins).innerJoin(countries, eq(countries.code, pins.countryCode)).where(visible(eventId));
  return t ?? { pins: 0, places: 0, countries: 0 };
}

const toLivePin = (p: typeof pins.$inferSelect): LivePin => ({
  id: p.id, name: p.placeName, countryCode: p.countryCode, lat: p.lat, lon: p.lon, visitKind: p.visitKind, createdAt: p.createdAt.toISOString(),
});

export const eventRoutes = new Hono()
  .get('/:slug', async c => {
    const ev = await loadEvent(c.req.param('slug'));
    c.header('Cache-Control', CACHE.none);
    return c.json(eventInfo(ev));
  })

  .post('/:slug/pins', async c => {
    const ev = await loadEvent(c.req.param('slug'));
    if (ev.status !== 'open' && ev.status !== 'live') fail(409, 'event_closed', 'Pridávanie svetiel je momentálne zatvorené.');
    const input = await readJson(c, PinSubmitSchema);
    if (ev.codeHash && !(input.code && safeEqual(sha256(input.code.toUpperCase()), ev.codeHash))) {
      fail(403, 'code_invalid', 'Na pridanie svetla naskenuj QR kód z plesu.');
    }
    const device = deviceHash(c);
    const ip = ipHash(c);
    const d = await db();

    // rate limits: per browser and per address (the venue Wi-Fi shares one address, so that limit is loose)
    const since = new Date(Date.now() - 10 * 60_000);
    const [byDevice] = await d.select({ n: sql<number>`count(*)::int` }).from(submissions)
      .where(and(eq(submissions.eventId, ev.id), eq(submissions.deviceHash, device), gt(submissions.createdAt, since)));
    if ((byDevice?.n ?? 0) >= LIMITS.submissionsPerDevice10min) fail(429, 'too_many', 'Veľa svetiel naraz. Skús to o pár minút.');
    const [byIp] = await d.select({ n: sql<number>`count(*)::int` }).from(submissions)
      .where(and(eq(submissions.eventId, ev.id), eq(submissions.ipHash, ip), gt(submissions.createdAt, since)));
    if ((byIp?.n ?? 0) >= LIMITS.submissionsPerIp10min) fail(429, 'too_many', 'Veľa svetiel naraz. Skús to o pár minút.');

    // resolve places on the server: coordinates never come from the browser
    const geonameIds = [...new Set(input.places.flatMap(p => ('geonameId' in p ? [p.geonameId] : [])))];
    const countryCodes = [...new Set(input.places.flatMap(p => ('countryCode' in p ? [p.countryCode] : [])))];
    const cityRows = geonameIds.length ? await d.select({
      geonameId: gazetteer.geonameId, name: gazetteer.name, countryCode: gazetteer.countryCode, lat: gazetteer.lat, lon: gazetteer.lon,
    }).from(gazetteer).where(inArray(gazetteer.geonameId, geonameIds)) : [];
    const countryRows = countryCodes.length ? await d.select({ code: countries.code, name: countries.nameSk, lat: countries.lat, lon: countries.lon })
      .from(countries).where(inArray(countries.code, countryCodes)) : [];
    if (cityRows.length !== geonameIds.length || countryRows.some(r => r.lat === null) || countryRows.length !== countryCodes.length) {
      fail(400, 'unknown_place', 'Niektoré z vybraných miest nepoznáme. Vyber ich znova zo zoznamu.');
    }

    const [sub] = await d.insert(submissions).values({
      eventId: ev.id, deviceHash: device, ipHash: ip, personRole: input.role ?? null, faculty: input.faculty ?? null,
    }).returning({ id: submissions.id, createdAt: submissions.createdAt });
    const rows = [
      ...cityRows.map(r => ({ geonameId: r.geonameId, countryCode: r.countryCode, placeName: r.name, lat: r.lat, lon: r.lon })),
      ...countryRows.map(r => ({ geonameId: null, countryCode: r.code, placeName: r.name, lat: r.lat!, lon: r.lon! })),
    ].map(r => ({ ...r, eventId: ev.id, submissionId: sub!.id, visitKind: input.visitKind }));
    const inserted = await d.insert(pins).values(rows).returning();

    const body: SubmitResponse = {
      submissionId: sub!.id,
      pins: inserted.map(toLivePin),
      undoUntil: new Date(sub!.createdAt.getTime() + LIMITS.undoMinutes * 60_000).toISOString(),
    };
    c.header('Cache-Control', CACHE.none);
    return c.json(body, 201);
  })

  .delete('/:slug/submissions/:id', async c => {
    const ev = await loadEvent(c.req.param('slug'));
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id', 'Neplatné ID.');
    const d = await db();
    const deleted = await d.delete(submissions).where(and(
      eq(submissions.id, id), eq(submissions.eventId, ev.id), eq(submissions.deviceHash, deviceHash(c)),
      gt(submissions.createdAt, new Date(Date.now() - LIMITS.undoMinutes * 60_000)),
    )).returning({ id: submissions.id });
    if (!deleted.length) fail(404, 'not_found', 'Svetlá sa už nedajú vrátiť.');
    return c.json({ ok: true });
  })

  .get('/:slug/live', async c => {
    const ev = await loadEvent(c.req.param('slug'));
    const d = await db();
    const afterParam = c.req.query('after');
    if (afterParam === undefined) {
      // the newest lights, identical for every viewer, so the CDN can answer the polls
      const rows = await d.select({ pin: pins }).from(pins)
        .innerJoin(countries, eq(countries.code, pins.countryCode))
        .where(visible(ev.id))
        .orderBy(desc(pins.id))
        .limit(LIMITS.liveWindow);
      const list = rows.map(r => toLivePin(r.pin)).reverse();
      c.header('Cache-Control', CACHE.live);
      return c.json({ event: eventInfo(ev), cursor: list.at(-1)?.id ?? 0, pins: list, totals: await totals(d, ev.id) });
    }
    const after = Math.max(0, Number(afterParam) || 0);
    const rows = await d.select({ pin: pins }).from(pins)
      .innerJoin(countries, eq(countries.code, pins.countryCode))
      .where(and(visible(ev.id), gt(pins.id, after)))
      .orderBy(asc(pins.id))
      .limit(200);
    const list = rows.map(r => toLivePin(r.pin));
    c.header('Cache-Control', CACHE.none);
    return c.json({ event: eventInfo(ev), cursor: list.at(-1)?.id ?? after, pins: list, totals: await totals(d, ev.id) });
  })

  .get('/:slug/summary', async c => {
    const ev = await loadEvent(c.req.param('slug'));
    const d = await db();
    const key = sql<string>`coalesce(${pins.geonameId}::text, 'country:' || ${pins.countryCode})`;
    const rows = await d.select({
      key,
      name: sql<string>`min(${pins.placeName})`,
      countryCode: sql<string>`min(${pins.countryCode})`,
      lat: sql<number>`avg(${pins.lat})::float8`,
      lon: sql<number>`avg(${pins.lon})::float8`,
      count: sql<number>`count(*)::int`,
      lastPinId: sql<number>`max(${pins.id})::int`,
    }).from(pins).innerJoin(countries, eq(countries.code, pins.countryCode)).where(visible(ev.id)).groupBy(key);
    const places: SummaryPlace[] = rows;
    c.header('Cache-Control', CACHE.summary);
    return c.json({ event: eventInfo(ev), cursor: places.reduce((m, p) => Math.max(m, p.lastPinId), 0), places, totals: await totals(d, ev.id) });
  });
