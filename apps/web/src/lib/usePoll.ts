import { useEffect, useRef } from 'react';

/**
 * Calls fn every intervalMs. On failure waits longer (up to 30 s) and keeps trying, so the wall
 * recovers by itself after a network outage. Stops when the component unmounts.
 */
export function usePoll(fn: () => Promise<void>, intervalMs: number, enabled = true): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer = 0;
    let delay = intervalMs;
    const run = async () => {
      try { await fnRef.current(); delay = intervalMs; } catch { delay = Math.min(delay * 2, 30_000); }
      if (!stopped) timer = window.setTimeout(run, delay);
    };
    run();
    return () => { stopped = true; clearTimeout(timer); };
  }, [intervalMs, enabled]);
}
