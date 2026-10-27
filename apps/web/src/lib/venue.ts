/**
 * Which wall a page belongs to: /vestibul/… is the student lobby, every other path the ball (VENUES in
 * packages/shared). A venue's pages call the venue's API (/api/vestibul/…), which has a database of its own.
 */
import { venueOfPath, type Venue } from '@ples/shared/constants';

/** The venue of the page that is open now. */
export const currentVenue = (): Venue => venueOfPath(location.pathname);

/** The page inside its venue, without a trailing slash: /vestibul/mapa/ -> /mapa, /vestibul -> /. */
export function pageOf(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path.slice(venueOfPath(path).prefix.length) || '/';
}

/** A link to a page of the venue: /mapa -> /vestibul/mapa and /?view=2d -> /vestibul?view=2d in the lobby. */
export function venueHref(href: string, venue: Venue = currentVenue()): string {
  if (!venue.prefix || !href.startsWith('/') || href.startsWith('//')) return href;
  const cut = href.search(/[?#]/);
  const path = cut < 0 ? href : href.slice(0, cut);
  if (venueOfPath(path).prefix) return href; // already inside a venue
  return venue.prefix + (path === '/' ? '' : path) + (cut < 0 ? '' : href.slice(cut));
}
