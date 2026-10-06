/**
 * Guest lights of an event for a globe page: one summary request, then the live feed every 2 s.
 * New pins are handed to the scene as arrivals, so each one flies in from Košice.
 */
import { useEffect, useRef, useState } from 'react';
import type { EventInfo, LivePin, LiveTotals } from '@ples/shared';
import type { GlobeScene } from '../globe/scene.ts';
import { api } from './api.ts';
import { usePoll } from './usePoll.ts';

/** Same place = same star; summary and live feed both carry the place coordinates. */
export const pinKey = (p: { countryCode: string; lat: number; lon: number }) => `${p.countryCode}:${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;

export function useGuests(scene: GlobeScene | null, slug: string, { intervalMs = 2000 } = {}) {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [totals, setTotals] = useState<LiveTotals>({ pins: 0, places: 0, countries: 0 });
  const [recent, setRecent] = useState<LivePin[]>([]);
  const [available, setAvailable] = useState(true);
  const cursor = useRef<number | null>(null);

  useEffect(() => { cursor.current = null; }, [scene, slug]);

  usePoll(async () => {
    if (!scene) return;
    try {
      if (cursor.current === null) {
        const s = await api.summary(slug);
        scene.setGuests(s.places.map(p => ({ key: pinKey(p), name: p.name, countryCode: p.countryCode, lat: p.lat, lon: p.lon, count: p.count })));
        cursor.current = s.cursor;
        setEvent(s.event);
        setTotals(s.totals);
      } else {
        const live = await api.live(slug, cursor.current);
        if (live.pins.length) {
          scene.addGuestArrivals(live.pins.map(p => ({ ...p, key: pinKey(p) })));
          setRecent(r => [...live.pins.slice().reverse(), ...r].slice(0, 4));
        }
        cursor.current = live.cursor;
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
