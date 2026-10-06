/**
 * npm run db:seed [-- --force | --if-needed]
 *  1. reference data: legend groups and categories (packages/shared)
 *  2. countries and the GeoNames gazetteer (downloaded once into data/cache/geonames)
 *  3. the cooperation dataset data/tuke_cooperation.json (skipped when this version is already current)
 *  4. the default event, so the guest form works right away
 * Safe to run again: every step upserts.
 * --if-needed (used by every Vercel build): does nothing when the gazetteer is loaded, the current dataset
 * version matches data/tuke_cooperation.json and the event exists. A new dataset in git is imported on deploy.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { CATEGORIES, CATEGORY_GROUPS, DEFAULT_EVENT, normalizeSearch } from '@ples/shared';
import { REPO_ROOT, closeDb, getDb, isDatabaseConfigured, loadEnv, resolveDriver } from '../client.ts';
import {
  categories, categoryGroups, coopPlaces, cooperationLinks, countries, datasetImports, events, gazetteer, institutions,
} from '../schema.ts';

loadEnv();
const force = process.argv.includes('--force');
const ifNeeded = process.argv.includes('--if-needed');
const log = (...a: unknown[]) => console.log('[db:seed]', ...a);
const chunks = <T>(rows: T[], size: number) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
if (!isDatabaseConfigured()) {
  log('DATABASE_URL is not set, skipping');
  process.exit(0);
}
const db = await getDb();
log('driver:', resolveDriver());

interface DatasetLink { category: string; tuke_units: string[]; detail: string; since?: string; source_url: string; confidence: 'high' | 'medium' | 'low'; [k: string]: unknown }
interface Dataset {
  generated: string;
  stats: Record<string, number | string>;
  cities: { id: string; city: string; country: string; country_code: string; lat: number; lon: number; distance_km: number }[];
  institutions: { id: string; name: string; city: string; country: string; country_code: string; lat: number; lon: number; city_id: string; links: DatasetLink[] }[];
}
const raw = readFileSync(`${REPO_ROOT}data/tuke_cooperation.json`);
const sha256 = createHash('sha256').update(raw).digest('hex');
const dataset = JSON.parse(raw.toString('utf8')) as Dataset;
const version = `${dataset.generated}+${sha256.slice(0, 8)}`;

if (ifNeeded && !force) {
  const [cities] = await db.select({ n: sql<number>`count(*)::int` }).from(gazetteer);
  const [current] = await db.select({ version: datasetImports.version }).from(datasetImports).where(eq(datasetImports.isCurrent, true));
  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.slug, DEFAULT_EVENT));
  if ((cities?.n ?? 0) > 0 && current?.version === version && event) {
    log('database is up to date (dataset', version + '), nothing to seed');
    await closeDb();
    process.exit(0);
  }
}

// ------------------------------------------------------------ 1. legend
await db.insert(categoryGroups)
  .values(CATEGORY_GROUPS.map((g, sort) => ({ code: g.code, label: g.label, color: g.color, sort })))
  .onConflictDoUpdate({ target: categoryGroups.code, set: { label: sql`excluded.label`, color: sql`excluded.color`, sort: sql`excluded.sort` } });
await db.insert(categories)
  .values(CATEGORIES.map((c, sort) => ({ code: c.code, groupCode: c.group, label: c.label, sort })))
  .onConflictDoUpdate({ target: categories.code, set: { groupCode: sql`excluded.group_code`, label: sql`excluded.label`, sort: sql`excluded.sort` } });
log('categories:', CATEGORIES.length);

// ------------------------------------------------------------ 2. countries + gazetteer
const GEO_DIR = `${REPO_ROOT}data/cache/geonames/`;
async function download(name: string): Promise<Buffer> {
  const file = GEO_DIR + name;
  if (!existsSync(file)) {
    mkdirSync(GEO_DIR, { recursive: true });
    log('downloading', name, 'from download.geonames.org');
    const res = await fetch(`https://download.geonames.org/export/dump/${name}`);
    if (!res.ok) throw new Error(`GeoNames ${name}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(file);
}

/** Reads the single file of a zip archive (GeoNames ships one .txt per zip). */
function unzipFirst(zip: Buffer): string {
  if (zip.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip file');
  const method = zip.readUInt16LE(8);
  let size = zip.readUInt32LE(18);
  const nameLen = zip.readUInt16LE(26);
  const extraLen = zip.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  if (size === 0) {
    // sizes stored in the central directory (data descriptor flag): read them from there
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const cd = zip.readUInt32LE(eocd + 16);
    size = zip.readUInt32LE(cd + 20);
  }
  const data = zip.subarray(start, start + size);
  return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
}

const skNames = new Intl.DisplayNames(['sk'], { type: 'region' });
const enNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryInfo = (await download('countryInfo.txt')).toString('utf8')
  .split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t'))
  .map(f => ({ code: f[0]!, name: f[4]!, capital: f[5] ?? '', continent: f[8] || null }))
  .filter(c => /^[A-Z]{2}$/.test(c.code));
const regionName = (names: Intl.DisplayNames, code: string, fallback: string) => {
  try { const n = names.of(code); return n && n !== code ? n : fallback; } catch { return fallback; }
};
for (const part of chunks(countryInfo, 500)) {
  await db.insert(countries)
    .values(part.map(c => ({ code: c.code, nameSk: regionName(skNames, c.code, c.name), nameEn: regionName(enNames, c.code, c.name), continent: c.continent })))
    .onConflictDoUpdate({ target: countries.code, set: { nameSk: sql`excluded.name_sk`, nameEn: sql`excluded.name_en`, continent: sql`excluded.continent` } });
}
const known = new Set(countryInfo.map(c => c.code));
log('countries:', countryInfo.length);

const LATIN = /^[\p{Script=Latin}\p{M}0-9 .,'’()\-]+$/u;
const cities = unzipFirst(await download('cities15000.zip')).split('\n').filter(Boolean).map(l => l.split('\t'))
  .filter(f => known.has(f[8]!))
  .map(f => {
    const names = [f[1]!, f[2]!, ...(f[3] ? f[3].split(',') : [])].filter(n => n.length <= 60 && LATIN.test(n));
    // |primary name|other names|… – the separators let the search rank exact and primary-name matches first
    const search = `|${[...new Set(names.map(normalizeSearch).filter(Boolean))].join('|').slice(0, 1200)}|`;
    return {
      geonameId: Number(f[0]), name: f[1]!, asciiName: f[2]!, countryCode: f[8]!, admin1: f[10] || null,
      lat: Number(f[4]), lon: Number(f[5]), population: Number(f[14]) || 0, searchText: search,
    };
  });
for (const part of chunks(cities, 1000)) {
  await db.insert(gazetteer).values(part).onConflictDoUpdate({
    target: gazetteer.geonameId,
    set: {
      name: sql`excluded.name`, asciiName: sql`excluded.ascii_name`, countryCode: sql`excluded.country_code`, admin1: sql`excluded.admin1`,
      lat: sql`excluded.lat`, lon: sql`excluded.lon`, population: sql`excluded.population`, searchText: sql`excluded.search_text`,
    },
  });
}
log('gazetteer cities:', cities.length);

// a "whole country" light lands on the capital, or on the largest city when the capital is not in the list
const byCountry = new Map<string, typeof cities>();
for (const c of cities) (byCountry.get(c.countryCode) ?? byCountry.set(c.countryCode, []).get(c.countryCode)!).push(c);
let placedCountries = 0;
for (const info of countryInfo) {
  const list = (byCountry.get(info.code) ?? []).sort((a, b) => b.population - a.population);
  const capital = list.find(c => c.name === info.capital || c.asciiName === info.capital) ?? list[0];
  if (!capital) continue;
  await db.update(countries).set({ lat: capital.lat, lon: capital.lon }).where(eq(countries.code, info.code));
  placedCountries++;
}
log('countries with a landing point:', placedCountries);

// ------------------------------------------------------------ 3. cooperation dataset
const [existing] = await db.select().from(datasetImports).where(eq(datasetImports.version, version));

if (existing?.isCurrent && !force) {
  log('dataset', version, 'is already current');
} else {
  if (existing) await db.delete(datasetImports).where(eq(datasetImports.id, existing.id));
  // countries named by the dataset but missing in GeoNames (should not happen, kept for safety)
  const missing = [...new Map(dataset.cities.filter(c => !known.has(c.country_code)).map(c => [c.country_code, c.country])).entries()];
  if (missing.length) {
    await db.insert(countries).values(missing.map(([code, name]) => ({ code, nameSk: name, nameEn: name }))).onConflictDoNothing();
    log('added countries missing in GeoNames:', missing.map(m => m[0]).join(', '));
  }
  const [imp] = await db.insert(datasetImports).values({ version, sha256, stats: dataset.stats }).returning({ id: datasetImports.id });
  const importId = imp!.id;

  const placeIds = new Map<string, number>();
  for (const part of chunks(dataset.cities, 500)) {
    const rows = await db.insert(coopPlaces).values(part.map(c => ({
      importId, extId: c.id, name: c.city || c.country, countryCode: c.country_code, lat: c.lat, lon: c.lon, distanceKm: c.distance_km,
    }))).returning({ id: coopPlaces.id, extId: coopPlaces.extId });
    for (const r of rows) placeIds.set(r.extId, r.id);
  }

  const instIds = new Map<string, number>();
  for (const part of chunks(dataset.institutions.filter(i => placeIds.has(i.city_id)), 500)) {
    const rows = await db.insert(institutions).values(part.map(i => ({
      importId, extId: i.id, placeId: placeIds.get(i.city_id)!, name: i.name, city: i.city ?? '', countryCode: i.country_code, lat: i.lat, lon: i.lon,
    }))).returning({ id: institutions.id, extId: institutions.extId });
    for (const r of rows) instIds.set(r.extId, r.id);
  }

  const categoryCodes = new Set<string>(CATEGORIES.map(c => c.code));
  const links = dataset.institutions.flatMap(i => (instIds.has(i.id) ? i.links : []).map(l => {
    const { category, tuke_units, detail, since, source_url, confidence, ...metrics } = l;
    return {
      institutionId: instIds.get(i.id)!,
      categoryCode: categoryCodes.has(category) ? category : 'other',
      tukeUnits: tuke_units ?? [],
      detail: detail ?? '',
      since: since ? String(since) : null,
      sourceUrl: source_url,
      confidence,
      metrics,
    };
  }));
  for (const part of chunks(links, 500)) await db.insert(cooperationLinks).values(part);

  await db.update(datasetImports).set({ isCurrent: true }).where(eq(datasetImports.id, importId));
  await db.delete(datasetImports).where(ne(datasetImports.id, importId)); // older imports, cascades to their rows
  log(`dataset ${version}: ${placeIds.size} places, ${instIds.size} institutions, ${links.length} links`);
}

// ------------------------------------------------------------ 4. default event
await db.insert(events).values({ slug: DEFAULT_EVENT, name: 'Ples TUKE 2027', status: 'open' }).onConflictDoNothing();
const [ev] = await db.select({ status: events.status }).from(events).where(and(eq(events.slug, DEFAULT_EVENT), inArray(events.status, ['draft', 'open', 'live', 'closed'])));
log('event', DEFAULT_EVENT, ev?.status);

await closeDb();
