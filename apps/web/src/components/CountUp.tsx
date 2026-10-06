/**
 * A counter that runs towards its value instead of jumping, so the numbers on the wall rise as smoothly as the
 * light spreads (the scene reports new totals in small batches). The text is written straight into the
 * element every frame; React only renders the element itself.
 */
import { useLayoutEffect, useRef } from 'react';
import { fmt } from '../lib/format.ts';

const EASE_S = 0.4; // about 0.4 s to cover two thirds of a change

export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLElement>(null);
  const shown = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (shown.current === null || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shown.current = value;
      el.textContent = fmt(value);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const from = shown.current!;
      let next = from + (value - from) * (1 - Math.exp(-dt / EASE_S));
      if (Math.abs(value - next) < 0.5) next = value;
      shown.current = next;
      el.textContent = fmt(Math.round(next));
      if (next !== value) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <b ref={ref} />;
}
