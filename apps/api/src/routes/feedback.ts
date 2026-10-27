/** Reviewer comments from the prototype: POST /api/feedback (stored in the venue's database) */
import { Hono } from 'hono';
import { FeedbackSchema } from '@ples/shared';
import { getDb, isDatabaseConfigured } from '@ples/db';
import { CACHE, fail, readJson } from '../lib/http.ts';
import { ipHash } from '../lib/security.ts';
import { venueOf } from '../lib/venue.ts';

export const feedbackRoutes = new Hono().post('/', async c => {
  const venue = venueOf(c);
  if (!isDatabaseConfigured(venue)) fail(503, 'database_missing', 'Pripomienky zatiaľ nie je kam uložiť (chýba databáza).');
  const input = await readJson(c, FeedbackSchema);
  const ip = ipHash(c);
  const db = await getDb(venue);
  const recent = await db.selectFrom('feedback').select(eb => eb.fn.countAll<number>().as('n'))
    .where('ip_hash', '=', ip).where('created_at', '>', new Date(Date.now() - 10 * 60_000))
    .executeTakeFirst();
  if ((recent?.n ?? 0) >= 20) fail(429, 'too_many', 'Veľa pripomienok naraz. Skús to o chvíľu.');
  const row = await db.insertInto('feedback').values({ page: input.page, message: input.message, author: input.author || null, ip_hash: ip })
    .output('inserted.id').executeTakeFirstOrThrow();
  c.header('Cache-Control', CACHE.none);
  return c.json({ id: row.id }, 201);
});
