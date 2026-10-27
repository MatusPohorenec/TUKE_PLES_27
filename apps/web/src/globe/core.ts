/**
 * What the wall needs from a map, whatever its shape: the opening timeline (1952 → today), cooperation places
 * and guest lights, country colours, the counters and the year. GlobeScene (3D, globe.gl) and MapScene (flat
 * map) only add how things are drawn and where they are on screen.
 *
 * The reveal runs on a clock: every place gets a launch time, its beam flies on the GPU (arcs.ts), its star
 * lights up when the beam lands (stars.ts) and its country fades in at that moment. Nothing is rebuilt while
 * the light spreads, which keeps the first half minute smooth. The guests' gold lights fly in as the finale of
 * the opening. fadeOut() runs the timeline backwards (the wall's 2D/3D cycle): the lights go out the same way.
 */
import { DoubleSide, MeshBasicMaterial, SRGBColorSpace } from 'three';
import { CATEGORY_GROUPS, MILESTONES, ORIGIN, TUKE_FOUNDED, type GroupCode } from '@ples/shared/constants';
import type { GlobePlace } from '@ples/shared';
import { DEATH_FADE, type ArcLayer } from './arcs.ts';
import type { PlacedStar, StarLayer } from './stars.ts';

export const GROUP_COLOR = Object.fromEntries(CATEGORY_GROUPS.map(g => [g.code, g.color])) as Record<GroupCode, string>;
/** Guest lights are gold: the cooperation colours are all cool (white, blues, violet), so the guests stand out. */
export const GUEST_COLOR = '#ffb52e';
/** A guest arc stays clearly lit and turns gold right after Košice (cooperation arcs: faint, white near Košice). */
export const GUEST_ARC_STYLE = { base: 0.35, tintFrom: 0.06 } as const;
/** Guest stars keep their gold in the core instead of burning white. */
export const GUEST_STAR_WHITE = 0.3;
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
/** One round of the steady light on a guest arc (arcs.ts: 4 × 3 × travel): spreads the pulses of the guest places. */
const GUEST_CYCLE = GUEST_LANDING * 12;
/** Stable 0–1 number for a key, so a guest arc keeps its rhythm however often the arcs are rebuilt. */
const spread = (key: string) => ([...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 997) / 997;

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
const FINALE_GAP = 0.8; // s after the last landing of the opening before the guests' lights leave Košice …
const FINALE_SPAN = 6; // … all of them within this time
const STAR_AFTER_ARC = 1; // s: going out, the arc withdraws to its place first, then the star goes out

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
  /** a golden arc from Košice to every guest place, lit in both scenes */
  protected guestArcs!: ArcLayer;

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
  /** when the beam of each guest place left Košice (its latest light); places shown without a flight got a past time */
  private readonly guestBeams = new Map<string, number>();
  private arrivalTimers = new Set<number>();
  private readonly countryLooks = new Map<string, Country>();
  private lookSets = { main: new Set<string>(), other: new Set<string>() };
  private countriesFading = false;
  /** the timeline: when each year starts and ends, in seconds of the shader clock */
  private years: { year: number; start: number; end: number }[] = [];
  private shownYear: number | null = null;
  private frame = 0;
  /** while the lights go out (fadeOut): when the star of each place in this.coop goes out; null otherwise */
  private deathAt: number[] | null = null;
  /** when each place's arc starts to go out, by place id (fadeOut) */
  private readonly arcDeath = new Map<string, number>();
  /** when each guest place goes out (fadeOut) */
  private readonly guestDeath = new Map<string, number>();
  /** the next moment a guest light lands or goes out: its country changes then */
  private nextGuestEvent = 0;

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
  /** Line width of a cooperation arc, in scene units. */
  protected abstract arcWidth(place: GlobePlace): number;
  /** Line width of a guest arc, in scene units (a little wider than the widest cooperation arc). */
  protected abstract guestArcWidth(): number;
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
      this.guestArcs.update(now / 1000, dt);
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
   * delay: seconds before the first beam leaves Košice (e.g. while the view zooms in after a change of scene).
   */
  setCooperation(places: GlobePlace[], { reveal = false, delay = REVEAL_DELAY }: { reveal?: boolean; delay?: number; zoomIn?: boolean } = {}): void {
    const first = this.coop.length === 0;
    const t = seconds();
    this.timing.clear();
    this.years = [];
    const wasDark = this.deathAt !== null;
    this.deathAt = null;
    this.arcDeath.clear();
    this.guestDeath.clear();
    const byDistance = [...places].sort((a, b) => a.distanceKm - b.distanceKm);
    const land = new Map<string, number>();
    if (reveal && places.some(p => p.since)) {
      const last = Math.max(new Date().getFullYear(), ...places.map(p => p.since ?? 0));
      const yearOf = (p: GlobePlace) => Math.min(last, Math.max(TUKE_FOUNDED, p.since ?? last));
      const perYear = new Map<number, GlobePlace[]>();
      for (const p of byDistance) perYear.set(yearOf(p), [...(perYear.get(yearOf(p)) ?? []), p]); // nearest first within a year
      const milestones = new Set(MILESTONES.map(m => m.year));
      let at = t + delay;
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
      byDistance.forEach((p, i) => land.set(p.id, t + delay + (REVEAL_SPAN * i) / Math.max(1, byDistance.length - 1) + beamSeconds(p.distanceKm)));
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
    // the guests' lights: again as the finale of a new opening, lit at once without one (or after going out)
    if (reveal || wasDark) this.scheduleGuests();
    this.renderCountries();
    this.notifyCoop();
  }

  replay(): void { this.setCooperation(this.coop, { reveal: true }); }

  /**
   * The lights go out, the timeline running backwards: the newest cooperation first, the oldest last (Košice's own
   * star stays lit), the guests' gold lights towards the end. Every arc withdraws to its place, then the star goes
   * out and the country darkens. Returns the seconds until everything is dark.
   */
  fadeOut(duration = 20): number {
    const t = seconds();
    this.coopShown = this.coop.length; // a beam still in the air would land now: nothing is left half-lit
    this.years = [];
    if (this.shownYear !== null) { this.shownYear = null; this.onYear?.(null, null); }
    const n = this.coop.length;
    const span = duration * 0.7;
    this.arcDeath.clear();
    this.deathAt = this.coop.map((p, i) => {
      const arc = t + 0.5 + (span * (n - 1 - i)) / Math.max(1, n - 1); // in landing order: the last landed goes first
      this.arcDeath.set(p.id, arc);
      return arc + STAR_AFTER_ARC;
    });
    const guests = [...this.guests.keys()].sort((a, b) => spread(a) - spread(b));
    guests.forEach((key, j) => this.guestDeath.set(key, t + 0.5 + duration * 0.6 + (duration * 0.25 * j) / Math.max(1, guests.length)));
    this.nextGuestEvent = this.nextGuestTime(t);
    this.renderArcs();
    this.renderCoopStars();
    this.renderGuestArcs();
    this.renderGuestStars();
    return duration;
  }

  /** No place for cards: the light is spreading, going out, or out. */
  busy(): boolean { return this.revealing() || this.deathAt !== null; }

  setGroups(groups: Iterable<GroupCode>): void {
    this.groups = new Set(groups);
    this.renderArcs();
    this.renderCoopStars();
    this.renderCountries();
    this.notifyCoop();
  }

  /** True while beams are still on their way (the counters are rising). */
  revealing(): boolean { return this.deathAt === null && this.coopShown < this.coop.length; }

  /** Cooperation places in the active groups that their beam has reached. */
  visibleCoop(): GlobePlace[] {
    return this.coop.slice(0, this.coopShown).filter(p => this.inGroups(p));
  }

  protected inGroups(p: GlobePlace): boolean { return p.groups.some(g => this.groups.has(g)); }

  /**
   * Moves the reveal on: places whose beam has landed count, and their countries light up. While the lights go out
   * it runs backwards: places whose star has gone out no longer count (the alive ones stay a prefix of this.coop).
   */
  private advanceReveal(nowMs: number): void {
    const t = nowMs / 1000;
    let k = this.coopShown;
    if (this.deathAt) while (k > 0 && this.deathAt[k - 1]! <= t) k--;
    else while (k < this.coop.length && this.landAt[k]! <= t) k++;
    if (k !== this.coopShown) {
      this.coopShown = k;
      this.renderCountries();
      this.notify.pending = true;
    }
    if (this.nextGuestEvent && t >= this.nextGuestEvent) {
      // a scheduled guest light landed (the finale) or went out (fadeOut): its country follows
      this.nextGuestEvent = this.nextGuestTime(t);
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

  /**
   * All guest lights at once (initial load, reconnect). While the opening runs they fly in as its finale, after the
   * last cooperation has landed; otherwise they are lit at once, without the flight.
   */
  setGuests(places: GuestPlace[]): void {
    // arrivals still waiting for their turn are part of the new snapshot (or come again from the feed)
    for (const t of this.arrivalTimers) clearTimeout(t);
    this.arrivalTimers.clear();
    this.guestLanding.clear();
    this.guests = new Map(places.map(p => [p.key, p]));
    for (const key of this.guestBeams.keys()) if (!this.guests.has(key)) this.guestBeams.delete(key);
    if (this.revealing()) this.scheduleGuests(); // during the opening: its finale (again, with the new snapshot)
    else for (const key of this.guests.keys()) this.litWithoutFlight(key);
    this.renderGuestStars();
    this.renderGuestArcs();
    this.renderCountries();
    this.placesChanged();
  }

  /**
   * The guests' lights fly in one after another as the finale of the opening (or appear at once when there is no
   * opening running); their stars ignite and their countries light up when they land.
   */
  private scheduleGuests(): void {
    const t = seconds();
    this.guestLanding.clear();
    this.guestStars.clear(); // the stars ignite again when their light lands
    const finale = this.revealing() ? Math.max(t, ...this.landAt) + FINALE_GAP : 0;
    const list = [...this.guests.values()].sort((a, b) => spread(a.key) - spread(b.key));
    list.forEach((g, i) => {
      if (!finale) { this.guestBeams.delete(g.key); this.litWithoutFlight(g.key); return; }
      const launch = finale + (FINALE_SPAN * i) / Math.max(1, list.length);
      this.guestBeams.set(g.key, launch);
      this.guestLanding.set(g.key, launch + GUEST_LANDING);
    });
    this.nextGuestEvent = this.nextGuestTime(t);
    this.renderGuestStars();
    this.renderGuestArcs();
  }

  /** The next landing or going out of a guest light after t (0: none). */
  private nextGuestTime(t: number): number {
    let next = Infinity;
    for (const at of this.guestLanding.values()) if (at > t && at < next) next = at;
    for (const at of this.guestDeath.values()) if (at > t && at < next) next = at;
    return next === Infinity ? 0 : next;
  }

  /** Lights added without the flight, e.g. the older part of a big burst. */
  addGuests(pins: GuestPin[]): void {
    for (const pin of pins) { this.countGuest(pin); this.litWithoutFlight(pin.key); }
    this.renderGuestStars();
    this.renderGuestArcs();
    this.renderCountries();
    this.placesChanged();
  }

  /**
   * New lights: a beam flies from Košice along the place's golden arc, the star ignites and the country lights up
   * when it lands; from then on light flows both ways on the arc. Another light for a known place sends a new beam.
   */
  addGuestArrivals(pins: GuestArrival[]): void {
    pins.forEach((pin, i) => {
      const timer = window.setTimeout(() => {
        this.arrivalTimers.delete(timer);
        const prev = this.countGuest(pin);
        if (!prev) this.guestLanding.set(pin.key, seconds() + GUEST_LANDING);
        this.guestStars.ignite(`guest:${pin.key}`, GUEST_LANDING);
        this.renderGuestStars();
        this.guestBeams.set(pin.key, seconds());
        this.renderGuestArcs();
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

  /** A guest place shown without a flight: its arc is lit already, at its own point of the light's round. */
  private litWithoutFlight(key: string): void {
    if (!this.guestBeams.has(key)) this.guestBeams.set(key, seconds() - GUEST_LANDING - spread(key) * GUEST_CYCLE);
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
    return [...this.guests.values()].filter(g => !((this.guestLanding.get(g.key) ?? 0) > t) && !((this.guestDeath.get(g.key) ?? Infinity) <= t));
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
    this.guestArcs.dispose();
    for (const c of this.countryLooks.values()) c.material.dispose();
  }

  // ---------------------------------------------------------------- rendering

  private renderArcs(): void {
    this.arcs.set(this.coop.filter(p => this.inGroups(p)).map(p => {
      const { launch, travel } = this.timing.get(p.id)!;
      return {
        lat: p.lat, lon: p.lon, color: GROUP_COLOR[p.groups.find(g => this.groups.has(g))!], width: this.arcWidth(p), glow: this.arcGlow(p),
        launch, travel, death: this.arcDeath.get(p.id),
      };
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
          death: this.arcDeath.has(p.id) ? this.arcDeath.get(p.id)! + STAR_AFTER_ARC : undefined,
        };
      }),
    ]);
  }

  /** One golden arc per guest place, in both scenes (the cooperation arcs fade out in the guest-lights scene). */
  protected renderGuestArcs(): void {
    this.guestArcs.set([...this.guests.values()].map(g => ({
      lat: g.lat, lon: g.lon, color: GUEST_COLOR, width: this.guestArcWidth(), launch: this.guestBeams.get(g.key) ?? 0, travel: GUEST_LANDING,
      death: this.guestDeath.has(g.key) ? this.guestDeath.get(g.key)! - DEATH_FADE : undefined,
    })));
  }

  /** A guest star ignites when its light lands (an arrival, the finale of the opening) and goes out with fadeOut. */
  protected renderGuestStars(): void {
    const t = seconds();
    this.guestStars.set([...this.guests.values()].map(g => ({
      id: `guest:${g.key}`, lat: g.lat, lon: g.lon, size: 26 + 8 * Math.sqrt(Math.min(g.count, 60)), color: GUEST_COLOR,
      delay: Math.max(0, (this.guestLanding.get(g.key) ?? t) - t), death: this.guestDeath.get(g.key),
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
