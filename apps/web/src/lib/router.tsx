/** Five routes do not need a router library: pathname state plus history.pushState. */
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach(l => l()));

export function navigate(to: string): void {
  if (to === location.pathname + location.search) return;
  history.pushState(null, '', to);
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

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || href.startsWith('http')) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}

export const queryParam = (name: string): string | null => new URLSearchParams(location.search).get(name);
