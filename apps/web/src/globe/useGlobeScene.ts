import { useEffect, useRef, useState } from 'react';
import { GlobeScene, type CountryFeature } from './scene.ts';

let countries: Promise<CountryFeature[]> | undefined;
const loadCountries = () => (countries ??= fetch('/geo/countries-110m.json').then(r => r.json()).then(g => g.features as CountryFeature[]));

/** Mounts a GlobeScene into the returned ref; the scene is null until the country outlines are loaded. */
export function useGlobeScene(opts?: { autoRotateSpeed?: number; altitude?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<GlobeScene | null>(null);
  useEffect(() => {
    let alive = true;
    let created: GlobeScene | null = null;
    loadCountries().then(features => {
      if (!alive || !ref.current) return;
      created = new GlobeScene(ref.current, features, opts);
      setScene(created);
    });
    return () => { alive = false; created?.dispose(); setScene(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ref, scene };
}
