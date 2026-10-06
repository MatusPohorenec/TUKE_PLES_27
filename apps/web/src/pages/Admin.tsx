/** Operator console: the wall scene, collecting on/off, the QR access code, moderation of lights, reviewer comments. */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_EVENT, DISPLAY_SCENES, FACULTIES, PERSON_ROLES, VISIT_KINDS, type EventStatus } from '@ples/shared/constants';
import type { AdminFeedback, AdminPin, EventInfo } from '@ples/shared';
import { ApiError, api } from '../lib/api.ts';
import { Link } from '../lib/router.tsx';
import './admin.css';

const STATUS_LABEL: Record<EventStatus, string> = {
  draft: 'Koncept (skryté)', open: 'Otvorené pred plesom', live: 'Ples práve prebieha', closed: 'Uzavreté',
};
const label = (list: readonly { code: string; label: string }[], code: string | null) => list.find(x => x.code === code)?.label ?? '–';
const time = (iso: string) => new Date(iso).toLocaleString('sk', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function Admin() {
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
        <Link href="/" className="join-brand">TUKE · Ples 2027</Link>
        <h1>Administrácia</h1>
        {authed && <button type="button" className="chip" onClick={() => api.admin.logout().then(() => setAuthed(false))}>Odhlásiť</button>}
      </header>
      {notice && <p className="join-note">{notice}</p>}
      {authed === false && !notice && <Login onDone={() => setAuthed(true)} />}
      {authed && <Console />}
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

function Console() {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [pins, setPins] = useState<AdminPin[]>([]);
  const [feedback, setFeedback] = useState<AdminFeedback[]>([]);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');

  const load = useCallback(() => {
    Promise.all([api.admin.event(DEFAULT_EVENT), api.admin.pins(), api.admin.feedback()])
      .then(([e, p, f]) => { setEvent(e); setPins(p.pins); setFeedback(f.feedback); setError(''); })
      .catch(err => setError((err as Error).message));
  }, []);
  useEffect(() => { load(); const t = window.setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  const patch = async (p: Parameters<typeof api.admin.patchEvent>[1]) => {
    try { setEvent(await api.admin.patchEvent(DEFAULT_EVENT, p)); } catch (err) { setError((err as Error).message); }
  };

  return (
    <div className="admin-grid">
      {error && <p className="error" role="alert">{error}</p>}

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
        <h2>Zbieranie svetiel</h2>
        <div className="join-options">
          {(Object.keys(STATUS_LABEL) as EventStatus[]).map(s => (
            <button key={s} type="button" className={`join-option${event?.status === s ? ' on' : ''}`} onClick={() => patch({ status: s })}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
        <form className="admin-code" onSubmit={e => { e.preventDefault(); patch({ code }); setCode(''); }}>
          <label htmlFor="admin-code">Kód v QR odkaze {event?.requiresCode ? <span className="ok">(nastavený)</span> : <span className="muted">(bez kódu)</span>}</label>
          <div>
            <input id="admin-code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Napr. PLES27" maxLength={64} />
            <button className="button" type="submit" disabled={!code}>Nastaviť</button>
            {event?.requiresCode && <button className="button ghost" type="button" onClick={() => patch({ code: '' })}>Zrušiť kód</button>}
          </div>
          <p className="muted small">QR na stoloch potom vedie na /zapoj-sa?k=KÓD a stenu spustíš s ?kiosk=1&amp;k=KÓD.</p>
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
