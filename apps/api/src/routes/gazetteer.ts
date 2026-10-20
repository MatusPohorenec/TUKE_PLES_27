/** Place search for the guest form: GET /api/gazetteer/search?q=vied */
import { Hono } from 'hono';
import { normalizeSearch, type GazetteerHit } from '@ples/shared';
import { getDb, sql } from '@ples/db';
import { CACHE, fail, positiveInt } from '../lib/http.ts';

type Country = { code: string; nameSk: string; nameEn: string; lat: number | null; lon: number | null; search: string };
let countryCache: { at: number; rows: Country[] } | undefined;

async function allCountries(): Promise<Country[]> {
  if (countryCache && Date.now() - countryCache.at < 600_000) return countryCache.rows;
  const db = await getDb();
  const rows = await db.selectFrom('countries').select(['code', 'name_sk as nameSk', 'name_en as nameEn', 'lat', 'lon'])
    .where('is_hidden', '=', false).execute();
  const list = rows.map(r => ({ ...r, search: normalizeSearch(`${r.nameSk} ${r.nameEn}`) }));
  countryCache = { at: Date.now(), rows: list };
  return list;
}

export const gazetteerRoutes = new Hono().get('/search', async c => {
  // normalizeSearch leaves only a-z, 0-9 and spaces, so the LIKE patterns below hold no wildcards from the user
  const q = normalizeSearch(c.req.query('q') ?? '');
  const limit = Math.min(positiveInt(c.req.query('limit')) ?? 8, 20);
  if (q.length < 2) fail(400, 'query_too_short', 'Zadaj aspoň 2 znaky.');

  const countryList = await allCountries();
  const nameOf = new Map(countryList.map(x => [x.code, x.nameSk]));
  const matchedCountries = countryList
    .filter(x => x.lat !== null && x.search.split(' ').some(w => w.startsWith(q)))
    .slice(0, 3)
    .map((x): GazetteerHit => ({ kind: 'country', countryCode: x.code, name: x.nameSk, country: x.nameSk, lat: x.lat!, lon: x.lon! }));

  const db = await getDb();
  // primary name exact, any name exact, primary name prefix, any name prefix, any word prefix, anywhere
  const rank = sql<number>`case
    when g.search_text like ${`|${q}|%`} then 0
    when g.search_text like ${`%|${q}|%`} then 1
    when g.search_text like ${`|${q}%`} then 2
    when g.search_text like ${`%|${q}%`} then 3
    when g.search_text like ${`% ${q}%`} then 4
    else 5 end`;
  const cities = await db.selectFrom('gazetteer as g')
    .innerJoin('countries as c', join => join.onRef('c.code', '=', 'g.country_code').on('c.is_hidden', '=', false))
    .select(['g.geoname_id as geonameId', 'g.name', 'g.country_code as countryCode', 'g.admin1', 'g.lat', 'g.lon'])
    .where('g.search_text', 'like', `%${q}%`)
    .orderBy(rank).orderBy('g.population', 'desc')
    .top(limit)
    .execute();

  const hits: GazetteerHit[] = [
    ...matchedCountries,
    ...cities.map((r): GazetteerHit => ({ kind: 'city', geonameId: r.geonameId, countryCode: r.countryCode, name: r.name, country: nameOf.get(r.countryCode) ?? r.countryCode, admin1: r.admin1, lat: r.lat, lon: r.lon })),
  ];
  c.header('Cache-Control', CACHE.dictionary);
  return c.json({ query: q, hits });
});
