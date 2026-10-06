/** Hard facts for the globe: GET /api/globe, GET /api/globe/places/:id */
import { Hono } from 'hono';
import { and, asc, eq, sql } from 'drizzle-orm';
import { CATEGORIES, type GlobeResponse, type PlaceDetail } from '@ples/shared';
import {
  categories, coopPlaces, cooperationLinks, countries, datasetImports, getDb, institutions, isDatabaseConfigured,
} from '@ples/db';
import { CACHE, fail } from '../lib/http.ts';
import { snapshotGlobe, snapshotPlace, sortGroups } from '../snapshot.ts';

async function globeFromDb(): Promise<GlobeResponse | null> {
  const db = await getDb();
  const [current] = await db.select().from(datasetImports).where(eq(datasetImports.isCurrent, true)).limit(1);
  if (!current) return null; // database connected but not seeded yet
  const rows = await db.select({
    id: coopPlaces.extId,
    name: coopPlaces.name,
    countryCode: coopPlaces.countryCode,
    country: countries.nameSk,
    lat: coopPlaces.lat,
    lon: coopPlaces.lon,
    distanceKm: coopPlaces.distanceKm,
    institutions: sql<number>`count(distinct ${institutions.id})::int`,
    links: sql<number>`count(${cooperationLinks.id})::int`,
    groups: sql<string[]>`array_agg(distinct ${categories.groupCode})`,
  })
    .from(coopPlaces)
    .innerJoin(countries, and(eq(countries.code, coopPlaces.countryCode), eq(countries.isHidden, false)))
    .innerJoin(institutions, eq(institutions.placeId, coopPlaces.id))
    .innerJoin(cooperationLinks, eq(cooperationLinks.institutionId, institutions.id))
    .innerJoin(categories, eq(categories.code, cooperationLinks.categoryCode))
    .where(eq(coopPlaces.importId, current.id))
    .groupBy(coopPlaces.id, countries.nameSk)
    .orderBy(asc(coopPlaces.distanceKm));
  const places = rows.map(r => ({ ...r, countryCode: r.countryCode.trim(), groups: sortGroups(r.groups) }));
  return {
    version: current.version,
    generated: current.version.split('+')[0]!,
    source: 'database',
    stats: {
      institutions: places.reduce((s, p) => s + p.institutions, 0),
      places: places.length,
      countries: new Set(places.map(p => p.countryCode)).size,
      links: places.reduce((s, p) => s + p.links, 0),
    },
    places,
  };
}

let memo: { at: number; value: GlobeResponse } | undefined;
async function loadGlobe(): Promise<GlobeResponse> {
  if (memo && Date.now() - memo.at < 60_000) return memo.value;
  let value: GlobeResponse | null = null;
  if (isDatabaseConfigured()) {
    try { value = await globeFromDb(); } catch (err) { console.error('[globe] database unavailable, serving snapshot:', (err as Error).message); }
  }
  value ??= snapshotGlobe();
  memo = { at: Date.now(), value };
  return value;
}

async function placeFromDb(id: string): Promise<PlaceDetail | null> {
  const db = await getDb();
  const label = new Map<string, string>(CATEGORIES.map(c => [c.code, c.label]));
  const rows = await db.select({
    placeName: coopPlaces.name, country: countries.nameSk, distanceKm: coopPlaces.distanceKm,
    institution: institutions.name, institutionId: institutions.id,
    category: cooperationLinks.categoryCode, detail: cooperationLinks.detail, tukeUnits: cooperationLinks.tukeUnits,
    sourceUrl: cooperationLinks.sourceUrl, since: cooperationLinks.since,
  })
    .from(coopPlaces)
    .innerJoin(datasetImports, and(eq(datasetImports.id, coopPlaces.importId), eq(datasetImports.isCurrent, true)))
    .innerJoin(countries, eq(countries.code, coopPlaces.countryCode))
    .innerJoin(institutions, eq(institutions.placeId, coopPlaces.id))
    .innerJoin(cooperationLinks, eq(cooperationLinks.institutionId, institutions.id))
    .where(eq(coopPlaces.extId, id))
    .orderBy(asc(institutions.name), asc(cooperationLinks.id));
  if (!rows.length) return null;
  const byInstitution = new Map<number, PlaceDetail['institutions'][number]>();
  for (const r of rows) {
    const inst = byInstitution.get(r.institutionId) ?? byInstitution.set(r.institutionId, { name: r.institution, links: [] }).get(r.institutionId)!;
    inst.links.push({ category: label.get(r.category) ?? r.category, detail: r.detail, tukeUnits: r.tukeUnits, sourceUrl: r.sourceUrl, since: r.since });
  }
  const first = rows[0]!;
  return { id, name: first.placeName, country: first.country, distanceKm: first.distanceKm, institutions: [...byInstitution.values()] };
}

export const globe = new Hono()
  .get('/', async c => {
    const data = await loadGlobe();
    const etag = `"${data.version}"`;
    c.header('Cache-Control', CACHE.dataset);
    c.header('ETag', etag);
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    return c.json(data);
  })
  .get('/places/:id', async c => {
    const id = c.req.param('id');
    if (!/^c\d{1,6}$/.test(id)) fail(400, 'invalid_id', 'Neplatné ID miesta.');
    const { source } = await loadGlobe();
    let detail: PlaceDetail | null = null;
    if (source === 'database') {
      try { detail = await placeFromDb(id); } catch (err) { console.error('[globe] place from database failed:', (err as Error).message); }
    }
    detail ??= snapshotPlace(id);
    if (!detail) fail(404, 'not_found', 'Miesto neexistuje.');
    c.header('Cache-Control', CACHE.dataset);
    return c.json(detail);
  });
