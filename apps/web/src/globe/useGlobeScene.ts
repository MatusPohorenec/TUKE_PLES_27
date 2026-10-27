import { useEffect, useRef, useState } from 'react';
import type { CountryFeature, WallScene } from './core.ts';
import { MapScene } from './map2d.ts';
import { GlobeScene } from './scene.ts';

/** '3d' = the globe, '2d' = the flat world map. */
export type View = '3d' | '2d';

/** ms the old and the new scene cross-fade when the view changes (the wall's 2D/3D cycle); matches .scene-layer */
export const CROSSFADE_MS = 2600;

let countries: Promise<CountryFeature[]> | undefined;
const loadCountries = () => (countries ??= fetch('/geo/countries-110m.json').then(r => r.json()).then(g => g.features as CountryFeature[]));

/**
 * Mounts the scene into the returned ref; the scene is null until the country outlines are loaded. Each scene lives
 * in its own layer inside the ref: when the view changes, the new scene fades in over the old one, which is
 * disposed once it has faded out (the flat map turns into the globe and back).
 */
export function useGlobeScene(opts: { autoRotateSpeed?: number; altitude?: number; view?: View } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<WallScene | null>(null);
  const view = opts.view ?? '3d';
  const leaving = useRef(new Set<{ scene: WallScene; timer: number }>());

  useEffect(() => {
    const host = ref.current;
    let alive = true;
    let created: WallScene | null = null;
    const layer = document.createElement('div');
    layer.className = `scene-layer view-${view}`;
    const first = !host?.childElementCount;
    if (!first) layer.classList.add('entering');
    loadCountries().then(features => {
      if (!alive || !host) return;
      host.appendChild(layer);
      created = view === '2d' ? new MapScene(layer, features) : new GlobeScene(layer, features, opts);
      setScene(created);
      // two frames: the layer is in the page at opacity 0 before it starts to fade in
      requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.remove('entering')));
    });
    return () => {
      alive = false;
      const old = created;
      if (!old) { layer.remove(); return; }
      old.onCoopChange = undefined;
      old.onYear = undefined;
      layer.classList.add('leaving');
      const entry = { scene: old, timer: 0 };
      entry.timer = window.setTimeout(() => { leaving.current.delete(entry); old.dispose(); layer.remove(); }, CROSSFADE_MS + 200);
      leaving.current.add(entry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // leaving the page: nothing waits for a fade
  useEffect(() => () => {
    for (const entry of leaving.current) { clearTimeout(entry.timer); entry.scene.dispose(); }
    leaving.current.clear();
  }, []);

  return { ref, scene };
}
