/**
 * npm run db:seed [-- --force | --if-needed] [--env .env.tuke] [--venue vestibul]
 *  1. reference data: legend groups and categories (packages/shared)
 *  2. countries and the GeoNames gazetteer (downloaded once into data/cache/geonames)
 *  3. the cooperation dataset data/tuke_cooperation.json (skipped when this version is already current)
 *  4. the venue's event (VENUES in packages/shared), so the guest form works right away
 * Safe to run again: every step upserts (MERGE).
 * --if-needed: does nothing when the gazetteer is loaded, the current dataset version matches
 * data/tuke_cooperation.json and the event exists. Run it after a deploy that changes the dataset.
 * --env <file>: the database to seed, e.g. .env.tuke (default: the repository .env, local SQL Server).
 * --venue vestibul: the student lobby's database (MSSQL_VESTIBUL_*) instead of the ball's (MSSQL_*).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { sql } from 'kysely';
import { CATEGORIES, CATEGORY_GROUPS, VENUES, normalizeSearch } from '@ples/shared';
import { REPO_ROOT, closeDb, dbSwitch, describeDatabase, getDb, isDatabaseConfigured, loadEnv, venueArg, type Db } from '../client.ts';
import { toJson, type Database } from '../schema.ts';

const envFile = loadEnv();
const venue = VENUES[venueArg()];
const force = process.argv.includes('--force');
const ifNeeded = process.argv.includes('--if-needed');
const log = (...a: unknown[]) => console.log('[db:seed]', ...a);
if (!isDatabaseConfigured(venue.key)) {
  console.error(`[db:seed] ${dbSwitch(venue.key)} is not set (copy .env.example to .env, or pass --env <file>)`);
  process.exit(1);
}
log(`${venue.name}: ${describeDatabase(venue.key)}${envFile ? ` (from ${envFile})` : ''}`);
const started = Date.now();

/** SQL Server takes at most 2 100 parameters per statement: rows go in chunks of fewer than 2 000 values. */
function chunks<T extends object>(rows: T[]): T[][] {
  const columns = rows[0] ? Object.keys(rows[0]).length : 1;
  const size = Math.max(1, Math.floor(2000 / columns));
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
}

/**
 * MERGE rows into a table, matched on the key columns: new rows are inserted, existing ones get the other
 * columns updated (or are left alone with update: false). Table and column names come from this file only.
 */
async function upsert<T extends keyof Database, R extends Partial<Record<keyof Database[T] & string, unknown>>>(
  db: Db, table: T, key: (keyof R & string)[], rows: R[], { update = true } = {},
): Promise<void> {
  for (const part of chunks(rows)) {
    const cols = Object.keys(part[0]!) as (keyof R & string)[];
    const other = cols.filter(c => !key.includes(c));
    const values = sql.join(part.map(r => sql`(${sql.join(cols.map(c => r[c]))})`));
    const s = (c: string) => sql.ref(`s.${c}`);
    const matched = update && other.length
      ? sql`when matched then update set ${sql.join(other.map(c => sql`${sql.ref(c)} = ${s(c)}`))}`
      : sql``;
    await sql`
      merge ${sql.raw(`dbo.${table}`)} with (holdlock) as t
      using (values ${values}) as s (${sql.join(cols.map(c => sql.ref(c)))})
      on ${sql.join(key.map(k => sql`${sql.ref(`t.${k}`)} = ${s(k)}`), sql` and `)}
      ${matched}
      when not matched then insert (${sql.join(cols.map(c => sql.ref(c)))}) values (${sql.join(cols.map(s))});`.execute(db);
  }
}

/** Removes dataset imports (all except keepId, or just one) with their places, institutions and links. */
async function deleteImports(db: Db, where: { keep: number } | { only: number }): Promise<void> {
  // SQL Server allows one cascade path only: institutions (-> links) first, then places, then the import
  const [op, id] = 'keep' in where ? ['<>', where.keep] as const : ['=', where.only] as const;
  await db.deleteFrom('institutions').where('import_id', op, id).execute();
  await db.deleteFrom('coop_places').where('import_id', op, id).execute();
  await db.deleteFrom('dataset_imports').where('id', op, id).execute();
}

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

// ------------------------------------------------------------ GeoNames files
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

async function seed(db: Db): Promise<void> {
  if (ifNeeded && !force) {
    const cities = await db.selectFrom('gazetteer').select(eb => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const current = await db.selectFrom('dataset_imports').select('version').where('is_current', '=', true).executeTakeFirst();
    const event = await db.selectFrom('events').select('id').where('slug', '=', venue.event).executeTakeFirst();
    if ((cities?.n ?? 0) > 0 && current?.version === version && event) {
      log('database is up to date (dataset', version + '), nothing to seed');
      return;
    }
  }

  // ------------------------------------------------------------ 1. legend
  await upsert(db, 'category_groups', ['code'], CATEGORY_GROUPS.map((g, sort) => ({ code: g.code, label: g.label, color: g.color, sort })));
  await upsert(db, 'categories', ['code'], CATEGORIES.map((c, sort) => ({ code: c.code, group_code: c.group, label: c.label, sort })));
  log('categories:', CATEGORIES.length);

  // ------------------------------------------------------------ 2. countries + gazetteer
  const skNames = new Intl.DisplayNames(['sk'], { type: 'region' });
  const enNames = new Intl.DisplayNames(['en'], { type: 'region' });
  const regionName = (names: Intl.DisplayNames, code: string, fallback: string) => {
    try { const n = names.of(code); return n && n !== code ? n : fallback; } catch { return fallback; }
  };
  const countryInfo = (await download('countryInfo.txt')).toString('utf8')
    .split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t'))
    .map(f => ({ code: f[0]!, name: f[4]!, capital: f[5] ?? '', continent: f[8] || null }))
    .filter(c => /^[A-Z]{2}$/.test(c.code));
  const known = new Set(countryInfo.map(c => c.code));

  const LATIN = /^[\p{Script=Latin}\p{M}0-9 .,'’()\-]+$/u;
  const cities = unzipFirst(await download('cities15000.zip')).split('\n').filter(Boolean).map(l => l.split('\t'))
    .filter(f => known.has(f[8]!))
    .map(f => {
      const names = [f[1]!, f[2]!, ...(f[3] ? f[3].split(',') : [])].filter(n => n.length <= 60 && LATIN.test(n));
      // |primary name|other names|… – the separators let the search rank exact and primary-name matches first
      const search = `|${[...new Set(names.map(normalizeSearch).filter(Boolean))].join('|').slice(0, 1200)}|`;
      return {
        geoname_id: Number(f[0]), name: f[1]!, ascii_name: f[2]!, country_code: f[8]!, admin1: f[10] || null,
        lat: Number(f[4]), lon: Number(f[5]), population: Number(f[14]) || 0, search_text: search,
      };
    });

  // a "whole country" light lands on the capital, or on the largest city when the capital is not in the list
  const byCountry = new Map<string, typeof cities>();
  for (const c of cities) (byCountry.get(c.country_code) ?? byCountry.set(c.country_code, []).get(c.country_code)!).push(c);
  const landing = (info: (typeof countryInfo)[number]) => {
    const list = (byCountry.get(info.code) ?? []).sort((a, b) => b.population - a.population);
    return list.find(c => c.name === info.capital || c.ascii_name === info.capital) ?? list[0];
  };
  const countryRows = countryInfo.map(c => {
    const capital = landing(c);
    return {
      code: c.code, name_sk: regionName(skNames, c.code, c.name), name_en: regionName(enNames, c.code, c.name), continent: c.continent,
      lat: capital?.lat ?? null, lon: capital?.lon ?? null,
    };
  });
  await upsert(db, 'countries', ['code'], countryRows);
  log('countries:', countryRows.length, '– with a landing point:', countryRows.filter(c => c.lat !== null).length);

  await upsert(db, 'gazetteer', ['geoname_id'], cities);
  log('gazetteer cities:', cities.length);

  // ------------------------------------------------------------ 3. cooperation dataset
  const existing = await db.selectFrom('dataset_imports').select(['id', 'is_current']).where('version', '=', version).executeTakeFirst();
  if (existing?.is_current && !force) {
    log('dataset', version, 'is already current');
  } else {
    if (existing) await deleteImports(db, { only: existing.id });
    // countries named by the dataset but missing in GeoNames (should not happen, kept for safety)
    const missing = [...new Map(dataset.cities.filter(c => !known.has(c.country_code)).map(c => [c.country_code, c.country])).entries()];
    if (missing.length) {
      await upsert(db, 'countries', ['code'], missing.map(([code, name]) => ({ code, name_sk: name, name_en: name })), { update: false });
      log('added countries missing in GeoNames:', missing.map(m => m[0]).join(', '));
    }
    const { id: importId } = await db.insertInto('dataset_imports').values({ version, sha256, stats: toJson(dataset.stats) })
      .output('inserted.id').executeTakeFirstOrThrow();

    const placeIds = new Map<string, number>();
    for (const part of chunks(dataset.cities.map(c => ({
      import_id: importId, ext_id: c.id, name: c.city || c.country, country_code: c.country_code, lat: c.lat, lon: c.lon, distance_km: c.distance_km,
    })))) {
      const rows = await db.insertInto('coop_places').values(part).output(['inserted.id', 'inserted.ext_id']).execute();
      for (const r of rows) placeIds.set(r.ext_id, r.id);
    }

    const instIds = new Map<string, number>();
    for (const part of chunks(dataset.institutions.filter(i => placeIds.has(i.city_id)).map(i => ({
      import_id: importId, ext_id: i.id, place_id: placeIds.get(i.city_id)!, name: i.name, city: i.city ?? '', country_code: i.country_code, lat: i.lat, lon: i.lon,
    })))) {
      const rows = await db.insertInto('institutions').values(part).output(['inserted.id', 'inserted.ext_id']).execute();
      for (const r of rows) instIds.set(r.ext_id, r.id);
    }

    const categoryCodes = new Set<string>(CATEGORIES.map(c => c.code));
    const links = dataset.institutions.flatMap(i => (instIds.has(i.id) ? i.links : []).map(l => {
      const { category, tuke_units, detail, since, source_url, confidence, ...metrics } = l;
      return {
        institution_id: instIds.get(i.id)!,
        category_code: categoryCodes.has(category) ? category : 'other',
        tuke_units: toJson(tuke_units ?? []),
        detail: detail ?? '',
        since: since ? String(since) : null,
        source_url,
        confidence,
        metrics: toJson(metrics),
      };
    }));
    for (const part of chunks(links)) await db.insertInto('cooperation_links').values(part).execute();

    // switch to the new version in one statement, then drop the older imports with their rows
    await db.updateTable('dataset_imports').set({ is_current: sql<boolean>`case when id = ${importId} then 1 else 0 end` }).execute();
    await deleteImports(db, { keep: importId });
    log(`dataset ${version}: ${placeIds.size} places, ${instIds.size} institutions, ${links.length} links`);
  }

  // ------------------------------------------------------------ 4. the venue's event
  await upsert(db, 'events', ['slug'], [{ slug: venue.event, name: venue.name, status: 'open' }], { update: false });
  const ev = await db.selectFrom('events').select('status').where('slug', '=', venue.event).executeTakeFirst();
  log('event', venue.event, ev?.status);
}

try {
  // one connection for the whole run: no pool round trips between the many statements
  await (await getDb(venue.key)).connection().execute(seed);
  log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
} finally {
  await closeDb();
}
