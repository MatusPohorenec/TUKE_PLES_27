/**
 * 3D or 2D? The same wall twice, side by side: each frame renders the wall at the LED wall's size and is scaled
 * down, so the composition is the real one, and both openings start at the same moment.
 */
import { useEffect, useState } from 'react';
import './compare.css';

const WALL = { w: 1920, h: 1080 };
const VIEWS = [
  { label: '3D – zemeguľa', src: '/?kiosk=1' },
  { label: '2D – mapa sveta', src: '/?kiosk=1&view=2d' },
];

function layout() {
  const columns = innerWidth >= 900 ? 2 : 1;
  const byWidth = (innerWidth - 48 - (columns - 1) * 16) / columns / WALL.w;
  const byHeight = columns === 2 ? (innerHeight - 150) / WALL.h : Infinity;
  return { columns, scale: Math.max(0.1, Math.min(byWidth, byHeight)) };
}

export default function Compare() {
  const [run, setRun] = useState(0); // a new key remounts both frames: the openings start together again
  const [{ columns, scale }, setLayout] = useState(layout);
  useEffect(() => {
    const fit = () => setLayout(layout());
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);

  return (
    <main className="compare">
      <header>
        <div>
          <h1>3D alebo 2D?</h1>
          <p className="muted">Rovnaká stena v rozlíšení LED steny 1920 × 1080, obe spustené naraz. Čo sa číta lepšie?</p>
        </div>
        <button type="button" className="chip" onClick={() => setRun(r => r + 1)}>↻ Spustiť obe znova</button>
      </header>
      <div className="compare-row" style={{ gridTemplateColumns: `repeat(${columns}, auto)` }}>
        {VIEWS.map(v => (
          <figure key={v.src}>
            <figcaption>{v.label}</figcaption>
            <div className="compare-frame" style={{ width: WALL.w * scale, height: WALL.h * scale }}>
              <iframe key={run} src={v.src} title={v.label} style={{ width: WALL.w, height: WALL.h, transform: `scale(${scale})` }} />
            </div>
          </figure>
        ))}
      </div>
    </main>
  );
}
