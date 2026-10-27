/**
 * "Pridaj fotku na stenu" on the guest form: a photo of the guest in one of the places they lit (the API checks the
 * light is theirs and copies its place), or at the ball right now. The photo is made ready in the phone (upright,
 * wall size, no metadata), shown once more with a consent box, then sent; the wall shows it as a postcard at its
 * light, after an admin approved it (event.photos 'review') or at once ('auto'). The guest can take it back for a
 * while, like a light.
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { PhotoMode, PhotoUploadResponse, Venue, VenueKey } from '@ples/shared';
import { api } from '../lib/api.ts';
import { PhotoError, preparePhoto, type PreparedPhoto } from '../lib/photo.ts';
import './photo-panel.css';

/** One of the guest's lights (from this browser), a photo can go with it. */
export interface LitPlace { pinId: number; name: string; countryCode: string }
type Target = { kind: 'ball' } | { kind: 'place'; place: LitPlace };
type State =
  | { step: 'choose' }
  | { step: 'preparing'; target: Target }
  | { step: 'preview' | 'sending'; target: Target; prepared: PreparedPhoto }
  | { step: 'sent'; target: Target; prepared: PreparedPhoto; result: PhotoUploadResponse };

/** The option for a photo taken right now, and what the venue's wall is. */
const HERE: Record<VenueKey, { option: string; wall: string; erase: string }> = {
  ples: { option: 'Práve na plese', wall: 'na stene plesu', erase: 'po plese fotky zmažeme' },
  vestibul: { option: 'Práve tu na TUKE', wall: 'na stene vo vestibule', erase: 'fotky po čase zmažeme' },
};

const labelOf = (t: Target, venue: Venue) => (t.kind === 'ball' ? HERE[venue.key].option : t.place.name);

function Camera() {
  return (
    <svg className="photo-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.3-2h6l1.3 2h1.2A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
      <circle cx="12" cy="12.5" r="3.6" />
    </svg>
  );
}

export function PhotoPanel({ slug, code, mode, venue, places }: { slug: string; code: string; mode: PhotoMode; venue: Venue; places: LitPlace[] }) {
  const [state, setState] = useState<State>({ step: 'choose' });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<Target | null>(null); // the option tapped while the file picker is open
  const preview = 'prepared' in state ? state.prepared.preview : null;
  // a picture shown before is no longer needed: give its memory back
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (target: Target) => {
    pending.current = target;
    setError('');
    setNotice('');
    input.current?.click(); // inside the tap, so phones open the camera or the gallery
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file may be chosen again
    const target = pending.current;
    if (!file || !target) return;
    setState({ step: 'preparing', target });
    try {
      setState({ step: 'preview', target, prepared: await preparePhoto(file) });
    } catch (err) {
      setState({ step: 'choose' });
      setError(err instanceof PhotoError ? err.message : 'Fotku sa nepodarilo pripraviť. Skús inú.');
    }
  };

  const send = async () => {
    if (state.step !== 'preview') return;
    const { target, prepared } = state;
    setState({ step: 'sending', target, prepared });
    setError('');
    try {
      const meta = target.kind === 'place' ? { kind: 'place' as const, pinId: target.place.pinId } : { kind: 'ball' as const };
      const result = await api.sendPhoto(slug, { ...meta, code: code || undefined }, prepared.photo, prepared.thumb);
      setState({ step: 'sent', target, prepared, result });
    } catch (err) {
      setState({ step: 'preview', target, prepared });
      setError((err as Error).message);
    }
  };

  const undo = async () => {
    if (state.step !== 'sent') return;
    try {
      await api.deletePhoto(slug, state.result.id);
      setState({ step: 'choose' });
      setNotice('Fotku sme zmazali, na stene sa neukáže.');
    } catch (err) { setError((err as Error).message); }
  };

  const review = mode === 'review';
  const here = HERE[venue.key];
  return (
    <section className="join-card join-photo" aria-labelledby="join-photo-title">
      <input ref={input} type="file" accept="image/*" hidden onChange={onFile} />
      <div className="join-photo-head">
        <h2 id="join-photo-title"><Camera />Pridaj fotku na stenu</h2>
        <p className="muted">
          Fotka z miesta, ktoré si rozsvietil/a, alebo {venue.key === 'ples' ? 'z plesu' : 'z TUKE'}. Na stene sa objaví ako pohľadnica
          pri svojom svetle{review ? ', keď ju schvália organizátori' : ''}.
        </p>
      </div>

      {notice && <p className="join-note" role="status">{notice}</p>}

      {(state.step === 'choose' || state.step === 'preparing') && (
        <>
          <div className="join-options photo-options">
            <button type="button" className="join-option photo-option" onClick={() => pick({ kind: 'ball' })} disabled={state.step === 'preparing'}>
              <Camera />{here.option}
            </button>
            {places.map(p => (
              <button key={p.pinId} type="button" className="join-option photo-option" onClick={() => pick({ kind: 'place', place: p })} disabled={state.step === 'preparing'}>
                <Camera />{p.name}
              </button>
            ))}
          </div>
          {state.step === 'preparing' && <p className="muted small" role="status">Pripravujem fotku…</p>}
          {!places.length && <p className="muted small">K fotke z cesty najprv rozsvieť miesto vyššie, potom ho tu nájdeš.</p>}
        </>
      )}

      {(state.step === 'preview' || state.step === 'sending' || state.step === 'sent') && (
        <figure className={`photo-proof${state.step === 'sent' ? ' sent' : ''}`}>
          <img src={state.prepared.preview} alt="" width={state.prepared.width} height={state.prepared.height} />
          <figcaption>✦ {labelOf(state.target, venue)}</figcaption>
        </figure>
      )}

      {(state.step === 'preview' || state.step === 'sending') && (
        <>
          <label className={`join-consent${consent ? ' on' : ''}`}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
            <span>Ľudia na fotke súhlasia, aby sa ukázala {here.wall}.</span>
          </label>
          <div className="join-actions">
            <button type="button" className="button" onClick={send} disabled={!consent || state.step === 'sending'}>
              {state.step === 'sending' ? 'Posielam fotku…' : 'Poslať na stenu'}
            </button>
            <button type="button" className="button ghost" onClick={() => pick(state.target)} disabled={state.step === 'sending'}>Vybrať inú</button>
          </div>
          <p className="muted small">
            <button type="button" className="join-undo-link" onClick={() => { setState({ step: 'choose' }); setError(''); }} disabled={state.step === 'sending'}>Zrušiť</button>
          </p>
        </>
      )}

      {state.step === 'sent' && (
        <div className="photo-sent" aria-live="polite">
          <h3>{state.result.status === 'approved' ? 'Fotka letí na stenu' : 'Fotka čaká na schválenie'}</h3>
          <p className="muted">
            {state.result.status === 'approved' ? 'O chvíľu sa objaví' : 'Keď ju organizátori schvália, objaví sa'}
            {' '}na stene{state.target.kind === 'place' ? ' pri svojom svetle' : ''}.
          </p>
          <div className="join-actions">
            <button type="button" className="button ghost" onClick={() => setState({ step: 'choose' })}>Pridať ďalšiu fotku</button>
          </div>
          <p className="muted small join-undo">
            Zlá fotka? <button type="button" className="join-undo-link" onClick={undo}>Zmazať ju</button>
          </p>
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted small">
        Fotku uvidia hostia {here.wall} a organizátori. Polohu ani iné údaje z fotky neukladáme, {here.erase}.
      </p>
    </section>
  );
}
