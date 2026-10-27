/**
 * GET /api/gate (each venue: /api/vestibul/gate): which pages the venue shows this visitor. Before the ball the ball
 * shows only /onboarding; a logged-in admin sees every page (rehearsal on the wall). Never cached: the answer depends
 * on the admin cookie and the operator's switch in /admin.
 */
import { Hono } from 'hono';
import { VENUES, gateOf, type GateResponse } from '@ples/shared';
import { getDb, isDatabaseConfigured } from '@ples/db';
import { CACHE, fail } from '../lib/http.ts';
import { hasSession } from '../lib/security.ts';
import { venueOf } from '../lib/venue.ts';

export const gateRoutes = new Hono().get('/', async c => {
  c.header('Cache-Control', CACHE.none);
  const venue = VENUES[venueOf(c)];
  let status = null;
  if (isDatabaseConfigured(venue.key)) {
    try {
      const ev = await (await getDb(venue.key)).selectFrom('events').select('status').where('slug', '=', venue.event).executeTakeFirst();
      status = ev?.status ?? null;
    } catch (err) {
      console.error(`[gate] ${venue.key}: database unavailable:`, (err as Error).message);
      fail(503, 'database_down', 'Databáza je dočasne nedostupná.');
    }
  }
  return c.json({ state: gateOf(status), admin: hasSession(c) } satisfies GateResponse);
});
