/**
 * Operator console of a venue: what the venue shows (before the ball only the onboarding, the ball night, after the
 * ball, off), the wall scene, the QR access code, confirmed attendance, moderation of lights, reviewer comments.
 * /admin manages the ball's database, /vestibul/admin the student lobby's; one login opens both.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { DISPLAY_SCENES, FACULTIES, PERSON_ROLES, VENUES, VISIT_KINDS, type EventStatus, type Venue, type VenueKey } from '@ples/shared/constants';
import type { AdminAttendee, AdminFeedback, AdminPin, EventInfo } from '@ples/shared';
import { ApiError, api } from '../lib/api.ts';
import { plural } from '../lib/format.ts';
import { refreshGate } from '../lib/gate.ts';
import { Link, useVenue } from '../lib/router.tsx';
import './admin.css';

/** The event status as the operator's switch (gateOf in packages/shared decides what visitors see). */
const STATUS: Record<VenueKey, Record<EventStatus, { label: string; hint: string }>> = {
  ples: {
    open: { label: 'Pred plesom', hint: 'Hostia vidia len potvrdenie účasti (/onboarding), ostatné stránky ukazujú teaser. Ty ako admin vidíš všetko.' },
    live: { label: 'Ples prebieha', hint: 'Všetky stránky sú otvorené, hostia pridávajú svetlá cez QR na stene.' },
    closed: { label: 'Po plese', hint: 'Stránky sú otvorené len na pozeranie, svetlá ani potvrdenia sa už nepridávajú.' },
    draft: { label: 'Vypnuté', hint: 'Hostia vidia len teaser, nič sa nedá poslať.' },
  },
  vestibul: {
    draft: { label: 'Vypnutý', hint: 'Všetky stránky vestibulu ukazujú teaser.' },
    open: { label: 'Pripravený', hint: 'Stránky sú stále skryté (teaser), ty ako admin ich vidíš a môžeš skúšať svetlá.' },
    live: { label: 'Zapnutý', hint: 'Stena vestibulu a formulár sú otvorené pre všetkých.' },
    closed: { label: 'Len na pozeranie', hint: 'Stránky sú otvorené, svetlá sa už nepridávajú.' },
  },
};
const label = (list: readonly { code: string; label: string }[], code: string | null) => list.find(x => x.code === code)?.label ?? '–';
const time = (iso: string) => new Date(iso).toLocaleString('sk', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "12 osôb: 8 potvrdení, 4 s doprovodom" */
function headcount(rows: AdminAttendee[]): string {
  const companions = rows.filter(a => a.companion).length;
  const persons = rows.length + companions;
  return `${persons} ${plural(persons, 'osoba', 'osoby', 'osôb')}: ${rows.length} ${plural(rows.length, 'potvrdenie', 'potvrdenia', 'potvrdení')}, ${companions} s doprovodom`;
}

/** Confirmed attendance as a CSV for Excel (semicolons, UTF-8 with BOM); formula-like cells are defused. */
function downloadAttendees(rows: AdminAttendee[], slug: string): void {
  const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
  const lines = [
    'Meno;Príslušnosť;Doprovod;Osôb;Potvrdené',
    ...[...rows].reverse().map(r => [r.name, r.affiliation, r.companion ?? '', String(r.companion ? 2 : 1), new Date(r.createdAt).toLocaleString('sk')].map(cell).join(';')),
  ];
  const url = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `ucast-${slug}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Admin() {
  const venue = useVenue();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    api.admin.me().then(() => setAuthed(true)).catch((err: ApiError) => {
      setAuthed(false);
      if (err.status !== 401) setNotice(err.message);
    });
  }, []);

  return (
    <main className="admin">
      <header className="admin-head">
        <Link href="/" className="join-brand">{venue.brand}</Link>
        <h1>Administrácia</h1>
        {/* each venue has its own database: switching is a full page load to the other console */}
        <nav className="admin-venues" aria-label="Stena">
          {Object.values(VENUES).map(v => (
            <a key={v.key} className={`chip${v.key === venue.key ? '' : ' off'}`} href={`${v.prefix}/admin`} aria-current={v.key === venue.key ? 'page' : undefined}>{v.name}</a>
          ))}
        </nav>
        {authed && <button type="button" className="chip" onClick={() => api.admin.logout().then(() => { setAuthed(false); refreshGate(); })}>Odhlásiť</button>}
      </header>
      {notice && <p className="join-note">{notice}</p>}
      {authed === false && !notice && <Login onDone={() => { setAuthed(true); refreshGate(); }} />}
      {authed && <Console venue={venue} />}
    </main>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password') ?? '');
    try { await api.admin.login(password); onDone(); } catch (err) { setError((err as Error).message); }
  };
  return (
    <form className="admin-card admin-login" onSubmit={submit}>
      <label htmlFor="admin-password">Heslo</label>
      <input id="admin-password" name="password" type="password" autoComplete="current-password" required />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="button" type="submit">Prihlásiť</button>
    </form>
  );
}

function Console({ venue }: { venue: Venue }) {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [pins, setPins] = useState<AdminPin[]>([]);
  const [feedback, setFeedback] = useState<AdminFeedback[]>([]);
  const [attendees, setAttendees] = useState<AdminAttendee[]>([]);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');

  const load = useCallback(() => {
    Promise.all([
      api.admin.event(venue.event), api.admin.pins(), api.admin.feedback(),
      venue.onboarding ? api.admin.attendees() : Promise.resolve({ attendees: [] }),
    ])
      .then(([e, p, f, a]) => { setEvent(e); setPins(p.pins); setFeedback(f.feedback); setAttendees(a.attendees); setError(''); })
      .catch(err => setError((err as Error).message));
  }, [venue.event, venue.onboarding]);
  useEffect(() => { load(); const t = window.setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  const patch = async (p: Parameters<typeof api.admin.patchEvent>[1]) => {
    try { setEvent(await api.admin.patchEvent(venue.event, p)); } catch (err) { setError((err as Error).message); }
  };
  const removeAttendee = async (a: AdminAttendee) => {
    if (!confirm(`Zmazať potvrdenie účasti: ${a.name}${a.companion ? ` (aj s doprovodom ${a.companion})` : ''}?`)) return;
    try { await api.admin.deleteAttendee(a.id); load(); } catch (err) { setError((err as Error).message); }
  };
  const statuses = STATUS[venue.key];

  return (
    <div className="admin-grid">
      {error && <p className="error" role="alert">{error}</p>}

      <section className="admin-card admin-wide">
        <h2>{venue.key === 'ples' ? 'Stav plesu' : 'Stav vestibulu'}</h2>
        <div className="join-options">
          {(Object.keys(statuses) as EventStatus[]).map(s => (
            <button key={s} type="button" className={`join-option${event?.status === s ? ' on' : ''}`} onClick={() => patch({ status: s })}>{statuses[s].label}</button>
          ))}
        </div>
        {event && <p className="muted">{statuses[event.status].hint}</p>}
      </section>

      {venue.onboarding && (
        <section className="admin-card admin-wide">
          <h2>
            Potvrdená účasť{' '}
            <span className="muted">({headcount(attendees)})</span>
          </h2>
          <p className="muted small">Mená a príslušnosť z /onboarding. Osobné údaje: len pre organizátorov, po plese ich zmaž.</p>
          <div className="admin-code">
            <div>
              <button className="button" type="button" disabled={!attendees.length} onClick={() => downloadAttendees(attendees, venue.event)}>Stiahnuť CSV</button>
            </div>
          </div>
          <div className="admin-table">
            <table>
              <thead><tr><th>Čas</th><th>Meno</th><th>Príslušnosť</th><th>Doprovod</th><th /></tr></thead>
              <tbody>
                {attendees.map(a => (
                  <tr key={a.id}>
                    <td>{time(a.createdAt)}</td>
                    <td>{a.name}</td>
                    <td>{a.affiliation}</td>
                    <td>{a.companion ?? <span className="muted">–</span>}</td>
                    <td><button type="button" className="chip" onClick={() => removeAttendee(a)}>Zmazať</button></td>
                  </tr>
                ))}
                {!attendees.length && <tr><td colSpan={5} className="muted">Zatiaľ nikto nepotvrdil účasť.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="admin-card">
        <h2>Stena</h2>
        <p className="muted">Čo práve ukazuje LED stena. Zmena sa prejaví do 2 sekúnd.</p>
        <div className="join-options">
          {DISPLAY_SCENES.map(s => (
            <button key={s.code} type="button" className={`join-option${event?.displayScene === s.code ? ' on' : ''}`} onClick={() => patch({ displayScene: s.code })}>{s.label}</button>
          ))}
        </div>
      </section>

      <section className="admin-card">
        <h2>Kód pre svetlá</h2>
        <form className="admin-code" onSubmit={e => { e.preventDefault(); patch({ code }); setCode(''); }}>
          <label htmlFor="admin-code">Kód v QR odkaze {event?.requiresCode ? <span className="ok">(nastavený)</span> : <span className="muted">(bez kódu)</span>}</label>
          <div>
            <input id="admin-code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Napr. PLES27" maxLength={64} />
            <button className="button" type="submit" disabled={!code}>Nastaviť</button>
            {event?.requiresCode && <button className="button ghost" type="button" onClick={() => patch({ code: '' })}>Zrušiť kód</button>}
          </div>
          <p className="muted small">
            QR {venue.key === 'ples' ? 'na stoloch' : 'na stene'} potom vedie na {venue.prefix}/zapoj-sa?k=KÓD a stenu spustíš s {venue.prefix || '/'}?kiosk=1&amp;k=KÓD.
          </p>
        </form>
      </section>

      <section className="admin-card admin-wide">
        <h2>Svetlá hostí <span className="muted">({pins.length} posledných)</span></h2>
        <div className="admin-table">
          <table>
            <thead><tr><th>Čas</th><th>Miesto</th><th>Čo</th><th>Kto</th><th>Fakulta</th><th /></tr></thead>
            <tbody>
              {pins.map(p => (
                <tr key={p.id} className={p.status === 'hidden' ? 'hidden-row' : ''}>
                  <td>{time(p.createdAt)}</td>
                  <td>{p.name} <span className="muted">{p.countryCode}</span></td>
                  <td>{label(VISIT_KINDS, p.visitKind)}</td>
                  <td>{label(PERSON_ROLES, p.role)}</td>
                  <td>{p.faculty ? label(FACULTIES.map(f => ({ code: f.code, label: f.code })), p.faculty) : '–'}</td>
                  <td>
                    <button type="button" className="chip" onClick={() => api.admin.patchPin(p.id, p.status === 'visible' ? 'hidden' : 'visible').then(load)}>
                      {p.status === 'visible' ? 'Skryť' : 'Zobraziť'}
                    </button>
                  </td>
                </tr>
              ))}
              {!pins.length && <tr><td colSpan={6} className="muted">Zatiaľ žiadne svetlá.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card admin-wide">
        <h2>Pripomienky <span className="muted">({feedback.filter(f => f.status === 'new').length} nových)</span></h2>
        <ul className="admin-feedback">
          {feedback.map(f => (
            <li key={f.id} className={`fb-${f.status}`}>
              <div className="muted small">{time(f.createdAt)} · {f.page} · {f.author ?? 'anonym'}</div>
              <p>{f.message}</p>
              <div className="join-options">
                {(['new', 'accepted', 'done', 'rejected'] as const).map(s => (
                  <button key={s} type="button" className={`chip${f.status === s ? '' : ' off'}`} onClick={() => api.admin.patchFeedback(f.id, s).then(load)}>
                    {{ new: 'Nová', accepted: 'Prijatá', done: 'Vyriešená', rejected: 'Zamietnutá' }[s]}
                  </button>
                ))}
              </div>
            </li>
          ))}
          {!feedback.length && <li className="muted">Zatiaľ žiadne pripomienky.</li>}
        </ul>
      </section>
    </div>
  );
}
