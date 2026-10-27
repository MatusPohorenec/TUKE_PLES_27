/** Five routes do not need a router library: pathname state plus history.pushState. */
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { venueOfPath, type Venue } from '@ples/shared/constants';
import { venueHref } from './venue.ts';

const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach(l => l()));

export function navigate(to: string, { replace = false } = {}): void {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  listeners.forEach(l => l());
  window.scrollTo(0, 0);
}

export function usePathname(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);
  return path;
}

/** The venue of the open page (the ball, or the student lobby under /vestibul). */
export const useVenue = (): Venue => venueOfPath(usePathname());

/**
 * In-app link. A path stays inside the venue that is open: href="/mapa" leads to /vestibul/mapa in the lobby.
 * A link to the other venue is a plain <a> (full page load).
 */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const to = venueHref(href);
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || to.startsWith('http')) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}

export const queryParam = (name: string): string | null => new URLSearchParams(location.search).get(name);

/**
 * Kiosk mode: no links, no comment button, the cursor hides, the screen stays awake. The wall (/, /stena) runs as a
 * kiosk unless ?kiosk=0 (the LED wall needs nothing in the address); other pages only with ?kiosk.
 */
export function kioskMode(page: string): boolean {
  const k = queryParam('kiosk');
  if (k !== null) return k !== '0';
  return page === '/' || page === '/stena';
}
