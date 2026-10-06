/**
 * The wall: what the LED screen at the ball shows. Open with ?kiosk=1 on the playback PC
 * (no links, no comment button, cursor hidden). ?k=CODE puts the event access code into the QR link.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EVENT } from '@ples/shared/constants';
import type { GlobePlace } from '@ples/shared';
import { useGlobeScene } from '../globe/useGlobeScene.ts';
import { CountUp } from '../components/CountUp.tsx';
import { GlobeTooltip } from '../components/GlobeTooltip.tsx';
import { PlaceSpotlight, type Box } from '../components/PlaceSpotlight.tsx';
import { QrCode } from '../components/QrCode.tsx';
import { Starfield } from '../components/Starfield.tsx';
import { useGlobeData } from '../lib/useGlobeData.ts';
import { useGuests } from '../lib/useGuests.ts';
import { Link, queryParam } from '../lib/router.tsx';
import './wall.css';


export default function Wall() {
  const kiosk = queryParam('kiosk') !== null;
  const slug = queryParam('event') ?? DEFAULT_EVENT;
  const code = queryParam('k');
  const { ref, scene } = useGlobeScene();
  const titleRef = useRef<HTMLElement>(null);
  const { data, error } = useGlobeData();
  const [visible, setVisible] = useState<GlobePlace[]>([]);
  const guests = useGuests(scene, slug);
  const mode = guests.event?.displayScene ?? 'cooperation';

  useEffect(() => {
    if (!scene || !data) return;
    scene.onCoopChange = setVisible;
    scene.setCooperation(data.places, { reveal: true });
  }, [scene, data]);

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

  // what the cards keep clear of: the title text while it is visible, the counters, the QR code and the buttons
  const obstacles = useCallback((): Box[] => {
    const rects: Box[] = [];
    const title = titleRef.current;
    if (title && Number(getComputedStyle(title).opacity) > 0.2) {
      for (const line of title.children) { // the text itself, the header box spans the whole width
        const range = document.createRange();
        range.selectNodeContents(line);
        rects.push(range.getBoundingClientRect());
      }
    }
    for (const sel of ['.wall-stats', '.wall-join', '.wall-nav', '.feedback-open']) {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      if (r && r.height > 0) rects.push(r); // hidden panels (narrow screens) have no size
    }
    return rects;
  }, []);

  const counts = useMemo(() => ({
    countries: new Set(visible.map(p => p.countryCode)).size,
    places: visible.length,
    institutions: visible.reduce((s, p) => s + p.institutions, 0),
  }), [visible]);

  const joinUrl = `${location.origin}/zapoj-sa${code ? `?k=${encodeURIComponent(code)}` : ''}`;
  const collecting = guests.available && (guests.event?.status === 'open' || guests.event?.status === 'live');

  return (
    <div className={`wall mode-${mode}${kiosk ? ' kiosk' : ''}`}>
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
        {mode === 'live' ? (
          <>
            <Stat value={guests.totals.pins} label="svetiel hostí" short="svetiel" warm />
            <Stat value={guests.totals.places} label="miest" />
            <Stat value={guests.totals.countries} label="krajín" />
          </>
        ) : (
          <>
            <Stat value={counts.countries} label="krajín" />
            <Stat value={counts.places} label="miest" />
            <Stat value={counts.institutions} label="partnerských inštitúcií" short="inštitúcií" />
            {guests.totals.pins > 0 && <Stat value={guests.totals.pins} label="svetiel hostí" short="svetiel" warm small />}
          </>
        )}
      </section>

      {collecting && (
        <aside className="wall-join">
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
          <button type="button" className="chip wall-replay" aria-label="Znova" onClick={() => scene?.replay()}>↻ <span>Znova (R)</span></button>
        </nav>
      )}
      {error && !data && <p className="wall-error error">{error}</p>}
    </div>
  );
}

/** short: the label on a phone, where the counters share one row */
function Stat({ value, label, short, warm, small }: { value: number; label: string; short?: string; warm?: boolean; small?: boolean }) {
  return (
    <div className={`stat${warm ? ' warm' : ''}${small ? ' small' : ''}`}>
      <CountUp value={value} />
      <span className="stat-long">{label}</span>
      <span className="stat-short">{short ?? label}</span>
    </div>
  );
}
