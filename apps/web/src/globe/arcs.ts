/**
 * Cooperation arcs on the GPU: all arcs in one mesh and one draw call. The reveal and the pulses run on time
 * inside the shaders, so nothing is rebuilt while the light spreads and JavaScript only moves a clock. An arc
 * first carries a beam from Košice to its place; when the beam lands, the place answers with light back to
 * Košice, and from then on light travels both ways, as cooperation does (unless the layer is one-shot, as for
 * guest lights). The shape of an arc comes from a path function: over the globe (globeArcPath) or on a flat map.
 */
import * as THREE from 'three';
import type { GlobeInstance } from 'globe.gl';

export interface ArcInput {
  lat: number;
  lon: number;
  color: string;
  /** line width in scene units (on the globe its radius is 100) */
  width: number;
  /** when the beam leaves Košice, in seconds of performance.now() */
  launch: number;
  /** seconds the beam needs for the whole arc */
  travel: number;
  /** 0–1: strength of the steady light after the beam has landed (the first beam is always full); default 1 */
  glow?: number;
}

/** Fills `out` (ARC_SEGMENTS + 1 points) with the arc from Košice to the place at lat/lon. */
export type ArcPath = (lat: number, lon: number, out: THREE.Vector3[]) => void;

const GLOBE_RADIUS = 100;
export const ARC_SEGMENTS = 48;
const SEGMENTS = ARC_SEGMENTS;
const LIFT = 0.008; // above the country fills (0.006), below the stars (0.012)
const ALTITUDE_SCALE = 0.38; // arc height relative to its length, as globe.gl's arcAltitudeAutoScale

const VERTEX = /* glsl */ `
  uniform vec2 uResolution;
  uniform float uMinPx;
  attribute vec3 aPrev, aNext, aColor;
  attribute float aSide, aT, aWidth, aLaunch, aTravel, aGlow;
  varying vec3 vColor;
  varying float vT, vSide, vLaunch, vTravel, vGlow;
  void main() {
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 c = mvp * vec4(position, 1.0);
    vec4 cp = mvp * vec4(aPrev, 1.0);
    vec4 cn = mvp * vec4(aNext, 1.0);
    vec2 dir = (cn.xy / cn.w - cp.xy / cp.w) * uResolution;
    float len = length(dir);
    dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    // half width in pixels: the line's own width in perspective, never thinner than uMinPx, plus room for the glow
    float px = max(aWidth * projectionMatrix[1][1] * uResolution.y * 0.5 / c.w, uMinPx) * 1.6;
    c.xy += nrm * aSide * px / (uResolution * 0.5) * c.w;
    gl_Position = c;
    vColor = aColor;
    vT = aT;
    vSide = aSide;
    vLaunch = aLaunch;
    vTravel = aTravel;
    vGlow = aGlow;
  }`;

const FRAGMENT = /* glsl */ `
  uniform float uTime, uOpacity, uBase, uAmbient;
  varying vec3 vColor;
  varying float vT, vSide, vLaunch, vTravel, vGlow;
  // a pulse whose head is at 'head' (0 = where it starts, 1 = where it ends) with a fading tail behind it
  float pulse(float head, float s, float len) {
    float d = head - s;
    if (d < 0.0 || d > len) return 0.0;
    float k = 1.0 - d / len;
    return k * k;
  }
  void main() {
    float age = uTime - vLaunch;
    if (age <= 0.0) discard;
    float h = age / vTravel;
    float beam = pulse(h, vT, 0.25);
    float light = beam * 1.4;                           // the beam that lights the place
    if (h > 1.0 && uAmbient > 0.0) {
      float slow = vTravel * 3.0;                       // the steady light flows calmer than the first beam
      float k = mod(age - vTravel, slow * 4.0) / slow;
      float steady = pulse(k, 1.0 - vT, 0.22) * 0.5     // the place answers right away: light back to Košice
                   + pulse(k - 2.0, vT, 0.22) * 0.5      // and out again
                   + uBase * smoothstep(1.0, 1.6, h);    // the connection itself stays faintly lit
      light += steady * vGlow;
    }
    light *= 0.15 + 0.85 * smoothstep(0.0, 0.15, vT);   // hundreds of arcs meet in Košice
    float glow = exp(-vSide * vSide * mix(3.2, 1.8, min(beam, 1.0)));
    vec3 col = mix(vec3(1.0), vColor, smoothstep(0.0, 0.3, vT));
    col = mix(col, vec3(1.0), clamp(light - 0.9, 0.0, 1.0) * 0.6); // only the head of the beam burns white
    gl_FragColor = vec4(col * light * glow * uOpacity, 1.0);
  }`;

function slerp(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  const omega = a.angleTo(b);
  if (omega < 1e-4) return a.clone().lerp(b, t).normalize();
  const s = Math.sin(omega);
  return a.clone().multiplyScalar(Math.sin((1 - t) * omega) / s).addScaledVector(b, Math.sin(t * omega) / s);
}

/** Arcs over the globe, shaped like globe.gl's: a cubic Bézier lifted in proportion to the distance. */
export function globeArcPath(globe: GlobeInstance, origin: { lat: number; lon: number }): ArcPath {
  const o = globe.getCoords(origin.lat, origin.lon, 0);
  const u0 = new THREE.Vector3(o.x, o.y, o.z).normalize();
  return (lat, lon, out) => {
    const e = globe.getCoords(lat, lon, 0);
    const u3 = new THREE.Vector3(e.x, e.y, e.z).normalize();
    const alt = (u0.angleTo(u3) / 2) * ALTITUDE_SCALE;
    const curve = new THREE.CubicBezierCurve3(
      u0.clone().multiplyScalar(GLOBE_RADIUS * (1 + LIFT)),
      slerp(u0, u3, 0.25).multiplyScalar(GLOBE_RADIUS * (1 + LIFT + alt * 1.5)),
      slerp(u0, u3, 0.75).multiplyScalar(GLOBE_RADIUS * (1 + LIFT + alt * 1.5)),
      u3.clone().multiplyScalar(GLOBE_RADIUS * (1 + LIFT)),
    );
    for (let i = 0; i <= SEGMENTS; i++) curve.getPoint(i / SEGMENTS, out[i]!);
  };
}

export class ArcLayer {
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly size = new THREE.Vector2();
  private opacity = 1;
  private targetOpacity = 1;

  /** ambient: false for one-shot beams (guest lights) that end when they land */
  constructor(private readonly scene: THREE.Scene, private readonly renderer: THREE.WebGLRenderer, private readonly path: ArcPath, { ambient = true } = {}) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: performance.now() / 1000 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uMinPx: { value: renderer.getPixelRatio() },
        uOpacity: { value: 1 },
        uBase: { value: 0.02 },
        uAmbient: { value: ambient ? 1 : 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  /** Called by the scene every frame: the clock, the screen size and a fade when the scene changes. */
  update(seconds: number, dt: number): void {
    const u = this.material.uniforms;
    u.uTime!.value = seconds;
    this.renderer.getDrawingBufferSize(this.size);
    (u.uResolution!.value as THREE.Vector2).copy(this.size);
    if (this.opacity !== this.targetOpacity) {
      const step = dt / 0.6;
      this.opacity = this.targetOpacity > this.opacity ? Math.min(this.targetOpacity, this.opacity + step) : Math.max(this.targetOpacity, this.opacity - step);
      u.uOpacity!.value = this.opacity;
    }
    this.mesh.visible = this.opacity > 0;
  }

  /** 1 shows the arcs, 0 hides them (the guest-lights scene); the change fades over 0.6 s. */
  setOpacity(value: number): void { this.targetOpacity = value; }

  set(arcs: ArcInput[]): void {
    const P = SEGMENTS + 1, V = P * 2, n = arcs.length;
    const pos = new Float32Array(n * V * 3), prev = new Float32Array(n * V * 3), next = new Float32Array(n * V * 3), col = new Float32Array(n * V * 3);
    const side = new Float32Array(n * V), along = new Float32Array(n * V), width = new Float32Array(n * V), launch = new Float32Array(n * V), travel = new Float32Array(n * V), glow = new Float32Array(n * V);
    const index = new Uint32Array(n * SEGMENTS * 6);
    const pts = Array.from({ length: P }, () => new THREE.Vector3());
    const lens = new Float32Array(P);
    const color = new THREE.Color(), rgb = { r: 0, g: 0, b: 0 };
    arcs.forEach((a, k) => {
      this.path(a.lat, a.lon, pts);
      let total = 0;
      for (let i = 0; i < P; i++) {
        if (i) total += pts[i]!.distanceTo(pts[i - 1]!);
        lens[i] = total;
      }
      color.set(a.color).getRGB(rgb, THREE.SRGBColorSpace); // sRGB values: the shader writes them out unconverted
      for (let i = 0; i < P; i++) {
        const p = pts[i]!, pv = pts[Math.max(0, i - 1)]!, nx = pts[Math.min(SEGMENTS, i + 1)]!;
        for (let s = 0; s < 2; s++) {
          const v = k * V + i * 2 + s;
          pos[v * 3] = p.x; pos[v * 3 + 1] = p.y; pos[v * 3 + 2] = p.z;
          prev[v * 3] = pv.x; prev[v * 3 + 1] = pv.y; prev[v * 3 + 2] = pv.z;
          next[v * 3] = nx.x; next[v * 3 + 1] = nx.y; next[v * 3 + 2] = nx.z;
          col[v * 3] = rgb.r; col[v * 3 + 1] = rgb.g; col[v * 3 + 2] = rgb.b;
          side[v] = s ? 1 : -1;
          along[v] = total > 0 ? lens[i]! / total : i / SEGMENTS; // by length, so the light moves at an even pace
          width[v] = a.width;
          launch[v] = a.launch;
          travel[v] = a.travel;
          glow[v] = a.glow ?? 1;
        }
      }
      for (let i = 0; i < SEGMENTS; i++) {
        const b = k * V + i * 2, j = (k * SEGMENTS + i) * 6;
        index[j] = b; index[j + 1] = b + 2; index[j + 2] = b + 1; // counter-clockwise on screen
        index[j + 3] = b + 1; index[j + 4] = b + 2; index[j + 5] = b + 3;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPrev', new THREE.BufferAttribute(prev, 3));
    g.setAttribute('aNext', new THREE.BufferAttribute(next, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aT', new THREE.BufferAttribute(along, 1));
    g.setAttribute('aWidth', new THREE.BufferAttribute(width, 1));
    g.setAttribute('aLaunch', new THREE.BufferAttribute(launch, 1));
    g.setAttribute('aTravel', new THREE.BufferAttribute(travel, 1));
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
