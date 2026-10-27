/**
 * Guest lights of a venue (/api/… the ball, /api/vestibul/… the student lobby, each in its own database).
 *   GET    /api/events/:slug                    event info for the form and the wall
 *   POST   /api/events/:slug/pins               a guest adds places (one submission = up to 10 lights)
 *   DELETE /api/events/:slug/submissions/:id    undo from the same browser within LIMITS.undoMinutes
 *   GET    /api/events/:slug/live               newest lights, shared for 2 s (the wall polls every 2 s)
 *   GET    /api/events/:slug/live?after=<id>    lights since a cursor, uncached (debugging, tools)
 *   GET    /api/events/:slug/summary            all lights aggregated per place (initial load, shared for 5 s)
 *   POST   /api/events/:slug/attendees          confirmation of attendance from /onboarding (before and during the ball)
 * Lights are accepted while the ball is live; before it (status open) only from a logged-in admin (rehearsal).
 */
import { Hono } from 'hono';
import {
  AttendeeSchema, LIMITS, PinSubmitSchema, type AttendeeResponse, type EventInfo, type LivePin, type LiveResponse, type LiveTotals,
  type SubmitResponse, type SummaryPlace, type SummaryResponse, type VenueKey,
} from '@ples/shared';
import { getDb, isDatabaseConfigured, sql, type Db, type EventRow, type PinRow } from '@ples/db';
import { CACHE, fail, readJson, shared } from '../lib/http.ts';
import { clientIp, deviceHash, hasSession, ipHash, safeEqual, sha256 } from '../lib/security.ts';
import { venueOf } from '../lib/venue.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where the QR code with the access code hangs, for the message when the code is missing or wrong. */
const SCAN_HINT: Record<VenueKey, string> = {
  ples: 'Na pridanie svetla naskenuj QR kód z plesu.',
  vestibul: 'Na pridanie svetla naskenuj QR kód na stene vo vestibule.',
};

async function db(venue: VenueKey): Promise<Db> {
  if (!isDatabaseConfigured(venue)) fail(503, 'database_missing', 'Zbieranie svetiel ešte nie je spustené (chýba databáza).');
  return getDb(venue);
}

async function loadEvent(venue: VenueKey, slug: string): Promise<EventRow> {
  const ev = await (await db(venue)).selectFrom('events').selectAll().where('slug', '=', slug).executeTakeFirst();
  if (!ev || ev.status === 'draft') fail(404, 'event_not_found', 'Udalosť neexistuje.');
  return ev!;
}

export const eventInfo = (ev: EventRow): EventInfo => ({
  slug: ev.slug, name: ev.name, status: ev.status, requiresCode: Boolean(ev.code_hash), displayScene: ev.display_scene,
});

/** Lights shown on the wall: visible, and not in a hidden country. */
const visiblePins = (d: Db, eventId: number) => d.selectFrom('pins as p')
  .innerJoin('countries as c', 'c.code', 'p.country_code')
  .where('p.event_id', '=', eventId).where('p.status', '=', 'visible').where('c.is_hidden', '=', false);

async function totals(d: Db, eventId: number): Promise<LiveTotals> {
  const t = await visiblePins(d, eventId).select([
    sql<number>`count(*)`.as('pins'),
    sql<number>`count(distinct coalesce(cast(p.geoname_id as nvarchar(20)), p.country_code))`.as('places'),
    sql<number>`count(distinct p.country_code)`.as('countries'),
  ]).executeTakeFirst();
  return t ?? { pins: 0, places: 0, countries: 0 };
}

const toLivePin = (p: PinRow): LivePin => ({
  id: p.id, name: p.place_name, countryCode: p.country_code, lat: p.lat, lon: p.lon, visitKind: p.visit_kind, createdAt: p.created_at.toISOString(),
});

// identical for every viewer: computed once per interval, whatever the number of screens and phones polling;
// keyed by venue and event, the venues never see each other's lights
const liveFeed = shared<LiveResponse>(2_000);
const summaryFeed = shared<SummaryResponse>(5_000);

export const eventRoutes = new Hono()
  .get('/:slug', async c => {
    const ev = await loadEvent(venueOf(c), c.req.param('slug'));
    c.header('Cache-Control', CACHE.none);
    return c.json(eventInfo(ev));
  })

  .post('/:slug/pins', async c => {
    const venue = venueOf(c);
    const ev = await loadEvent(venue, c.req.param('slug'));
    // the ball night; before it only an admin trying the whole flow (the wall, the form) on the venue screen
    if (ev.status !== 'live' && !(ev.status === 'open' && hasSession(c))) fail(409, 'event_closed', 'Pridávanie svetiel je momentálne zatvorené.');
    const input = await readJson(c, PinSubmitSchema);
    if (ev.code_hash && !(input.code && safeEqual(sha256(input.code.toUpperCase()), ev.code_hash))) {
      fail(403, 'code_invalid', SCAN_HINT[venue]);
    }
    const device = deviceHash(c);
    const ip = ipHash(c);
    const d = await db(venue);

    // rate limits: per browser and per address (the venue Wi-Fi shares one address, so that limit is loose;
    // it is skipped when the address is unknown, otherwise every guest would share one budget)
    const since = new Date(Date.now() - 10 * 60_000);
    const recent = d.selectFrom('submissions').select(eb => eb.fn.countAll<number>().as('n'))
      .where('event_id', '=', ev.id).where('created_at', '>', since);
    const byDevice = await recent.where('device_hash', '=', device).executeTakeFirst();
    if ((byDevice?.n ?? 0) >= LIMITS.submissionsPerDevice10min) fail(429, 'too_many', 'Veľa svetiel naraz. Skús to o pár minút.');
    if (clientIp(c)) {
      const byIp = await recent.where('ip_hash', '=', ip).executeTakeFirst();
      if ((byIp?.n ?? 0) >= LIMITS.submissionsPerIp10min) fail(429, 'too_many', 'Veľa svetiel naraz. Skús to o pár minút.');
    }

    // resolve places on the server: coordinates never come from the browser
    const geonameIds = [...new Set(input.places.flatMap(p => ('geonameId' in p ? [p.geonameId] : [])))];
    const countryCodes = [...new Set(input.places.flatMap(p => ('countryCode' in p ? [p.countryCode] : [])))];
    const cityRows = geonameIds.length ? await d.selectFrom('gazetteer')
      .select(['geoname_id', 'name', 'country_code', 'lat', 'lon']).where('geoname_id', 'in', geonameIds).execute() : [];
    const countryRows = countryCodes.length ? await d.selectFrom('countries')
      .select(['code', 'name_sk', 'lat', 'lon']).where('code', 'in', countryCodes).execute() : [];
    if (cityRows.length !== geonameIds.length || countryRows.some(r => r.lat === null) || countryRows.length !== countryCodes.length) {
      fail(400, 'unknown_place', 'Niektoré z vybraných miest nepoznáme. Vyber ich znova zo zoznamu.');
    }

    const { sub, inserted } = await d.transaction().execute(async trx => {
      const sub = await trx.insertInto('submissions').values({
        event_id: ev.id, device_hash: device, ip_hash: ip, person_role: input.role ?? null, faculty: input.faculty ?? null,
      }).output(['inserted.id', 'inserted.created_at']).executeTakeFirstOrThrow();
      const rows = [
        ...cityRows.map(r => ({ geoname_id: r.geoname_id, country_code: r.country_code, place_name: r.name, lat: r.lat, lon: r.lon })),
        ...countryRows.map(r => ({ geoname_id: null, country_code: r.code, place_name: r.name_sk, lat: r.lat!, lon: r.lon! })),
      ].map(r => ({ ...r, event_id: ev.id, submission_id: sub.id, visit_kind: input.visitKind }));
      const inserted = await trx.insertInto('pins').values(rows).outputAll('inserted').execute();
      return { sub, inserted };
    });

    const body: SubmitResponse = {
      submissionId: sub.id.toLowerCase(), // SQL Server returns GUIDs in upper case
      pins: inserted.sort((a, b) => a.id - b.id).map(toLivePin),
      undoUntil: new Date(sub.created_at.getTime() + LIMITS.undoMinutes * 60_000).toISOString(),
    };
    c.header('Cache-Control', CACHE.none);
    return c.json(body, 201);
  })

  .post('/:slug/attendees', async c => {
    const venue = venueOf(c);
    const ev = await loadEvent(venue, c.req.param('slug'));
    if (ev.status !== 'open' && ev.status !== 'live') fail(409, 'onboarding_closed', 'Potvrdzovanie účasti je uzavreté.');
    const input = await readJson(c, AttendeeSchema);
    const device = deviceHash(c);
    const ip = ipHash(c);
    const d = await db(venue);
    // one phone may confirm a few people (a couple, a family); a shared network gets a loose limit
    const since = new Date(Date.now() - 10 * 60_000);
    const recent = d.selectFrom('attendees').select(eb => eb.fn.countAll<number>().as('n'))
      .where('event_id', '=', ev.id).where('created_at', '>', since);
    const byDevice = await recent.where('device_hash', '=', device).executeTakeFirst();
    if ((byDevice?.n ?? 0) >= LIMITS.attendeesPerDevice10min) fail(429, 'too_many', 'Veľa potvrdení naraz. Skús to o pár minút.');
    if (clientIp(c)) {
      const byIp = await recent.where('ip_hash', '=', ip).executeTakeFirst();
      if ((byIp?.n ?? 0) >= LIMITS.attendeesPerIp10min) fail(429, 'too_many', 'Veľa potvrdení naraz. Skús to o pár minút.');
    }
    const row = await d.insertInto('attendees')
      .values({ event_id: ev.id, full_name: input.name, affiliation: input.affiliation, device_hash: device, ip_hash: ip })
      .output('inserted.id').executeTakeFirstOrThrow();
    c.header('Cache-Control', CACHE.none);
    return c.json({ id: row.id, name: input.name } satisfies AttendeeResponse, 201);
  })

  .delete('/:slug/submissions/:id', async c => {
    const venue = venueOf(c);
    const ev = await loadEvent(venue, c.req.param('slug'));
    const id = c.req.param('id');
    if (!UUID.test(id)) fail(400, 'invalid_id', 'Neplatné ID.');
    const d = await db(venue);
    // deleting the submission removes its lights (ON DELETE CASCADE)
    const deleted = await d.deleteFrom('submissions')
      .where('id', '=', id).where('event_id', '=', ev.id).where('device_hash', '=', deviceHash(c))
      .where('created_at', '>', new Date(Date.now() - LIMITS.undoMinutes * 60_000))
      .output('deleted.id')
      .execute();
    if (!deleted.length) fail(404, 'not_found', 'Svetlá sa už nedajú vrátiť.');
    return c.json({ ok: true });
  })

  .get('/:slug/live', async c => {
    const venue = venueOf(c);
    const slug = c.req.param('slug');
    const afterParam = c.req.query('after');
    if (afterParam === undefined) {
      // the newest lights, identical for every viewer
      const body = await liveFeed(`${venue}/${slug}`, async () => {
        const ev = await loadEvent(venue, slug);
        const d = await db(venue);
        const rows = await visiblePins(d, ev.id).selectAll('p').orderBy('p.id', 'desc').top(LIMITS.liveWindow).execute();
        const list = rows.map(toLivePin).reverse();
        return { event: eventInfo(ev), cursor: list.at(-1)?.id ?? 0, pins: list, totals: await totals(d, ev.id) };
      });
      c.header('Cache-Control', CACHE.live);
      return c.json(body);
    }
    const ev = await loadEvent(venue, slug);
    const d = await db(venue);
    const after = Math.max(0, Math.floor(Number(afterParam)) || 0);
    const rows = await visiblePins(d, ev.id).selectAll('p').where('p.id', '>', after).orderBy('p.id', 'asc').top(200).execute();
    const list = rows.map(toLivePin);
    c.header('Cache-Control', CACHE.none);
    return c.json({ event: eventInfo(ev), cursor: list.at(-1)?.id ?? after, pins: list, totals: await totals(d, ev.id) } satisfies LiveResponse);
  })

  .get('/:slug/summary', async c => {
    const venue = venueOf(c);
    const slug = c.req.param('slug');
    const body = await summaryFeed(`${venue}/${slug}`, async () => {
      const ev = await loadEvent(venue, slug);
      const d = await db(venue);
      // the same expression in SELECT and GROUP BY: a city by its GeoNames id, a whole country by its code
      const key = sql<string>`coalesce(cast(p.geoname_id as nvarchar(20)), N'country:' + p.country_code)`;
      const places: SummaryPlace[] = await visiblePins(d, ev.id).select([
        key.as('key'),
        sql<string>`min(p.place_name)`.as('name'),
        sql<string>`min(p.country_code)`.as('countryCode'),
        sql<number>`avg(p.lat)`.as('lat'),
        sql<number>`avg(p.lon)`.as('lon'),
        sql<number>`count(*)`.as('count'),
        sql<number>`max(p.id)`.as('lastPinId'),
      ]).groupBy(key).execute();
      return { event: eventInfo(ev), cursor: places.reduce((m, p) => Math.max(m, p.lastPinId), 0), places, totals: await totals(d, ev.id) };
    });
    c.header('Cache-Control', CACHE.summary);
    return c.json(body);
  });
