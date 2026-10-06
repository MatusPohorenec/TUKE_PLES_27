/** Reviewer comments from the prototype: POST /api/feedback */
import { Hono } from 'hono';
import { and, eq, gt, sql } from 'drizzle-orm';
import { FeedbackSchema } from '@ples/shared';
import { feedback, getDb, isDatabaseConfigured } from '@ples/db';
import { CACHE, fail, readJson } from '../lib/http.ts';
import { ipHash } from '../lib/security.ts';

export const feedbackRoutes = new Hono().post('/', async c => {
  if (!isDatabaseConfigured()) fail(503, 'database_missing', 'Pripomienky zatiaľ nie je kam uložiť (chýba databáza).');
  const input = await readJson(c, FeedbackSchema);
  const ip = ipHash(c);
  const db = await getDb();
  const [recent] = await db.select({ n: sql<number>`count(*)::int` }).from(feedback)
    .where(and(eq(feedback.ipHash, ip), gt(feedback.createdAt, new Date(Date.now() - 10 * 60_000))));
  if ((recent?.n ?? 0) >= 20) fail(429, 'too_many', 'Veľa pripomienok naraz. Skús to o chvíľu.');
  const [row] = await db.insert(feedback).values({ page: input.page, message: input.message, author: input.author || null, ipHash: ip })
    .returning({ id: feedback.id });
  c.header('Cache-Control', CACHE.none);
  return c.json({ id: row!.id }, 201);
});
