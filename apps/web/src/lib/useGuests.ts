/**
 * Guest lights of an event for a globe page: one summary request, then the shared live feed every 2 s.
 * The feed is the same for every viewer (CDN cached), each page keeps its own cursor and takes only
 * pins newer than it. Hidden tabs do not poll (usePoll). Every few minutes the summary is loaded again,
 * so lights an admin hid or a guest took back disappear from the wall too.
 */
import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '@ples/shared/constants';
import type { EventInfo, LivePin, LiveTotals } from '@ples/shared';
import type { WallScene } from '../globe/core.ts';
import { api } from './api.ts';
import { usePoll } from './usePoll.ts';

/** Same place = same star; summary and live feed both carry the place coordinates. */
export const pinKey = (p: { countryCode: string; lat: number; lon: number }) => `${p.countryCode}:${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;

/** At most this many lights fly in one by one; the rest of a burst (e.g. after the tab was hidden) appears at once. */
const ANIMATED_PER_POLL = 8;
const RESYNC_MS = 5 * 60_000;

export function useGuests(scene: WallScene | null, slug: string, { intervalMs = 2000 } = {}) {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [totals, setTotals] = useState<LiveTotals>({ pins: 0, places: 0, countries: 0 });
  const [recent, setRecent] = useState<LivePin[]>([]);
  const [available, setAvailable] = useState(true);
  const cursor = useRef<number | null>(null);
  const synced = useRef(0); // when the summary was loaded
  const seen = useRef(0); // newest pin this page has shown, so a resync does not fly the same light in twice

  useEffect(() => { cursor.current = null; seen.current = 0; }, [scene, slug]);

  usePoll(async () => {
    if (!scene) return;
    try {
      if (Date.now() - synced.current > RESYNC_MS) cursor.current = null;
      if (cursor.current === null) {
        const s = await api.summary(slug);
        scene.setGuests(s.places.map(p => ({ key: pinKey(p), name: p.name, countryCode: p.countryCode, lat: p.lat, lon: p.lon, count: p.count })));
        cursor.current = s.cursor;
        seen.current = Math.max(seen.current, s.cursor);
        synced.current = Date.now();
        setEvent(s.event);
        setTotals(s.totals);
      } else {
        const live = await api.live(slug);
        const since = cursor.current;
        const fresh = live.pins.filter(p => p.id > since);
        if (fresh.length && live.pins.length >= LIMITS.liveWindow && live.pins[0]!.id > since + 1) {
          // more new lights than the shared window holds: start over from the summary
          cursor.current = null;
        } else if (fresh.length) {
          const unseen = fresh.filter(p => p.id > seen.current);
          const quiet = [...fresh.filter(p => p.id <= seen.current), ...unseen.slice(0, -ANIMATED_PER_POLL)];
          const animated = unseen.slice(-ANIMATED_PER_POLL);
          if (quiet.length) scene.addGuests(quiet.map(p => ({ ...p, key: pinKey(p) })));
          if (animated.length) scene.addGuestArrivals(animated.map(p => ({ ...p, key: pinKey(p) })));
          if (unseen.length) setRecent(r => [...unseen.slice().reverse(), ...r].slice(0, 4));
          cursor.current = fresh.at(-1)!.id;
          seen.current = Math.max(seen.current, cursor.current);
        }
        setEvent(live.event);
        setTotals(live.totals);
      }
      setAvailable(true);
    } catch (err) {
      // 503 = no database yet: the cooperation globe keeps running without guest lights
      setAvailable(false);
      throw err;
    }
  }, intervalMs, Boolean(scene));

  return { event, totals, recent, available };
}
