/** Hard facts for the globe: GET /api/globe, GET /api/globe/places/:id */
import { Hono } from 'hono';
import { CATEGORIES, type GlobeResponse, type PlaceDetail } from '@ples/shared';
import { fromJson, getDb, isDatabaseConfigured, sql } from '@ples/db';
import { CACHE, fail } from '../lib/http.ts';
import { snapshotGlobe, snapshotPlace, sortGroups } from '../snapshot.ts';

async function globeFromDb(): Promise<GlobeResponse | null> {
  const db = await getDb();
  const current = await db.selectFrom('dataset_imports').select(['id', 'version']).where('is_current', '=', true).top(1).executeTakeFirst();
  if (!current) return null; // database connected but not seeded yet
  const rows = await db.selectFrom('coop_places as p')
    .innerJoin('countries as c', join => join.onRef('c.code', '=', 'p.country_code').on('c.is_hidden', '=', false))
    .innerJoin('institutions as i', 'i.place_id', 'p.id')
    .innerJoin('cooperation_links as l', 'l.institution_id', 'i.id')
    .innerJoin('categories as k', 'k.code', 'l.category_code')
    .where('p.import_id', '=', current.id)
    .groupBy(['p.id', 'p.ext_id', 'p.name', 'p.country_code', 'c.name_sk', 'p.lat', 'p.lon', 'p.distance_km'])
    .select([
      'p.ext_id as id', 'p.name', 'p.country_code as countryCode', 'c.name_sk as country', 'p.lat', 'p.lon', 'p.distance_km as distanceKm',
      sql<number>`count(distinct i.id)`.as('institutions'),
      sql<number>`count(l.id)`.as('links'),
      // STRING_AGG has no DISTINCT: sortGroups() removes the repeats
      sql<string>`string_agg(cast(k.group_code as nvarchar(max)), N',')`.as('groups'),
      sql<number | null>`min(case when l.since like '[0-9][0-9][0-9][0-9]%' then cast(left(l.since, 4) as int) end)`.as('since'),
    ])
    .orderBy('p.distance_km')
    .execute();
  const places = rows.map(r => ({ ...r, groups: sortGroups(r.groups.split(',')) }));
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
  const rows = await db.selectFrom('coop_places as p')
    .innerJoin('dataset_imports as d', join => join.onRef('d.id', '=', 'p.import_id').on('d.is_current', '=', true))
    .innerJoin('countries as c', 'c.code', 'p.country_code')
    .innerJoin('institutions as i', 'i.place_id', 'p.id')
    .innerJoin('cooperation_links as l', 'l.institution_id', 'i.id')
    .where('p.ext_id', '=', id)
    .select([
      'p.name as placeName', 'c.name_sk as country', 'p.distance_km as distanceKm',
      'i.name as institution', 'i.id as institutionId',
      'l.category_code as category', 'l.detail', 'l.tuke_units as tukeUnits', 'l.source_url as sourceUrl', 'l.since',
    ])
    .orderBy('i.name').orderBy('l.id')
    .execute();
  if (!rows.length) return null;
  const byInstitution = new Map<number, PlaceDetail['institutions'][number]>();
  for (const r of rows) {
    const inst = byInstitution.get(r.institutionId) ?? byInstitution.set(r.institutionId, { name: r.institution, links: [] }).get(r.institutionId)!;
    inst.links.push({
      category: label.get(r.category) ?? r.category, detail: r.detail, tukeUnits: fromJson<string[]>(r.tukeUnits, []), sourceUrl: r.sourceUrl, since: r.since,
    });
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
