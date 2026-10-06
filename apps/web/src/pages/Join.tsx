/**
 * Guest form (QR code at the ball -> /zapoj-sa?k=CODE): pick places, say what you did there, send.
 * Mobile first. No name, no e-mail.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_EVENT, FACULTIES, LIMITS, PERSON_ROLES, VISIT_KINDS, type FacultyCode, type PersonRole, type VisitKind } from '@ples/shared/constants';
import type { EventInfo, GazetteerHit, SubmitResponse } from '@ples/shared';
import { PlaceSearch, hitKey } from '../components/PlaceSearch.tsx';
import { ApiError, api } from '../lib/api.ts';
import { Link, queryParam } from '../lib/router.tsx';
import './join.css';

function useEventCode(): [string, (v: string) => void] {
  const [code, setCode] = useState(() => {
    const fromUrl = queryParam('k');
    try {
      if (fromUrl) sessionStorage.setItem('ples-code', fromUrl);
      return fromUrl ?? sessionStorage.getItem('ples-code') ?? '';
    } catch { return fromUrl ?? ''; }
  });
  return [code, setCode];
}

export default function Join() {
  const slug = queryParam('event') ?? DEFAULT_EVENT;
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [eventError, setEventError] = useState('');
  const [code, setCode] = useEventCode();
  const [places, setPlaces] = useState<GazetteerHit[]>([]);
  const [visitKind, setVisitKind] = useState<VisitKind | ''>('');
  const [role, setRole] = useState<PersonRole | ''>('');
  const [faculty, setFaculty] = useState<FacultyCode | ''>('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<SubmitResponse | null>(null);

  useEffect(() => {
    api.event(slug).then(setEvent).catch((err: ApiError) => setEventError(err.status === 503 || err.status === 404
      ? 'Zbieranie svetiel ešte nie je spustené. Skús to bližšie k plesu.'
      : err.message));
  }, [slug]);

  const add = (h: GazetteerHit) => setPlaces(list => (list.some(p => hitKey(p) === hitKey(h)) || list.length >= LIMITS.placesPerSubmission ? list : [...list, h]));
  const remove = (h: GazetteerHit) => setPlaces(list => list.filter(p => hitKey(p) !== hitKey(h)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!places.length) { setError('Vyber aspoň jedno miesto.'); return; }
    if (!visitKind) { setError('Vyber, čo si tam robil/a.'); return; }
    setSending(true);
    setError('');
    try {
      const res = await api.submit(slug, {
        code: code || undefined,
        places: places.map(p => (p.kind === 'city' ? { geonameId: p.geonameId! } : { countryCode: p.countryCode })),
        visitKind,
        role: role || undefined,
        faculty: faculty || undefined,
      });
      setDone(res);
      setPlaces([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const undo = async () => {
    if (!done) return;
    try { await api.undo(slug, done.submissionId); setDone(null); } catch (err) { setError((err as Error).message); }
  };

  const closed = event && (event.status === 'closed' || event.status === 'draft');
  const needsCode = event?.requiresCode && !code;

  return (
    <main className="join">
      <div className="stage-light" />
      <header className="join-head">
        <Link href="/" className="join-brand">TUKE · Ples 2027</Link>
        <h1>Rozsvieť svoje miesta</h1>
        <p>Kde všade ťa štúdium, práca alebo cesty zaviedli? Každé miesto sa ako svetlo rozletí z Košíc na zemeguľu na stene.</p>
      </header>

      {eventError && <p className="join-note">{eventError}</p>}
      {closed && <p className="join-note">Pridávanie svetiel je už zatvorené. Ďakujeme všetkým, ktorí sa zapojili.</p>}

      {done ? (
        <section className="join-card join-done" aria-live="polite">
          <h2>Tvoje svetlá letia na stenu</h2>
          <ul className="join-chips">{done.pins.map(p => <li key={p.id} className="join-chip lit">{p.name}</li>)}</ul>
          <p className="muted">Pozri sa na zemeguľu, o pár sekúnd sa rozsvietia.</p>
          <div className="join-actions">
            <button type="button" className="button" onClick={() => setDone(null)}>Pridať ďalšie miesta</button>
            <button type="button" className="button ghost" onClick={undo}>Vrátiť späť</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      ) : event && !closed && (
        <form className="join-card" onSubmit={submit} noValidate>
          {needsCode && (
            <div className="join-field">
              <label htmlFor="join-code">Kód z QR</label>
              <input id="join-code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Kód je na stoloch a pri vstupe" autoCapitalize="characters" />
            </div>
          )}

          <fieldset className="join-field">
            <legend>1. Kde si bol/a?</legend>
            <PlaceSearch onPick={add} disabled={places.length >= LIMITS.placesPerSubmission} />
            {places.length > 0 && (
              <ul className="join-chips" aria-label="Vybrané miesta">
                {places.map(p => (
                  <li key={hitKey(p)} className="join-chip">
                    {p.name}{p.kind === 'city' && <span className="muted"> · {p.country}</span>}
                    <button type="button" onClick={() => remove(p)} aria-label={`Odstrániť ${p.name}`}>×</button>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">Najviac {LIMITS.placesPerSubmission} miest naraz. Ďalšie pridáš v novom odoslaní.</p>
          </fieldset>

          <fieldset className="join-field">
            <legend>2. Čo si tam robil/a?</legend>
            <div className="join-options">
              {VISIT_KINDS.map(k => (
                <label key={k.code} className={`join-option${visitKind === k.code ? ' on' : ''}`}>
                  <input type="radio" name="visitKind" value={k.code} checked={visitKind === k.code} onChange={() => setVisitKind(k.code)} />
                  {k.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="join-field">
            <legend>3. Kto si? <span className="muted">(nepovinné)</span></legend>
            <div className="join-options">
              {PERSON_ROLES.map(r => (
                <label key={r.code} className={`join-option${role === r.code ? ' on' : ''}`}>
                  <input type="radio" name="role" value={r.code} checked={role === r.code} onChange={() => setRole(r.code)} />
                  {r.label}
                </label>
              ))}
            </div>
            {role && role !== 'guest' && (
              <select aria-label="Fakulta" value={faculty} onChange={e => setFaculty(e.target.value as FacultyCode | '')}>
                <option value="">Fakulta (nepovinné)</option>
                {FACULTIES.map(f => <option key={f.code} value={f.code}>{f.code} – {f.label}</option>)}
              </select>
            )}
          </fieldset>

          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="button join-submit" disabled={sending || !places.length || !visitKind}>
            {sending ? 'Posielam…' : places.length ? `Rozsvietiť ${places.length === 1 ? '1 miesto' : `${places.length} ${places.length < 5 ? 'miesta' : 'miest'}`}` : 'Rozsvietiť'}
          </button>
          <p className="muted small">Neukladáme meno ani e-mail. Na mapu idú len vybrané miesta a voliteľné údaje vyššie, anonymne.</p>
        </form>
      )}

      <footer className="join-foot">
        <Link href="/mapa">Kde všade spolupracuje TUKE →</Link>
      </footer>
    </main>
  );
}
