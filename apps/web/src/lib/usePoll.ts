import { useEffect, useRef } from 'react';

/**
 * Calls fn every intervalMs. On failure waits longer (up to 30 s) and keeps trying, so the wall
 * recovers by itself after a network outage. Pauses while the tab is hidden and polls right away
 * when it becomes visible again. Stops when the component unmounts.
 */
export function usePoll(fn: () => Promise<void>, intervalMs: number, enabled = true): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let running = false;
    let timer = 0;
    let delay = intervalMs;
    const run = async () => {
      if (stopped || document.hidden) return; // resumed by visibilitychange
      running = true;
      try { await fnRef.current(); delay = intervalMs; } catch { delay = Math.min(delay * 2, 30_000); }
      running = false;
      if (!stopped) timer = window.setTimeout(run, delay);
    };
    const onVisibility = () => {
      if (document.hidden || running || stopped) return;
      clearTimeout(timer);
      run();
    };
    document.addEventListener('visibilitychange', onVisibility);
    run();
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [intervalMs, enabled]);
}
