/**
 * The cooperation dataset bundled with the API (data/tuke_cooperation.json). Serves the globe when the
 * database is not connected yet or does not answer, so the wall never goes dark because of the database.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, CATEGORY_GROUPS, type GlobePlace, type GlobeResponse, type GroupCode, type PlaceDetail } from '@ples/shared';

interface DatasetLink { category: string; tuke_units: string[]; detail: string; since?: string; source_url: string }
interface Dataset {
  generated: string;
  cities: { id: string; city: string; country: string; country_code: string; lat: number; lon: number; distance_km: number; institutions: string[]; categories: string[]; links: number }[];
  institutions: { id: string; name: string; city_id: string; links: DatasetLink[] }[];
}

const CANDIDATES = [
  new URL('./tuke_cooperation.json', import.meta.url), // next to the bundled function on Vercel
  new URL('../../../data/tuke_cooperation.json', import.meta.url), // running from source
];

let cached: Dataset | undefined;
function dataset(): Dataset {
  if (cached) return cached;
  const file = CANDIDATES.map(u => fileURLToPath(u)).find(existsSync);
  if (!file) throw new Error('tuke_cooperation.json not found next to the API');
  cached = JSON.parse(readFileSync(file, 'utf8')) as Dataset;
  return cached;
}

const groupOf = new Map<string, GroupCode>(CATEGORIES.map(c => [c.code, c.group]));
const groupRank = new Map<GroupCode, number>(CATEGORY_GROUPS.map((g, i) => [g.code, i]));
const skName = new Intl.DisplayNames(['sk'], { type: 'region' });
const countryName = (code: string, fallback: string) => { try { return skName.of(code) ?? fallback; } catch { return fallback; } };

export const sortGroups = (groups: Iterable<string>): GroupCode[] =>
  [...new Set([...groups].map(g => (groupRank.has(g as GroupCode) ? (g as GroupCode) : 'other')))].sort((a, b) => groupRank.get(a)! - groupRank.get(b)!);

export function snapshotGlobe(): GlobeResponse {
  const d = dataset();
  const since = new Map<string, number>(); // earliest dated cooperation per place
  for (const i of d.institutions) {
    for (const l of i.links) {
      const year = /^\d{4}/.test(l.since ?? '') ? Number(l.since!.slice(0, 4)) : NaN;
      if (year && !(since.get(i.city_id)! <= year)) since.set(i.city_id, year);
    }
  }
  const places: GlobePlace[] = d.cities.map(c => ({
    id: c.id,
    name: c.city || c.country,
    countryCode: c.country_code,
    country: countryName(c.country_code, c.country),
    lat: c.lat,
    lon: c.lon,
    distanceKm: c.distance_km,
    groups: sortGroups(c.categories.map(cat => groupOf.get(cat) ?? 'other')),
    institutions: c.institutions.length,
    links: c.links,
    since: since.get(c.id) ?? null,
  }));
  return {
    version: `${d.generated}+snapshot`,
    generated: d.generated,
    source: 'snapshot',
    stats: {
      institutions: places.reduce((s, p) => s + p.institutions, 0),
      places: places.length,
      countries: new Set(places.map(p => p.countryCode)).size,
      links: places.reduce((s, p) => s + p.links, 0),
    },
    places: places.sort((a, b) => a.distanceKm - b.distanceKm),
  };
}

export function snapshotPlace(id: string): PlaceDetail | null {
  const d = dataset();
  const city = d.cities.find(c => c.id === id);
  if (!city) return null;
  const label = new Map<string, string>(CATEGORIES.map(c => [c.code, c.label]));
  return {
    id,
    name: city.city || city.country,
    country: countryName(city.country_code, city.country),
    distanceKm: city.distance_km,
    institutions: d.institutions.filter(i => i.city_id === id).map(i => ({
      name: i.name,
      links: i.links.map(l => ({ category: label.get(l.category) ?? l.category, detail: l.detail, tukeUnits: l.tuke_units, sourceUrl: l.source_url, since: l.since ?? null })),
    })),
  };
}
