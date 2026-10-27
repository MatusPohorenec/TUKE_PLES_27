import type { Context } from 'hono';
import { venueOfPath, type VenueKey } from '@ples/shared';

/**
 * The venue of a request and the route inside it: /api/vestibul/events/… is the student lobby's /events/…,
 * every other /api/… path belongs to the ball. Each venue reads and writes only its own database.
 */
export function routeOf(c: Context): { venue: VenueKey; route: string } {
  const path = c.req.path.replace(/^\/api(?=\/|$)/, '');
  const venue = venueOfPath(path);
  return { venue: venue.key, route: path.slice(venue.prefix.length) || '/' };
}

export const venueOf = (c: Context): VenueKey => routeOf(c).venue;
