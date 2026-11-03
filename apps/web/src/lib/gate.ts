/**
 * Which pages the open venue shows this visitor: GET /api/gate (gateOf in packages/shared). Before the ball the ball
 * shows only /onboarding, to a logged-in admin too, unless the admin opened the preview (usePreview). The last answer
 * is kept per venue, so the wall keeps running when the API is away for a moment during a reload at the ball.
 * Every open page asks again every 10 s while it is in front (and at once when it comes back to the front): when the
 * admin switches the venue in /admin, phones and the wall follow by themselves (teaser and page, the wall and the
 * onboarding), and pages that show the event (the form, the onboarding) load it again (useEventVersion).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { GateResponse, GateState, Venue } from '@ples/shared';
import { api } from './api.ts';
import { store } from './device.ts';
import { usePoll } from './usePoll.ts';

const POLL_MS = 10_000;

const REFRESH = 'ples-gate-refresh';
const PREVIEW = 'ples-preview-change';
const PARAM = 'nahlad';
const previewKey = (venue: Venue) => `ples-preview-${venue.key}`;

/** ?nahlad=1 (the link in /admin) starts the preview of this tab, ?nahlad=0 ends it; then it lasts while the tab is open. */
function readPreview(venue: Venue): boolean {
  const flag = new URLSearchParams(location.search).get(PARAM);
  try {
    if (flag === '0') sessionStorage.removeItem(previewKey(venue));
    else if (flag !== null) sessionStorage.setItem(previewKey(venue), '1');
    return sessionStorage.getItem(previewKey(venue)) === '1';
  } catch {
    return flag !== null && flag !== '0'; // storage blocked: only while the address carries it
  }
}

/**
 * The admin's preview: every page as on the ball night (a rehearsal on the LED wall before the ball), in this tab only.
 * Without it a logged-in admin sees what the guests see, so the status switch in /admin shows at once what everybody
 * gets (the user, 2026-10-27: after „Pred plesom" the map still showed while logged in). Only for a valid admin session.
 */
export function usePreview(venue: Venue): boolean {
  const [on, setOn] = useState(() => readPreview(venue));
  useEffect(() => {
    const update = () => setOn(readPreview(venue));
    update();
    addEventListener(PREVIEW, update);
    return () => removeEventListener(PREVIEW, update);
  }, [venue]);
  return on;
}

/** Ends the preview of this tab: the page falls back to what the guests see. */
export function endPreview(venue: Venue): void {
  try { sessionStorage.removeItem(previewKey(venue)); } catch { /* nothing kept */ }
  const params = new URLSearchParams(location.search);
  if (params.has(PARAM)) {
    params.delete(PARAM);
    const search = params.toString();
    history.replaceState(history.state, '', `${location.pathname}${search ? `?${search}` : ''}${location.hash}`);
  }
  dispatchEvent(new Event(PREVIEW));
}

/** The address of a venue's preview, for the link in /admin (the wall with its links, ?kiosk=0). */
export const previewHref = (venueRoot: string) => `${venueRoot}?kiosk=0&${PARAM}=1`;

/** Asks the API again, e.g. after an admin logs in or out. */
export const refreshGate = () => dispatchEvent(new Event(REFRESH));

const same = (a: GateResponse, b: GateResponse) => a.state === b.state && a.admin === b.admin && a.status === b.status && a.changed === b.changed;

/** The gate of the open venue, asked again every 10 s while the page is in front (one per page: main.tsx). */
export function useGate(venue: Venue): GateResponse | null {
  const [gate, setGate] = useState<{ venue: string; value: GateResponse } | null>(null);
  const current = useRef(venue);
  current.current = venue;
  const check = useCallback(async () => {
    const v = current.current;
    const key = `ples-gate-${v.key}`;
    try {
      const value = await api.gate();
      if (current.current.key !== v.key) return;
      store.set(key, value.state);
      setGate(prev => (prev && prev.venue === v.key && same(prev.value, value) ? prev : { venue: v.key, value }));
    } catch (err) {
      if (current.current.key !== v.key) return;
      // the API is away: the page keeps what it shows; before any answer the last known state, else closed
      // (onboarding where the venue has one)
      const state = store.get<GateState>(key) ?? (v.onboarding ? 'onboarding' : 'off');
      setGate(prev => (prev && prev.venue === v.key ? prev : { venue: v.key, value: { state, admin: false, status: null, changed: null } }));
      throw err; // usePoll waits longer before the next try
    }
  }, []);
  usePoll(check, POLL_MS);
  // at once after a login or logout, and in another venue
  useEffect(() => {
    const again = () => { check().catch(() => {}); };
    addEventListener(REFRESH, again);
    return () => removeEventListener(REFRESH, again);
  }, [check]);
  const shown = useRef(venue.key);
  useEffect(() => {
    if (shown.current === venue.key) return;
    shown.current = venue.key;
    check().catch(() => {});
  }, [venue.key, check]);
  return gate && gate.venue === venue.key ? gate.value : null;
}

/** The gate of the page (main.tsx provides it). */
export const GateContext = createContext<GateResponse | null>(null);

/**
 * Changes whenever the admin changes the venue's event (status, photos, access code, scene): a page that shows the event
 * loads it again when this changes, e.g. the form when photos are switched on, the onboarding when the ball starts.
 */
export const useEventVersion = (): string | null => useContext(GateContext)?.changed ?? null;

/** May this visitor open the page (a path inside the venue, e.g. /mapa)? /admin is always open, the admin's preview all. */
export function pageAllowed(gate: GateResponse, page: string, venue: Venue, preview = false): boolean {
  if (page === '/admin' || gate.state === 'open' || (gate.admin && preview)) return true;
  return gate.state === 'onboarding' && venue.onboarding && page === '/onboarding';
}
