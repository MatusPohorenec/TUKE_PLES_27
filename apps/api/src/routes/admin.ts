/**
 * Operator console of a venue (session cookie after POST /api/admin/login). /api/admin/… manages the ball's
 * database, /api/vestibul/admin/… the student lobby's. One login (ADMIN_PASSWORD) opens both consoles.
 *   GET   /api/admin/me
 *   GET   /api/admin/events/:slug            PATCH: status, wall scene, access code
 *   GET   /api/admin/pins?limit=100          PATCH /api/admin/pins/:id   hide or show a light
 *   GET   /api/admin/feedback                PATCH /api/admin/feedback/:id
 *   GET   /api/admin/attendees               DELETE /api/admin/attendees/:id   confirmed attendance (personal data)
 */
import { Hono, type Context } from 'hono';
import {
  EventPatchSchema, FeedbackPatchSchema, LoginSchema, PinPatchSchema, type AdminAttendee, type AdminFeedback, type AdminPin,
} from '@ples/shared';
import { getDb, isDatabaseConfigured, sql, toJson } from '@ples/db';
import { CACHE, fail, positiveInt, readJson } from '../lib/http.ts';
import {
  adminPasswordConfigured, checkAdminPassword, endSession, hasSession, ipHash, sha256, startSession,
} from '../lib/security.ts';
import { venueOf } from '../lib/venue.ts';
import { eventInfo } from './events.ts';

/** The database of the venue the request belongs to. */
const dbOf = (c: Context) => getDb(venueOf(c));

async function audit(c: Context, action: string, target: string | null, payload: Record<string, unknown> | null) {
  await (await dbOf(c)).insertInto('admin_audit').values({ action, target, payload: payload ? toJson(payload) : null, ip_hash: ipHash(c) }).execute();
}

const idParam = (value: string) => positiveInt(value) ?? fail(400, 'invalid_id', 'Neplatné ID.');

export const adminRoutes = new Hono()
  .use('*', async (c, next) => {
    c.header('Cache-Control', CACHE.none);
    if (!isDatabaseConfigured(venueOf(c))) fail(503, 'database_missing', 'Administrácia potrebuje databázu.');
    if (!adminPasswordConfigured()) fail(503, 'not_configured', 'Administrácia nie je zapnutá (chýba ADMIN_PASSWORD).');
    if (c.req.path.endsWith('/admin/login')) return next();
    if (!hasSession(c)) fail(401, 'unauthorized', 'Prihlás sa.');
    return next();
  })

  .post('/login', async c => {
    const ip = ipHash(c);
    const db = await dbOf(c);
    const fails = await db.selectFrom('admin_audit').select(eb => eb.fn.countAll<number>().as('n'))
      .where('action', '=', 'login_fail').where('ip_hash', '=', ip).where('created_at', '>', new Date(Date.now() - 15 * 60_000))
      .executeTakeFirst();
    if ((fails?.n ?? 0) >= 10) fail(429, 'too_many', 'Priveľa pokusov. Skús to o 15 minút.');
    const { password } = await readJson(c, LoginSchema);
    if (!checkAdminPassword(password)) {
      await audit(c, 'login_fail', null, null);
      fail(401, 'wrong_password', 'Nesprávne heslo.');
    }
    await audit(c, 'login_ok', null, null);
    startSession(c);
    return c.json({ ok: true });
  })

  .post('/logout', c => { endSession(c); return c.json({ ok: true }); })

  .get('/me', c => c.json({ ok: true }))

  .get('/events/:slug', async c => {
    const ev = await (await dbOf(c)).selectFrom('events').selectAll().where('slug', '=', c.req.param('slug')).executeTakeFirst();
    if (!ev) fail(404, 'event_not_found', 'Udalosť neexistuje.');
    return c.json(eventInfo(ev!));
  })

  .patch('/events/:slug', async c => {
    const input = await readJson(c, EventPatchSchema);
    const ev = await (await dbOf(c)).updateTable('events')
      .set({
        updated_at: sql<Date>`sysutcdatetime()`,
        ...(input.status ? { status: input.status } : {}),
        ...(input.displayScene ? { display_scene: input.displayScene } : {}),
        ...(input.code !== undefined ? { code_hash: input.code ? sha256(input.code.toUpperCase()) : null } : {}),
      })
      .where('slug', '=', c.req.param('slug'))
      .outputAll('inserted')
      .executeTakeFirst();
    if (!ev) fail(404, 'event_not_found', 'Udalosť neexistuje.');
    await audit(c, 'event_update', ev!.slug, { ...input, code: input.code === undefined ? undefined : input.code ? 'set' : 'removed' });
    return c.json(eventInfo(ev!));
  })

  .get('/pins', async c => {
    const limit = Math.min(positiveInt(c.req.query('limit')) ?? 100, 500);
    const rows = await (await dbOf(c)).selectFrom('pins as p')
      .innerJoin('submissions as s', 's.id', 'p.submission_id')
      .selectAll('p').select(['s.person_role as role', 's.faculty'])
      .orderBy('p.id', 'desc').top(limit)
      .execute();
    const list: AdminPin[] = rows.map(pin => ({
      id: pin.id, name: pin.place_name, countryCode: pin.country_code, lat: pin.lat, lon: pin.lon, visitKind: pin.visit_kind,
      createdAt: pin.created_at.toISOString(), status: pin.status, role: pin.role, faculty: pin.faculty,
    }));
    return c.json({ pins: list });
  })

  .patch('/pins/:id', async c => {
    const { status } = await readJson(c, PinPatchSchema);
    const id = idParam(c.req.param('id'));
    const row = await (await dbOf(c)).updateTable('pins').set({ status }).where('id', '=', id).output('inserted.id').executeTakeFirst();
    if (!row) fail(404, 'not_found', 'Svetlo neexistuje.');
    await audit(c, 'pin_status', String(id), { status });
    return c.json({ ok: true });
  })

  .get('/attendees', async c => {
    const rows = await (await dbOf(c)).selectFrom('attendees').select(['id', 'full_name', 'affiliation', 'created_at'])
      .orderBy('id', 'desc').top(5000).execute();
    const list: AdminAttendee[] = rows.map(r => ({ id: r.id, name: r.full_name, affiliation: r.affiliation, createdAt: r.created_at.toISOString() }));
    return c.json({ attendees: list });
  })

  .delete('/attendees/:id', async c => {
    const id = idParam(c.req.param('id'));
    const row = await (await dbOf(c)).deleteFrom('attendees').where('id', '=', id).output('deleted.id').executeTakeFirst();
    if (!row) fail(404, 'not_found', 'Záznam neexistuje.');
    await audit(c, 'attendee_delete', String(id), null); // the name stays out of the audit log
    return c.json({ ok: true });
  })

  .get('/feedback', async c => {
    const rows = await (await dbOf(c)).selectFrom('feedback').selectAll().orderBy('id', 'desc').top(500).execute();
    const list: AdminFeedback[] = rows.map(r => ({ id: r.id, page: r.page, message: r.message, author: r.author, status: r.status, createdAt: r.created_at.toISOString() }));
    return c.json({ feedback: list });
  })

  .patch('/feedback/:id', async c => {
    const { status } = await readJson(c, FeedbackPatchSchema);
    const id = idParam(c.req.param('id'));
    const row = await (await dbOf(c)).updateTable('feedback').set({ status }).where('id', '=', id).output('inserted.id').executeTakeFirst();
    if (!row) fail(404, 'not_found', 'Pripomienka neexistuje.');
    await audit(c, 'feedback_status', String(id), { status });
    return c.json({ ok: true });
  });
