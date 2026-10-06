/** "Pripomienka": reviewers of the prototype leave a comment for the page they are on. */
import { useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api.ts';
import { store } from '../lib/device.ts';
import './feedback.css';

export function FeedbackButton({ page }: { page: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const [author, setAuthor] = useState(() => store.get<string>('ples-feedback-author') ?? '');

  const open = () => { setState('idle'); setError(''); dialog.current?.showModal(); };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const message = String(new FormData(form).get('message') ?? '').trim();
    if (message.length < 3) { setError('Napíš aspoň pár slov.'); return; }
    setState('sending');
    setError('');
    try {
      await api.feedback({ page: page + location.search, message, author: author.trim() || undefined });
      store.set('ples-feedback-author', author.trim());
      setState('sent');
      form.reset();
    } catch (err) {
      setError((err as Error).message);
      setState('idle');
    }
  };

  return (
    <>
      <button type="button" className="chip feedback-open" onClick={open}>Pripomienka</button>
      <dialog ref={dialog} className="feedback-dialog" onClick={e => { if (e.target === dialog.current) dialog.current.close(); }}>
        {state === 'sent' ? (
          <div className="feedback-body">
            <h2>Ďakujeme</h2>
            <p className="muted">Pripomienka je uložená. Uvidí ju tím plesu v administrácii.</p>
            <div className="feedback-actions">
              <button type="button" className="button ghost" onClick={() => setState('idle')}>Pridať ďalšiu</button>
              <button type="button" className="button" onClick={() => dialog.current?.close()}>Zavrieť</button>
            </div>
          </div>
        ) : (
          <form className="feedback-body" onSubmit={submit}>
            <h2>Pripomienka k prototypu</h2>
            <p className="muted">Čo by si zmenil/a na tejto obrazovke? Pripomienka sa uloží spolu s adresou stránky.</p>
            <label htmlFor="fb-message">Pripomienka</label>
            <textarea id="fb-message" name="message" rows={5} maxLength={2000} required placeholder="Napr. farba hviezd hostí je príliš výrazná…" />
            <label htmlFor="fb-author">Meno alebo útvar <span className="muted">(nepovinné)</span></label>
            <input id="fb-author" value={author} onChange={e => setAuthor(e.target.value)} maxLength={120} placeholder="Napr. OZVaM, organizačný tím" />
            {error && <p className="error" role="alert">{error}</p>}
            <div className="feedback-actions">
              <button type="button" className="button ghost" onClick={() => dialog.current?.close()}>Zrušiť</button>
              <button type="submit" className="button" disabled={state === 'sending'}>{state === 'sending' ? 'Odosielam…' : 'Odoslať'}</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
