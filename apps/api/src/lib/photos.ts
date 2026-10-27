/**
 * Guests' photos as the wall and the admin see them: the metadata only, never the JPEG bytes (those come one by one
 * from GET /events/:slug/photos/:id). Used by the live feed (events.ts), the photo routes and the admin console.
 */
import { LIMITS, ORIGIN, VENUES, type AdminPhoto, type PhotoFeed, type VenueKey, type WallPhoto } from '@ples/shared';
import type { Db, EventRow } from '@ples/db';

/** Every column of a photo except the bytes, with the country's name. */
export const photoMeta = (d: Db) => d.selectFrom('photos as f')
  .leftJoin('countries as c', 'c.code', 'f.country_code')
  .select([
    'f.id', 'f.kind', 'f.place_name', 'f.country_code', 'c.name_sk as country', 'f.lat', 'f.lon', 'f.visit_kind',
    'f.status', 'f.width', 'f.height', 'f.created_at', 'f.reviewed_at',
  ]);
type MetaRow = Awaited<ReturnType<ReturnType<typeof photoMeta>['executeTakeFirstOrThrow']>>;

/** A ball photo sits at Košice and is named after the venue; a place photo keeps the place of its light. */
function base(r: MetaRow, venue: VenueKey): Omit<WallPhoto, 'approvedAt'> {
  const ball = r.kind === 'ball';
  return {
    id: r.id.toLowerCase(), // SQL Server returns GUIDs in upper case
    kind: r.kind,
    name: ball ? VENUES[venue].name : r.place_name ?? '',
    countryCode: ball ? ORIGIN.countryCode : r.country_code ?? '',
    country: ball ? '' : r.country ?? '',
    lat: ball ? ORIGIN.lat : r.lat ?? ORIGIN.lat,
    lon: ball ? ORIGIN.lon : r.lon ?? ORIGIN.lon,
    visitKind: r.visit_kind,
    width: r.width,
    height: r.height,
    createdAt: r.created_at.toISOString(),
  };
}

export const toWallPhoto = (r: MetaRow, venue: VenueKey): WallPhoto => ({ ...base(r, venue), approvedAt: (r.reviewed_at ?? r.created_at).toISOString() });
export const toAdminPhoto = (r: MetaRow, venue: VenueKey): AdminPhoto => ({
  ...base(r, venue), status: r.status, approvedAt: r.status === 'approved' && r.reviewed_at ? r.reviewed_at.toISOString() : null,
});

const approved = (d: Db, ev: EventRow) => photoMeta(d).where('f.event_id', '=', ev.id).where('f.status', '=', 'approved');

/** Every photo on the wall, newest approval first (the wall's gallery). None while photos are switched off. */
export async function wallPhotos(d: Db, ev: EventRow, venue: VenueKey): Promise<WallPhoto[]> {
  if ((ev.photo_mode ?? 'off') === 'off') return [];
  const rows = await approved(d, ev).orderBy('f.reviewed_at', 'desc').orderBy('f.id').top(LIMITS.photosPerEvent).execute();
  return rows.map(r => toWallPhoto(r, venue));
}

/**
 * The part of the live feed about photos: the newest approvals and the count. A database without the photos table
 * (the API deployed before migration 0004) gives an empty feed instead of breaking the wall's lights.
 */
export async function photoFeed(d: Db, ev: EventRow, venue: VenueKey): Promise<PhotoFeed> {
  if ((ev.photo_mode ?? 'off') === 'off') return { latest: [], total: 0 };
  try {
    const rows = await approved(d, ev).orderBy('f.reviewed_at', 'desc').orderBy('f.id').top(LIMITS.photoWindow).execute();
    const count = await d.selectFrom('photos').select(eb => eb.fn.countAll<number>().as('n'))
      .where('event_id', '=', ev.id).where('status', '=', 'approved').executeTakeFirst();
    return { latest: rows.map(r => toWallPhoto(r, venue)), total: count?.n ?? 0 };
  } catch (err) {
    console.error(`[photos] ${venue}: feed unavailable:`, (err as Error).message);
    return { latest: [], total: 0 };
  }
}
