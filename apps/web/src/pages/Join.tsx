/**
 * Guest form (QR code at the ball -> /zapoj-sa?k=CODE, in the student lobby -> /vestibul/zapoj-sa?k=CODE):
 * pick places, say what you did there, send. The lights go to the venue's own database. Mobile first.
 * No name, no e-mail. Below the form a guest may add a photo to one of their lights, or one from the ball
 * (PhotoPanel), unless the admin switched photos off.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { FACULTIES, LIMITS, PERSON_ROLES, VISIT_KINDS, type FacultyCode, type PersonRole, type VenueKey, type VisitKind } from '@ples/shared/constants';
import type { EventInfo, GazetteerHit, LivePin, SubmitResponse } from '@ples/shared';
import { PhotoPanel, type LitPlace } from '../components/PhotoPanel.tsx';
import { PlaceSearch, hitKey } from '../components/PlaceSearch.tsx';
import { ApiError, api } from '../lib/api.ts';
import { store } from '../lib/device.ts';
import { Link, queryParam, useVenue } from '../lib/router.tsx';
import './join.css';

/** The lights sent from this browser, newest first: a photo can go with each (the API checks they are this browser's). */
function useLitPlaces(venue: VenueKey): [LitPlace[], (add: LivePin[]) => void, (remove: LivePin[]) => void] {
  const key = `ples-lit-${venue}`;
  const [lit, setLit] = useState<LitPlace[]>(() => store.get<LitPlace[]>(key) ?? []);
  const save = (list: LitPlace[]) => { store.set(key, list); return list; };
  const add = (pins: LivePin[]) => setLit(list => save([
    ...pins.map(p => ({ pinId: p.id, name: p.name, countryCode: p.countryCode })),
    ...list.filter(l => !pins.some(p => p.name === l.name && p.countryCode === l.countryCode)), // one button per place
  ].slice(0, 12)));
  const remove = (pins: LivePin[]) => setLit(list => save(list.filter(l => !pins.some(p => p.id === l.pinId))));
  return [lit, add, remove];
}

/** The access code from the QR link, kept for the tab per venue (each venue's event has its own code). */
function useEventCode(venue: VenueKey): [string, (v: string) => void] {
  const key = venue === 'ples' ? 'ples-code' : `ples-code-${venue}`;
  const [code, setCode] = useState(() => {
    const fromUrl = queryParam('k');
    try {
      if (fromUrl) sessionStorage.setItem(key, fromUrl);
      return fromUrl ?? sessionStorage.getItem(key) ?? '';
    } catch { return fromUrl ?? ''; }
  });
  return [code, setCode];
}

export default function Join() {
  const venue = useVenue();
  const slug = queryParam('event') ?? venue.event;
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [eventError, setEventError] = useState('');
  const [code, setCode] = useEventCode(venue.key);
  const [places, setPlaces] = useState<GazetteerHit[]>([]);
  const [visitKind, setVisitKind] = useState<VisitKind | ''>('');
  const [role, setRole] = useState<PersonRole | ''>('');
  const [faculty, setFaculty] = useState<FacultyCode | ''>('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<SubmitResponse | null>(null);
  const [notice, setNotice] = useState(''); // after an undo: what happened to the lights
  const [lit, addLit, removeLit] = useLitPlaces(venue.key);

  useEffect(() => {
    api.event(slug).then(setEvent).catch((err: ApiError) => setEventError(err.status === 503 || err.status === 404
      ? `Zbieranie svetiel ešte nie je spustené. ${venue.key === 'ples' ? 'Skús to bližšie k plesu.' : 'Skús to neskôr.'}`
      : err.message));
  }, [slug, venue.key]);

  const add = (h: GazetteerHit) => setPlaces(list => (list.some(p => hitKey(p) === hitKey(h)) || list.length >= LIMITS.placesPerSubmission ? list : [...list, h]));
  const remove = (h: GazetteerHit) => setPlaces(list => list.filter(p => hitKey(p) !== hitKey(h)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!places.length) { setError('Vyber aspoň jedno miesto.'); return; }
    if (!visitKind) { setError('Vyber, čo si tam robil/a.'); return; }
    setSending(true);
    setError('');
    setNotice('');
    try {
      const res = await api.submit(slug, {
        code: code || undefined,
        places: places.map(p => (p.kind === 'city' ? { geonameId: p.geonameId! } : { countryCode: p.countryCode })),
        visitKind,
        role: role || undefined,
        faculty: faculty || undefined,
      });
      setDone(res);
      addLit(res.pins);
      setPlaces([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  // takes the lights of the last sending off the wall again (a wrong place); the form stays empty for a new try
  const undo = async () => {
    if (!done) return;
    const one = done.pins.length === 1;
    try {
      await api.undo(slug, done.submissionId);
      removeLit(done.pins); // their photos are gone with them
      setDone(null);
      setNotice(one ? 'Svetlo sme zrušili, zo steny zmizne o pár sekúnd.' : 'Svetlá sme zrušili, zo steny zmiznú o pár sekúnd.');
    } catch (err) { setError((err as Error).message); }
  };

  const closed = event && (event.status === 'closed' || event.status === 'draft');
  const needsCode = event?.requiresCode && !code;
  const photos = event && !closed && event.photos !== 'off';

  return (
    <main className="join">
      <div className="stage-light" />
      <header className="join-head">
        <Link href="/" className="join-brand">{venue.brand}</Link>
        <h1>Rozsvieť svoje miesta</h1>
        <p>Kde všade ťa štúdium, práca alebo cesty zaviedli? Každé miesto sa ako svetlo rozletí z Košíc na zemeguľu na stene.</p>
      </header>

      {eventError && <p className="join-note">{eventError}</p>}
      {closed && <p className="join-note">Pridávanie svetiel je už zatvorené. Ďakujeme všetkým, ktorí sa zapojili.</p>}

      {done ? (
        <section className="join-card join-done" aria-live="polite">
          <h2>{done.pins.length === 1 ? 'Tvoje svetlo letí na stenu' : 'Tvoje svetlá letia na stenu'}</h2>
          <ul className="join-chips">{done.pins.map(p => <li key={p.id} className="join-chip lit">{p.name}</li>)}</ul>
          <p className="muted">
            Pozri sa na zemeguľu, o pár sekúnd sa {done.pins.length === 1 ? 'rozsvieti' : 'rozsvietia'}.
            {photos && ' Máš odtiaľ fotku? Pridaj ju nižšie, ukáže sa na stene pri svojom svetle.'}
          </p>
          <div className="join-actions">
            <button type="button" className="button" onClick={() => setDone(null)}>Pridať ďalšie miesta</button>
          </div>
          <p className="muted small join-undo">
            Pomýlil/a si sa?{' '}
            <button type="button" className="join-undo-link" onClick={undo}>
              {done.pins.length === 1 ? 'Zrušiť toto svetlo' : 'Zrušiť tieto svetlá'}
            </button>
          </p>
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      ) : event && !closed && (
        <form className="join-card" onSubmit={submit} noValidate>
          {notice && <p className="join-note" role="status">{notice}</p>}
          {needsCode && (
            <div className="join-field">
              <label htmlFor="join-code">Kód z QR</label>
              <input id="join-code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder={venue.key === 'ples' ? 'Kód je na stoloch a pri vstupe' : 'Kód nájdeš pri stene'} autoCapitalize="characters" />
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

      {photos && <PhotoPanel slug={slug} code={code} mode={event.photos} venue={venue} places={lit} />}

      <footer className="join-foot">
        <Link href="/mapa">Kde všade spolupracuje TUKE →</Link>
      </footer>
    </main>
  );
}
