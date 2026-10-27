/**
 * Confirmation of attendance (/onboarding). The QR code on the invitations leads here, and before the ball it is the
 * only open page. A name and an affiliation, optionally a companion (doprovod), seen only by the organisers in /admin
 * (personal data, deleted after the ball). One phone may confirm a few people; the names confirmed here are
 * remembered in this browser.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { FACULTIES, LIMITS } from '@ples/shared/constants';
import type { EventInfo } from '@ples/shared';
import { Starfield } from '../components/Starfield.tsx';
import { ApiError, api } from '../lib/api.ts';
import { store } from '../lib/device.ts';
import { Link, useVenue } from '../lib/router.tsx';
import './join.css';
import './onboarding.css';

/** Suggestions for the affiliation; any text is fine (a faculty, a department, a company, a guest). */
const SUGGESTIONS = [
  'Študent/ka TUKE', 'Zamestnanec/kyňa TUKE', 'Absolvent/ka TUKE',
  ...FACULTIES.map(f => `${f.code} TUKE`), 'Partner TUKE', 'Hosť',
];
const KEY = 'ples-attendance';
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export default function Onboarding() {
  const venue = useVenue();
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [eventError, setEventError] = useState('');
  const [name, setName] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [withCompanion, setWithCompanion] = useState(false);
  const [companion, setCompanion] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<string[]>(() => store.get<string[]>(`${KEY}-${venue.key}`) ?? []);
  const [done, setDone] = useState<{ name: string; companion: string | null } | null>(null);

  useEffect(() => {
    api.event(venue.event).then(setEvent).catch((err: ApiError) => setEventError(err.status === 503 || err.status === 404
      ? 'Potvrdzovanie účasti ešte nie je spustené. Skús to o chvíľu.'
      : err.message));
  }, [venue.event]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) { setError('Napíš svoje meno a priezvisko.'); return; }
    if (affiliation.trim().length < 2) { setError('Napíš, kam patríš: fakulta, pracovisko, firma alebo hosť.'); return; }
    if (withCompanion && companion.trim().length < 2) { setError('Napíš meno a priezvisko svojho doprovodu.'); return; }
    setSending(true);
    setError('');
    try {
      const res = await api.attend(venue.event, {
        name: name.trim(), affiliation: affiliation.trim(), companion: withCompanion ? companion.trim() : undefined,
      });
      const list = [...confirmed, res.companion ? `${res.name} s doprovodom (${res.companion})` : res.name];
      setConfirmed(list);
      store.set(`${KEY}-${venue.key}`, list);
      setDone({ name: res.name, companion: res.companion });
      setName('');
      setAffiliation('');
      setWithCompanion(false);
      setCompanion('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const open = event?.status === 'open' || event?.status === 'live';

  return (
    <>
    {/* the night behind the page: outside <main>, whose children are laid out in its grid */}
    <div className="stage-light" />
    <Starfield count={300} />
    <main className="join onboarding">
      <header className="join-head">
        <span className="join-brand">{venue.brand}</span>
        <h1>Potvrď svoju účasť</h1>
        <p>
          Ples TUKE 2027 oslavuje 75 rokov univerzity. Z Košíc sa rozletí svetlo ku všetkým miestam sveta, s ktorými TUKE
          spolupracuje, a v tú noc sa rozsvietia aj miesta, kde si bol/a ty.
        </p>
      </header>

      {eventError && <p className="join-note">{eventError}</p>}
      {event && !open && <p className="join-note">Potvrdzovanie účasti je uzavreté. Ďakujeme všetkým, ktorí prišli.</p>}

      {done ? (
        <section className="join-card join-done" aria-live="polite">
          <h2>Ďakujeme, {firstName(done.name)}!</h2>
          <p>
            {done.companion ? `Tvoja účasť aj s doprovodom (${done.companion}) je potvrdená.` : 'Tvoja účasť je potvrdená.'}
            {' '}Uvidíme sa pod hviezdami.
          </p>
          <div className="join-actions">
            <button type="button" className="button ghost" onClick={() => setDone(null)}>Potvrdiť účasť ďalšej osoby</button>
          </div>
        </section>
      ) : open && (
        <form className="join-card" onSubmit={submit} noValidate>
          {confirmed.length > 0 && (
            <p className="onboarding-done small">Z tohto zariadenia už je potvrdená účasť: {confirmed.join(', ')}</p>
          )}
          <div className="join-field">
            <label htmlFor="onb-name">Meno a priezvisko</label>
            <input id="onb-name" value={name} onChange={e => setName(e.target.value)} autoComplete="name"
              maxLength={LIMITS.attendeeNameChars} required />
          </div>
          <div className="join-field">
            <label htmlFor="onb-affiliation">Príslušnosť</label>
            <input id="onb-affiliation" list="onb-affiliations" value={affiliation} onChange={e => setAffiliation(e.target.value)}
              placeholder="Fakulta, pracovisko, firma alebo hosť" autoComplete="organization"
              maxLength={LIMITS.attendeeAffiliationChars} required />
            <datalist id="onb-affiliations">{SUGGESTIONS.map(s => <option key={s} value={s} />)}</datalist>
          </div>
          <div className="join-field">
            <div className="join-options">
              <label className={`join-option${withCompanion ? ' on' : ''}`}>
                <input type="checkbox" checked={withCompanion} onChange={e => setWithCompanion(e.target.checked)} />
                Prídem s doprovodom
              </label>
            </div>
            {withCompanion && (
              <>
                <label htmlFor="onb-companion">Meno a priezvisko doprovodu</label>
                <input id="onb-companion" value={companion} onChange={e => setCompanion(e.target.value)} autoComplete="off"
                  maxLength={LIMITS.attendeeNameChars} required />
              </>
            )}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="button join-submit" disabled={sending}>{sending ? 'Posielam…' : 'Záväzne potvrdiť účasť'}</button>
          <p className="muted small">
            Mená a príslušnosť uvidia len organizátori plesu a použijú ich len na evidenciu účasti. Po plese ich vymažeme.
          </p>
        </form>
      )}

      {event?.status === 'live' && (
        <p className="join-foot"><Link href="/zapoj-sa">Ples práve prebieha: pridaj aj svoje svetlo →</Link></p>
      )}
    </main>
    </>
  );
}
