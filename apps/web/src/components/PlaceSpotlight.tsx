/**
 * Cards on the wall: every few seconds a place in the middle of the visible side of the globe gets a card
 * saying what TUKE does there (or how many guests brought a light). Where the screen has room next to the
 * globe, the card sits there with a line to its place; otherwise it sits beside the place. A card never
 * covers the title, the counters, the QR code, the buttons or its own place, and it leaves before the
 * place sets behind the horizon.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CATEGORY_GROUPS } from '@ples/shared/constants';
import type { GlobePlace, PlaceDetail } from '@ples/shared';
import type { GlobeScene, GuestPlace } from '../globe/scene.ts';
import { GROUP_COLOR, GUEST_COLOR } from '../globe/scene.ts';
import { api } from '../lib/api.ts';
import { fmt, plural } from '../lib/format.ts';
import './spotlight.css';

type Spot = { kind: 'coop'; id: string; lat: number; lon: number; place: GlobePlace } | { kind: 'guest'; id: string; lat: number; lon: number; place: GuestPlace };
export interface Box { left: number; top: number; right: number; bottom: number }
type Side = 'left' | 'right';
/** margin: in the free space next to the globe; beside: on the globe next to the place; above / below: over or under the place (phones) */
type Mode = 'margin' | 'beside' | 'above' | 'below';
interface Placement { mode: Mode; side: Side; x: number; y: number }
interface Disc { x: number; y: number; r: number }

const SHOW_MS = 7000;
const GAP_MS = 2600;
const LEAVE_MS = 450;
const LOAD_MS = 2500; // longest wait for a place's partners; after that the card shows without them
const FIRST_DELAY_MS = 9000; // at least this long after the page opens
const AFTER_REVEAL_MS = 3000; // the whole lit globe first, then the cards
const PAD = 14; // free space kept around the title, counters and buttons
const EDGE = 12; // free space kept at the window edges
const BESIDE = 60; // distance between a card and its place when the card sits on the globe
const RING = 26; // half the size of the area around the place that a card must not cover
const groupLabel = new Map<string, string>(CATEGORY_GROUPS.map(g => [g.code, g.label]));
const keyOf = (s: Spot) => `${s.kind}:${s.id}`;

function pickSpot(scene: GlobeScene, recent: string[], obstacles: Box[]): Spot | null {
  const ahead = scene.turnWhileFocused(SHOW_MS / 1000); // where the place will be when its card leaves
  const pool: (Spot & { weight: number })[] = [];
  if (scene.currentMode() === 'cooperation') {
    for (const p of scene.visibleCoop()) pool.push({ kind: 'coop', id: p.id, lat: p.lat, lon: p.lon, place: p, weight: Math.sqrt(p.links) });
  }
  for (const g of scene.guestPlaces()) pool.push({ kind: 'guest', id: g.key, lat: g.lat, lon: g.lon, place: g, weight: 1.5 * Math.sqrt(g.count) });
  let best: (Spot & { weight: number }) | null = null;
  let bestScore = 0;
  for (const c of pool) {
    if (recent.includes(keyOf(c))) continue;
    // only the middle of the disc, now and when the card leaves, so no card goes to a place that is about to set
    const facing = Math.min(scene.facing(c.lat, c.lon), scene.facing(c.lat, c.lon + ahead));
    if (facing < 0.45) continue;
    const { x, y } = scene.screenPoint(c.lat, c.lon); // on a narrow screen the disc can be wider than the window
    if (x < innerWidth * 0.06 || x > innerWidth * 0.94 || y < EDGE || y > innerHeight - EDGE) continue;
    if (obstacles.some(o => x > o.left - PAD && x < o.right + PAD && y > o.top - PAD && y < o.bottom + PAD)) continue; // hidden under the title or a panel
    const score = c.weight * facing * (0.6 + Math.random() * 0.8);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

/** The top edge nearest to `want` at which a card [x, x + w] × [y, y + h] touches no obstacle, or null. */
function freeTop(x: number, w: number, h: number, want: number, obstacles: Box[]): number | null {
  let spans: [number, number][] = [[EDGE, innerHeight - EDGE - h]];
  for (const o of obstacles) {
    if (o.right + PAD <= x || o.left - PAD >= x + w) continue; // not in this column
    const from = o.top - PAD - h, to = o.bottom + PAD; // a top edge between these would touch the obstacle
    spans = spans.flatMap(([a, b]): [number, number][] => {
      if (to <= a || from >= b) return [[a, b]];
      const out: [number, number][] = [];
      if (from > a) out.push([a, from]);
      if (to < b) out.push([to, b]);
      return out;
    });
  }
  let best: number | null = null;
  for (const [a, b] of spans) {
    if (b < a) continue;
    const y = Math.min(Math.max(want, a), b);
    if (best === null || Math.abs(y - want) < Math.abs(best - want)) best = y;
  }
  return best;
}

const ringBox = (px: number, py: number): Box => ({ left: px - RING, top: py - RING, right: px + RING, bottom: py + RING });
const overlapsDisc = (b: Box, d: Disc) => {
  const dx = Math.max(b.left - d.x, 0, d.x - b.right), dy = Math.max(b.top - d.y, 0, d.y - b.bottom);
  return dx * dx + dy * dy < d.r * d.r;
};

const clampX = (x: number, w: number) => Math.min(Math.max(x, EDGE), innerWidth - EDGE - w);

/** The card's x and the top edge it would like in a mode; for margin cards x stays where it was chosen. */
function slot(mode: Mode, side: Side, px: number, py: number, w: number, h: number, marginX: number): { x: number; want: number } {
  if (mode === 'margin') return { x: marginX, want: py - h * 0.4 };
  if (mode === 'beside') return { x: side === 'right' ? px + BESIDE : px - BESIDE - w, want: py - h * 0.4 };
  return { x: clampX(px - w / 2, w), want: mode === 'above' ? py - BESIDE - h : py + BESIDE };
}

/** A free top edge for the slot, or null; cards over or under the place must stay on their side of it. */
function fit(mode: Mode, x: number, want: number, py: number, w: number, h: number, blocked: Box[]): number | null {
  if (x < EDGE || x + w > innerWidth - EDGE) return null;
  const y = freeTop(x, w, h, want, blocked);
  if (y === null) return null;
  if (mode === 'above' && y + h > py - RING) return null;
  if (mode === 'below' && y < py + RING) return null;
  return y;
}

/**
 * Where a card goes when it appears: next to the globe on the side of its place if there is room, else beside
 * the place, else (on a phone) over or under it.
 */
function choosePlacement(px: number, py: number, w: number, h: number, prefer: Side, disc: Disc, obstacles: Box[]): Placement | null {
  const blocked = [...obstacles, ringBox(px, py)];
  let best: (Placement & { cost: number }) | null = null;
  const consider = (mode: Mode, side: Side, x: number, want: number, extra: number) => {
    const y = fit(mode, x, want, py, w, h, blocked);
    if (y === null) return;
    const box = { left: x, top: y, right: x + w, bottom: y + h };
    const ax = Math.min(Math.max(px, box.left), box.right), ay = Math.min(Math.max(py, box.top), box.bottom);
    const cost = Math.hypot(ax - px, ay - py) + (overlapsDisc(box, disc) ? 320 : 0) + (side === prefer ? 0 : 80) + extra;
    if (!best || cost < best.cost) best = { mode, side, x, y, cost };
  };
  for (const side of ['left', 'right'] as const) {
    const edge = side === 'right' ? disc.x + disc.r + 28 : disc.x - disc.r - 28 - w;
    for (let k = 0; k < 10; k++) consider('margin', side, edge + (side === 'right' ? k : -k) * 40, py - h * 0.4, 0); // next to the globe, then further out
    const b = slot('beside', side, px, py, w, h, 0);
    consider('beside', side, b.x, b.want, 0);
  }
  for (const mode of ['above', 'below'] as const) {
    const s = slot(mode, prefer, px, py, w, h, 0);
    consider(mode, prefer, s.x, s.want, 40);
  }
  const chosen = best as (Placement & { cost: number }) | null;
  return chosen && { mode: chosen.mode, side: chosen.side, x: chosen.x, y: chosen.y };
}

/** Where the card is in this frame: it keeps its mode and side and follows its place. */
function follow(p: Placement, px: number, py: number, w: number, h: number, obstacles: Box[]): { x: number; y: number } | null {
  const s = slot(p.mode, p.side, px, py, w, h, p.x);
  const x = p.mode === 'beside' ? clampX(s.x, w) : s.x;
  const y = fit(p.mode, x, s.want, py, w, h, [...obstacles, ringBox(px, py)]);
  return y === null ? null : { x, y };
}

/** obstacles(): what the cards must keep clear of (title, counters, QR code, buttons), in client pixels. */
export function PlaceSpotlight({ scene, obstacles }: { scene: GlobeScene | null; obstacles: () => Box[] }) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [detail, setDetail] = useState<PlaceDetail | null>(null);
  const [shown, setShown] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const lines = useRef<SVGSVGElement>(null);
  const line = useRef<SVGLineElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const obstaclesRef = useRef(obstacles);
  obstaclesRef.current = obstacles;
  const rendered = useRef(''); // what the card shows right now, so it is measured only when complete

  useLayoutEffect(() => { rendered.current = spot ? keyOf(spot) + (detail ? '+' : '') : ''; }, [spot, detail]);

  useEffect(() => {
    if (!scene) return;
    const recent: string[] = [];
    let current: Spot | null = null;
    let phase: 'wait' | 'load' | 'show' | 'leave' = 'wait';
    let until = performance.now() + FIRST_DELAY_MS;
    let want = ''; // what the card must show before it is measured
    let placement: Placement | null = null;
    let pos: { x: number; y: number } | null = null;
    let last = 0;
    let raf = 0;

    const reset = (t: number, gap: number) => {
      phase = 'wait';
      until = t + gap;
      current = null;
      placement = null;
      pos = null;
      setSpot(null);
      setShown(false);
    };

    const draw = (px: number, py: number, w: number, h: number) => {
      if (!pos || !card.current || !line.current || !ring.current || !dot.current) return;
      card.current.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)`;
      const ax = Math.min(Math.max(px, pos.x), pos.x + w), ay = Math.min(Math.max(py, pos.y + 16), pos.y + h - 16);
      line.current.setAttribute('x1', String(px)); line.current.setAttribute('y1', String(py));
      line.current.setAttribute('x2', String(ax)); line.current.setAttribute('y2', String(ay));
      ring.current.setAttribute('cx', String(px)); ring.current.setAttribute('cy', String(py));
      dot.current.setAttribute('cx', String(ax)); dot.current.setAttribute('cy', String(ay));
    };

    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - (last || t)) / 1000);
      last = t;
      if (phase === 'wait' && scene.revealing()) {
        until = Math.max(until, t + AFTER_REVEAL_MS); // no cards while the light spreads: they would hide the stars
      } else if (phase === 'wait' && t > until) {
        const next = pickSpot(scene, recent, obstaclesRef.current());
        if (next) {
          current = next;
          recent.push(keyOf(next));
          if (recent.length > 24) recent.shift();
          phase = 'load';
          until = t + LOAD_MS;
          want = keyOf(next);
          setDetail(null);
          setShown(false);
          setSpot(next);
          if (next.kind === 'coop') {
            want += '+';
            api.place(next.id)
              .then(d => { if (current === next) setDetail(d); })
              .catch(() => { if (current === next) want = keyOf(next); }); // show it without the partners
          }
        } else {
          until = t + 1500; // nothing in the middle (an ocean): try again soon, the globe turns faster meanwhile
        }
      } else if (phase === 'load' && current && scene.revealing()) {
        reset(t, AFTER_REVEAL_MS); // the reveal started again while this card was being prepared
      } else if (phase === 'load' && current) {
        if (t > until) want = keyOf(current); // partners took too long
        const el = card.current;
        const ready = rendered.current === want || rendered.current === keyOf(current) + '+';
        if (el && ready) {
          const w = el.offsetWidth, h = el.offsetHeight;
          const p = scene.screenPoint(current.lat, current.lon);
          const end = scene.screenPoint(current.lat, current.lon + scene.turnWhileFocused(SHOW_MS / 1000));
          const disc = scene.disc();
          placement = choosePlacement(p.x, p.y, w, h, (p.x + end.x) / 2 < disc.x ? 'left' : 'right', disc, obstaclesRef.current());
          if (!placement) {
            reset(t, 300); // no room for this card on this screen: try another place
          } else {
            phase = 'show';
            until = t + SHOW_MS;
            pos = { x: placement.x, y: placement.y };
            el.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)`;
            setShown(true);
            scene.flare(current.kind, current.id);
            scene.setFocus(true);
          }
        }
      } else if ((phase === 'show' || phase === 'leave') && current && placement && card.current) {
        const p = scene.screenPoint(current.lat, current.lon);
        const w = card.current.offsetWidth, h = card.current.offsetHeight;
        const target = follow(placement, p.x, p.y, w, h, obstaclesRef.current());
        const gone = p.facing < 0.15 || p.x < 0 || p.x > innerWidth || p.y < 0 || p.y > innerHeight || !target || scene.revealing(); // e.g. R replays the reveal
        if (phase === 'show' && (t > until || gone)) {
          phase = 'leave';
          until = t + LEAVE_MS;
          card.current.classList.add('leaving');
          lines.current?.classList.add('leaving');
          scene.setFocus(false);
        } else if (phase === 'leave' && t > until) {
          reset(t, GAP_MS);
        }
        if (target && pos) {
          const k = 1 - Math.exp(-dt / 0.12); // glide, so a change of free space never makes the card jump
          pos = { x: pos.x + (target.x - pos.x) * k, y: pos.y + (target.y - pos.y) * k };
        }
        if (current) draw(p.x, p.y, w, h);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); scene.setFocus(false); };
  }, [scene]);

  if (!spot) return null;
  return (
    <>
      {shown && (
        <svg ref={lines} className="spot-lines" aria-hidden="true">
          <line ref={line} />
          <circle ref={ring} className="spot-ring" r="17" />
          <circle ref={dot} className="spot-dot" r="2.5" />
        </svg>
      )}
      <div ref={card} className={`spot-card spot-${spot.kind}${shown ? '' : ' measuring'}`} role="status" aria-live="polite">
        {spot.kind === 'coop' ? <CoopCard place={spot.place} detail={detail} /> : <GuestCard place={spot.place} />}
      </div>
    </>
  );
}

function CoopCard({ place, detail }: { place: GlobePlace; detail: PlaceDetail | null }) {
  const group = place.groups[0] ?? 'other';
  const top = detail?.institutions.slice().sort((a, b) => b.links.length - a.links.length).slice(0, 3) ?? [];
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
