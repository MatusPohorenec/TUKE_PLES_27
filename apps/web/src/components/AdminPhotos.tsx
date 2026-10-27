/**
 * Guests' photos in /admin: whether guests may send photos and whether they wait for approval (event.photos), the
 * waiting ones to approve or hide, the ones on the wall, the hidden ones; and deleting them (personal data, after
 * the ball). Refreshes itself every few seconds, so a new photo shows up here while the operator watches the ball.
 */
import { useCallback, useState } from 'react';
import { VISIT_KINDS, type PhotoMode, type PhotoStatus, type Venue } from '@ples/shared/constants';
import type { AdminPhoto, EventInfo } from '@ples/shared';
import { api, photoUrl } from '../lib/api.ts';
import { plural } from '../lib/format.ts';
import { usePoll } from '../lib/usePoll.ts';

const MODES: { mode: PhotoMode; label: string; hint: string }[] = [
  { mode: 'off', label: 'Vypnuté', hint: 'Hostia fotky neposielajú a stena žiadne neukazuje.' },
  { mode: 'review', label: 'Po schválení', hint: 'Nová fotka čaká tu, kým ju schváliš. Až potom sa objaví na stene.' },
  { mode: 'auto', label: 'Hneď na stenu', hint: 'Fotky idú na stenu hneď. Nevhodnú skry tlačidlom Skryť, zo steny zmizne do pár sekúnd.' },
];
const TABS: { status: PhotoStatus; label: string; empty: string }[] = [
  { status: 'pending', label: 'Čakajú', empty: 'Žiadna fotka nečaká na schválenie.' },
  { status: 'approved', label: 'Na stene', empty: 'Na stene zatiaľ nie je žiadna fotka.' },
  { status: 'hidden', label: 'Skryté', empty: 'Žiadne skryté fotky.' },
];
const visitLabel = new Map<string, string>(VISIT_KINDS.map(k => [k.code, k.label]));
const time = (iso: string) => new Date(iso).toLocaleString('sk', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "2 čakajú · 5 na stene · 1 skrytá" */
function counts(photos: AdminPhoto[]): string {
  const n = (s: PhotoStatus) => photos.filter(p => p.status === s).length;
  const pending = n('pending'), approved = n('approved'), hidden = n('hidden');
  return [
    `${pending} ${plural(pending, 'čaká', 'čakajú', 'čaká')}`,
    `${approved} na stene`,
    `${hidden} ${plural(hidden, 'skrytá', 'skryté', 'skrytých')}`,
  ].join(' · ');
}

export function AdminPhotos({ venue, event, onMode }: { venue: Venue; event: EventInfo | null; onMode: (mode: PhotoMode) => void }) {
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [tab, setTab] = useState<PhotoStatus>('pending');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setPhotos((await api.admin.photos()).photos); setError(''); } catch (err) { setError((err as Error).message); throw err; }
  }, []);
  usePoll(load, 4000);

  const act = async (run: () => Promise<unknown>) => {
    try { await run(); await load(); } catch (err) { setError((err as Error).message); }
  };
  const setStatus = (p: AdminPhoto, status: PhotoStatus) => act(() => api.admin.patchPhoto(p.id, status));
  const remove = (p: AdminPhoto) => { if (confirm(`Zmazať fotku (${p.kind === 'ball' ? 'z plesu' : p.name}) natrvalo?`)) void act(() => api.admin.deletePhoto(p.id)); };
  const removeAll = () => {
    if (!photos.length || !confirm(`Zmazať všetky fotky hostí (${photos.length}) natrvalo? Toto sa nedá vrátiť.`)) return;
    void act(() => api.admin.deleteAllPhotos());
  };

  const mode = event?.photos;
  const list = photos.filter(p => p.status === tab);
  return (
    <section className="admin-card admin-wide">
      <h2>Fotky hostí <span className="muted">({counts(photos)})</span></h2>
      <div className="join-options">
        {MODES.map(m => (
          <button key={m.mode} type="button" className={`join-option${mode === m.mode ? ' on' : ''}`} onClick={() => onMode(m.mode)}>{m.label}</button>
        ))}
      </div>
      {mode && <p className="muted">{MODES.find(m => m.mode === mode)?.hint}</p>}
      <div className="admin-tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.status} type="button" role="tab" aria-selected={tab === t.status} className={`chip${tab === t.status ? '' : ' off'}`} onClick={() => setTab(t.status)}>
            {t.label} <em>{photos.filter(p => p.status === t.status).length}</em>
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {list.length ? (
        <ul className="admin-photos">
          {list.map(p => (
            <li key={p.id}>
              <a href={photoUrl(venue.event, p.id)} target="_blank" rel="noopener" title="Celá fotka">
                <img src={photoUrl(venue.event, p.id, 'thumb')} alt="" loading="lazy" width={p.width} height={p.height} />
              </a>
              <div className="admin-photo-text">
                <b>{p.kind === 'ball' ? (venue.key === 'ples' ? 'Z plesu' : 'Z TUKE') : p.name}</b>
                <span className="muted small">
                  {[p.kind === 'place' && p.country !== p.name ? p.country : null, p.visitKind ? visitLabel.get(p.visitKind) : null, time(p.createdAt)].filter(Boolean).join(' · ')}
                </span>
              </div>
              <div className="admin-photo-actions">
                {p.status !== 'approved' && <button type="button" className="button" onClick={() => setStatus(p, 'approved')}>Schváliť</button>}
                {p.status !== 'hidden' && <button type="button" className="button ghost" onClick={() => setStatus(p, 'hidden')}>Skryť</button>}
                <button type="button" className="chip" onClick={() => remove(p)}>Zmazať</button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{TABS.find(t => t.status === tab)?.empty}</p>
      )}
      <div className="admin-photos-foot">
        <button type="button" className="button ghost" onClick={removeAll} disabled={!photos.length}>Zmazať všetky fotky</button>
        <span className="muted small">Fotky sú osobné údaje: po {venue.key === 'ples' ? 'plese' : 'skončení'} ich zmaž.</span>
      </div>
    </section>
  );
}
