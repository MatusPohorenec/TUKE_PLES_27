/**
 * Operator console (session cookie after POST /api/admin/login).
 *   GET   /api/admin/me
 *   GET   /api/admin/events/:slug            PATCH: status, wall scene, access code
 *   GET   /api/admin/pins?limit=100          PATCH /api/admin/pins/:id   hide or show a light
 *   GET   /api/admin/feedback                PATCH /api/admin/feedback/:id
 */
import { Hono } from 'hono';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import {
  EventPatchSchema, FeedbackPatchSchema, LoginSchema, PinPatchSchema, type AdminFeedback, type AdminPin,
} from '@ples/shared';
import { adminAudit, events, feedback, getDb, isDatabaseConfigured, pins, submissions } from '@ples/db';
import { CACHE, fail, readJson } from '../lib/http.ts';
import {
  adminPasswordConfigured, checkAdminPassword, endSession, hasSession, ipHash, sha256, startSession,
} from '../lib/security.ts';
import { eventInfo } from './events.ts';

async function audit(action: string, target: string | null, payload: Record<string, unknown> | null, ip: string) {
  await (await getDb()).insert(adminAudit).values({ action, target, payload, ipHash: ip });
}

export const adminRoutes = new Hono()
  .use('*', async (c, next) => {
    c.header('Cache-Control', CACHE.none);
    if (!isDatabaseConfigured()) fail(503, 'database_missing', 'Administrácia potrebuje databázu.');
    if (!adminPasswordConfigured()) fail(503, 'not_configured', 'Administrácia nie je zapnutá (chýba ADMIN_PASSWORD).');
    if (c.req.path.endsWith('/admin/login')) return next();
    if (!hasSession(c)) fail(401, 'unauthorized', 'Prihlás sa.');
    return next();
  })

  .post('/login', async c => {
    const ip = ipHash(c);
    const db = await getDb();
    const [fails] = await db.select({ n: sql<number>`count(*)::int` }).from(adminAudit)
      .where(and(eq(adminAudit.action, 'login_fail'), eq(adminAudit.ipHash, ip), gt(adminAudit.createdAt, new Date(Date.now() - 15 * 60_000))));
    if ((fails?.n ?? 0) >= 10) fail(429, 'too_many', 'Priveľa pokusov. Skús to o 15 minút.');
    const { password } = await readJson(c, LoginSchema);
    if (!checkAdminPassword(password)) {
      await audit('login_fail', null, null, ip);
      fail(401, 'wrong_password', 'Nesprávne heslo.');
    }
    await audit('login_ok', null, null, ip);
    startSession(c);
    return c.json({ ok: true });
  })

  .post('/logout', c => { endSession(c); return c.json({ ok: true }); })

  .get('/me', c => c.json({ ok: true }))

  .get('/events/:slug', async c => {
    const [ev] = await (await getDb()).select().from(events).where(eq(events.slug, c.req.param('slug')));
    if (!ev) fail(404, 'event_not_found', 'Udalosť neexistuje.');
    return c.json(eventInfo(ev!));
  })

  .patch('/events/:slug', async c => {
    const input = await readJson(c, EventPatchSchema);
    const set: Partial<typeof events.$inferInsert> = { updatedAt: new Date() };
    if (input.status) set.status = input.status;
    if (input.displayScene) set.displayScene = input.displayScene;
    if (input.code !== undefined) set.codeHash = input.code ? sha256(input.code.toUpperCase()) : null;
    const [ev] = await (await getDb()).update(events).set(set).where(eq(events.slug, c.req.param('slug'))).returning();
    if (!ev) fail(404, 'event_not_found', 'Udalosť neexistuje.');
    await audit('event_update', ev!.slug, { ...input, code: input.code === undefined ? undefined : input.code ? 'set' : 'removed' }, ipHash(c));
    return c.json(eventInfo(ev!));
  })

  .get('/pins', async c => {
    const limit = Math.min(Number(c.req.query('limit')) || 100, 500);
    const rows = await (await getDb()).select({ pin: pins, role: submissions.personRole, faculty: submissions.faculty })
      .from(pins).innerJoin(submissions, eq(submissions.id, pins.submissionId))
      .orderBy(desc(pins.id)).limit(limit);
    const list: AdminPin[] = rows.map(({ pin, role, faculty }) => ({
      id: pin.id, name: pin.placeName, countryCode: pin.countryCode, lat: pin.lat, lon: pin.lon, visitKind: pin.visitKind,
      createdAt: pin.createdAt.toISOString(), status: pin.status, role, faculty,
    }));
    return c.json({ pins: list });
  })

  .patch('/pins/:id', async c => {
    const { status } = await readJson(c, PinPatchSchema);
    const id = Number(c.req.param('id'));
    const [row] = await (await getDb()).update(pins).set({ status }).where(eq(pins.id, id)).returning({ id: pins.id });
    if (!row) fail(404, 'not_found', 'Svetlo neexistuje.');
    await audit('pin_status', String(id), { status }, ipHash(c));
    return c.json({ ok: true });
  })

  .get('/feedback', async c => {
    const rows = await (await getDb()).select().from(feedback).orderBy(desc(feedback.id)).limit(500);
    const list: AdminFeedback[] = rows.map(r => ({ id: r.id, page: r.page, message: r.message, author: r.author, status: r.status, createdAt: r.createdAt.toISOString() }));
    return c.json({ feedback: list });
  })

  .patch('/feedback/:id', async c => {
    const { status } = await readJson(c, FeedbackPatchSchema);
    const id = Number(c.req.param('id'));
    const [row] = await (await getDb()).update(feedback).set({ status }).where(eq(feedback.id, id)).returning({ id: feedback.id });
    if (!row) fail(404, 'not_found', 'Pripomienka neexistuje.');
    await audit('feedback_status', String(id), { status }, ipHash(c));
    return c.json({ ok: true });
  });
