/** Place search for the guest form: GET /api/gazetteer/search?q=vied */
import { Hono } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import { normalizeSearch, type GazetteerHit } from '@ples/shared';
import { countries, gazetteer, getDb } from '@ples/db';
import { CACHE, fail } from '../lib/http.ts';

type Country = { code: string; nameSk: string; nameEn: string; lat: number | null; lon: number | null; search: string };
let countryCache: { at: number; rows: Country[] } | undefined;

async function allCountries(): Promise<Country[]> {
  if (countryCache && Date.now() - countryCache.at < 600_000) return countryCache.rows;
  const db = await getDb();
  const rows = await db.select({ code: countries.code, nameSk: countries.nameSk, nameEn: countries.nameEn, lat: countries.lat, lon: countries.lon })
    .from(countries).where(eq(countries.isHidden, false));
  const list = rows.map(r => ({ ...r, search: normalizeSearch(`${r.nameSk} ${r.nameEn}`) }));
  countryCache = { at: Date.now(), rows: list };
  return list;
}

export const gazetteerRoutes = new Hono().get('/search', async c => {
  const q = normalizeSearch(c.req.query('q') ?? '');
  const limit = Math.min(Number(c.req.query('limit')) || 8, 20);
  if (q.length < 2) fail(400, 'query_too_short', 'Zadaj aspoň 2 znaky.');

  const countryList = await allCountries();
  const nameOf = new Map(countryList.map(x => [x.code, x.nameSk]));
  const matchedCountries = countryList
    .filter(x => x.lat !== null && x.search.split(' ').some(w => w.startsWith(q)))
    .slice(0, 3)
    .map((x): GazetteerHit => ({ kind: 'country', countryCode: x.code, name: x.nameSk, country: x.nameSk, lat: x.lat!, lon: x.lon! }));

  const db = await getDb();
  const t = gazetteer.searchText;
  // primary name exact, any name exact, primary name prefix, any name prefix, any word prefix, anywhere
  const rank = sql`case
    when ${t} like ${`|${q}|%`} then 0
    when ${t} like ${`%|${q}|%`} then 1
    when ${t} like ${`|${q}%`} then 2
    when ${t} like ${`%|${q}%`} then 3
    when ${t} like ${`% ${q}%`} then 4
    else 5 end`;
  const cities = await db.select({
    geonameId: gazetteer.geonameId, name: gazetteer.name, countryCode: gazetteer.countryCode,
    admin1: gazetteer.admin1, lat: gazetteer.lat, lon: gazetteer.lon,
  })
    .from(gazetteer)
    .innerJoin(countries, and(eq(countries.code, gazetteer.countryCode), eq(countries.isHidden, false)))
    .where(sql`${gazetteer.searchText} like ${`%${q}%`}`)
    .orderBy(rank, desc(gazetteer.population))
    .limit(limit);

  const hits: GazetteerHit[] = [
    ...matchedCountries,
    ...cities.map((r): GazetteerHit => ({ kind: 'city', geonameId: r.geonameId, countryCode: r.countryCode, name: r.name, country: nameOf.get(r.countryCode) ?? r.countryCode, admin1: r.admin1, lat: r.lat, lon: r.lon })),
  ];
  c.header('Cache-Control', CACHE.dictionary);
  return c.json({ query: q, hits });
});
