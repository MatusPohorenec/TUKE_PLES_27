/**
 * Country outlines in one draw call (globe.gl draws one line per polygon, a few hundred draw calls).
 * Long edges are split along the great circle, so the lines follow the curve of the globe.
 */
import * as THREE from 'three';
import type { GlobeInstance } from 'globe.gl';

type Ring = number[][];

const MAX_STEP = (2 * Math.PI) / 180; // at most 2° per segment

export function createBorders(globe: GlobeInstance, features: { geometry: object }[], { altitude, color, opacity }: { altitude: number; color: string; opacity: number }): THREE.LineSegments {
  const out: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3();
  const at = (lon: number, lat: number, v: THREE.Vector3) => { const c = globe.getCoords(lat, lon, altitude); return v.set(c.x, c.y, c.z); };
  const ring = (r: Ring) => {
    for (let i = 1; i < r.length; i++) {
      at(r[i - 1]![0]!, r[i - 1]![1]!, a);
      at(r[i]![0]!, r[i]![1]!, b);
      const steps = Math.max(1, Math.ceil(a.angleTo(b) / MAX_STEP));
      const len = a.length();
      p.copy(a);
      for (let s = 1; s <= steps; s++) {
        q.copy(a).lerp(b, s / steps).setLength(len); // on the sphere, close enough to the great circle for 2° steps
        out.push(p.x, p.y, p.z, q.x, q.y, q.z);
        p.copy(q);
      }
    }
  };
  for (const f of features) {
    const g = f.geometry as { type: string; coordinates: unknown };
    const polygons = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as Ring[][];
    for (const polygon of polygons) for (const r of polygon) ring(r);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  lines.renderOrder = 2;
  return lines;
}
