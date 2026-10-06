/** Hard facts for the globe; the last good copy is kept in localStorage so a reload works offline. */
import { useEffect, useState } from 'react';
import type { GlobeResponse } from '@ples/shared';
import { api } from './api.ts';
import { store } from './device.ts';

const KEY = 'ples-globe-cache';

export function useGlobeData() {
  const [data, setData] = useState<GlobeResponse | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api.globe()
      .then(d => { if (alive) { setData(d); store.set(KEY, d); } })
      .catch(err => {
        const cached = store.get<GlobeResponse>(KEY);
        if (!alive) return;
        if (cached) setData(cached);
        else setError((err as Error).message);
      });
    return () => { alive = false; };
  }, []);
  return { data, error };
}
