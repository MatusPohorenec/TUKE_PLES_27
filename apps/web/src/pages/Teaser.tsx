/**
 * What a visitor sees on a page that is not open yet (before the ball every page except /onboarding, in a venue that
 * is switched off all of them) or that does not exist (lost: any other address; the TUKE server sends unknown
 * addresses here through its 404 error document). main.tsx decides, the operator switches in /admin. A wink and a hint
 * of the ball instead of an error.
 */
import type { GateState, Venue } from '@ples/shared/constants';
import { Starfield } from '../components/Starfield.tsx';
import { Link } from '../lib/router.tsx';
import './join.css';
import './teaser.css';

export default function Teaser({ venue, state, lost = false }: { venue: Venue; state: GateState; lost?: boolean }) {
  // before the ball an unknown address looks like any closed page: nothing gives away what exists
  const strayed = lost && state === 'open';
  const ball = venue.key === 'ples';
  return (
    <>
    {/* the night behind the page: outside <main>, whose children are laid out in its grid */}
    <div className="stage-light" />
    <Starfield count={520} />
    <main className="join teaser">
      <span className="teaser-star" aria-hidden="true" />
      <header className="join-head">
        <span className="join-brand">{venue.brand}</span>
        <h1>{strayed ? 'Sem svetlo nedoletelo.' : 'Pst… ešte je zhasnuté.'}</h1>
        {strayed ? (
          <p>
            Takáto stránka neexistuje. Keď už si sem zablúdil/a, máš malú indíciu: spomeň si na všetky miesta sveta, kde si
            kedy bol/a, a pridaj ich na stenu. Rozsvietia sa ako hviezdy a budú ťa sprevádzať celou nocou.
          </p>
        ) : ball ? (
          <p>
            Zvedavosť ti nikto nezazlieva, ale toto sa rozsvieti až na plese. Keď už si sem zablúdil/a, máš malú indíciu:
            spomeň si na všetky miesta sveta, kde si kedy bol/a. Na plese sa z nich stanú hviezdy a budú ťa sprevádzať celou nocou.
          </p>
        ) : (
          <p>Vestibul sa rozsvieti neskôr. Dovtedy si spomeň na všetky miesta sveta, kde si kedy bol/a: raz z nich budú hviezdy.</p>
        )}
      </header>
      {strayed ? <Link className="button teaser-cta" href="/">Na stenu</Link>
        : venue.onboarding && state !== 'off' && <Link className="button teaser-cta" href="/onboarding">Potvrdiť účasť na plese</Link>}
      <p className="teaser-sign">75 rokov TUKE · Do videnia pod hviezdami</p>
    </main>
    </>
  );
}
