/**
 * The globe: a dark planet, country outlines, arcs from Košice and two star layers
 * (cooperation places tinted by legend group, guest lights in warm white).
 * Framework-free on purpose: the wall, the map and later any other screen drive it imperatively.
 *
 * The reveal runs on a clock: every place gets a launch time, its beam flies on the GPU (arcs.ts), its star
 * lights up when the beam lands (stars.ts) and its country fades in at that moment. Nothing is rebuilt while
 * the light spreads, which keeps the first half minute smooth.
 */
import Globe, { type GlobeInstance } from 'globe.gl';
import { DoubleSide, MeshBasicMaterial, SRGBColorSpace, Vector3, type LineSegments, type PerspectiveCamera } from 'three';
import { CATEGORY_GROUPS, MILESTONES, ORIGIN, TUKE_FOUNDED, type GroupCode } from '@ples/shared/constants';
import type { GlobePlace } from '@ples/shared';
import { ArcLayer } from './arcs.ts';
import { createBorders } from './borders.ts';
import { StarLayer, type PlacedStar } from './stars.ts';

export const GROUP_COLOR = Object.fromEntries(CATEGORY_GROUPS.map(g => [g.code, g.color])) as Record<GroupCode, string>;
export const GUEST_COLOR = '#ffd9a0';
const ALL_GROUPS = CATEGORY_GROUPS.map(g => g.code);

export interface CountryFeature { type: 'Feature'; properties: { iso2: string; name: string }; geometry: object }
export interface GuestPlace { key: string; name: string; countryCode: string; lat: number; lon: number; count: number }
export type SceneMode = 'cooperation' | 'live';
export type PickResult = { kind: 'coop'; place: GlobePlace } | { kind: 'guest'; place: GuestPlace };

interface GuestArc { id: string; lat: number; lon: number }
/** r, g, b (0–255) and alpha of a country fill */
type Look = readonly [number, number, number, number];
interface Country { material: MeshBasicMaterial; shown: Look; from: Look; to: Look; since: number }

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const smoothstep = (e0: number, e1: number, x: number) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
const seconds = () => performance.now() / 1000; // the clock of the arc and star shaders

const GUEST_ARC_MS = 2600;
const GUEST_DASH = 0.3;
const GLOBE_RADIUS = 100; // three-globe units
const FOCUS_SPEED = 1.6; // × base speed at most while a card is on screen
const REVEAL_SPEED = 0.3; // × base speed while the light spreads, so the beams can be followed
const REVEAL_DELAY = 0.8; // s before the first beam leaves Košice
const REVEAL_SPAN = 24; // s over which the beams leave, nearest places first (when the places have no years)
// the timeline: every year from the founding to today gets its moment, longer when more places light up in it
const YEAR_EMPTY = 0.09; // s for a year without new places
const YEAR_BASE = 0.16; // s for a year with new places …
const YEAR_PER_PLACE = 0.018; // … plus this per place
const YEAR_MAX = 1.6; // s at most for one year
const MILESTONE_HOLD = 1.8; // s at least for a year with a milestone, so it can be read
const YEAR_AFTER = 3; // s the last year stays on screen after the last light has landed
const COUNTRY_FADE = 0.8; // s for a country to light up
const NOTIFY_MS = 150; // the counters follow the landings at most this often
/** Seconds a beam needs from Košice to a place. */
const beamSeconds = (km: number) => 0.9 + km / 5000;

// one blue for both layers, so the globe stays in the palette: the scene's subject lit, the other one faint
const LOOK = {
  dark: [14, 26, 78, 0.55],
  lit: [86, 128, 255, 0.42],
  faint: [86, 128, 255, 0.2],
  home: [255, 255, 255, 0.55],
} as const satisfies Record<string, Look>;
const applyLook = (m: MeshBasicMaterial, [r, g, b, a]: Look) => { m.color.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace); m.opacity = a; };

export class GlobeScene {
  readonly globe: GlobeInstance;
  private readonly coopStars: StarLayer;
  private readonly guestStars: StarLayer;
  private readonly arcs: ArcLayer;
  private readonly borders: LineSegments;
  private coop: GlobePlace[] = [];
  /** how many of this.coop have been reached by their beam (a prefix: nearer places land first) */
  private coopShown = 0;
  /** when each place's beam leaves Košice and how long it flies, by place id */
  private readonly timing = new Map<string, { launch: number; travel: number }>();
  /** landing time of each place in this.coop */
  private landAt: number[] = [];
  private notify = { pending: false, last: 0 };
  private groups = new Set<GroupCode>(ALL_GROUPS);
  private guests = new Map<string, GuestPlace>();
  /** guest places whose light is still in the air: their country lights up when it lands */
  private readonly guestLanding = new Map<string, number>();
  private arrivalTimers = new Set<number>();
  private guestArcs: GuestArc[] = [];
  private readonly countryLooks = new Map<string, Country>();
  private lookSets = { main: new Set<string>(), other: new Set<string>() };
  private countriesFading = false;
  private mode: SceneMode = 'cooperation';
  private readonly ro: ResizeObserver;
  private title?: { el: HTMLElement; bottomGap: number; bottom: number; limit?: () => number | null };
  /** unit vectors of every lit place (x, y, z per place): how much is there to see in the current view */
  private interest = new Float32Array(0);
  private readonly rotation: { base: number; max: number; speed: number; focused: boolean; last: number };
  private frame = 0;
  /** Called whenever the set of visible cooperation places changes (reveal, filters). */
  onCoopChange?: (visible: GlobePlace[]) => void;
  /** Called when the timeline moves to another year; null when the timeline is over. */
  onYear?: (year: number | null, milestone: string | null) => void;
  /** the timeline: when each year starts and ends, in seconds of the shader clock */
  private years: { year: number; start: number; end: number }[] = [];
  private shownYear: number | null = null;

  constructor(private readonly el: HTMLElement, countries: CountryFeature[], opts: { autoRotateSpeed?: number; altitude?: number } = {}) {
    this.globe = new Globe(el, { rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' } })
      .width(el.clientWidth).height(el.clientHeight)
      .backgroundColor('rgba(0,0,0,0)')
      .atmosphereColor('#4f7dff').atmosphereAltitude(0.2)
      .polygonsData(countries)
      .polygonAltitude(0.006)
      .polygonSideColor(() => '') // no sides
      .polygonCapMaterial((f: object) => this.countryMaterial((f as CountryFeature).properties.iso2)) // colours change without a rebuild
      .polygonsTransitionDuration(900)
      // globe.gl's own arcs carry only the guest lights (a handful at a time); the cooperation arcs are in ArcLayer
      .arcStartLat(() => ORIGIN.lat).arcStartLng(() => ORIGIN.lon)
      .arcEndLat((d: object) => (d as GuestArc).lat).arcEndLng((d: object) => (d as GuestArc).lon)
      .arcColor(() => [rgba('#ffffff', 1), rgba(GUEST_COLOR, 1)])
      .arcAltitudeAutoScale(0.38)
      .arcStroke(0.9)
      .arcDashLength(GUEST_DASH).arcDashGap(8).arcDashInitialGap(0)
      .arcDashAnimateTime(GUEST_ARC_MS)
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

    this.borders = createBorders(this.globe, countries, { altitude: 0.0062, color: '#bed2ff', opacity: 0.22 });
    this.globe.scene().add(this.borders);
    this.arcs = new ArcLayer(this.globe, ORIGIN);
    this.coopStars = new StarLayer(this.globe, 0.012);
    this.guestStars = new StarLayer(this.globe, 0.016);
    this.ro = new ResizeObserver(() => {
      this.globe.width(el.clientWidth).height(el.clientHeight);
      if (this.title) { this.fitBelowTitle(); this.fadeTitle(); }
    });
    this.ro.observe(el);
    this.renderCoopStars();
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.adaptRotation(now);
      this.advanceReveal(now);
      this.advanceYear(now / 1000);
      this.fadeCountries(now / 1000);
      this.arcs.update(now / 1000, dt);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- rotation

  /**
   * Turns faster where there is little to see: up to three times the base speed over an empty ocean
   * (the Pacific), the base speed wherever a few dozen lit places face the viewer. During the reveal it turns
   * slowly, so the beams can be followed to where they land; while a card is on screen only a little faster
   * than the base speed, so the card can still be read.
   */
  private adaptRotation(now: number): void {
    const controls = this.globe.controls() as unknown as { autoRotate: boolean; autoRotateSpeed: number };
    const r = this.rotation;
    const dt = Math.min(0.1, (now - r.last) / 1000);
    r.last = now;
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

  /** While a card is on screen the globe turns at most a little faster than the base speed. */
  setFocus(on: boolean): void { this.rotation.focused = on; }

  /** Degrees of longitude the view turns in the given time while a card is up (the camera moves west, places drift east). */
  turnWhileFocused(seconds: number): number {
    const controls = this.globe.controls() as unknown as { autoRotate: boolean };
    return controls.autoRotate ? 6 * Math.min(this.rotation.speed, this.rotation.base * FOCUS_SPEED) * seconds : 0;
  }

  private updateInterest(): void {
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

  /** Where a place is on screen and how directly it faces the viewer: 1 = centre of the disc, 0 = horizon, below 0 = behind. */
  screenPoint(lat: number, lon: number, altitude = 0.012): { x: number; y: number; facing: number } {
    const c = this.globe.getCoords(lat, lon, altitude);
    const p = new Vector3(c.x, c.y, c.z);
    const facing = this.facing(lat, lon, altitude);
    p.project(this.camera());
    const rect = this.el.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, facing };
  }

  /** The globe on screen: centre and radius in client pixels. */
  disc(): { x: number; y: number; r: number } {
    const rect = this.el.getBoundingClientRect();
    const [ox, oy] = this.globe.globeOffset();
    return { x: rect.left + rect.width / 2 + ox, y: rect.top + rect.height / 2 + oy, r: this.globeRadiusPx() };
  }

  /** Only how directly a place faces the viewer (see screenPoint), without the projection. */
  facing(lat: number, lon: number, altitude = 0.012): number {
    const c = this.globe.getCoords(lat, lon, altitude);
    const cam = this.camera().position;
    const horizon = GLOBE_RADIUS / cam.length();
    return (new Vector3(c.x, c.y, c.z).normalize().dot(cam.clone().normalize()) - horizon) / (1 - horizon);
  }

  /** Guest places whose light has landed. */
  guestPlaces(): GuestPlace[] { return this.landedGuests(); }

  currentMode(): SceneMode { return this.mode; }

  /** Makes a star flare up again, e.g. when the wall puts a card on it. */
  flare(kind: 'coop' | 'guest', id: string): void {
    if (kind === 'coop') { this.coopStars.ignite(id); this.renderCoopStars(); }
    else { this.guestStars.ignite(`guest:${id}`); this.renderGuestStars(); }
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

  // ---------------------------------------------------------------- cooperation

  /**
   * With reveal the light spreads through time: every year from the founding of TUKE to today has its moment
   * and each place lights up in the year of its earliest dated cooperation (places without a year at the end).
   * Without years in the data the beams leave by distance instead. Without reveal everything is lit at once.
   */
  setCooperation(places: GlobePlace[], { reveal = false } = {}): void {
    const first = this.coop.length === 0;
    const t = seconds();
    this.timing.clear();
    this.years = [];
    const byDistance = [...places].sort((a, b) => a.distanceKm - b.distanceKm);
    const land = new Map<string, number>();
    if (reveal && places.some(p => p.since)) {
      const last = Math.max(new Date().getFullYear(), ...places.map(p => p.since ?? 0));
      const yearOf = (p: GlobePlace) => Math.min(last, Math.max(TUKE_FOUNDED, p.since ?? last));
      const perYear = new Map<number, GlobePlace[]>();
      for (const p of byDistance) perYear.set(yearOf(p), [...(perYear.get(yearOf(p)) ?? []), p]); // nearest first within a year
      const milestones = new Set(MILESTONES.map(m => m.year));
      let at = t + REVEAL_DELAY;
      for (let year = TUKE_FOUNDED; year <= last; year++) {
        const list = perYear.get(year) ?? [];
        let length = list.length ? Math.min(YEAR_MAX, YEAR_BASE + YEAR_PER_PLACE * list.length) : YEAR_EMPTY;
        if (milestones.has(year)) length = Math.max(length, MILESTONE_HOLD);
        list.forEach((p, i) => land.set(p.id, at + (length * (i + 0.5)) / list.length)); // the beam lands within its year
        this.years.push({ year, start: at, end: at + length });
        at += length;
      }
    } else if (reveal) {
      byDistance.forEach((p, i) => land.set(p.id, t + REVEAL_DELAY + (REVEAL_SPAN * i) / Math.max(1, byDistance.length - 1) + beamSeconds(p.distanceKm)));
    }
    // landing order: the reveal counts places in this order (visibleCoop() is a prefix)
    this.coop = reveal ? [...byDistance].sort((a, b) => land.get(a.id)! - land.get(b.id)!) : byDistance;
    this.landAt = this.coop.map(p => {
      const travel = beamSeconds(p.distanceKm);
      const landing = reveal ? land.get(p.id)! : t - 3600 + travel;
      this.timing.set(p.id, { launch: landing - travel, travel });
      return landing;
    });
    this.coopShown = reveal ? 0 : this.coop.length;
    this.shownYear = null;
    if (!this.years.length) this.onYear?.(null, null);
    if (reveal) {
      this.coopStars.clear();
      if (first) this.rotation.speed = this.rotation.base * REVEAL_SPEED; // the page opens calm; a replay slows down smoothly
    }
    this.renderArcs();
    this.renderCoopStars();
    this.renderCountries();
    this.notifyCoop();
  }

  /** The timeline year on screen: from just before the first year until a few seconds after the last light. */
  private advanceYear(t: number): void {
    if (!this.years.length) return;
    const lastYear = this.years.at(-1)!;
    let year: number | null = this.years[0]!.year;
    for (const y of this.years) if (t >= y.start) year = y.year;
    if (!this.revealing() && t > Math.max(lastYear.end, this.landAt.at(-1) ?? 0) + YEAR_AFTER) {
      year = null;
      this.years = []; // done
    }
    if (year === this.shownYear) return;
    this.shownYear = year;
    this.onYear?.(year, year === null ? null : MILESTONES.find(m => m.year === year)?.text ?? null);
  }

  replay(): void { this.setCooperation(this.coop, { reveal: true }); }

  setGroups(groups: Iterable<GroupCode>): void {
    this.groups = new Set(groups);
    this.renderArcs();
    this.renderCoopStars();
    this.renderCountries();
    this.notifyCoop();
  }

  /** True while beams are still on their way (the counters are rising). */
  revealing(): boolean { return this.coopShown < this.coop.length; }

  /** Cooperation places in the active groups that their beam has reached. */
  visibleCoop(): GlobePlace[] {
    return this.coop.slice(0, this.coopShown).filter(p => this.inGroups(p));
  }

  private inGroups(p: GlobePlace): boolean { return p.groups.some(g => this.groups.has(g)); }

  /** Moves the reveal on: places whose beam has landed count, and their countries light up. */
  private advanceReveal(nowMs: number): void {
    const t = nowMs / 1000;
    let k = this.coopShown;
    while (k < this.coop.length && this.landAt[k]! <= t) k++;
    if (k !== this.coopShown) {
      this.coopShown = k;
      this.renderCountries();
      this.notify.pending = true;
    }
    if (this.notify.pending && nowMs - this.notify.last >= NOTIFY_MS) this.notifyCoop(nowMs);
  }

  private notifyCoop(nowMs = performance.now()): void {
    this.notify = { pending: false, last: nowMs };
    this.updateInterest();
    this.onCoopChange?.(this.visibleCoop());
  }

  // ---------------------------------------------------------------- guests

  /** All guest lights at once (initial load, reconnect), no arrival animation. */
  setGuests(places: GuestPlace[]): void {
    // arrivals still waiting for their turn are part of the new snapshot (or come again from the feed)
    for (const t of this.arrivalTimers) clearTimeout(t);
    this.arrivalTimers.clear();
    this.guestLanding.clear();
    this.guests = new Map(places.map(p => [p.key, p]));
    this.renderGuestStars();
    this.renderCountries();
    this.updateInterest();
  }

  /** Lights added without the flight, e.g. the older part of a big burst. */
  addGuests(pins: { key: string; name: string; countryCode: string; lat: number; lon: number }[]): void {
    for (const pin of pins) {
      const prev = this.guests.get(pin.key);
      this.guests.set(pin.key, prev ? { ...prev, count: prev.count + 1 } : { key: pin.key, name: pin.name, countryCode: pin.countryCode, lat: pin.lat, lon: pin.lon, count: 1 });
    }
    this.renderGuestStars();
    this.renderCountries();
    this.updateInterest();
  }

  /** New lights: a bright dash flies from Košice; the star ignites and the country lights up when it lands. */
  addGuestArrivals(pins: { id: number; key: string; name: string; countryCode: string; lat: number; lon: number }[]): void {
    pins.forEach((pin, i) => {
      const timer = window.setTimeout(() => {
        this.arrivalTimers.delete(timer);
        const arc: GuestArc = { id: `g${pin.id}`, lat: pin.lat, lon: pin.lon };
        this.guestArcs.push(arc);
        const prev = this.guests.get(pin.key);
        this.guests.set(pin.key, prev ? { ...prev, count: prev.count + 1 } : { key: pin.key, name: pin.name, countryCode: pin.countryCode, lat: pin.lat, lon: pin.lon, count: 1 });
        const landing = ((1 - GUEST_DASH) * GUEST_ARC_MS) / 1000;
        if (!prev) this.guestLanding.set(pin.key, seconds() + landing);
        this.guestStars.ignite(`guest:${pin.key}`, landing);
        this.renderGuestStars(landing);
        this.renderGuestArcs();
        const landed = window.setTimeout(() => {
          this.arrivalTimers.delete(landed);
          this.guestLanding.delete(pin.key);
          this.renderCountries();
          this.updateInterest();
        }, landing * 1000);
        this.arrivalTimers.add(landed);
        window.setTimeout(() => { this.guestArcs = this.guestArcs.filter(a => a !== arc); this.renderGuestArcs(); }, GUEST_ARC_MS + 200);
      }, i * 450); // a burst arrives one by one, so every light gets its moment
      this.arrivalTimers.add(timer);
    });
  }

  private landedGuests(): GuestPlace[] {
    const t = seconds();
    return [...this.guests.values()].filter(g => !((this.guestLanding.get(g.key) ?? 0) > t));
  }

  setMode(mode: SceneMode): void {
    this.mode = mode;
    this.coopStars.setIntensity(mode === 'live' ? 0.45 : 1);
    this.arcs.setOpacity(mode === 'live' ? 0 : 1);
    this.renderCountries();
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
    cancelAnimationFrame(this.frame);
    for (const t of this.arrivalTimers) clearTimeout(t);
    this.ro.disconnect();
    this.coopStars.dispose();
    this.guestStars.dispose();
    this.arcs.dispose();
    this.borders.geometry.dispose();
    (this.borders.material as { dispose(): void }).dispose();
    for (const c of this.countryLooks.values()) c.material.dispose();
    this.globe._destructor?.();
    this.el.replaceChildren();
  }

  // ---------------------------------------------------------------- rendering

  private renderArcs(): void {
    this.arcs.set(this.coop.filter(p => this.inGroups(p)).map(p => {
      const { launch, travel } = this.timing.get(p.id)!;
      return {
        lat: p.lat, lon: p.lon,
        color: GROUP_COLOR[p.groups.find(g => this.groups.has(g))!],
        width: 0.12 + Math.min(p.links, 12) * 0.02,
        launch, travel,
      };
    }));
  }

  private renderGuestArcs(): void {
    this.globe.arcsData(this.guestArcs);
  }

  /** All stars at once: each lights up when its beam lands (the star layer counts down on the GPU). */
  private renderCoopStars(): void {
    const t = seconds();
    this.coopStars.set([
      { id: 'origin', lat: ORIGIN.lat, lon: ORIGIN.lon, size: 66, color: '#ffffff' },
      ...this.coop.filter(p => this.inGroups(p)).map(p => {
        const { launch, travel } = this.timing.get(p.id)!;
        return {
          id: p.id, lat: p.lat, lon: p.lon,
          size: 11 + 5.5 * Math.sqrt(Math.min(p.links, 50)),
          color: GROUP_COLOR[p.groups.find(g => this.groups.has(g))!],
          delay: launch + travel - t,
        };
      }),
    ]);
  }

  private renderGuestStars(delay = 0): void {
    this.guestStars.set([...this.guests.values()].map(g => ({
      id: `guest:${g.key}`, lat: g.lat, lon: g.lon, size: 14 + 6 * Math.sqrt(Math.min(g.count, 60)), color: GUEST_COLOR, delay,
    })));
  }

  // ---------------------------------------------------------------- countries

  /** Each country has its own material, so a colour change is a fade instead of a rebuild of all polygons. */
  private countryMaterial(iso: string): MeshBasicMaterial {
    let c = this.countryLooks.get(iso);
    if (!c) {
      const look = this.targetLook(iso);
      const material = new MeshBasicMaterial({ side: DoubleSide, transparent: true, depthWrite: true });
      applyLook(material, look);
      c = { material, shown: look, from: look, to: look, since: -1 };
      this.countryLooks.set(iso, c);
    }
    return c.material;
  }

  private targetLook(iso: string): Look {
    if (iso === ORIGIN.countryCode) return LOOK.home;
    return this.lookSets.main.has(iso) ? LOOK.lit : this.lookSets.other.has(iso) ? LOOK.faint : LOOK.dark;
  }

  private renderCountries(): void {
    const coop = new Set(this.visibleCoop().map(p => p.countryCode));
    const guests = new Set(this.landedGuests().map(g => g.countryCode));
    const [main, other] = this.mode === 'cooperation' ? [coop, guests] : [guests, coop];
    this.lookSets = { main, other };
    const t = seconds();
    for (const [iso, c] of this.countryLooks) {
      const to = this.targetLook(iso);
      if (to === c.to) continue;
      c.from = c.shown;
      c.to = to;
      c.since = t;
      this.countriesFading = true;
    }
  }

  private fadeCountries(t: number): void {
    if (!this.countriesFading) return;
    let busy = false;
    for (const c of this.countryLooks.values()) {
      if (c.since < 0) continue;
      const k = Math.min(1, (t - c.since) / COUNTRY_FADE);
      const e = k * k * (3 - 2 * k);
      c.shown = [0, 1, 2, 3].map(i => c.from[i]! + (c.to[i]! - c.from[i]!) * e) as unknown as Look;
      applyLook(c.material, c.shown);
      if (k >= 1) c.since = -1; else busy = true;
    }
    this.countriesFading = busy;
  }
}
