/**
 * The 3D view: a dark planet (globe.gl), country outlines, arcs from Košice (cooperation tinted by legend group,
 * guest lights in gold) and two star layers. The timeline, the guests and the country colours are shared with the
 * flat map (core.ts); this file adds the globe, its rotation and the screen positions.
 */
import Globe, { type GlobeInstance } from 'globe.gl';
import { Vector3, type LineSegments, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { ORIGIN } from '@ples/shared/constants';
import type { GlobePlace } from '@ples/shared';
import { ArcLayer, globeArcPath } from './arcs.ts';
import { createBorders } from './borders.ts';
import { GUEST_ARC_STYLE, GUEST_STAR_WHITE, WallScene, type CountryFeature } from './core.ts';
import { StarLayer } from './stars.ts';

export { GROUP_COLOR, GUEST_COLOR, WallScene } from './core.ts';
export type { CountryFeature, GuestPlace, PickResult, SceneMode } from './core.ts';

const smoothstep = (e0: number, e1: number, x: number) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };

const GLOBE_RADIUS = 100; // three-globe units
const FOCUS_SPEED = 1.6; // × base speed at most while a card is on screen
const REVEAL_SPEED = 0.3; // × base speed while the light spreads, so the beams can be followed
const PHOTO_TURN_MS = 2200; // the globe turns to the place of a guest's photo …
const PHOTO_LAT: readonly [number, number] = [8, 45]; // … keeping its usual tilt (the view starts at 38° N)

export class GlobeScene extends WallScene {
  readonly globe: GlobeInstance;
  private readonly borders: LineSegments;
  private readonly ro: ResizeObserver;
  private title?: { el: HTMLElement; bottomGap: number; bottom: number; limit?: () => number | null };
  /** unit vectors of every lit place (x, y, z per place): how much is there to see in the current view */
  private interest = new Float32Array(0);
  private readonly rotation: { base: number; max: number; speed: number; focused: boolean; last: number };
  /** degrees the view has turned since resetTurns(), and the camera's last azimuth */
  private turned = { degrees: 0, azimuth: NaN };

  constructor(private readonly el: HTMLElement, countries: CountryFeature[], opts: { autoRotateSpeed?: number; altitude?: number } = {}) {
    super();
    this.globe = new Globe(el, { rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' } })
      .width(el.clientWidth).height(el.clientHeight)
      .backgroundColor('rgba(0,0,0,0)')
      .atmosphereColor('#4f7dff').atmosphereAltitude(0.2)
      .polygonsData(countries)
      .polygonAltitude(0.006)
      .polygonSideColor(() => '') // no sides
      .polygonCapMaterial((f: object) => this.countryMaterial((f as CountryFeature).properties.iso2)) // colours change without a rebuild
      .polygonsTransitionDuration(900)
      .ringsData([ORIGIN]).ringLat('lat').ringLng('lon')
      .ringColor(() => (t: number) => `rgba(255,255,255,${1 - t})`)
      .ringMaxRadius(5).ringPropagationSpeed(2.2).ringRepeatPeriod(1100);

    const material = this.globe.globeMaterial() as unknown as { color: { set(c: string): void }; emissive: { set(c: string): void }; shininess: number };
    material.color.set('#030a24'); // the "switched-off" planet
    material.emissive.set('#01040f');
    material.shininess = 6;
    this.globe.pointOfView({ lat: 38, lng: 21, altitude: opts.altitude ?? 2.1 });
    const controls = this.globe.controls() as unknown as { autoRotate: boolean; autoRotateSpeed: number; enableZoom: boolean };
    controls.autoRotate = true;
    controls.autoRotateSpeed = opts.autoRotateSpeed ?? 0.45;
    controls.enableZoom = true;
    const base = opts.autoRotateSpeed ?? 0.45;
    this.rotation = { base, max: base * 3, speed: base, focused: false, last: 0 };

    const scene = this.globe.scene() as Scene;
    const renderer = this.globe.renderer() as WebGLRenderer;
    this.borders = createBorders(this.globe, countries, { altitude: 0.0062, color: '#bed2ff', opacity: 0.22 });
    scene.add(this.borders);
    // all arcs are ours (one mesh per layer); globe.gl's own arc layer stays unused
    this.arcs = new ArcLayer(scene, renderer, globeArcPath(this.globe, ORIGIN));
    this.guestArcs = new ArcLayer(scene, renderer, globeArcPath(this.globe, ORIGIN), GUEST_ARC_STYLE);
    const onGlobe = (altitude: number) => (lat: number, lon: number) => { const c = this.globe.getCoords(lat, lon, altitude); return new Vector3(c.x, c.y, c.z); };
    this.coopStars = new StarLayer({ scene, renderer, camera: () => this.camera(), place: onGlobe(0.012) });
    this.guestStars = new StarLayer({ scene, renderer, camera: () => this.camera(), place: onGlobe(0.016), whiteCore: GUEST_STAR_WHITE });
    this.ro = new ResizeObserver(() => {
      this.globe.width(el.clientWidth).height(el.clientHeight);
      if (this.title) { this.fitBelowTitle(); this.fadeTitle(); }
    });
    this.ro.observe(el);
    this.renderCoopStars();
    this.startLoop();
  }

  // ---------------------------------------------------------------- rotation

  /**
   * Turns faster where there is little to see: up to three times the base speed over an empty ocean
   * (the Pacific), the base speed wherever a few dozen lit places face the viewer. During the reveal it turns
   * slowly, so the beams can be followed to where they land; while a card is on screen only a little faster
   * than the base speed, so the card can still be read.
   */
  protected override frameTick(now: number): void {
    const controls = this.globe.controls() as unknown as { autoRotate: boolean; autoRotateSpeed: number };
    const r = this.rotation;
    const dt = Math.min(0.1, (now - r.last) / 1000);
    r.last = now;
    const cam = this.camera().position;
    const azimuth = (Math.atan2(cam.x, cam.z) * 180) / Math.PI;
    if (!Number.isNaN(this.turned.azimuth) && controls.autoRotate) { // turning to a photo's place is no turn of the wall
      const step = ((azimuth - this.turned.azimuth + 540) % 360) - 180; // across ±180° without a jump
      this.turned.degrees += Math.abs(step);
    }
    this.turned.azimuth = azimuth;
    if (!controls.autoRotate) return;
    let target = this.revealing() ? r.base * REVEAL_SPEED : r.base;
    if (!this.revealing()) {
      const cam = this.camera().position;
      const len = cam.length();
      const cx = cam.x / len, cy = cam.y / len, cz = cam.z / len;
      const a = this.interest;
      let seen = 0; // places in the middle of the disc count fully, towards the horizon less, behind not at all
      for (let i = 0; i < a.length; i += 3) seen += smoothstep(0.5, 0.95, a[i]! * cx + a[i + 1]! * cy + a[i + 2]! * cz);
      target += (r.max - r.base) * (1 - smoothstep(8, 45, seen));
      if (r.focused) target = Math.min(target, r.base * FOCUS_SPEED);
    }
    const ease = target > r.speed ? 2 : 0.8; // speed up gently (after the reveal), slow down within a second
    r.speed += (target - r.speed) * (1 - Math.exp(-dt / ease));
    controls.autoRotateSpeed = r.speed;
  }

  protected override revealStarts(first: boolean): void {
    if (first) this.rotation.speed = this.rotation.base * REVEAL_SPEED; // the page opens calm; a replay slows down smoothly
  }

  /** While a card is on screen the globe turns at most a little faster than the base speed. */
  setFocus(on: boolean): void { this.rotation.focused = on; }

  /** Degrees of longitude the view turns in the given time while a card is up (the camera moves west, places drift east). */
  turnWhileFocused(seconds: number): number {
    const controls = this.globe.controls() as unknown as { autoRotate: boolean };
    return controls.autoRotate ? 6 * Math.min(this.rotation.speed, this.rotation.base * FOCUS_SPEED) * seconds : 0;
  }

  setAutoRotate(on: boolean): void {
    (this.globe.controls() as unknown as { autoRotate: boolean }).autoRotate = on;
  }

  /** Full turns the globe has made since resetTurns() (the wall's cycle counts them after the opening). */
  turns(): number { return this.turned.degrees / 360; }

  resetTurns(): void { this.turned.degrees = 0; }

  /** Stops turning and brings a place to the middle of the view (before the flat map takes over). */
  turnTo(lat: number, lon: number, ms: number): void {
    this.setAutoRotate(false);
    const { altitude } = this.globe.pointOfView();
    this.globe.pointOfView({ lat, lng: lon, altitude }, ms);
  }

  /** A guest's photo: the globe stops and, unless the place already faces the viewer, turns to it. */
  override showPlace(lat: number, lon: number): number {
    this.setAutoRotate(false);
    if (this.facing(lat, lon) > 0.8) return 0;
    this.turnTo(Math.min(PHOTO_LAT[1], Math.max(PHOTO_LAT[0], lat)), lon, PHOTO_TURN_MS);
    return PHOTO_TURN_MS;
  }

  /** The photo is gone: the globe turns again, speeding up gently from a standstill. */
  override endShowPlace(): void {
    this.rotation.speed = 0;
    this.setAutoRotate(true);
  }

  protected override placesChanged(): void {
    const places = [...this.visibleCoop(), ...this.landedGuests()];
    const a = new Float32Array(places.length * 3);
    places.forEach((p, i) => {
      const c = this.globe.getCoords(p.lat, p.lon, 0);
      const len = Math.hypot(c.x, c.y, c.z) || 1;
      a[i * 3] = c.x / len; a[i * 3 + 1] = c.y / len; a[i * 3 + 2] = c.z / len;
    });
    this.interest = a;
  }

  // ---------------------------------------------------------------- screen positions (cards on the wall)

  screenPoint(lat: number, lon: number, altitude = 0.012): { x: number; y: number; facing: number } {
    const c = this.globe.getCoords(lat, lon, altitude);
    const p = new Vector3(c.x, c.y, c.z);
    const facing = this.facing(lat, lon, altitude);
    p.project(this.camera());
    const rect = this.el.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, facing };
  }

  disc(): { x: number; y: number; r: number } {
    const rect = this.el.getBoundingClientRect();
    const [ox, oy] = this.globe.globeOffset();
    return { x: rect.left + rect.width / 2 + ox, y: rect.top + rect.height / 2 + oy, r: this.globeRadiusPx() };
  }

  facing(lat: number, lon: number, altitude = 0.012): number {
    const c = this.globe.getCoords(lat, lon, altitude);
    const cam = this.camera().position;
    const horizon = GLOBE_RADIUS / cam.length();
    return (new Vector3(c.x, c.y, c.z).normalize().dot(cam.clone().normalize()) - horizon) / (1 - horizon);
  }

  // ---------------------------------------------------------------- overlay title

  /**
   * Keeps an overlay title clear of the globe on any screen shape: the starting view fits the globe between
   * the title and the bottom edge, and when the globe is zoomed into the title, the title fades out.
   */
  attachTitle(el: HTMLElement, { bottomGap = 24, bottom }: { bottomGap?: number; bottom?: () => number | null } = {}): void {
    this.title = { el, bottomGap, bottom: 0, limit: bottom };
    this.fitBelowTitle();
    this.globe.onZoom(() => this.fadeTitle());
    this.fadeTitle();
  }

  private camera(): PerspectiveCamera {
    return this.globe.camera() as PerspectiveCamera;
  }

  /** Radius of the globe on screen in CSS pixels, from the camera distance and field of view. */
  private globeRadiusPx(): number {
    const cam = this.camera();
    const alpha = Math.asin(Math.min(1, GLOBE_RADIUS / cam.position.length()));
    return (Math.tan(alpha) / Math.tan((cam.fov * Math.PI) / 360)) * (this.el.clientHeight / 2);
  }

  private fitBelowTitle(): void {
    if (!this.title) return;
    const h = this.el.clientHeight;
    this.title.bottom = this.title.el.getBoundingClientRect().bottom;
    const top = this.title.bottom + 16;
    // bottom(): where the globe has to end (e.g. above the counters on a phone), in client pixels
    const bottom = Math.min(h - this.title.bottomGap, (this.title.limit?.() ?? Infinity) - this.el.getBoundingClientRect().top);
    const radius = Math.min((bottom - top) / 2, this.el.clientWidth * 0.46);
    if (radius < 80) return; // very small screens keep the default view
    this.globe.globeOffset([0, Math.round((top + bottom) / 2 - h / 2)]);
    const tanAlpha = (radius / (h / 2)) * Math.tan((this.camera().fov * Math.PI) / 360);
    const altitude = 1 / Math.sin(Math.atan(tanAlpha)) - 1;
    const { lat, lng } = this.globe.pointOfView();
    this.globe.pointOfView({ lat, lng, altitude }, 0);
  }

  private fadeTitle(): void {
    if (!this.title) return;
    const centerY = this.el.clientHeight / 2 + this.globe.globeOffset()[1];
    const overlap = this.title.bottom + 8 - (centerY - this.globeRadiusPx());
    const t = Math.min(1, Math.max(0, overlap / 90));
    this.title.el.style.opacity = String(1 - t * t * (3 - 2 * t));
  }

  // ---------------------------------------------------------------- drawing

  protected arcWidth(p: GlobePlace): number { return 0.12 + Math.min(p.links, 12) * 0.02; }

  protected guestArcWidth(): number { return 0.42; }

  override dispose(): void {
    super.dispose();
    this.ro.disconnect();
    this.borders.geometry.dispose();
    (this.borders.material as { dispose(): void }).dispose();
    const renderer = this.globe.renderer() as WebGLRenderer;
    this.globe._destructor?.();
    // the wall's 2D/3D cycle makes a new scene every round: give the WebGL context back at once
    try { renderer.dispose(); renderer.forceContextLoss(); } catch { /* already gone */ }
    this.el.replaceChildren();
  }
}
