/** Search box over the GeoNames gazetteer and countries; Slovak and English names both work ("Viedeň", "Vienna"). */
import { useEffect, useId, useRef, useState } from 'react';
import type { GazetteerHit } from '@ples/shared';
import { api } from '../lib/api.ts';

export const hitKey = (h: GazetteerHit) => (h.kind === 'city' ? `g${h.geonameId}` : `c${h.countryCode}`);

export function PlaceSearch({ onPick, disabled }: { onPick: (hit: GazetteerHit) => void; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<GazetteerHit[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setState('idle'); return; }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      setState('loading');
      api.search(term, ctrl.signal)
        .then(r => { setHits(r.hits); setActive(0); setState('idle'); })
        .catch(err => { if (!ctrl.signal.aborted) { setHits([]); setState(err?.status === 503 ? 'error' : 'error'); } });
    }, 180);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q]);

  const pick = (h: GazetteerHit) => { onPick(h); setQ(''); setHits([]); input.current?.focus(); };

  return (
    <div className="place-search">
      <label htmlFor={`${listId}-input`} className="sr-only">Mesto alebo krajina</label>
      <input
        id={`${listId}-input`}
        ref={input}
        type="search"
        inputMode="search"
        autoComplete="off"
        placeholder="Mesto alebo krajina, napr. Viedeň, Nice, Japonsko"
        value={q}
        disabled={disabled}
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && hits[active]) { e.preventDefault(); pick(hits[active]!); }
        }}
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {state === 'loading' && <span className="place-search-state muted">Hľadám…</span>}
      {state === 'error' && <p className="error">Vyhľadávanie teraz nefunguje. Skús to o chvíľu.</p>}
      {hits.length > 0 && (
        <ul id={listId} role="listbox" className="place-hits">
          {hits.map((h, i) => (
            <li key={hitKey(h)} role="option" aria-selected={i === active}>
              <button type="button" onClick={() => pick(h)} onMouseEnter={() => setActive(i)} className={i === active ? 'active' : ''}>
                <span>{h.name}</span>
                <span className="muted">{h.kind === 'country' ? 'celá krajina' : h.country}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && state === 'idle' && hits.length === 0 && <p className="muted">Nič sme nenašli. Skús iný názov alebo celú krajinu.</p>}
    </div>
  );
}
