/**
 * The globe: a dark planet, country outlines, arcs from Košice and two star layers
 * (cooperation places tinted by legend group, guest lights in warm white).
 * Framework-free on purpose: the wall, the map and later any other screen drive it imperatively.
 */
import Globe, { type GlobeInstance } from 'globe.gl';
import { Vector3, type PerspectiveCamera } from 'three';
import { CATEGORY_GROUPS, ORIGIN, type GroupCode } from '@ples/shared/constants';
import type { GlobePlace } from '@ples/shared';
import { StarLayer, type PlacedStar } from './stars.ts';

export const GROUP_COLOR = Object.fromEntries(CATEGORY_GROUPS.map(g => [g.code, g.color])) as Record<GroupCode, string>;
export const GUEST_COLOR = '#ffd9a0';
const ALL_GROUPS = CATEGORY_GROUPS.map(g => g.code);

export interface CountryFeature { type: 'Feature'; properties: { iso2: string; name: string }; geometry: object }
export interface GuestPlace { key: string; name: string; countryCode: string; lat: number; lon: number; count: number }
export type SceneMode = 'cooperation' | 'live';
export type PickResult = { kind: 'coop'; place: GlobePlace } | { kind: 'guest'; place: GuestPlace };

interface ArcDatum { id: string; kind: 'coop' | 'guest'; lat: number; lon: number; color: string; stroke: number; distanceKm: number; gap: number }

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const smoothstep = (e0: number, e1: number, x: number) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
const hash01 = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return ((h >>> 0) % 1000) / 1000; };

const GUEST_ARC_MS = 2600;
const GLOBE_RADIUS = 100; // three-globe units
const FOCUS_SPEED = 1.6; // × base speed at most while a card is on screen
const GUEST_DASH = 0.3;

export class GlobeScene {
  readonly globe: GlobeInstance;
  private readonly coopStars: StarLayer;
  private readonly guestStars: StarLayer;
  private coop: GlobePlace[] = [];
  private coopShown = 0;
  private revealTimer = 0;
  private groups = new Set<GroupCode>(ALL_GROUPS);
  private readonly coopArcs = new Map<string, ArcDatum>();
  private guests = new Map<string, GuestPlace>();
  private arrivalTimers = new Set<number>();
  private guestArcs: ArcDatum[] = [];
  private mode: SceneMode = 'cooperation';
  private readonly ro: ResizeObserver;
  private title?: { el: HTMLElement; bottomGap: number; bottom: number };
  /** unit vectors of every lit place (x, y, z per place): how much is there to see in the current view */
  private interest = new Float32Array(0);
  private readonly rotation: { base: number; max: number; speed: number; focused: boolean; last: number };
  private frame = 0;
  /** Called whenever the set of visible cooperation places changes (reveal, filters). */
  onCoopChange?: (visible: GlobePlace[]) => void;

  constructor(private readonly el: HTMLElement, countries: CountryFeature[], opts: { autoRotateSpeed?: number; altitude?: number } = {}) {
    this.globe = new Globe(el, { rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' } })
      .width(el.clientWidth).height(el.clientHeight)
      .backgroundColor('rgba(0,0,0,0)')
      .atmosphereColor('#4f7dff').atmosphereAltitude(0.2)
      .polygonsData(countries)
      .polygonAltitude(0.006)
      .polygonSideColor(() => 'rgba(0,0,0,0)')
      .polygonStrokeColor(() => 'rgba(190,210,255,.22)')
      .polygonsTransitionDuration(900)
      .arcStartLat(() => ORIGIN.lat).arcStartLng(() => ORIGIN.lon)
      .arcEndLat((d: object) => (d as ArcDatum).lat).arcEndLng((d: object) => (d as ArcDatum).lon)
      .arcColor((d: object) => { const a = d as ArcDatum; return a.kind === 'guest' ? [rgba('#ffffff', 1), rgba(GUEST_COLOR, 1)] : [rgba('#ffffff', 0.95), rgba(a.color, 0.55)]; })
      .arcAltitudeAutoScale(0.38)
      .arcStroke((d: object) => (d as ArcDatum).stroke)
      .arcDashLength((d: object) => ((d as ArcDatum).kind === 'guest' ? GUEST_DASH : 0.45))
      .arcDashGap((d: object) => ((d as ArcDatum).kind === 'guest' ? 8 : 1.4))
      .arcDashInitialGap((d: object) => (d as ArcDatum).gap)
      .arcDashAnimateTime((d: object) => { const a = d as ArcDatum; return a.kind === 'guest' ? GUEST_ARC_MS : 2200 + a.distanceKm / 4; })
      .arcsTransitionDuration(0)
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

    this.coopStars = new StarLayer(this.globe, 0.012);
    this.guestStars = new StarLayer(this.globe, 0.016);
    this.ro = new ResizeObserver(() => {
      this.globe.width(el.clientWidth).height(el.clientHeight);
      if (this.title) { this.fitBelowTitle(); this.fadeTitle(); }
    });
    this.ro.observe(el);
    this.renderStars();
    const tick = (now: number) => { this.adaptRotation(now); this.frame = requestAnimationFrame(tick); };
    this.frame = requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- rotation

  /**
   * Turns faster where there is little to see: up to three times the base speed over an empty ocean
   * (the Pacific), the base speed wherever a few dozen lit places face the viewer. Not during the reveal;
   * while a card is on screen only a little faster, so the card can still be read.
   */
  private adaptRotation(now: number): void {
    const controls = this.globe.controls() as unknown as { autoRotate: boolean; autoRotateSpeed: number };
    const r = this.rotation;
    const dt = Math.min(0.1, (now - r.last) / 1000);
    r.last = now;
    if (!controls.autoRotate) return;
    let target = r.base;
    if (this.coopShown >= this.coop.length) {
      const cam = this.camera().position;
      const len = cam.length();
      const cx = cam.x / len, cy = cam.y / len, cz = cam.z / len;
      const a = this.interest;
      let seen = 0; // places in the middle of the disc count fully, towards the horizon less, behind not at all
      for (let i = 0; i < a.length; i += 3) seen += smoothstep(0.5, 0.95, a[i]! * cx + a[i + 1]! * cy + a[i + 2]! * cz);
      target += (r.max - r.base) * (1 - smoothstep(8, 45, seen));
      if (r.focused) target = Math.min(target, r.base * FOCUS_SPEED);
    }
    r.speed += (target - r.speed) * (1 - Math.exp(-dt / 0.8)); // ease over about a second, never jump
    controls.autoRotateSpeed = r.speed;
  }

  /** While a card is on screen the globe turns at most a little faster than the base speed. */
  setFocus(on: boolean): void { this.rotation.focused = on; }

  /** Degrees of longitude the view turns in the given time while a card is up (the camera moves west, places drift east). */
  turnWhileFocused(seconds: number): number {
    const controls = this.globe.controls() as unknown as { autoRotate: boolean };
    return controls.autoRotate ? 6 * Math.min(this.rotation.speed, this.rotation.base * FOCUS_SPEED) * seconds : 0;
  }

  private updateInterest(): void {
    const places = [...this.visibleCoop(), ...this.guests.values()];
    const a = new Float32Array(places.length * 3);
    places.forEach((p, i) => {
      const c = this.globe.getCoords(p.lat, p.lon, 0);
      const len = Math.hypot(c.x, c.y, c.z) || 1;
      a[i * 3] = c.x / len; a[i * 3 + 1] = c.y / len; a[i * 3 + 2] = c.z / len;
    });
    this.interest = a;
  }

  // ---------------------------------------------------------------- screen positions (cards on the wall)

  /** Where a place is on screen and how directly it faces the viewer: 1 = centre of the disc, 0 = horizon, below 0 = behind. */
  screenPoint(lat: number, lon: number, altitude = 0.012): { x: number; y: number; facing: number } {
    const c = this.globe.getCoords(lat, lon, altitude);
    const p = new Vector3(c.x, c.y, c.z);
    const facing = this.facing(lat, lon, altitude);
    p.project(this.camera());
    const rect = this.el.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, facing };
  }

  /** Only how directly a place faces the viewer (see screenPoint), without the projection. */
  facing(lat: number, lon: number, altitude = 0.012): number {
    const c = this.globe.getCoords(lat, lon, altitude);
    const cam = this.camera().position;
    const horizon = GLOBE_RADIUS / cam.length();
    return (new Vector3(c.x, c.y, c.z).normalize().dot(cam.clone().normalize()) - horizon) / (1 - horizon);
  }

  guestPlaces(): GuestPlace[] { return [...this.guests.values()]; }

  currentMode(): SceneMode { return this.mode; }

  /** Makes a star flare up again, e.g. when the wall puts a card on it. */
  flare(kind: 'coop' | 'guest', id: string): void {
    if (kind === 'coop') this.coopStars.ignite(id); else this.guestStars.ignite(`guest:${id}`);
    this.renderStars();
  }

  // ---------------------------------------------------------------- overlay title

  /**
   * Keeps an overlay title clear of the globe on any screen shape: the starting view fits the globe between
   * the title and the bottom edge, and when the globe is zoomed into the title, the title fades out.
   */
  attachTitle(el: HTMLElement, { bottomGap = 24 } = {}): void {
    this.title = { el, bottomGap, bottom: 0 };
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
    const bottom = h - this.title.bottomGap;
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

  // ---------------------------------------------------------------- cooperation

  /** Places sorted by distance from Košice; with reveal the light spreads outwards in about 30 s. */
  setCooperation(places: GlobePlace[], { reveal = false } = {}): void {
    this.coop = [...places].sort((a, b) => a.distanceKm - b.distanceKm);
    clearInterval(this.revealTimer);
    if (!reveal) { this.coopShown = this.coop.length; this.render(); return; }
    this.coopShown = 0;
    this.render();
    const step = Math.max(3, Math.round(this.coop.length / 90));
    this.revealTimer = window.setInterval(() => {
      this.coopShown = Math.min(this.coop.length, this.coopShown + step);
      this.render();
      if (this.coopShown >= this.coop.length) clearInterval(this.revealTimer);
    }, 320);
  }

  replay(): void { this.setCooperation(this.coop, { reveal: true }); }

  setGroups(groups: Iterable<GroupCode>): void { this.groups = new Set(groups); this.render(); }

  visibleCoop(): GlobePlace[] {
    return this.coop.slice(0, this.coopShown).filter(p => p.groups.some(g => this.groups.has(g)));
  }

  // ---------------------------------------------------------------- guests

  /** All guest lights at once (initial load, reconnect), no arrival animation. */
  setGuests(places: GuestPlace[]): void {
    // arrivals still waiting for their turn are part of the new snapshot (or come again from the feed)
    for (const t of this.arrivalTimers) clearTimeout(t);
    this.arrivalTimers.clear();
    this.guests = new Map(places.map(p => [p.key, p]));
    this.render();
  }

  /** Lights added without the flight, e.g. the older part of a big burst. */
  addGuests(pins: { key: string; name: string; countryCode: string; lat: number; lon: number }[]): void {
    for (const pin of pins) {
      const prev = this.guests.get(pin.key);
      this.guests.set(pin.key, prev ? { ...prev, count: prev.count + 1 } : { key: pin.key, name: pin.name, countryCode: pin.countryCode, lat: pin.lat, lon: pin.lon, count: 1 });
    }
    this.renderStars();
    this.renderCountries();
    this.updateInterest();
  }

  /** New lights: a bright dash flies from Košice, the star ignites when it lands. */
  addGuestArrivals(pins: { id: number; key: string; name: string; countryCode: string; lat: number; lon: number }[]): void {
    pins.forEach((pin, i) => {
      const timer = window.setTimeout(() => {
        this.arrivalTimers.delete(timer);
        const arc: ArcDatum = { id: `g${pin.id}`, kind: 'guest', lat: pin.lat, lon: pin.lon, color: GUEST_COLOR, stroke: 0.9, distanceKm: 0, gap: 0 };
        this.guestArcs.push(arc);
        const prev = this.guests.get(pin.key);
        this.guests.set(pin.key, prev ? { ...prev, count: prev.count + 1 } : { key: pin.key, name: pin.name, countryCode: pin.countryCode, lat: pin.lat, lon: pin.lon, count: 1 });
        const landing = ((1 - GUEST_DASH) * GUEST_ARC_MS) / 1000;
        this.guestStars.ignite(`guest:${pin.key}`, landing);
        this.renderStars(landing);
        this.renderArcs();
        this.renderCountries();
        this.updateInterest();
        window.setTimeout(() => { this.guestArcs = this.guestArcs.filter(a => a !== arc); this.renderArcs(); }, GUEST_ARC_MS + 200);
      }, i * 450); // a burst arrives one by one, so every light gets its moment
      this.arrivalTimers.add(timer);
    });
  }

  setMode(mode: SceneMode): void {
    this.mode = mode;
    this.coopStars.setIntensity(mode === 'live' ? 0.45 : 1);
    this.render();
  }

  // ---------------------------------------------------------------- picking, teardown

  pick(x: number, y: number): PickResult | null {
    const guest = this.guestStars.pick(x, y, 14);
    if (guest) return { kind: 'guest', place: this.guests.get(guest.id.slice(6))! };
    const coop: PlacedStar | null = this.coopStars.pick(x, y, 16);
    if (coop) return { kind: 'coop', place: this.coop.find(p => p.id === coop.id)! };
    return null;
  }

  setAutoRotate(on: boolean): void {
    (this.globe.controls() as unknown as { autoRotate: boolean }).autoRotate = on;
  }

  dispose(): void {
    clearInterval(this.revealTimer);
    cancelAnimationFrame(this.frame);
    for (const t of this.arrivalTimers) clearTimeout(t);
    this.ro.disconnect();
    this.coopStars.dispose();
    this.guestStars.dispose();
    this.globe._destructor?.();
    this.el.replaceChildren();
  }

  // ---------------------------------------------------------------- rendering

  private render(): void {
    this.renderArcs();
    this.renderStars();
    this.renderCountries();
    this.updateInterest();
    this.onCoopChange?.(this.visibleCoop());
  }

  private coopArc(p: GlobePlace, group: GroupCode): ArcDatum {
    const key = `${p.id}:${group}`;
    let arc = this.coopArcs.get(key);
    if (!arc) {
      arc = { id: p.id, kind: 'coop', lat: p.lat, lon: p.lon, color: GROUP_COLOR[group], stroke: 0.12 + Math.min(p.links, 12) * 0.02, distanceKm: p.distanceKm, gap: hash01(p.id) * 2 };
      this.coopArcs.set(key, arc); // stable objects: globe.gl keeps the existing arc instead of rebuilding it
    }
    return arc;
  }

  private renderArcs(): void {
    const coop = this.mode === 'cooperation'
      ? this.visibleCoop().map(p => this.coopArc(p, p.groups.find(g => this.groups.has(g))!))
      : [];
    this.globe.arcsData([...coop, ...this.guestArcs]);
  }

  private renderStars(guestDelay = 0): void {
    this.coopStars.set([
      { id: 'origin', lat: ORIGIN.lat, lon: ORIGIN.lon, size: 66, color: '#ffffff' },
      ...this.visibleCoop().map(p => ({
        id: p.id, lat: p.lat, lon: p.lon,
        size: 11 + 5.5 * Math.sqrt(Math.min(p.links, 50)),
        color: GROUP_COLOR[p.groups.find(g => this.groups.has(g))!],
        delay: 0.35,
      })),
    ]);
    this.guestStars.set([...this.guests.values()].map(g => ({
      id: `guest:${g.key}`, lat: g.lat, lon: g.lon, size: 14 + 6 * Math.sqrt(Math.min(g.count, 60)), color: GUEST_COLOR, delay: guestDelay,
    })));
  }

  private renderCountries(): void {
    const coop = new Set(this.visibleCoop().map(p => p.countryCode));
    const guests = new Set([...this.guests.values()].map(g => g.countryCode));
    this.globe.polygonCapColor((f: object) => {
      const iso = (f as CountryFeature).properties.iso2;
      if (iso === ORIGIN.countryCode) return 'rgba(255,255,255,.55)';
      if (coop.has(iso) && this.mode === 'cooperation') return 'rgba(86,128,255,.42)';
      if (guests.has(iso)) return 'rgba(255,217,160,.22)';
      if (coop.has(iso)) return 'rgba(86,128,255,.2)';
      return 'rgba(14,26,78,.55)';
    });
  }
}
