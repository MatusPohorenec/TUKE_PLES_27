/**
 * The wall: what the LED screen at the ball shows (/), or in the student lobby (/vestibul, its own database).
 * Open with ?kiosk=1 on the playback PC (no links, no comment button, cursor hidden). ?k=CODE puts the event
 * access code into the QR link.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GlobePlace } from '@ples/shared';
import { useGlobeScene } from '../globe/useGlobeScene.ts';
import { CountUp } from '../components/CountUp.tsx';
import { GlobeTooltip } from '../components/GlobeTooltip.tsx';
import { PlaceSpotlight, type Box } from '../components/PlaceSpotlight.tsx';
import { QrCode } from '../components/QrCode.tsx';
import { Starfield } from '../components/Starfield.tsx';
import { useGlobeData } from '../lib/useGlobeData.ts';
import { useGuests } from '../lib/useGuests.ts';
import { plural } from '../lib/format.ts';
import { Link, queryParam, useVenue } from '../lib/router.tsx';
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

/** Screen boxes of the elements that exist and have a size (hidden panels on narrow screens have none). */
function boxesOf(selectors: string[]): Box[] {
  return selectors.flatMap(sel => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r && r.height > 0 ? [r] : [];
  });
}

export default function Wall() {
  const kiosk = queryParam('kiosk') !== null;
  const venue = useVenue();
  const slug = queryParam('event') ?? venue.event;
  const code = queryParam('k');
  // ?view=2d shows the same wall on a flat world map (to compare readability with the globe)
  const view = queryParam('view') === '2d' ? '2d' : '3d';
  const { ref, scene } = useGlobeScene({ view });
  const otherView = (() => {
    const q = new URLSearchParams(location.search);
    if (view === '2d') q.delete('view'); else q.set('view', '2d');
    const s = q.toString();
    return location.pathname + (s ? `?${s}` : '');
  })();
  const titleRef = useRef<HTMLElement>(null);
  const { data, error } = useGlobeData();
  const [visible, setVisible] = useState<GlobePlace[]>([]);
  const guests = useGuests(scene, slug);
  const mode = guests.event?.displayScene ?? 'cooperation';

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
    scene.setCooperation(data.places, { reveal: true });
  }, [scene, data, onYear]);

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
    if (view !== '2d' || !scene) return;
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

  return (
    <div className={`wall mode-${mode} view-${view}${kiosk ? ' kiosk' : ''}`}>
      <div className="stage-light" />
      <Starfield />
      <div className="globe-host" ref={ref} />
      {!kiosk && <GlobeTooltip scene={scene} host={ref.current} />}
      <PlaceSpotlight scene={scene} obstacles={obstacles} />

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

      {!kiosk && (
        <nav className="wall-nav">
          <Link className="chip" href="/mapa">Preskúmať mapu</Link>
          <Link className="chip" href="/zapoj-sa">Zapoj sa</Link>
          <Link className="chip" href="/o-projekte">O projekte</Link>
          <a className="chip wall-view" href={otherView} title="Prepnúť medzi zemeguľou a mapou">{view === '2d' ? '3D' : '2D'}</a>
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
