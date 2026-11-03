/**
 * GET /api/gate (each venue: /api/vestibul/gate): which pages the venue shows this visitor, the event's status and when
 * the admin last changed the event. Before the ball the ball shows only /onboarding; a logged-in admin sees what the
 * guests see (every page only in the preview). Every open page asks again every few seconds, so a switch in /admin
 * reaches open phones and the wall without a reload. Never cached by the browser: the answer depends on the admin cookie.
 */
import { Hono } from 'hono';
import { VENUES, gateOf, type EventStatus, type GateResponse, type VenueKey } from '@ples/shared';
import { getDb, isDatabaseConfigured } from '@ples/db';
import { CACHE, fail, shared } from '../lib/http.ts';
import { hasSession } from '../lib/security.ts';
import { venueOf } from '../lib/venue.ts';

/** The event as the gate needs it, read once per 2 s per venue however many pages ask. */
const eventState = shared<{ status: EventStatus | null; changed: string | null }>(2_000);

/** The admin changed the event (PATCH /admin/events): the next question gets the new state at once. */
export const forgetGate = (venue: VenueKey) => eventState.forget(venue);

export const gateRoutes = new Hono().get('/', async c => {
  c.header('Cache-Control', CACHE.none);
  const venue = VENUES[venueOf(c)];
  let event: { status: EventStatus | null; changed: string | null } = { status: null, changed: null };
  if (isDatabaseConfigured(venue.key)) {
    try {
      event = await eventState(venue.key, async () => {
        const ev = await (await getDb(venue.key)).selectFrom('events').select(['status', 'updated_at']).where('slug', '=', venue.event).executeTakeFirst();
        return { status: ev?.status ?? null, changed: ev ? ev.updated_at.toISOString() : null };
      });
    } catch (err) {
      console.error(`[gate] ${venue.key}: database unavailable:`, (err as Error).message);
      fail(503, 'database_down', 'Databáza je dočasne nedostupná.');
    }
  }
  return c.json({ state: gateOf(event.status), admin: hasSession(c), ...event } satisfies GateResponse);
});
