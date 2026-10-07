import { useEffect, useRef, useState } from 'react';
import type { CountryFeature, WallScene } from './core.ts';
import { MapScene } from './map2d.ts';
import { GlobeScene } from './scene.ts';

/** '3d' = the globe, '2d' = the flat world map (same wall, to compare which reads better). */
export type View = '3d' | '2d';

let countries: Promise<CountryFeature[]> | undefined;
const loadCountries = () => (countries ??= fetch('/geo/countries-110m.json').then(r => r.json()).then(g => g.features as CountryFeature[]));

/** Mounts the scene into the returned ref; the scene is null until the country outlines are loaded. */
export function useGlobeScene(opts: { autoRotateSpeed?: number; altitude?: number; view?: View } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<WallScene | null>(null);
  const view = opts.view ?? '3d';
  useEffect(() => {
    let alive = true;
    let created: WallScene | null = null;
    loadCountries().then(features => {
      if (!alive || !ref.current) return;
      created = view === '2d' ? new MapScene(ref.current, features) : new GlobeScene(ref.current, features, opts);
      setScene(created);
    });
    return () => { alive = false; created?.dispose(); setScene(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  return { ref, scene };
}
