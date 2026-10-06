/** Interactive map for the web and for reviewers: filters, hover cards, institutions of a place. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATEGORY_GROUPS, DEFAULT_EVENT, type GroupCode } from '@ples/shared/constants';
import type { GlobePlace, PlaceDetail } from '@ples/shared';
import { useGlobeScene } from '../globe/useGlobeScene.ts';
import type { PickResult } from '../globe/scene.ts';
import { GlobeTooltip } from '../components/GlobeTooltip.tsx';
import { Starfield } from '../components/Starfield.tsx';
import { api } from '../lib/api.ts';
import { useGlobeData } from '../lib/useGlobeData.ts';
import { useGuests } from '../lib/useGuests.ts';
import { Link } from '../lib/router.tsx';
import './map.css';

export default function MapPage() {
  const { ref, scene } = useGlobeScene({ autoRotateSpeed: 0.3 });
  const { data } = useGlobeData();
  const guests = useGuests(scene, DEFAULT_EVENT, { intervalMs: 5000 });
  const [active, setActive] = useState<Set<GroupCode>>(new Set(CATEGORY_GROUPS.map(g => g.code)));
  const [detail, setDetail] = useState<{ place: GlobePlace; data?: PlaceDetail; error?: string } | null>(null);

  useEffect(() => { if (scene && data) scene.setCooperation(data.places); }, [scene, data]);
  useEffect(() => { scene?.setGroups(active); }, [scene, active]);

  const counts = useMemo(() => {
    const m = new Map<GroupCode, number>();
    for (const p of data?.places ?? []) for (const g of p.groups) m.set(g, (m.get(g) ?? 0) + 1);
    return m;
  }, [data]);

  const toggle = (g: GroupCode) => setActive(prev => {
    const next = new Set(prev);
    if (next.has(g)) next.delete(g); else next.add(g);
    return next;
  });

  const onPick = useCallback((hit: PickResult | null) => {
    if (hit?.kind !== 'coop') return;
    const place = hit.place;
    setDetail({ place });
    api.place(place.id).then(d => setDetail(cur => (cur?.place.id === place.id ? { place, data: d } : cur)))
      .catch(err => setDetail(cur => (cur?.place.id === place.id ? { place, error: (err as Error).message } : cur)));
  }, []);

  return (
    <div className="map">
      <div className="stage-light" />
      <Starfield />
      <div className="globe-host" ref={ref} />
      <GlobeTooltip scene={scene} host={ref.current} onPick={onPick} />

      <header className="map-head">
        <Link href="/" className="map-back">← Stena</Link>
        <div>
          <h1>Mapa spolupráce TUKE</h1>
          {data && (
            <p className="muted">
              {data.stats.places.toLocaleString('sk')} miest v {data.stats.countries} krajinách · {data.stats.institutions.toLocaleString('sk')} inštitúcií
              {guests.totals.pins > 0 && <> · <span style={{ color: 'var(--warm)' }}>{guests.totals.pins} svetiel hostí</span></>}
            </p>
          )}
        </div>
      </header>

      <div className="map-legend" role="group" aria-label="Filtrovať podľa typu spolupráce">
        {CATEGORY_GROUPS.filter(g => counts.get(g.code)).map(g => (
          <button key={g.code} type="button" className={`chip${active.has(g.code) ? '' : ' off'}`} style={{ color: g.color }}
            aria-pressed={active.has(g.code)} onClick={() => toggle(g.code)}>
            <i /><span style={{ color: 'var(--silver)' }}>{g.label} <em>{counts.get(g.code)}</em></span>
          </button>
        ))}
        {guests.totals.pins > 0 && <span className="chip" style={{ color: 'var(--warm)', cursor: 'default' }}><i /><span style={{ color: 'var(--silver)' }}>Svetlá hostí <em>{guests.totals.places}</em></span></span>}
      </div>

      {detail && (
        <aside className="map-detail" aria-label={`Detail: ${detail.place.name}`}>
          <button type="button" className="map-close" onClick={() => setDetail(null)} aria-label="Zavrieť">×</button>
          <h2>{detail.place.name}</h2>
          <p className="muted">{detail.place.country} · {detail.place.distanceKm.toLocaleString('sk')} km od Košíc</p>
          {detail.error && <p className="error">{detail.error}</p>}
          {!detail.data && !detail.error && <p className="muted">Načítavam…</p>}
          {detail.data && (
            <ul className="map-inst">
              {detail.data.institutions.map(inst => (
                <li key={inst.name}>
                  <b>{inst.name}</b>
                  <ul>
                    {inst.links.map((l, i) => (
                      <li key={i}>
                        <span>{l.category}</span>
                        {l.detail && <span className="muted"> – {l.detail}</span>}
                        {l.tukeUnits.length > 0 && <span className="muted"> · {l.tukeUnits.join(', ')}</span>}
                        {' '}<a href={l.sourceUrl} target="_blank" rel="noreferrer">zdroj</a>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}
