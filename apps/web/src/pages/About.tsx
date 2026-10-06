/** Where the data comes from. Credits that the licences of the sources require. */
import { Link } from '../lib/router.tsx';
import './join.css';

const SOURCES: [string, string, string][] = [
  ['Erasmus+ bilaterálne zmluvy', 'erasmus.tuke.sk – partnerské inštitúcie fakúlt (stav jún 2026)', 'https://erasmus.tuke.sk/'],
  ['Projekty EÚ (FP7, Horizon 2020, Horizon Europe)', 'CORDIS, © Európska únia', 'https://cordis.europa.eu/'],
  ['Spoločné publikácie od 2015', 'OpenAlex (CC0)', 'https://openalex.org/'],
  ['Zmluvy a memorandá', 'Centrálny register zmlúv SR', 'https://www.crz.gov.sk/'],
  ['Erasmus+ projekty spolupráce', 'Erasmus+ Project Results Platform', 'https://erasmus-plus.ec.europa.eu/projects'],
  ['Cezhraničné projekty Interreg', 'keep.eu', 'https://keep.eu/'],
  ['Siete CEEPUS', 'ceepus.info', 'https://www.ceepus.info/'],
  ['Mestá pre formulár hostí', 'GeoNames (CC BY 4.0)', 'https://www.geonames.org/'],
  ['Hranice štátov', 'Natural Earth (public domain)', 'https://www.naturalearthdata.com/'],
];

export default function About() {
  return (
    <main className="join">
      <div className="stage-light" />
      <header className="join-head">
        <Link href="/" className="join-brand">TUKE · Ples 2027</Link>
        <h1>O projekte</h1>
        <p>
          Zemeguľa ukazuje miesta, kde má Technická univerzita v Košiciach doloženú spoluprácu: zmluvy, Erasmus+, spoločné projekty a publikácie.
          Každá väzba má zdroj. Na plese pribúdajú svetlá hostí, ktorí označia, kde všade boli.
        </p>
      </header>
      <section className="join-card">
        <h2 style={{ fontSize: 17 }}>Zdroje dát</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
          {SOURCES.map(([what, who, url]) => (
            <li key={what}><b>{what}</b> – <a href={url} target="_blank" rel="noreferrer">{who}</a></li>
          ))}
        </ul>
        <p className="muted small">
          Väzby s inštitúciami v Rusku a Bielorusku sú v dátach, ale na mape sa nezobrazujú. Údaje pred plesom overuje Úsek zahraničných vzťahov a mobility TUKE.
        </p>
      </section>
      <footer className="join-foot"><Link href="/mapa">Preskúmať mapu →</Link></footer>
    </main>
  );
}
