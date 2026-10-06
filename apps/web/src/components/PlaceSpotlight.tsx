/**
 * Cards on the wall: every few seconds a place in the middle of the visible side of the globe gets a card
 * saying what TUKE does there (or how many guests brought a light). The card follows its place while the
 * globe turns and leaves before the place sets behind the horizon.
 */
import { useEffect, useRef, useState } from 'react';
import { CATEGORY_GROUPS } from '@ples/shared/constants';
import type { GlobePlace, PlaceDetail } from '@ples/shared';
import type { GlobeScene, GuestPlace } from '../globe/scene.ts';
import { GROUP_COLOR, GUEST_COLOR } from '../globe/scene.ts';
import { api } from '../lib/api.ts';
import { fmt, plural } from '../lib/format.ts';
import './spotlight.css';

type Spot = { kind: 'coop'; id: string; lat: number; lon: number; place: GlobePlace } | { kind: 'guest'; id: string; lat: number; lon: number; place: GuestPlace };

const SHOW_MS = 7000;
const GAP_MS = 2600;
const LEAVE_MS = 450;
const FIRST_DELAY_MS = 9000; // let the reveal play first
const groupLabel = new Map<string, string>(CATEGORY_GROUPS.map(g => [g.code, g.label]));

function pickSpot(scene: GlobeScene, recent: string[], free: { top: number; bottom: number }): Spot | null {
  const ahead = scene.turnWhileFocused(SHOW_MS / 1000); // where the place will be when its card leaves
  const pool: (Spot & { weight: number })[] = [];
  if (scene.currentMode() === 'cooperation') {
    for (const p of scene.visibleCoop()) pool.push({ kind: 'coop', id: p.id, lat: p.lat, lon: p.lon, place: p, weight: Math.sqrt(p.links) });
  }
  for (const g of scene.guestPlaces()) pool.push({ kind: 'guest', id: g.key, lat: g.lat, lon: g.lon, place: g, weight: 1.5 * Math.sqrt(g.count) });
  let best: (Spot & { weight: number }) | null = null;
  let bestScore = 0;
  for (const c of pool) {
    if (recent.includes(`${c.kind}:${c.id}`)) continue;
    // only the middle of the disc, now and when the card leaves, so no card goes to a place that is about to set
    const facing = Math.min(scene.facing(c.lat, c.lon), scene.facing(c.lat, c.lon + ahead));
    if (facing < 0.45) continue;
    const { x, y } = scene.screenPoint(c.lat, c.lon); // on a narrow screen the disc can be wider than the window
    if (x < innerWidth * 0.06 || x > innerWidth * 0.94 || y < free.top || y > innerHeight - free.bottom) continue;
    const score = c.weight * facing * (0.6 + Math.random() * 0.8);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

/** insets(): space the cards must keep free at the top (title) and bottom (counters, QR code), in px. */
export function PlaceSpotlight({ scene, insets }: { scene: GlobeScene | null; insets: () => { top: number; bottom: number } }) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [detail, setDetail] = useState<PlaceDetail | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const line = useRef<SVGLineElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const insetsRef = useRef(insets);
  insetsRef.current = insets;

  useEffect(() => {
    if (!scene) return;
    const recent: string[] = [];
    let current: Spot | null = null;
    let phase: 'wait' | 'show' | 'leave' = 'wait';
    let until = performance.now() + FIRST_DELAY_MS;
    let raf = 0;

    const place = (x: number, y: number) => {
      const el = card.current;
      if (!el || !line.current || !ring.current) return;
      const w = el.offsetWidth, h = el.offsetHeight;
      const right = x < innerWidth * 0.5;
      const left = right ? x + 64 : x - 64 - w;
      const free = insetsRef.current();
      const top = Math.min(Math.max(y - h * 0.4, free.top), innerHeight - free.bottom - h);
      el.style.transform = `translate(${Math.round(Math.max(12, Math.min(left, innerWidth - w - 12)))}px, ${Math.round(top)}px)`;
      const anchorX = right ? left : left + w;
      const anchorY = Math.min(Math.max(y, top + 18), top + h - 18);
      line.current.setAttribute('x1', String(x)); line.current.setAttribute('y1', String(y));
      line.current.setAttribute('x2', String(anchorX)); line.current.setAttribute('y2', String(anchorY));
      ring.current.setAttribute('cx', String(x)); ring.current.setAttribute('cy', String(y));
    };

    const loop = (t: number) => {
      if (phase === 'wait' && t > until) {
        const next = pickSpot(scene, recent, insetsRef.current());
        if (next) {
          current = next;
          recent.push(`${next.kind}:${next.id}`);
          if (recent.length > 24) recent.shift();
          phase = 'show';
          until = t + SHOW_MS;
          setDetail(null);
          setSpot(next);
          scene.flare(next.kind, next.id);
          scene.setFocus(true);
          if (next.kind === 'coop') api.place(next.id).then(d => { if (current === next) setDetail(d); }).catch(() => {});
        } else {
          until = t + 1500; // nothing in the middle (an ocean): try again soon, the globe turns faster meanwhile
        }
      } else if (current && phase !== 'wait') {
        const p = scene.screenPoint(current.lat, current.lon);
        const gone = p.facing < 0.15 || p.x < 0 || p.x > innerWidth || p.y < 0 || p.y > innerHeight;
        if (phase === 'show' && (t > until || gone)) {
          phase = 'leave';
          until = t + LEAVE_MS;
          card.current?.classList.add('leaving');
          line.current?.parentElement?.classList.add('leaving');
          scene.setFocus(false);
        } else if (phase === 'leave' && t > until) {
          phase = 'wait';
          until = t + GAP_MS;
          current = null;
          setSpot(null);
        }
        if (current) place(p.x, p.y);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); scene.setFocus(false); };
  }, [scene]);

  if (!spot) return null;
  return (
    <>
      <svg className="spot-lines" aria-hidden="true">
        <line ref={line} />
        <circle ref={ring} r="17" />
      </svg>
      <div ref={card} className={`spot-card spot-${spot.kind}`} role="status" aria-live="polite">
        {spot.kind === 'coop' ? <CoopCard place={spot.place} detail={detail} /> : <GuestCard place={spot.place} />}
      </div>
    </>
  );
}

function CoopCard({ place, detail }: { place: GlobePlace; detail: PlaceDetail | null }) {
  const group = place.groups[0] ?? 'other';
  const top = detail?.institutions.slice().sort((a, b) => b.links.length - a.links.length).slice(0, 3) ?? [];
  const categories = detail ? [...new Set(detail.institutions.flatMap(i => i.links.map(l => l.category)))].slice(0, 3) : [];
  return (
    <>
      <div className="spot-kicker"><i style={{ background: GROUP_COLOR[group] }} />{groupLabel.get(group)}</div>
      <h3>{place.name}</h3>
      <p className="spot-meta">{place.country} · {fmt(place.distanceKm)} km od Košíc</p>
      <p className="spot-stats">
        <b>{fmt(place.institutions)}</b> {plural(place.institutions, 'partnerská inštitúcia', 'partnerské inštitúcie', 'partnerských inštitúcií')}
        {' · '}<b>{fmt(place.links)}</b> {plural(place.links, 'väzba', 'väzby', 'väzieb')}
      </p>
      {top.length > 0 && <ul>{top.map(i => <li key={i.name}>{i.name.replace(/\s*\(.*\)$/, '')}</li>)}</ul>}
      {categories.length > 0 && <div className="spot-tags">{categories.map(c => <span key={c}>{c}</span>)}</div>}
    </>
  );
}

function GuestCard({ place }: { place: GuestPlace }) {
  return (
    <>
      <div className="spot-kicker"><i style={{ background: GUEST_COLOR }} />Svetlá hostí</div>
      <h3>{place.name}</h3>
      <p className="spot-stats">
        <b>{fmt(place.count)}</b> {plural(place.count, 'hosť tu bol', 'hostia tu boli', 'hostí tu bolo')}
      </p>
    </>
  );
}
