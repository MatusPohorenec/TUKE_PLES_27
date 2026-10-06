/** Hover card for stars; rotation pauses while the pointer rests on a star. */
import { useEffect, useRef, useState } from 'react';
import type { GlobeScene, PickResult } from '../globe/scene.ts';

const km = (n: number) => `${n.toLocaleString('sk')} km`;

export function GlobeTooltip({ scene, host, onPick }: { scene: GlobeScene | null; host: HTMLElement | null; onPick?: (hit: PickResult | null) => void }) {
  const [hit, setHit] = useState<{ result: PickResult; x: number; y: number } | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scene || !host) return;
    const move = (e: PointerEvent) => {
      const result = scene.pick(e.clientX, e.clientY);
      scene.setAutoRotate(!result);
      host.style.cursor = result ? 'pointer' : '';
      setHit(result ? { result, x: e.clientX, y: e.clientY } : null);
    };
    const leave = () => { scene.setAutoRotate(true); setHit(null); };
    const click = (e: MouseEvent) => onPick?.(scene.pick(e.clientX, e.clientY));
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    host.addEventListener('click', click);
    return () => { host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave); host.removeEventListener('click', click); };
  }, [scene, host, onPick]);

  if (!hit) return null;
  const { result, x, y } = hit;
  const left = Math.min(x + 16, innerWidth - 356);
  const top = Math.min(y + 16, innerHeight - 140);
  return (
    <div ref={tip} className="tip" style={{ left, top }}>
      {result.kind === 'coop' ? (
        <>
          <b>{result.place.name}</b> <span className="muted">· {result.place.country} · {km(result.place.distanceKm)}</span><br />
          {result.place.institutions} {result.place.institutions === 1 ? 'partnerská inštitúcia' : result.place.institutions < 5 ? 'partnerské inštitúcie' : 'partnerských inštitúcií'}
          <span className="muted"> · {result.place.links} {result.place.links === 1 ? 'väzba' : result.place.links < 5 ? 'väzby' : 'väzieb'}</span>
          {onPick && <><br /><span className="muted">Klikni pre detail</span></>}
        </>
      ) : (
        <>
          <b>{result.place.name}</b><br />
          <span style={{ color: 'var(--warm)' }}>{result.place.count} {result.place.count === 1 ? 'svetlo hosťa' : result.place.count < 5 ? 'svetlá hostí' : 'svetiel hostí'}</span>
        </>
      )}
    </div>
  );
}
