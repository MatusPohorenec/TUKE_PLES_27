/**
 * The wall: what the LED screen at the ball shows (/), or in the student lobby (/vestibul, its own database).
 * It runs as a kiosk (no links, no comment button, cursor hidden, screen awake); ?kiosk=0 shows the links for tests.
 * On a phone, where the QR panel makes no sense, a button leads to the form instead. ?k=CODE puts the event access
 * code into the QR link.
 *
 * By default the wall alternates the flat map and the globe (the cycle below); ?view=2d or ?view=3d keeps one.
 * Guests' photos fly out of their lights as postcards (PhotoMoments); ?photos=0 leaves them out.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ORIGIN } from '@ples/shared/constants';
import type { GlobePlace } from '@ples/shared';
import { MapScene } from '../globe/map2d.ts';
import { GlobeScene } from '../globe/scene.ts';
import { CROSSFADE_MS, useGlobeScene, type View } from '../globe/useGlobeScene.ts';
import { CountUp } from '../components/CountUp.tsx';
import { GlobeTooltip } from '../components/GlobeTooltip.tsx';
import { PhotoMoments } from '../components/PhotoMoments.tsx';
import { PlaceSpotlight, type Box, type Stage } from '../components/PlaceSpotlight.tsx';
import { QrCode } from '../components/QrCode.tsx';
import { Starfield } from '../components/Starfield.tsx';
import { useGlobeData } from '../lib/useGlobeData.ts';
import { useGuests } from '../lib/useGuests.ts';
import { plural } from '../lib/format.ts';
import { Link, kioskMode, queryParam, useVenue } from '../lib/router.tsx';
import { pageOf } from '../lib/venue.ts';
import './wall.css';

/** Counter labels in the right Slovak form for the number (1 krajina, 3 krajiny, 86 krajín); short: on a phone. */
const LABELS = {
  countries: (n: number) => ({ label: plural(n, 'krajina', 'krajiny', 'krajín') }),
  places: (n: number) => ({ label: plural(n, 'miesto', 'miesta', 'miest') }),
  institutions: (n: number) => ({
    label: plural(n, 'partnerská inštitúcia', 'partnerské inštitúcie', 'partnerských inštitúcií'),
    short: plural(n, 'inštitúcia', 'inštitúcie', 'inštitúcií'),
  }),
  guests: (n: number) => ({ label: plural(n, 'svetlo hosťa', 'svetlá hostí', 'svetiel hostí'), short: plural(n, 'svetlo', 'svetlá', 'svetiel') }),
};

/** 2D: the smallest the QR panel gets to keep lit places free, and the room it keeps around them (px). */
const JOIN_MIN_SCALE = 0.5;
const JOIN_PAD = 8;

/**
 * The cycle of the ball's wall: the flat map opens (the timeline 1952 → 2027) and stays for holdMs; its lights go
 * out (the timeline backwards) and it turns into the globe, which opens the same way and makes `turns` turns; its
 * lights go out, it faces Košice and opens out into the flat map, which flies in to Košice, and it starts over.
 * On site without a new deploy: ?hold=<minutes> and ?turns=<number>; ?cycle=fast for a quick test.
 */
const CYCLE = { holdMs: 30 * 60_000, turns: 3, fadeS: 20 };
const FAST_CYCLE = { holdMs: 15_000, turns: 0.3, fadeS: 9 };
function cycleTiming() {
  const base = queryParam('cycle') === 'fast' ? FAST_CYCLE : CYCLE;
  const hold = Number(queryParam('hold')), turns = Number(queryParam('turns'));
  return { ...base, ...(hold > 0 ? { holdMs: hold * 60_000 } : {}), ...(turns > 0 ? { turns } : {}) };
}

/** Screen boxes of the elements that exist and have a size (hidden panels on narrow screens have none). */
function boxesOf(selectors: string[]): Box[] {
  return selectors.flatMap(sel => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r && r.height > 0 ? [r] : [];
  });
}

export default function Wall() {
  const kiosk = kioskMode(pageOf(location.pathname));
  const venue = useVenue();
  const slug = queryParam('event') ?? venue.event;
  const code = queryParam('k');
  // without ?view the flat map and the globe take turns (the cycle); ?view=2d or ?view=3d keeps one of them
  const viewParam = queryParam('view');
  const fixedView: View | null = viewParam === '2d' || viewParam === '3d' ? viewParam : null;
  const [cycleView, setCycleView] = useState<View>('2d');
  const view = fixedView ?? cycleView;
  const { ref, scene } = useGlobeScene({ view });
  /** the cycle has changed the scene: the next openings start after the cross-fade */
  const switched = useRef(false);
  const [switching, setSwitching] = useState(false);
  // the nav switches cycle → map only → globe only → cycle
  const nextMode = (() => {
    const q = new URLSearchParams(location.search);
    if (fixedView === null) q.set('view', '2d'); else if (fixedView === '2d') q.set('view', '3d'); else q.delete('view');
    const s = q.toString();
    return { href: location.pathname + (s ? `?${s}` : ''), label: fixedView === null ? '2D' : fixedView === '2d' ? '3D' : '2D ↔ 3D' };
  })();
  const titleRef = useRef<HTMLElement>(null);
  const { data, error } = useGlobeData();
  const [visible, setVisible] = useState<GlobePlace[]>([]);
  const guests = useGuests(scene, slug);
  const mode = guests.event?.displayScene ?? 'cooperation';
  // the guests' photos and the place cards take turns in front (photos first)
  const stage = useRef<Stage>({ photo: false, card: false }).current;
  const photos = queryParam('photos') !== '0';

  // the opening runs through the years; a milestone stays readable for a few seconds after its year
  const [year, setYear] = useState<{ year: number; milestone: string | null } | null>(null);
  const shownYear = useRef<{ year: number; milestone: string | null }>({ year: 0, milestone: null });
  const milestoneTimer = useRef(0);
  const onYear = useCallback((y: number | null, milestone: string | null) => {
    if (y === null) { setYear(null); return; }
    if (milestone) {
      clearTimeout(milestoneTimer.current);
      milestoneTimer.current = window.setTimeout(() => setYear(v => v && { ...v, milestone: null }), 3200);
    }
    // the milestone keeps its own year in front, because the counter runs on while it is shown
    setYear(v => ({ year: y, milestone: milestone ? `${y} · ${milestone}` : v?.milestone ?? null }));
  }, []);
  useEffect(() => () => clearTimeout(milestoneTimer.current), []);
  if (year) shownYear.current = year; // keeps the last year on screen while it fades out
  // after the fade the year leaves the layout, so the counters (and the cards' free space) are as before
  const [yearShown, setYearShown] = useState(false);
  useEffect(() => {
    if (year) { setYearShown(true); return; }
    const timer = window.setTimeout(() => setYearShown(false), 900);
    return () => clearTimeout(timer);
  }, [year]);

  useEffect(() => {
    if (!scene || !data) return;
    scene.onCoopChange = setVisible;
    scene.onYear = onYear;
    // after a change of scene the opening waits for the cross-fade, and the flat map first flies in to Košice
    const flat = scene instanceof MapScene;
    scene.setCooperation(data.places, switched.current ? { reveal: true, delay: flat ? 4 : 2.4, zoomIn: flat } : { reveal: true });
  }, [scene, data, onYear]);

  // the cycle: opening, hold (the map: a while; the globe: a few turns), the lights go out, the other view
  useEffect(() => {
    if (fixedView || !scene || !data) return;
    // right after the view changed the old scene is still the current one: wait for the new one
    if (view === '3d' ? !(scene instanceof GlobeScene) : !(scene instanceof MapScene)) return;
    const timing = cycleTiming();
    let cancelled = false;
    const timers = new Set<number>();
    const sleep = (ms: number) => new Promise<void>(resolve => {
      const id = window.setTimeout(() => { timers.delete(id); resolve(); }, ms);
      timers.add(id);
    });
    const until = async (done: () => boolean) => { while (!cancelled && !done()) await sleep(1000); };
    (async () => {
      await until(() => !scene.revealing());
      if (scene instanceof GlobeScene) {
        scene.resetTurns();
        await until(() => scene.turns() >= timing.turns);
      } else {
        await sleep(timing.holdMs);
      }
      if (cancelled) return;
      await sleep(scene.fadeOut(timing.fadeS) * 1000 + 1500);
      if (cancelled) return;
      if (scene instanceof GlobeScene) {
        scene.turnTo(ORIGIN.lat, ORIGIN.lon, 2500);
        await sleep(2700);
      }
      if (cancelled) return;
      setSwitching(true); // the QR panel fades out before it changes its place
      await sleep(700);
      if (cancelled) return;
      switched.current = true;
      setCycleView(v => (v === '2d' ? '3d' : '2d'));
    })();
    return () => { cancelled = true; for (const id of timers) clearTimeout(id); };
  }, [fixedView, scene, data, view]);

  useEffect(() => {
    if (!switching) return;
    const id = window.setTimeout(() => setSwitching(false), CROSSFADE_MS);
    return () => clearTimeout(id);
  }, [switching, view]);

  useEffect(() => { scene?.setMode(mode); }, [scene, mode]);

  useEffect(() => {
    if (!scene || !titleRef.current) return;
    // on a phone the counters span the screen under the globe: the globe ends above them
    const bottom = () => {
      const stats = document.querySelector('.wall-stats')?.getBoundingClientRect();
      return stats && stats.width > innerWidth * 0.5 ? stats.top - 14 : null;
    };
    scene.attachTitle(titleRef.current, { bottomGap: kiosk ? 20 : 28, bottom });
  }, [scene, kiosk]);

  // replay the reveal with R (handy when rehearsing on the venue screen)
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'r') scene?.replay(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [scene]);

  // kiosk: keep the screen awake and hide the cursor when idle
  useEffect(() => {
    if (!kiosk) return;
    let lock: WakeLockSentinel | undefined;
    navigator.wakeLock?.request('screen').then(l => { lock = l; }).catch(() => {});
    let timer = 0;
    const show = () => { document.body.style.cursor = ''; clearTimeout(timer); timer = window.setTimeout(() => { document.body.style.cursor = 'none'; }, 3000); };
    show();
    addEventListener('pointermove', show);
    return () => { lock?.release().catch(() => {}); removeEventListener('pointermove', show); clearTimeout(timer); document.body.style.cursor = ''; };
  }, [kiosk]);

  // the title text while it is visible (the text itself: the header box spans the whole width)
  const titleBoxes = useCallback((): Box[] => {
    const title = titleRef.current;
    if (!title || Number(getComputedStyle(title).opacity) <= 0.2) return [];
    return [...title.children].map(line => {
      const range = document.createRange();
      range.selectNodeContents(line);
      return range.getBoundingClientRect();
    });
  }, []);

  // what the cards keep clear of: the title text while it is visible, the counters, the QR code and the buttons
  const obstacles = useCallback(
    (): Box[] => [...titleBoxes(), ...boxesOf(['.wall-stats', '.wall-join', '.wall-nav', '.feedback-open'])],
    [titleBoxes],
  );

  // 2D: how much room the top right corner has depends on the screen (the LED wall's resolution is not known yet), so
  // once the light has spread the QR panel shrinks until no lit place, the title or a button lies under it
  const joinRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (view !== '2d' || !(scene instanceof MapScene)) return;
    const fit = () => {
      const el = joinRef.current;
      if (!el || !el.offsetWidth || scene.revealing()) return;
      const box = el.getBoundingClientRect(); // its top right corner stays put at any scale (transform-origin)
      const w = el.offsetWidth, h = el.offsetHeight; // unscaled size
      const lit = [...scene.visibleCoop(), ...scene.guestPlaces()].map(p => scene.screenPoint(p.lat, p.lon)).filter(p => p.facing > 0);
      const others = [...titleBoxes(), ...boxesOf(['.wall-nav', '.feedback-open'])];
      let scale = JOIN_MIN_SCALE;
      for (let s = 1; s >= JOIN_MIN_SCALE - 1e-6; s = Math.round((s - 0.05) * 100) / 100) {
        const r = { left: box.right - w * s - JOIN_PAD, right: box.right + JOIN_PAD, top: box.top - JOIN_PAD, bottom: box.top + h * s + JOIN_PAD };
        if (lit.some(p => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom)) continue;
        if (others.some(b => b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top)) continue;
        scale = s;
        break;
      }
      if (el.style.getPropertyValue('--join-scale') !== String(scale)) el.style.setProperty('--join-scale', String(scale));
    };
    fit();
    const timer = window.setInterval(fit, 2000); // guests add lights and names; after the opening the map settles
    addEventListener('resize', fit);
    return () => { clearInterval(timer); removeEventListener('resize', fit); };
  }, [view, scene, titleBoxes]);

  const counts = useMemo(() => ({
    countries: new Set(visible.map(p => p.countryCode)).size,
    places: visible.length,
    institutions: visible.reduce((s, p) => s + p.institutions, 0),
  }), [visible]);

  // the QR leads to the form of this wall's venue, so the lights land in its database
  const joinUrl = `${location.origin}${venue.prefix}/zapoj-sa${code ? `?k=${encodeURIComponent(code)}` : ''}`;
  const collecting = guests.available && (guests.event?.status === 'open' || guests.event?.status === 'live');

  // a phone shows the wall without the QR panel: a button leads to the form (the links stay hidden in kiosk mode)
  const phoneJoin = kiosk && collecting;

  return (
    <div className={`wall mode-${mode} view-${view}${kiosk ? ' kiosk' : ''}${phoneJoin ? ' joinable' : ''}${switching ? ' switching' : ''}`}>
      <div className="stage-light" />
      <Starfield />
      <div className="globe-host" ref={ref} />
      {!kiosk && <GlobeTooltip scene={scene} host={ref.current} />}
      <PlaceSpotlight scene={scene} obstacles={obstacles} stage={stage} />
      {photos && <PhotoMoments scene={scene} slug={slug} feed={guests.photos} stage={stage} obstacles={obstacles} venue={venue} />}

      <header className="wall-title title-block" ref={titleRef}>
        <small>TECHNICKÁ UNIVERZITA V KOŠICIACH</small>
        <h1>rozsvieťme mapu sveta</h1>
      </header>

      <section className="wall-stats" aria-label="Počty">
        {yearShown && (
          <div className={`wall-year${year ? ' on' : ''}`} aria-hidden={!year}>
            <b>{shownYear.current.year || ''}</b>
            <span key={shownYear.current.milestone ?? ''}>{shownYear.current.milestone ?? ''}</span>
          </div>
        )}
        {mode === 'live' ? (
          <>
            <Stat value={guests.totals.pins} labels={LABELS.guests} warm />
            <Stat value={guests.totals.places} labels={LABELS.places} />
            <Stat value={guests.totals.countries} labels={LABELS.countries} />
          </>
        ) : (
          <>
            <Stat value={counts.countries} labels={LABELS.countries} />
            <Stat value={counts.places} labels={LABELS.places} />
            <Stat value={counts.institutions} labels={LABELS.institutions} />
            {guests.totals.pins > 0 && <Stat value={guests.totals.pins} labels={LABELS.guests} warm small />}
          </>
        )}
      </section>

      {collecting && (
        <aside className="wall-join" ref={joinRef}>
          <QrCode value={joinUrl} size={kiosk ? 150 : 112} />
          <div>
            <b>Pridaj svoje svetlo</b>
            <span>Naskenuj kód a označ, kde všade si bol/a.</span>
            {guests.recent.length > 0 && (
              <ul className="wall-recent" aria-live="polite">
                {guests.recent.slice(0, 3).map(p => <li key={p.id}>{p.name}</li>)}
              </ul>
            )}
          </div>
        </aside>
      )}

      {phoneJoin && <Link className="button wall-join-phone" href={`/zapoj-sa${code ? `?k=${encodeURIComponent(code)}` : ''}`}>Pridaj svoje svetlo</Link>}

      {!kiosk && (
        <nav className="wall-nav">
          <Link className="chip" href="/mapa">Preskúmať mapu</Link>
          <Link className="chip" href="/zapoj-sa">Zapoj sa</Link>
          <Link className="chip" href="/o-projekte">O projekte</Link>
          <a className="chip wall-view" href={nextMode.href} title="Prepnúť: striedanie mapy a zemegule → len mapa → len zemeguľa">{nextMode.label}</a>
          <button type="button" className="chip wall-replay" aria-label="Znova" onClick={() => scene?.replay()}>↻ <span>Znova (R)</span></button>
        </nav>
      )}
      {error && !data && <p className="wall-error error">{error}</p>}
    </div>
  );
}

/** labels(n): the label for the number on screen (short: on a phone, where the counters share one row) */
function Stat({ value, labels, warm, small }: { value: number; labels: (n: number) => { label: string; short?: string }; warm?: boolean; small?: boolean }) {
  // the labels follow the number on screen, not the target the counter runs to, so "3 krajiny" never reads "3 krajín";
  // they are written like the number (no re-render per frame), also when a span attaches after the first number
  const shown = useRef(value);
  const long = useRef<HTMLSpanElement | null>(null);
  const brief = useRef<HTMLSpanElement | null>(null);
  const apply = useCallback(() => {
    const { label, short = label } = labels(shown.current);
    if (long.current && long.current.textContent !== label) long.current.textContent = label;
    if (brief.current && brief.current.textContent !== short) brief.current.textContent = short;
  }, [labels]);
  const show = useCallback((n: number) => { shown.current = n; apply(); }, [apply]);
  return (
    <div className={`stat${warm ? ' warm' : ''}${small ? ' small' : ''}`}>
      <CountUp value={value} onShow={show} />
      <span className="stat-long" ref={el => { long.current = el; apply(); }} />
      <span className="stat-short" ref={el => { brief.current = el; apply(); }} />
    </div>
  );
}
