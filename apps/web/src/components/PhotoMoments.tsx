/**
 * Guests' photos on the wall: a postcard flies out of the photo's light (its star; Košice for a photo from the ball),
 * stays a few seconds and flies back into it. New photos (approved in /admin, or sent while photos go on the wall at
 * once) come first, one after another; when none are waiting, an older one comes back now and then. The globe keeps
 * turning (slower while a postcard is up) and never turns back to a photo's place: a photo comes while its light
 * faces the viewer and stays in view until the postcard flies back into it; a new photo waits for that only while its
 * light comes round soon, else it comes at once and without the line. The postcard takes the free space beside the
 * globe; on the flat map it goes where it covers the fewest lit places, as near its light as that allows. Never over
 * the title, the counters, the QR code or the buttons. Place cards (PlaceSpotlight) give way: both share `stage`.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { VISIT_KINDS, type Venue, type VenueKey } from '@ples/shared/constants';
import type { PhotoFeed, WallPhoto } from '@ples/shared';
import type { WallScene } from '../globe/core.ts';
import { api, photoUrl } from '../lib/api.ts';
import { pinKey } from '../lib/useGuests.ts';
import type { Box, Stage } from './PlaceSpotlight.tsx';
import './photo-moments.css';

const SHOW_NEW_MS = 9000; // a new photo stays this long …
const SHOW_AGAIN_MS = 7000; // … one that comes back, this long
const ENTER_MS = 1200;
const LEAVE_MS = 800;
const GAP_MS = 1800; // between two photos
const AFTER_REVEAL_MS = 5000; // the lit map first, then the photos
const FIRST_AGAIN_MS = 20_000; // the first older photo after the page opens …
const AGAIN_MS = 40_000; // … then one every this often, while no new ones come
const LOAD_MS = 8000; // a photo that has not loaded by then is skipped
const FRESH_AT_LOAD_MS = 3 * 60_000; // photos approved this recently still count as new when the wall (re)starts
const FRESH_WAIT_MS = 25_000; // on the globe a new photo waits at most this long for its light to come round
const IN_VIEW = 0.3; // on the globe a photo comes while its light faces the viewer (1 = middle, 0 = horizon) …
const STILL_IN_VIEW = 0.15; // … and will still when the postcard flies back into it
const CARD_YIELD_S = 3; // a place card on screen may take this long to make room for a photo
const UP_S = CARD_YIELD_S + (ENTER_MS + SHOW_NEW_MS + LEAVE_MS) / 1000; // chosen → flown back, at most (s)
const CHECK_MS = 250; // how often the wall looks for the next photo (on the globe: a light that has come round)
const EDGE = 16; // free space kept at the window edges
const PAD = 14; // free space kept around the title, counters and buttons
const RING = 30; // the light itself stays visible
const STEP = 16; // px between the positions tried
const CELL = 24; // px of the grid that counts lit places
const SCALES = [1, 0.9, 0.8, 0.7, 0.6];
// what a position costs: a postcard 10 % smaller ≈ 7 lit places covered ≈ 1 000 px further from its light
const COST = { smaller: 1000, lit: 15, globe: 220, inGlobe: 2.5, far: 0.1 } as const;

/** The kicker of a photo taken at the venue right now. */
const HERE: Record<VenueKey, string> = { ples: 'Práve na plese', vestibul: 'Na TUKE' };
const visitLabel = new Map<string, string>(VISIT_KINDS.map(k => [k.code, k.label]));
const clock = (iso: string) => new Date(iso).toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' });
const hash = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/** A slight tilt of its own for every postcard, between -2.2° and 2.2°, never straight. */
const tiltOf = (id: string) => (((hash(id) % 9) - 4) * 0.55) || 0.8;

/**
 * The picture's size on the wall (px): large enough to be seen across the hall, within its share of the screen.
 * Phone shapes from 9:16 to 2:1 keep their whole picture; a panorama or a tall screenshot is cropped to them.
 */
function pictureSize(photo: WallPhoto, flat: boolean): { pw: number; ph: number } {
  const aspect = Math.min(2, Math.max(0.56, photo.width / photo.height));
  const phone = innerWidth <= 760;
  const maxH = innerHeight * (phone ? 0.34 : flat ? 0.42 : 0.46);
  const maxW = innerWidth * (phone ? 0.72 : 0.3);
  let ph = maxH, pw = ph * aspect;
  if (pw > maxW) { pw = maxW; ph = pw / aspect; }
  return { pw: Math.round(pw), ph: Math.round(ph) };
}

const overlaps = (a: Box, b: Box, pad = 0) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
const distance = (x: number, y: number, b: Box) => Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
const inside = (x: number, y: number, b: Box) => x > b.left && x < b.right && y > b.top && y < b.bottom;
/** The postcard shrunk to a spark at its light (x, y on screen): where it flies out of and back into. */
const spark = (x: number, y: number, w: number, h: number, tilt: number) =>
  `translate(${Math.round(x - w / 2)}px, ${Math.round(y - h / 2)}px) scale(0.05) rotate(${tilt * 5}deg)`;

/**
 * Where a w × h postcard goes (its top left corner on screen, and its scale): the cheapest position of every one tried,
 * counting how much smaller than full size it is, the lit places it would cover (for a few seconds a big photo is
 * worth a few covered stars, never a covered Europe), on the globe how far it reaches into the globe, and how far it
 * is from its light. `light`: where the light is while the postcard is up (on the globe it moves on as the globe
 * turns; empty when the light is out of view); the postcard never covers any of those points. Null when it fits
 * nowhere, not even at 60 %.
 */
function placeCard(w: number, h: number, light: { x: number; y: number }[], obstacles: Box[],
  lit: { x: number; y: number }[], disc: { x: number; y: number; r: number } | null): { x: number; y: number; scale: number } | null {
  const W = innerWidth, H = innerHeight;
  // lit places per grid cell, summed (a summed-area table): any rectangle's count in four lookups
  const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL), stride = cols + 1;
  const sat = new Int32Array(stride * (rows + 1));
  for (const p of lit) {
    if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) continue;
    sat[(Math.floor(p.y / CELL) + 1) * stride + Math.floor(p.x / CELL) + 1]! += 1;
  }
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) sat[r * stride + c]! += sat[(r - 1) * stride + c]! + sat[r * stride + c - 1]! - sat[(r - 1) * stride + c - 1]!;
  }
  const covered = (b: Box) => {
    const c0 = Math.max(0, Math.floor(b.left / CELL)), c1 = Math.min(cols, Math.ceil(b.right / CELL));
    const r0 = Math.max(0, Math.floor(b.top / CELL)), r1 = Math.min(rows, Math.ceil(b.bottom / CELL));
    return sat[r1 * stride + c1]! - sat[r0 * stride + c1]! - sat[r1 * stride + c0]! + sat[r0 * stride + c0]!;
  };
  const rings: Box[] = light.map(p => ({ left: p.x - RING, top: p.y - RING, right: p.x + RING, bottom: p.y + RING }));
  const near = light[Math.floor(light.length / 2)]; // the postcard stays near the middle of the light's way
  let best: { x: number; y: number; scale: number } | null = null;
  let bestCost = Infinity;
  for (const scale of SCALES) {
    const cw = w * scale, ch = h * scale;
    for (let y = EDGE; y <= H - EDGE - ch; y += STEP) {
      for (let x = EDGE; x <= W - EDGE - cw; x += STEP) {
        const box = { left: x, top: y, right: x + cw, bottom: y + ch };
        if (obstacles.some(o => overlaps(box, o, PAD)) || rings.some(r => overlaps(box, r))) continue;
        let cost = (1 - scale) * COST.smaller + covered(box) * COST.lit;
        if (disc) {
          const d = distance(disc.x, disc.y, box);
          if (d < disc.r) cost += COST.globe + (disc.r - d) * COST.inGlobe;
        }
        if (near) cost += distance(near.x, near.y, box) * COST.far;
        if (cost < bestCost) { bestCost = cost; best = { x, y, scale }; }
      }
    }
  }
  return best;
}

function Caption({ photo, venue }: { photo: WallPhoto; venue: Venue }) {
  if (photo.kind === 'ball') {
    return (
      <>
        <span className="photo-kicker">✦ {HERE[venue.key]}</span>
        <b>{photo.name}</b>
        <span className="photo-meta">Košice · {clock(photo.createdAt)}</span>
      </>
    );
  }
  const meta = [photo.country && photo.country !== photo.name ? photo.country : null, photo.visitKind ? visitLabel.get(photo.visitKind) : null].filter(Boolean);
  return (
    <>
      <span className="photo-kicker">✦ Fotka hosťa</span>
      <b>{photo.name}</b>
      {meta.length > 0 && <span className="photo-meta">{meta.join(' · ')}</span>}
    </>
  );
}

/** queued: when a new photo joined the queue (it keeps that time if it has to go back) */
interface Moment { photo: WallPhoto; fresh: boolean; queued: number; ready: boolean; failed: boolean; since: number }

export function PhotoMoments({ scene, slug, feed, stage, obstacles, venue }: {
  scene: WallScene | null; slug: string; feed: PhotoFeed | null; stage: Stage; obstacles: () => Box[]; venue: Venue;
}) {
  const [shown, setShown] = useState<{ photo: WallPhoto; src: string; size: { pw: number; ph: number } } | null>(null);
  const card = useRef<HTMLElement>(null);
  const lines = useRef<SVGSVGElement>(null);
  const line = useRef<SVGLineElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const rendered = useRef(''); // the photo in the page now: measured only once it is there
  useLayoutEffect(() => { rendered.current = shown?.photo.id ?? ''; }, [shown]);
  const obstaclesRef = useRef(obstacles);
  obstaclesRef.current = obstacles;

  // every photo on the wall, the new ones waiting for their turn, and when each was last shown
  const gallery = useRef(new Map<string, WallPhoto>());
  const queue = useRef<string[]>([]);
  const lastShown = useRef(new Map<string, number>());
  const queuedAt = useRef(new Map<string, number>()); // when each new photo joined the queue (performance.now)
  const loaded = useRef(false);
  const latestFeed = useRef(feed);
  latestFeed.current = feed;
  const syncing = useRef<{ running: boolean; again: boolean }>({ running: false, again: false });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // the feed brings the newest approvals; a count that differs from what the wall knows reloads the whole list
  useEffect(() => {
    if (!feed) return;
    const state = syncing.current;
    if (state.running) { state.again = true; return; } // the running sync goes again with the newest feed
    const add = (p: WallPhoto, fresh: boolean) => {
      gallery.current.set(p.id, p);
      if (fresh && !queue.current.includes(p.id)) {
        queue.current.push(p.id);
        queuedAt.current.set(p.id, performance.now());
      }
    };
    const reload = async (freshSince: number | null) => {
      const { photos } = await api.photos(slug);
      const ids = new Set(photos.map(p => p.id));
      for (const id of [...gallery.current.keys()]) if (!ids.has(id)) gallery.current.delete(id); // hidden or deleted
      // oldest first, so the queue keeps the order of approval
      for (const p of [...photos].reverse()) if (!gallery.current.has(p.id)) add(p, freshSince === null || Date.parse(p.approvedAt) > freshSince);
      queue.current = queue.current.filter(id => gallery.current.has(id));
    };
    const sync = async () => {
      state.running = true;
      try {
        const f = latestFeed.current;
        if (!f) return;
        if (!loaded.current) {
          await reload(Date.now() - FRESH_AT_LOAD_MS); // what was on the wall before this page counts as old
          loaded.current = true;
        }
        for (const p of [...f.latest].reverse()) if (!gallery.current.has(p.id)) add(p, true); // newly approved
        if (f.total !== gallery.current.size) await reload(null); // hidden, deleted, or more than the feed holds
      } catch { /* the next feed tries again */ } finally {
        state.running = false;
        if (state.again && mounted.current) { state.again = false; void sync(); }
      }
    };
    void sync();
  }, [feed, slug]);

  useEffect(() => {
    if (!scene) return;
    type Phase = 'idle' | 'load' | 'enter' | 'show' | 'leave' | 'gap';
    let phase: Phase = 'idle';
    let until = 0;
    let quietUntil = 0; // after the opening the lit map is seen first
    let nextAgain = performance.now() + FIRST_AGAIN_MS;
    let checkAt = 0;
    let moment: Moment | null = null;
    let box: Box | null = null; // where the postcard is, on screen
    let held = false; // the globe turns slower for this photo
    let raf = 0;

    const release = () => { if (held) { scene.setPhotoFocus(false); held = false; } };
    const end = (t: number) => {
      release();
      if (moment) lastShown.current.set(moment.photo.id, Date.now());
      moment = null;
      box = null;
      lines.current?.classList.remove('on');
      setShown(null);
      phase = 'gap';
      until = t + GAP_MS;
      nextAgain = t + AGAIN_MS;
    };
    // a new photo that could not finish goes back to the front of the queue
    const giveBack = () => {
      if (!moment?.fresh || phase === 'show' || phase === 'leave') return;
      queue.current.unshift(moment.photo.id);
      queuedAt.current.set(moment.photo.id, moment.queued);
    };

    /**
     * Whether the photo's light faces the viewer `delay` seconds from now and stays in view until its postcard has
     * flown back (the globe turns on meanwhile); now (delay 0) it must also be on screen and not under the title or
     * a panel. The flat map: always.
     */
    const inView = (photo: WallPhoto, delay: number, blocked: Box[]): boolean => {
      if (scene.flat()) return true;
      const lon = photo.lon + scene.turnIn(delay); // the camera moves west: places drift east
      if (scene.facing(photo.lat, lon) < IN_VIEW || scene.facing(photo.lat, lon + scene.turnWhileFocused(UP_S)) < STILL_IN_VIEW) return false;
      if (delay > 0) return true;
      const p = scene.screenPoint(photo.lat, photo.lon);
      return p.x > 0 && p.x < innerWidth && p.y > 0 && p.y < innerHeight && !blocked.some(o => inside(p.x, p.y, o));
    };

    /** The photo that has not been on the wall for the longest time (never shown first), not the one just shown. */
    const pickAgain = (ok: (p: WallPhoto) => boolean): string | undefined => {
      let best: string | undefined, bestAt = Infinity;
      for (const [id, p] of gallery.current) {
        const at = (lastShown.current.get(id) ?? 0) + Math.random(); // ties: any of them
        if (at < bestAt && !(gallery.current.size > 1 && at > Date.now() - AGAIN_MS) && ok(p)) { best = id; bestAt = at; }
      }
      return best;
    };

    /**
     * The next photo, or null to wait: a new one first, else (now and then) an older one. On the globe only one whose
     * light is in view (see inView); a new one waits for its light while that comes round within FRESH_WAIT_MS of
     * joining the queue, else it comes at once (its light is behind the globe: no line).
     */
    const choose = (t: number): { photo: WallPhoto; fresh: boolean; queued: number } | null => {
      const blocked = scene.flat() ? [] : obstaclesRef.current();
      const q = queue.current.filter(id => gallery.current.has(id));
      queue.current = q;
      if (q.length > 0) {
        let i = q.findIndex(id => inView(gallery.current.get(id)!, 0, blocked));
        if (i < 0) {
          const head = gallery.current.get(q[0]!)!;
          const left = FRESH_WAIT_MS - (t - (queuedAt.current.get(head.id) ?? t));
          for (let s = 2; s * 1000 <= left; s += 2) if (inView(head, s, blocked)) return null; // it comes round soon
          i = 0;
        }
        const id = q.splice(i, 1)[0]!;
        const queued = queuedAt.current.get(id) ?? t;
        queuedAt.current.delete(id);
        return { photo: gallery.current.get(id)!, fresh: true, queued };
      }
      if (t < nextAgain) return null;
      const id = pickAgain(p => inView(p, 0, blocked));
      return id ? { photo: gallery.current.get(id)!, fresh: false, queued: t } : null;
    };

    const leave = (t: number) => {
      const el = card.current;
      phase = 'leave';
      until = t + LEAVE_MS;
      lines.current?.classList.remove('on');
      if (!el) return;
      const to = el.style.transform;
      const p = moment && scene.screenPoint(moment.photo.lat, moment.photo.lon);
      // back into its light, where that is now (the globe has turned on), or it fades where it is
      const back = p && p.facing > 0.15 ? spark(p.x, p.y, el.offsetWidth, el.offsetHeight, tiltOf(moment!.photo.id)) : `${to} scale(0.92)`;
      el.animate([{ transform: to, opacity: 1 }, { transform: back, opacity: 0 }], { duration: LEAVE_MS, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' });
    };

    const enter = (t: number) => {
      const el = card.current;
      const m = moment!;
      if (!el) { end(t); return; }
      const w = el.offsetWidth, h = el.offsetHeight;
      const onScreen = (q: { x: number; y: number; facing: number }) => q.facing > 0.15 && q.x > 0 && q.x < innerWidth && q.y > 0 && q.y < innerHeight;
      const p = scene.screenPoint(m.photo.lat, m.photo.lon);
      const visible = onScreen(p);
      // the globe turns on while the postcard is up: where its light will be meanwhile (the map: where it is)
      const stay = (ENTER_MS + (m.fresh ? SHOW_NEW_MS : SHOW_AGAIN_MS) + LEAVE_MS) / 1000;
      const way = visible ? [0, 0.25, 0.5, 0.75, 1].map(k => scene.screenPoint(m.photo.lat, m.photo.lon + scene.turnWhileFocused(stay * k))).filter(onScreen) : [];
      const lit = [...scene.visibleCoop(), ...scene.guestPlaces()].map(q => scene.screenPoint(q.lat, q.lon)).filter(q => q.facing > 0);
      const spot = placeCard(w, h, way, obstaclesRef.current(), lit, scene.flat() ? null : scene.disc());
      if (!spot) { end(t); return; } // no room on this screen
      const tilt = tiltOf(m.photo.id);
      // transform-origin is the middle: translate puts the unscaled box, scale shrinks it around its middle
      const to = `translate(${Math.round(spot.x - (w * (1 - spot.scale)) / 2)}px, ${Math.round(spot.y - (h * (1 - spot.scale)) / 2)}px) scale(${spot.scale}) rotate(${tilt}deg)`;
      const sx = visible ? p.x : spot.x + (w * spot.scale) / 2, sy = visible ? p.y : spot.y + (h * spot.scale) / 2;
      const from = spark(sx, sy, w, h, tilt);
      box = { left: spot.x, top: spot.y, right: spot.x + w * spot.scale, bottom: spot.y + h * spot.scale };
      el.style.transform = to;
      el.classList.add('on');
      el.animate([
        { transform: from, opacity: 0 },
        { transform: from, opacity: 1, offset: 0.08 },
        { transform: to, opacity: 1 },
      ], { duration: ENTER_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      // the light the photo comes from flares up
      if (m.photo.kind === 'ball') scene.flare('coop', 'origin');
      else scene.flare('guest', pinKey(m.photo));
      phase = 'enter';
      until = t + ENTER_MS;
    };

    /** The ring at the light follows the place; on the globe a line joins it to the postcard. */
    const draw = () => {
      if (!moment || !box || !ring.current) return;
      const p = scene.screenPoint(moment.photo.lat, moment.photo.lon);
      const visible = p.facing > 0.15;
      ring.current.style.display = visible ? '' : 'none';
      ring.current.setAttribute('cx', String(p.x));
      ring.current.setAttribute('cy', String(p.y));
      if (!line.current) return;
      line.current.style.display = visible && !scene.flat() ? '' : 'none';
      const ax = Math.min(Math.max(p.x, box.left), box.right), ay = Math.min(Math.max(p.y, box.top + 16), box.bottom - 16);
      line.current.setAttribute('x1', String(p.x));
      line.current.setAttribute('y1', String(p.y));
      line.current.setAttribute('x2', String(ax));
      line.current.setAttribute('y2', String(ay));
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const busy = scene.busy(); // the light is spreading or going out (the 2D/3D cycle)
      if (busy && phase === 'load') { giveBack(); end(t); }
      else if (busy && (phase === 'enter' || phase === 'show')) leave(t);
      switch (phase) {
        case 'gap':
          if (t < until) break;
          phase = 'idle';
          stage.photo = queue.current.length > 0; // a burst of new photos keeps the stage
          break;
        case 'idle': {
          if (busy) { stage.photo = false; quietUntil = t + AFTER_REVEAL_MS; break; }
          if (t < quietUntil || t < checkAt) break;
          checkAt = t + CHECK_MS;
          const next = choose(t);
          if (!next) { stage.photo = false; break; } // place cards go on meanwhile
          const { photo, fresh, queued } = next;
          stage.photo = true;
          scene.setPhotoFocus(true); // the globe turns slower from now until the postcard has gone
          held = true;
          const m: Moment = { photo, fresh, queued, ready: false, failed: false, since: t };
          moment = m;
          const img = new Image();
          img.decoding = 'async';
          img.src = photoUrl(slug, photo.id);
          img.decode().then(() => { m.ready = true; }, () => { m.failed = true; });
          setShown({ photo, src: img.src, size: pictureSize(photo, scene.flat()) });
          phase = 'load';
          break;
        }
        case 'load': {
          const m = moment!;
          if (m.failed || t - m.since > LOAD_MS || !gallery.current.has(m.photo.id)) { end(t); break; }
          // the picture has loaded, the place card has left and the postcard is in the page to be measured
          if (!m.ready || stage.card || rendered.current !== m.photo.id) break;
          enter(t);
          break;
        }
        case 'enter':
          if (t < until) break;
          phase = 'show';
          until = t + (moment!.fresh ? SHOW_NEW_MS : SHOW_AGAIN_MS);
          lines.current?.classList.add('on');
          break;
        case 'show':
          // an admin hid it meanwhile: it leaves at once
          if (t > until || !gallery.current.has(moment!.photo.id)) leave(t);
          break;
        case 'leave':
          if (t >= until) end(t);
          break;
      }
      if (phase === 'enter' || phase === 'show' || phase === 'leave') draw();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      giveBack();
      release();
      stage.photo = false;
      setShown(null);
    };
  }, [scene, slug, stage]);

  if (!shown) return null;
  const style = { '--pw': `${shown.size.pw}px`, '--ph': `${shown.size.ph}px` } as CSSProperties;
  return (
    <>
      <svg ref={lines} className="photo-lines" aria-hidden="true">
        <line ref={line} />
        <circle ref={ring} className="photo-ring" r="18" />
      </svg>
      <figure ref={card} key={shown.photo.id} className="photo-card" style={style} role="status" aria-live="polite">
        <div className="photo-frame"><img src={shown.src} alt="" /></div>
        <figcaption><Caption photo={shown.photo} venue={venue} /></figcaption>
      </figure>
    </>
  );
}
