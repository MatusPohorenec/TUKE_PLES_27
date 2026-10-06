import { useEffect, useRef } from 'react';

/** Faint static stars behind the globe; redrawn on resize. */
export function Starfield({ count = 420 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const draw = () => {
      c.width = innerWidth;
      c.height = innerHeight;
      for (let i = 0; i < count; i++) {
        ctx.fillStyle = `rgba(215,225,255,${Math.random() * 0.6 + 0.1})`;
        ctx.beginPath();
        ctx.arc(Math.random() * c.width, Math.random() * c.height, Math.random() * 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();
    addEventListener('resize', draw);
    return () => removeEventListener('resize', draw);
  }, [count]);
  return <canvas ref={ref} className="starfield" aria-hidden="true" />;
}
