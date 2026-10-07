/**
 * Twinkling stars on the globe: one THREE.Points draw call per layer. The star shape (core, halo, four long
 * and four short rays) and the twinkle live in the shaders; JavaScript only uploads positions and attributes.
 */
import * as THREE from 'three';

export interface StarInput {
  id: string;
  lat: number;
  lon: number;
  /** diameter in CSS pixels at the default camera distance */
  size: number;
  color: string;
  /** seconds until the star lights up (e.g. when its arc arrives); negative: it has been lit for that long */
  delay?: number;
  /** 0–1: dimmer stars in a dense cluster, so the cluster does not burn white (default 1) */
  dim?: number;
}

export interface PlacedStar extends StarInput { pos: THREE.Vector3 }

export interface StarLayerOptions {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: () => THREE.Camera;
  /** where a star sits in the scene */
  place: (lat: number, lon: number) => THREE.Vector3;
  /** camera distance at which stars have their nominal size (the globe's default view: 210) */
  refDist?: number;
  /** stars on a sphere: picking skips the far side */
  sphere?: boolean;
}

const VERTEX = /* glsl */ `
  uniform float uTime, uPixelRatio, uRefDist, uMaxSize, uSizeScale;
  attribute float aSize, aPhase, aSpeed, aBorn, aSeed, aDim;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vTwinkle, vGlint, vAppear, vAngle, vDim;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float age = uTime - aBorn;
    vAppear = smoothstep(0.0, 1.2, age);
    float ignite = age > 0.0 ? exp(-age * 1.6) : 0.0;             // flare when the place lights up
    vTwinkle = 0.72 + 0.28 * sin(uTime * aSpeed + aPhase) * sin(uTime * aSpeed * 0.43 + aPhase * 1.7);
    float glint = pow(max(0.0, sin(uTime * aSpeed * 0.23 + aPhase * 3.1)), 70.0);   // rare sharp sparkle
    vGlint = max(glint, ignite);
    vAngle = (aSeed - 0.5) * 0.45 + 0.1 * sin(uTime * 0.35 + aPhase);
    vColor = aColor;
    vDim = aDim;
    float zoom = pow(uRefDist / max(-mv.z, 1.0), 0.6);
    gl_PointSize = min(aSize * uSizeScale * (0.8 + 0.25 * vTwinkle + 0.85 * vGlint) * zoom * uPixelRatio, uMaxSize);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAGMENT = /* glsl */ `
  uniform float uIntensity, uRays, uDimAmount;
  varying vec3 vColor;
  varying float vTwinkle, vGlint, vAppear, vAngle, vDim;
  float ray(vec2 p, float len, float width) {
    return exp(-abs(p.y) * width) * pow(max(0.0, 1.0 - abs(p.x) / len), 2.0);
  }
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float c = cos(vAngle), s = sin(vAngle);
    vec2 q = mat2(c, s, -s, c) * p;
    vec2 d = mat2(0.70710678, 0.70710678, -0.70710678, 0.70710678) * q;
    float len = 0.72 + 0.28 * vGlint;
    float spikes = ((ray(q, len, 46.0) + ray(q.yx, len, 46.0)) * (0.8 + 0.8 * vGlint)
                 + (ray(d, len * 0.5, 80.0) + ray(d.yx, len * 0.5, 80.0)) * (0.18 + 0.6 * vGlint)) * uRays;
    float core = exp(-r * r * 70.0);
    float halo = exp(-r * 6.5) * 0.5;
    float light = (core * 1.6 + halo + spikes) * vTwinkle * (1.0 + 1.3 * vGlint) * vAppear * uIntensity * mix(mix(1.0, vDim, uDimAmount), 1.0, vGlint);
    light *= smoothstep(1.0, 0.75, r);
    vec3 col = mix(vColor, vec3(1.0), clamp(core * 1.3 + spikes * 0.35, 0.0, 1.0));
    gl_FragColor = vec4(col * light, 1.0);
  }`;

/** Stable pseudo-random number per id, so a star keeps its rhythm when the layer is rebuilt. */
function rand(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

const now = () => performance.now() / 1000;

export class StarLayer {
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private readonly born = new Map<string, number>();
  private stars: PlacedStar[] = [];
  private frame = 0;
  private readonly o: Required<StarLayerOptions>;

  constructor(options: StarLayerOptions) {
    this.o = { refDist: 210, sphere: true, ...options };
    const renderer = this.o.renderer;
    const gl = renderer.getContext();
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: now() },
        uPixelRatio: { value: renderer.getPixelRatio() },
        uRefDist: { value: this.o.refDist },
        uMaxSize: { value: Math.min(range[1] ?? 64, 160) },
        uIntensity: { value: 1 },
        uSizeScale: { value: 1 },
        uRays: { value: 1 },
        uDimAmount: { value: 1 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.o.scene.add(this.points);
    const tick = () => {
      this.material.uniforms.uTime!.value = now();
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  set(list: StarInput[]): void {
    const t = now();
    const ids = new Set(list.map(s => s.id));
    for (const id of this.born.keys()) if (!ids.has(id)) this.born.delete(id);
    const n = list.length;
    const f = (k: number) => new Float32Array(n * k);
    const pos = f(3), col = f(3), size = f(1), phase = f(1), speed = f(1), birth = f(1), seed = f(1), dim = f(1);
    const color = new THREE.Color();
    this.stars = list.map((s, i) => {
      if (!this.born.has(s.id)) this.born.set(s.id, t + (s.delay ?? 0));
      const p = this.o.place(s.lat, s.lon);
      pos.set([p.x, p.y, p.z], i * 3);
      color.set(s.color); // sRGB values on purpose: the shader writes them out unconverted
      col.set([color.r, color.g, color.b], i * 3);
      size[i] = s.size;
      phase[i] = rand(s.id, 1) * Math.PI * 2;
      speed[i] = 0.8 + rand(s.id, 2) * 1.6;
      seed[i] = rand(s.id, 3);
      dim[i] = s.dim ?? 1;
      birth[i] = this.born.get(s.id)!;
      return { ...s, pos: new THREE.Vector3(p.x, p.y, p.z) };
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    g.setAttribute('aBorn', new THREE.BufferAttribute(birth, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aDim', new THREE.BufferAttribute(dim, 1));
    this.points.geometry.dispose();
    this.points.geometry = g;
  }

  /** Forget when the stars lit up, so the next set() lights them again (the reveal starts over). */
  clear(): void { this.born.clear(); }

  /** Flare a star again (another guest added the same place); applied at the next set(). */
  ignite(id: string, delay = 0): void {
    if (this.born.has(id)) this.born.set(id, now() + delay);
  }

  setIntensity(value: number): void {
    this.material.uniforms.uIntensity!.value = value;
  }

  /** Size multiplier of every star (the flat map shrinks them when it shows the whole world). */
  setSizeScale(value: number): void { this.material.uniforms.uSizeScale!.value = value; }

  /** Strength of the long and short rays (1 = full). */
  setRays(value: number): void { this.material.uniforms.uRays!.value = value; }

  /** How much the per-star `dim` applies (0 = not at all, 1 = fully). */
  setDimAmount(value: number): void { this.material.uniforms.uDimAmount!.value = value; }

  /** Nearest star (on the visible side of a globe) within maxPx of the pointer. */
  pick(x: number, y: number, maxPx: number): PlacedStar | null {
    const cam = this.o.camera();
    const rect = this.o.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(), toCam = new THREE.Vector3();
    let best: PlacedStar | null = null, bestD = maxPx;
    const t = now();
    for (const s of this.stars) {
      if ((this.born.get(s.id) ?? 0) > t) continue; // not lit yet
      if (this.o.sphere && toCam.copy(cam.position).sub(s.pos).dot(s.pos) <= 0) continue;
      v.copy(s.pos).project(cam);
      const d = Math.hypot(((v.x + 1) / 2) * rect.width + rect.left - x, ((1 - v.y) / 2) * rect.height + rect.top - y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.o.scene.remove(this.points);
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
