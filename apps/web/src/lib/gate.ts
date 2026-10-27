/**
 * Which pages the open venue shows this visitor: GET /api/gate (gateOf in packages/shared). Before the ball the ball
 * shows only /onboarding; a logged-in admin sees everything. The last answer is kept per venue, so the wall keeps
 * running when the API is away for a moment during a reload at the ball.
 */
import { useEffect, useState } from 'react';
import type { GateResponse, GateState, Venue } from '@ples/shared';
import { api } from './api.ts';
import { store } from './device.ts';

const REFRESH = 'ples-gate-refresh';

/** Asks the API again, e.g. after an admin logs in or out. */
export const refreshGate = () => dispatchEvent(new Event(REFRESH));

export function useGate(venue: Venue): GateResponse | null {
  const [gate, setGate] = useState<{ venue: string; value: GateResponse } | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const again = () => setRound(r => r + 1);
    addEventListener(REFRESH, again);
    return () => removeEventListener(REFRESH, again);
  }, []);
  useEffect(() => {
    let alive = true;
    const key = `ples-gate-${venue.key}`;
    api.gate()
      .then(value => {
        if (!alive) return;
        setGate({ venue: venue.key, value });
        store.set(key, value.state);
      })
      .catch(() => {
        if (!alive) return;
        // the API is away: the last known state, else closed (onboarding where the venue has one)
        const state = store.get<GateState>(key) ?? (venue.onboarding ? 'onboarding' : 'off');
        setGate({ venue: venue.key, value: { state, admin: false } });
      });
    return () => { alive = false; };
  }, [venue.key, venue.onboarding, round]);
  return gate && gate.venue === venue.key ? gate.value : null;
}

/** May this visitor open the page (a path inside the venue, e.g. /mapa)? /admin is always open. */
export function pageAllowed(gate: GateResponse, page: string, venue: Venue): boolean {
  if (page === '/admin' || gate.admin || gate.state === 'open') return true;
  return gate.state === 'onboarding' && venue.onboarding && page === '/onboarding';
}
