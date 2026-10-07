/**
 * What the wall needs from a map, whatever its shape: the opening timeline (1952 → today), cooperation places
 * and guest lights, country colours, the counters and the year. GlobeScene (3D, globe.gl) and MapScene (flat
 * map) only add how things are drawn and where they are on screen.
 *
 * The reveal runs on a clock: every place gets a launch time, its beam flies on the GPU (arcs.ts), its star
 * lights up when the beam lands (stars.ts) and its country fades in at that moment. Nothing is rebuilt while
 * the light spreads, which keeps the first half minute smooth.
 */
import { DoubleSide, MeshBasicMaterial, SRGBColorSpace } from 'three';
import { CATEGORY_GROUPS, MILESTONES, ORIGIN, TUKE_FOUNDED, type GroupCode } from '@ples/shared/constants';
import type { GlobePlace } from '@ples/shared';
import type { ArcLayer } from './arcs.ts';
import type { PlacedStar, StarLayer } from './stars.ts';

export const GROUP_COLOR = Object.fromEntries(CATEGORY_GROUPS.map(g => [g.code, g.color])) as Record<GroupCode, string>;
export const GUEST_COLOR = '#ffd9a0';
const ALL_GROUPS = CATEGORY_GROUPS.map(g => g.code);

export interface CountryFeature { type: 'Feature'; properties: { iso2: string; name: string }; geometry: object }
export interface GuestPlace { key: string; name: string; countryCode: string; lat: number; lon: number; count: number }
export interface GuestPin { key: string; name: string; countryCode: string; lat: number; lon: number }
export interface GuestArrival extends GuestPin { id: number }
export type SceneMode = 'cooperation' | 'live';
export type PickResult = { kind: 'coop'; place: GlobePlace } | { kind: 'guest'; place: GuestPlace };

/** r, g, b (0–255) and alpha of a country fill */
type Look = readonly [number, number, number, number];
interface Country { material: MeshBasicMaterial; shown: Look; from: Look; to: Look; since: number }

/** The clock of the arc and star shaders, in seconds. */
export const seconds = () => performance.now() / 1000;
/** Seconds a beam needs from Košice to a place. */
export const beamSeconds = (km: number) => 0.6 + km / 8000;
/** Seconds from the launch of a guest light to its landing. */
export const GUEST_LANDING = 1.82;

const REVEAL_DELAY = 0.8; // s before the first beam leaves Košice
const REVEAL_SPAN = 24; // s over which the beams leave, nearest places first (when the places have no years)
// the timeline: every year from the founding to today gets its moment, longer when more places light up in it
const YEAR_EMPTY = 0.09; // s for a year without new places
const YEAR_BASE = 0.16; // s for a year with new places …
const YEAR_PER_PLACE = 0.018; // … plus this per place
const YEAR_MAX = 1.6; // s at most for one year
const MILESTONE_HOLD = 1.8; // s at least for a year with a milestone, so it can be read
const LAUNCH_WINDOW = 3; // a beam leaves at most this many years before the year it lands in (the years before stretch)
const YEAR_AFTER = 3; // s the last year stays on screen after the last light has landed
const COUNTRY_FADE = 0.8; // s for a country to light up
const NOTIFY_MS = 150; // the counters follow the landings at most this often

// one blue for both layers, so the map stays in the palette: the scene's subject lit, the other one faint
// (a warm tint at this strength reads as grey on the dark map)
const LOOK = {
  dark: [14, 26, 78, 0.55],
  lit: [86, 128, 255, 0.42],
  faint: [86, 128, 255, 0.2],
  home: [255, 255, 255, 0.55],
} as const satisfies Record<string, Look>;
const applyLook = (m: MeshBasicMaterial, [r, g, b, a]: Look) => { m.color.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace); m.opacity = a; };

export abstract class WallScene {
  // created by the map that extends this class
  protected coopStars!: StarLayer;
  protected guestStars!: StarLayer;
  protected arcs!: ArcLayer;

  protected coop: GlobePlace[] = [];
  /** how many of this.coop have been reached by their beam (a prefix: places are kept in landing order) */
  protected coopShown = 0;
  /** when each place's beam leaves Košice and how long it flies, by place id */
  protected readonly timing = new Map<string, { launch: number; travel: number }>();
  /** landing time of each place in this.coop */
  protected landAt: number[] = [];
  protected groups = new Set<GroupCode>(ALL_GROUPS);
  protected guests = new Map<string, GuestPlace>();
  protected mode: SceneMode = 'cooperation';
  private notify = { pending: false, last: 0 };
  /** guest places whose light is still in the air: their country lights up when it lands */
  private readonly guestLanding = new Map<string, number>();
  private arrivalTimers = new Set<number>();
  private readonly countryLooks = new Map<string, Country>();
  private lookSets = { main: new Set<string>(), other: new Set<string>() };
  private countriesFading = false;
  /** the timeline: when each year starts and ends, in seconds of the shader clock */
  private years: { year: number; start: number; end: number }[] = [];
  private shownYear: number | null = null;
  private frame = 0;

  /** Called whenever the set of visible cooperation places changes (reveal, filters). */
  onCoopChange?: (visible: GlobePlace[]) => void;
  /** Called when the timeline moves to another year; null when the timeline is over. */
  onYear?: (year: number | null, milestone: string | null) => void;

  // ---------------------------------------------------------------- what a map provides

  /** Where a place is on screen (client pixels) and how directly it faces the viewer: 1 = fully, 0 = horizon, below 0 = hidden. */
  abstract screenPoint(lat: number, lon: number): { x: number; y: number; facing: number };
  /** Only how directly a place faces the viewer (see screenPoint). */
  abstract facing(lat: number, lon: number): number;
  /** The map on screen as a circle: centre and radius in client pixels (cards prefer the free space outside it). */
  abstract disc(): { x: number; y: number; r: number };
  /** Degrees of longitude the view turns in the given time while a card is up. */
  abstract turnWhileFocused(seconds: number): number;
  /** A card is on screen (the globe turns slower). */
  abstract setFocus(on: boolean): void;
  abstract setAutoRotate(on: boolean): void;
  /** Keeps an overlay title clear of the map; bottom(): where the map has to end, in client pixels. */
  abstract attachTitle(el: HTMLElement, options?: { bottomGap?: number; bottom?: () => number | null }): void;
  /** Draws the flight of a guest light from Košice; it lands GUEST_LANDING seconds later. */
  protected abstract launchGuest(pin: GuestArrival): void;
  /** Line width of a cooperation arc, in scene units. */
  protected abstract arcWidth(place: GlobePlace): number;
  /** Strength of an arc's steady light after its beam has landed (0–1). */
  protected arcGlow(_place: GlobePlace): number { return 1; }
  /** Brightness of a place's star (0–1), e.g. lower in a dense cluster. */
  protected starDim(_place: GlobePlace): number { return 1; }
  /** The lit places changed (reveal, filters, guests). */
  protected placesChanged(): void {}
  /** The reveal starts (first: the page has just opened). */
  protected revealStarts(_first: boolean): void {}
  /** The map's own work every frame, before the shared updates (rotation, camera). */
  protected frameTick(_nowMs: number, _dt: number): void {}
  /** After all updates of the frame (a map that draws itself renders here). */
  protected frameEnd(_nowMs: number, _dt: number): void {}

  /**
   * Where a card docks instead of floating next to its place: an area of the screen (client pixels), or null
   * to float. The flat map docks its cards over the empty southern ocean, like a lower third.
   */
  cardDock(): { top: number; bottom: number; left: number; right: number } | null { return null; }

  /** Whether a card that cannot dock may float next to its place; false: it shrinks to a name tag. */
  cardsFloat(): boolean { return true; }

  /** Starts the frame loop; a map calls it at the end of its constructor, once its layers exist. */
  protected startLoop(): void {
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.frameTick(now, dt);
      this.advanceReveal(now);
      this.advanceYear(now / 1000);
      this.fadeCountries(now / 1000);
      this.arcs.update(now / 1000, dt);
      this.frameEnd(now, dt);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
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
        if (list.length && this.years.length) {
          // a far beam would leave decades early in the quiet years: hold the previous year until it may leave
          const earliest = this.years[Math.max(0, this.years.length - LAUNCH_WINDOW)]!.start;
          let start = at;
          list.forEach((p, i) => { start = Math.max(start, earliest + beamSeconds(p.distanceKm) - (length * (i + 0.5)) / list.length); });
          this.years.at(-1)!.end = start;
          at = start;
        }
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
    this.coopStars.clear(); // births follow the new schedule (already lit without reveal)
    if (reveal) this.revealStarts(first);
    this.renderArcs();
    this.renderCoopStars();
    this.renderCountries();
    this.notifyCoop();
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

  protected inGroups(p: GlobePlace): boolean { return p.groups.some(g => this.groups.has(g)); }

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
    this.placesChanged();
    this.onCoopChange?.(this.visibleCoop());
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
    this.placesChanged();
  }

  /** Lights added without the flight, e.g. the older part of a big burst. */
  addGuests(pins: GuestPin[]): void {
    for (const pin of pins) this.countGuest(pin);
    this.renderGuestStars();
    this.renderCountries();
    this.placesChanged();
  }

  /** New lights: a bright dash flies from Košice; the star ignites and the country lights up when it lands. */
  addGuestArrivals(pins: GuestArrival[]): void {
    pins.forEach((pin, i) => {
      const timer = window.setTimeout(() => {
        this.arrivalTimers.delete(timer);
        const prev = this.countGuest(pin);
        if (!prev) this.guestLanding.set(pin.key, seconds() + GUEST_LANDING);
        this.guestStars.ignite(`guest:${pin.key}`, GUEST_LANDING);
        this.renderGuestStars(GUEST_LANDING);
        this.launchGuest(pin);
        const landed = window.setTimeout(() => {
          this.arrivalTimers.delete(landed);
          this.guestLanding.delete(pin.key);
          this.renderCountries();
          this.placesChanged();
        }, GUEST_LANDING * 1000);
        this.arrivalTimers.add(landed);
      }, i * 450); // a burst arrives one by one, so every light gets its moment
      this.arrivalTimers.add(timer);
    });
  }

  /** Adds one light to its place; returns the place as it was before (undefined for a new place). */
  private countGuest(pin: GuestPin): GuestPlace | undefined {
    const prev = this.guests.get(pin.key);
    this.guests.set(pin.key, prev ? { ...prev, count: prev.count + 1 } : { key: pin.key, name: pin.name, countryCode: pin.countryCode, lat: pin.lat, lon: pin.lon, count: 1 });
    return prev;
  }

  /** Guest places whose light has landed. */
  guestPlaces(): GuestPlace[] { return this.landedGuests(); }

  protected landedGuests(): GuestPlace[] {
    const t = seconds();
    return [...this.guests.values()].filter(g => !((this.guestLanding.get(g.key) ?? 0) > t));
  }

  // ---------------------------------------------------------------- scene, picking, teardown

  setMode(mode: SceneMode): void {
    this.mode = mode;
    this.coopStars.setIntensity(mode === 'live' ? 0.45 : 1);
    this.arcs.setOpacity(mode === 'live' ? 0 : 1);
    this.renderCountries();
  }

  currentMode(): SceneMode { return this.mode; }

  /** Makes a star flare up again, e.g. when the wall puts a card on it. */
  flare(kind: 'coop' | 'guest', id: string): void {
    if (kind === 'coop') { this.coopStars.ignite(id); this.renderCoopStars(); }
    else { this.guestStars.ignite(`guest:${id}`); this.renderGuestStars(); }
  }

  pick(x: number, y: number): PickResult | null {
    const guest = this.guestStars.pick(x, y, 14);
    if (guest) return { kind: 'guest', place: this.guests.get(guest.id.slice(6))! };
    const coop: PlacedStar | null = this.coopStars.pick(x, y, 16);
    if (coop) return { kind: 'coop', place: this.coop.find(p => p.id === coop.id)! };
    return null;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    for (const t of this.arrivalTimers) clearTimeout(t);
    this.coopStars.dispose();
    this.guestStars.dispose();
    this.arcs.dispose();
    for (const c of this.countryLooks.values()) c.material.dispose();
  }

  // ---------------------------------------------------------------- rendering

  private renderArcs(): void {
    this.arcs.set(this.coop.filter(p => this.inGroups(p)).map(p => {
      const { launch, travel } = this.timing.get(p.id)!;
      return { lat: p.lat, lon: p.lon, color: GROUP_COLOR[p.groups.find(g => this.groups.has(g))!], width: this.arcWidth(p), glow: this.arcGlow(p), launch, travel };
    }));
  }

  /** All stars at once: each lights up when its beam lands (the star layer counts down on the GPU). */
  protected renderCoopStars(): void {
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
          dim: this.starDim(p),
        };
      }),
    ]);
  }

  protected renderGuestStars(delay = 0): void {
    this.guestStars.set([...this.guests.values()].map(g => ({
      id: `guest:${g.key}`, lat: g.lat, lon: g.lon, size: 14 + 6 * Math.sqrt(Math.min(g.count, 60)), color: GUEST_COLOR, delay,
    })));
  }

  // ---------------------------------------------------------------- countries

  /** Each country has its own material, so a colour change is a fade instead of a rebuild of all polygons. */
  protected countryMaterial(iso: string): MeshBasicMaterial {
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

  protected renderCountries(): void {
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
