/**
 * Guests' photos of a venue (/api/… the ball, /api/vestibul/… the student lobby, each in its own database):
 *   POST   /api/events/:slug/photos             a guest sends a photo (multipart: meta JSON, photo + thumb JPEG)
 *   DELETE /api/events/:slug/photos/:id         the guest takes it back (same browser, LIMITS.undoMinutes)
 *   GET    /api/events/:slug/photos             every photo on the wall (the wall's gallery, shared for 2 s)
 *   GET    /api/events/:slug/photos/:id         the JPEG (?size=thumb: the small one); others than approved
 *                                               photos only for a logged-in admin
 * A place photo belongs to one of the guest's own lights (the API checks the browser that sent it); a ball photo
 * sits at Košice. events.photo_mode decides whether a photo waits for an admin (review) or goes on the wall at once
 * (auto); off: none are sent and the wall shows none. Photos are accepted like lights: the ball night, before it
 * only from an admin.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LIMITS, PhotoUploadSchema, type PhotoUpload, type PhotoUploadResponse, type WallPhoto } from '@ples/shared';
import { sql } from '@ples/db';
import { cleanJpeg, type Jpeg } from '../lib/jpeg.ts';
import { CACHE, fail, shared } from '../lib/http.ts';
import { wallPhotos } from '../lib/photos.ts';
import { clientIp, deviceHash, hasSession, ipHash } from '../lib/security.ts';
import { venueOf } from '../lib/venue.ts';
import { SCAN_HINT, UUID, acceptsGuests, codeAccepted, db, loadEvent } from './events.ts';

const gallery = shared<{ photos: WallPhoto[] }>(2_000);

/** The photo, its small copy and the form fields together; anything bigger is refused before it is read. */
const uploadLimit = bodyLimit({
  maxSize: LIMITS.photoBytes + LIMITS.photoThumbBytes + 32_000,
  onError: () => fail(413, 'too_large', 'Fotka je príliš veľká.'),
});

function readMeta(form: FormData): PhotoUpload {
  const raw = form.get('meta');
  let json: unknown = null;
  try { json = typeof raw === 'string' ? JSON.parse(raw) : null; } catch { /* refused below */ }
  const parsed = PhotoUploadSchema.safeParse(json);
  if (!parsed.success) fail(400, 'invalid_input', 'Neplatné údaje k fotke.');
  return parsed.data as PhotoUpload;
}

/** A JPEG file field, checked and without metadata. */
async function readJpeg(form: FormData, name: string, maxBytes: number, maxSide: number): Promise<Jpeg> {
  const value = form.get(name);
  if (!value || typeof value === 'string') fail(400, 'photo_missing', 'Chýba fotka.');
  const file = value as Blob; // File on Node 20+, undici's own File on Node 18 (no global File there)
  if (file.size > maxBytes) fail(413, 'too_large', 'Fotka je príliš veľká.');
  const jpeg = cleanJpeg(Buffer.from(await file.arrayBuffer()));
  if (!jpeg || jpeg.width > maxSide || jpeg.height > maxSide) fail(400, 'invalid_photo', 'Fotku sa nepodarilo spracovať. Skús inú.');
  return jpeg!;
}

export const photoRoutes = new Hono()
  .post('/:slug/photos', uploadLimit, async c => {
    const venue = venueOf(c);
    const ev = await loadEvent(venue, c.req.param('slug'));
    if (!acceptsGuests(ev, hasSession(c))) fail(409, 'event_closed', 'Posielanie fotiek je momentálne zatvorené.');
    if ((ev.photo_mode ?? 'off') === 'off') fail(409, 'photos_off', 'Posielanie fotiek je vypnuté.');
    const form = await c.req.formData().catch(() => fail(400, 'invalid_form', 'Fotka neprišla celá. Skús to znova.'));
    const meta = readMeta(form);
    if (!codeAccepted(ev, meta.code)) fail(403, 'code_invalid', SCAN_HINT[venue]);
    const device = deviceHash(c);
    const ip = ipHash(c);
    const d = await db(venue);

    // rate limits like the lights (the venue Wi-Fi shares one address, so that limit is loose), and a cap per event
    const since = new Date(Date.now() - 10 * 60_000);
    const count = () => d.selectFrom('photos').select(eb => eb.fn.countAll<number>().as('n')).where('event_id', '=', ev.id);
    const byDevice = await count().where('device_hash', '=', device).where('created_at', '>', since).executeTakeFirst();
    if ((byDevice?.n ?? 0) >= LIMITS.photosPerDevice10min) fail(429, 'too_many', 'Veľa fotiek naraz. Skús to o pár minút.');
    if (clientIp(c)) {
      const byIp = await count().where('ip_hash', '=', ip).where('created_at', '>', since).executeTakeFirst();
      if ((byIp?.n ?? 0) >= LIMITS.photosPerIp10min) fail(429, 'too_many', 'Veľa fotiek naraz. Skús to o pár minút.');
    }
    const all = await count().executeTakeFirst();
    if ((all?.n ?? 0) >= LIMITS.photosPerEvent) fail(409, 'photos_full', 'Fotiek je už priveľa, ďalšie stena neprijme.');

    const image = await readJpeg(form, 'photo', LIMITS.photoBytes, LIMITS.photoMaxSide);
    const thumb = await readJpeg(form, 'thumb', LIMITS.photoThumbBytes, LIMITS.photoThumbSide * 2);

    // a place photo: one of this browser's own lights, its place copied on the server
    const pin = meta.kind === 'place'
      ? await d.selectFrom('pins as p').innerJoin('submissions as s', 's.id', 'p.submission_id')
        .select(['p.id', 'p.place_name', 'p.country_code', 'p.lat', 'p.lon', 'p.visit_kind'])
        .where('p.id', '=', meta.pinId).where('p.event_id', '=', ev.id).where('s.device_hash', '=', device)
        .executeTakeFirst()
      : null;
    if (meta.kind === 'place' && !pin) fail(404, 'pin_not_found', 'Toto svetlo nepoznáme. Rozsvieť miesto znova a pridaj k nemu fotku.');

    const status = ev.photo_mode === 'auto' ? 'approved' : 'pending';
    const row = await d.insertInto('photos').values({
      event_id: ev.id, kind: meta.kind, pin_id: pin?.id ?? null, place_name: pin?.place_name ?? null, country_code: pin?.country_code ?? null,
      lat: pin?.lat ?? null, lon: pin?.lon ?? null, visit_kind: pin?.visit_kind ?? null, status,
      width: image.width, height: image.height, image: image.data, thumb: thumb.data, device_hash: device, ip_hash: ip,
      reviewed_at: status === 'approved' ? sql<Date>`sysutcdatetime()` : null,
    }).output(['inserted.id', 'inserted.created_at']).executeTakeFirstOrThrow();

    c.header('Cache-Control', CACHE.none);
    return c.json({
      id: row.id.toLowerCase(), status, undoUntil: new Date(row.created_at.getTime() + LIMITS.undoMinutes * 60_000).toISOString(),
    } satisfies PhotoUploadResponse, 201);
  })

  .delete('/:slug/photos/:id', async c => {
    const venue = venueOf(c);
    const ev = await loadEvent(venue, c.req.param('slug'));
    const id = c.req.param('id');
    if (!UUID.test(id)) fail(400, 'invalid_id', 'Neplatné ID.');
    const deleted = await (await db(venue)).deleteFrom('photos')
      .where('id', '=', id).where('event_id', '=', ev.id).where('device_hash', '=', deviceHash(c))
      .where('created_at', '>', new Date(Date.now() - LIMITS.undoMinutes * 60_000))
      .output('deleted.id')
      .execute();
    if (!deleted.length) fail(404, 'not_found', 'Fotka sa už nedá zmazať.');
    return c.json({ ok: true });
  })

  .get('/:slug/photos', async c => {
    const venue = venueOf(c);
    const slug = c.req.param('slug');
    const body = await gallery(`${venue}/${slug}`, async () => {
      const ev = await loadEvent(venue, slug);
      return { photos: await wallPhotos(await db(venue), ev, venue) };
    });
    c.header('Cache-Control', CACHE.live);
    return c.json(body);
  })

  .get('/:slug/photos/:id', async c => {
    const venue = venueOf(c);
    const ev = await loadEvent(venue, c.req.param('slug'));
    const id = c.req.param('id');
    if (!UUID.test(id)) fail(400, 'invalid_id', 'Neplatné ID.');
    const thumb = c.req.query('size') === 'thumb';
    const row = await (await db(venue)).selectFrom('photos')
      .select(eb => ['status', (thumb ? eb.ref('thumb') : eb.ref('image')).as('data')])
      .where('id', '=', id).where('event_id', '=', ev.id)
      .executeTakeFirst();
    // the wall shows approved photos to everybody; the rest only the admin sees (moderation)
    const open = row?.status === 'approved' && ev.photo_mode !== 'off';
    if (!row || (!open && !hasSession(c))) fail(404, 'not_found', 'Fotka neexistuje.');
    // a photo never changes under its id (only its status does): browsers keep it
    return c.body(new Uint8Array(row!.data), 200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': open ? 'public, max-age=604800, immutable' : 'private, no-store',
      'Content-Disposition': 'inline',
    });
  });
