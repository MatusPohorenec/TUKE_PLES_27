/**
 * The flat view: the same wall on a world map (Natural Earth projection) instead of the globe, made to compare
 * which reads better. Nothing hides behind a horizon and the picture does not turn. While the light spreads the
 * view starts on Central Europe and widens as the cooperation reaches further, then shows the whole world.
 * Arcs and stars use the same shaders as the globe (arcs.ts, stars.ts); timeline, guests and country colours
 * are shared (core.ts).
 */
import * as THREE from 'three';
import { geoNaturalEarth1, geoPath, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import { ORIGIN } from '@ples/shared/constants';
import type { GlobePlace } from '@ples/shared';
import { ArcLayer, ARC_SEGMENTS, type ArcInput, type ArcPath } from './arcs.ts';
import { GUEST_COLOR, GUEST_LANDING, WallScene, seconds, type CountryFeature, type GuestArrival } from './core.ts';
import { StarLayer } from './stars.ts';

type XY = [number, number];
interface Box { x0: number; y0: number; x1: number; y1: number }

const WIDTH = 2000; // width of the projected world in scene units
const CAMERA_Z = 500;
const Z = { ocean: 0, land: 1, borders: 2, arcs: 3, stars: 4, guests: 4.5 };
const START_WIDTH = 0.12; // the view starts on this share of the world's width around Košice …
const PADDING = 0.18; // … and keeps this much room around the places lit so far
const FOLLOW = 0.9; // s: how fast the view follows
const DENSE_RADIUS = 16; // scene units (~15 px on the whole world at 1920 px): neighbours closer than this crowd a star
const DOCK_LAT = -38; // cards dock south of this latitude …
const DOCK_LON: readonly [number, number] = [-52, 138]; // … between the coasts of Argentina and Australia (Melbourne lies at 145° E)

/** Projected rings of a GeoJSON object (antimeridian cut and curve resampling by d3). */
function rings(path: ReturnType<typeof geoPath>, object: GeoPermissibleObjects): XY[][] {
  const out: XY[][] = [];
  let ring: XY[] | null = null;
  const context = {
    moveTo(x: number, y: number) { ring = [[x, y]]; out.push(ring); },
    lineTo(x: number, y: number) { ring?.push([x, y]); },
    closePath() { ring = null; },
    arc() {},
    beginPath() {},
  };
  path.context(context as unknown as CanvasRenderingContext2D)(object);
  return out.filter(r => r.length > 2);
}

const area = (r: XY[]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] - r[i]![0]) * (r[j]![1] + r[i]![1]); return a / 2; };
const inside = ([x, y]: XY, r: XY[]) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!, [xj, yj] = r[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

export class MapScene extends WallScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, CAMERA_Z * 2);
  private readonly projection: GeoProjection;
  private readonly centre: XY;
  /** the whole world in scene units */
  private readonly world: Box;
  private readonly guestArcs: ArcLayer;
  private flights: (ArcInput & { until: number })[] = [];
  private readonly ro: ResizeObserver;
  private title?: { el: HTMLElement; bottomGap: number; limit?: () => number | null };
  /** the part of the world on screen now, and the part the view moves to */
  private view: Box;
  private target: Box;
  private readonly placeXY = new Map<string, XY>();
  private readonly density = new Map<string, number>();
  private readonly disposables: { dispose(): void }[] = [];

  constructor(private readonly el: HTMLElement, countries: CountryFeature[]) {
    super();
    const land = countries.filter(f => f.properties.iso2 !== 'AQ'); // nothing to light in Antarctica
    const collection = { type: 'FeatureCollection', features: land } as unknown as GeoPermissibleObjects;
    this.projection = geoNaturalEarth1().fitWidth(WIDTH, collection);
    const path = geoPath(this.projection);
    const [[bx0, by0], [bx1, by1]] = path.bounds(collection);
    this.centre = [(bx0 + bx1) / 2, (by0 + by1) / 2];
    const [wx0, wy1] = this.toScene([bx0, by0]), [wx1, wy0] = this.toScene([bx1, by1]);
    this.world = { x0: wx0, y0: wy0, x1: wx1, y1: wy1 };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(this.renderer.domElement);
    this.camera.position.set(0, 0, CAMERA_Z);

    this.drawOcean();
    this.drawCountries(path, land);

    const arcPath: ArcPath = (lat, lon, out) => {
      const [x0, y0] = this.lonLat(ORIGIN.lon, ORIGIN.lat), [x1, y1] = this.lonLat(lon, lat);
      const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
      let nx = -dy / d, ny = dx / d;
      if (ny < 0) { nx = -nx; ny = -ny; } // every arc bows northwards, like flight routes on a map
      const cx = (x0 + x1) / 2 + nx * d * 0.22, cy = (y0 + y1) / 2 + ny * d * 0.22;
      for (let i = 0; i <= ARC_SEGMENTS; i++) {
        const t = i / ARC_SEGMENTS, u = 1 - t;
        out[i]!.set(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1, Z.arcs);
      }
    };
    this.arcs = new ArcLayer(this.scene, this.renderer, arcPath);
    this.guestArcs = new ArcLayer(this.scene, this.renderer, arcPath, { ambient: false });
    const onMap = (z: number) => (lat: number, lon: number) => { const [x, y] = this.lonLat(lon, lat); return new THREE.Vector3(x, y, z); };
    const stars = { scene: this.scene, renderer: this.renderer, camera: () => this.camera, refDist: CAMERA_Z, sphere: false };
    this.coopStars = new StarLayer({ ...stars, place: onMap(Z.stars) });
    this.guestStars = new StarLayer({ ...stars, place: onMap(Z.guests) });
    this.coopStars.setRays(0.45); // hundreds of rays crossing over Europe read as one white blot
    this.guestStars.setRays(0.6);

    this.view = this.startBox();
    this.target = { ...this.view };
    this.ro = new ResizeObserver(() => { this.renderer.setSize(el.clientWidth, el.clientHeight); this.placeCamera(); });
    this.ro.observe(el);
    this.renderCoopStars();
    this.startLoop();
  }

  // ---------------------------------------------------------------- projection

  private toScene([px, py]: XY): XY { return [px - this.centre[0], this.centre[1] - py]; }

  private lonLat(lon: number, lat: number): XY { return this.toScene(this.projection([lon, lat]) ?? [0, 0]); }

  // ---------------------------------------------------------------- the map

  /**
   * The dark sea as a grid over the world, fading out towards its edges (the antimeridian, the far north and
   * south), so the map floats in the night instead of being cut out with a hard line.
   */
  private drawOcean(): void {
    const sea = new THREE.Color().setRGB(3 / 255, 10 / 255, 36 / 255, THREE.SRGBColorSpace);
    const smooth = (e0: number, e1: number, x: number) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
    const lons: number[] = [], lats: number[] = [];
    for (let lon = -180; lon <= 180; lon += 3) lons.push(Math.max(-179.999, Math.min(179.999, lon)));
    for (let lat = -64; lat <= 86; lat += 2.5) lats.push(lat);
    const positions: number[] = [], colors: number[] = [], index: number[] = [];
    for (const lat of lats) {
      for (const lon of lons) {
        const [x, y] = this.lonLat(lon, lat);
        const alpha = smooth(180, 166, Math.abs(lon)) * smooth(86, 70, lat) * smooth(-64, -50, lat);
        positions.push(x, y, Z.ocean);
        colors.push(sea.r, sea.g, sea.b, alpha);
      }
    }
    const row = lons.length;
    for (let j = 0; j < lats.length - 1; j++) {
      for (let i = 0; i < row - 1; i++) {
        const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
        index.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    g.setIndex(index);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const fill = new THREE.Mesh(g, material);
    this.scene.add(fill);
    this.disposables.push(g, material);
  }

  /** Country fills (own material each, shared with the colour fades in core.ts) and all outlines in one line mesh. */
  private drawCountries(path: ReturnType<typeof geoPath>, features: CountryFeature[]): void {
    const outline: number[] = [];
    for (const f of features) {
      const rs = rings(path, f as unknown as GeoPermissibleObjects).map(r => r.map(p => this.toScene(p)));
      if (!rs.length) continue;
      for (const r of rs) {
        for (let i = 0; i < r.length; i++) {
          const a = r[i]!, b = r[(i + 1) % r.length]!;
          outline.push(a[0], a[1], Z.borders, b[0], b[1], Z.borders);
        }
      }
      // holes turn the other way than the largest ring; each belongs to the outer ring around it
      const sign = Math.sign(area(rs.reduce((m, r) => (Math.abs(area(r)) > Math.abs(area(m)) ? r : m))));
      const outer = rs.filter(r => Math.sign(area(r)) === sign);
      const holes = rs.filter(r => Math.sign(area(r)) !== sign);
      const positions: number[] = [];
      const index: number[] = [];
      for (const o of outer) {
        const own = holes.filter(h => inside(h[0]!, o));
        const contour = o.map(([x, y]) => new THREE.Vector2(x, y));
        const hs = own.map(h => h.map(([x, y]) => new THREE.Vector2(x, y)));
        const base = positions.length / 3;
        const faces = THREE.ShapeUtils.triangulateShape(contour, hs); // may drop a repeated end point: positions after
        for (const v of [contour, ...hs].flat()) positions.push(v.x, v.y, Z.land);
        for (const tri of faces) index.push(base + tri[0]!, base + tri[1]!, base + tri[2]!);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setIndex(index);
      const mesh = new THREE.Mesh(g, this.countryMaterial(f.properties.iso2));
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      this.disposables.push(g);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#bed2ff', transparent: true, opacity: 0.22, depthWrite: false }));
    lines.renderOrder = 2;
    this.scene.add(lines);
    this.disposables.push(g, lines.material);
  }

  // ---------------------------------------------------------------- camera

  /** Košice and its surroundings: where the timeline begins. */
  private startBox(): Box {
    const [x, y] = this.lonLat(ORIGIN.lon, ORIGIN.lat);
    const w = (this.world.x1 - this.world.x0) * START_WIDTH;
    return { x0: x - w / 2, x1: x + w / 2, y0: y - w / 3, y1: y + w / 3 };
  }

  /** The screen area the map may use: below the title, above the bottom limit, inside the side gutters. */
  private area(): { x: number; y: number; w: number; h: number } {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const gutter = Math.max(16, Math.min(40, w * 0.03));
    const top = this.title ? this.title.el.getBoundingClientRect().bottom - this.el.getBoundingClientRect().top + 16 : 16;
    const limit = this.title?.limit?.();
    const bottom = Math.min(h - (this.title?.bottomGap ?? 16), limit != null ? limit - this.el.getBoundingClientRect().top : Infinity);
    return { x: gutter, y: top, w: Math.max(1, w - 2 * gutter), h: Math.max(1, bottom - top) };
  }

  /** Puts `this.view` into the screen area, as large as fits. */
  private placeCamera(): void {
    const a = this.area();
    const b = this.view;
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    const s = Math.min(a.w / bw, a.h / bh); // pixels per scene unit
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const cx = (b.x0 + b.x1) / 2 + w / (2 * s) - (a.x + a.w / 2) / s;
    const cy = (b.y0 + b.y1) / 2 - h / (2 * s) + (a.y + a.h / 2) / s;
    this.camera.left = -w / (2 * s); this.camera.right = w / (2 * s);
    this.camera.top = h / (2 * s); this.camera.bottom = -h / (2 * s);
    this.camera.position.set(cx, cy, CAMERA_Z);
    this.camera.updateProjectionMatrix();
    // the whole world shows Europe small: smaller stars and the dense ones dimmer; close up both as on the globe
    const zoom = (this.world.x1 - this.world.x0) / bw;
    const size = Math.min(1, 0.55 * Math.pow(zoom, 0.4));
    const dim = Math.min(1, Math.max(0, (2.5 - zoom) / 1.5));
    for (const layer of [this.coopStars, this.guestStars]) { layer?.setSizeScale(size); }
    this.coopStars?.setDimAmount(dim);
  }

  /**
   * While the light spreads the view holds Košice and every place whose beam is on its way (from a third of
   * the flight, so the view widens as the beam flies), with some room around them, and only ever widens;
   * afterwards it shows the whole world.
   */
  private follow(t: number, dt: number): void {
    let goal: Box = this.world;
    if (this.revealing()) {
      const [ox, oy] = this.lonLat(ORIGIN.lon, ORIGIN.lat);
      const g = { x0: ox, x1: ox, y0: oy, y1: oy }; // Košice and every place whose beam is a third of the way there
      for (const p of this.coop) {
        const time = this.timing.get(p.id);
        if (!time || time.launch + time.travel * 0.35 > t) continue;
        const [x, y] = this.placeXY.get(p.id) ?? this.lonLat(p.lon, p.lat);
        g.x0 = Math.min(g.x0, x); g.x1 = Math.max(g.x1, x); g.y0 = Math.min(g.y0, y); g.y1 = Math.max(g.y1, y);
      }
      const pad = Math.max(g.x1 - g.x0, g.y1 - g.y0) * PADDING;
      const lit = this.clamp({ x0: g.x0 - pad, x1: g.x1 + pad, y0: g.y0 - pad, y1: g.y1 + pad });
      // the view only widens: it holds what it has shown (at least the start around Košice) and the newly lit places
      this.target = { x0: Math.min(this.target.x0, lit.x0), x1: Math.max(this.target.x1, lit.x1), y0: Math.min(this.target.y0, lit.y0), y1: Math.max(this.target.y1, lit.y1) };
      goal = this.target;
    }
    const k = 1 - Math.exp(-dt / FOLLOW);
    const v = this.view;
    const next = { x0: v.x0 + (goal.x0 - v.x0) * k, x1: v.x1 + (goal.x1 - v.x1) * k, y0: v.y0 + (goal.y0 - v.y0) * k, y1: v.y1 + (goal.y1 - v.y1) * k };
    if (Math.abs(next.x0 - v.x0) + Math.abs(next.x1 - v.x1) + Math.abs(next.y0 - v.y0) + Math.abs(next.y1 - v.y1) > 1e-3) {
      this.view = next;
      this.placeCamera();
    }
  }

  /** Keeps a box inside the world (a box wider than the world is centred on it). */
  private clamp(b: Box): Box {
    const fit = (lo: number, hi: number, min: number, max: number): [number, number] => {
      const size = hi - lo;
      if (size >= max - min) return [min, max];
      if (lo < min) return [min, min + size];
      if (hi > max) return [max - size, max];
      return [lo, hi];
    };
    const [x0, x1] = fit(b.x0, b.x1, this.world.x0, this.world.x1);
    const [y0, y1] = fit(b.y0, b.y1, this.world.y0, this.world.y1);
    return { x0, x1, y0, y1 };
  }

  // ---------------------------------------------------------------- WallScene

  override setCooperation(places: GlobePlace[], options: { reveal?: boolean } = {}): void {
    this.placeXY.clear();
    for (const p of places) this.placeXY.set(p.id, this.lonLat(p.lon, p.lat));
    // how crowded each place is on the whole-world view: neighbours within about a star's width
    this.density.clear();
    const xy = places.map(p => this.placeXY.get(p.id)!);
    places.forEach((p, i) => {
      let near = 0;
      for (let j = 0; j < xy.length; j++) if (j !== i && Math.hypot(xy[j]![0] - xy[i]![0], xy[j]![1] - xy[i]![1]) < DENSE_RADIUS) near++;
      this.density.set(p.id, near);
    });
    if (options.reveal) {
      this.view = this.startBox();
      this.target = { ...this.view };
      this.placeCamera();
    }
    super.setCooperation(places, options);
  }

  protected override frameTick(now: number, dt: number): void {
    this.follow(now / 1000, dt);
    this.guestArcs.update(now / 1000, dt);
    if (this.flights.length && this.flights.some(f => f.until < now / 1000)) {
      this.flights = this.flights.filter(f => f.until >= now / 1000);
      this.guestArcs.set(this.flights);
    }
  }

  protected override frameEnd(): void {
    this.renderer.render(this.scene, this.camera);
  }

  protected arcWidth(p: GlobePlace): number { return 0.6 + Math.min(p.links, 12) * 0.11; }

  /** Short arcs (most of Europe) glow less after landing; the reach across the world stays bright. */
  protected override arcGlow(p: GlobePlace): number {
    const k = Math.min(1, Math.max(0, (p.distanceKm - 400) / 3100));
    return 0.2 + 0.8 * k * k * (3 - 2 * k);
  }

  /** Stars among many neighbours are dimmer on the whole-world view (they still flare when lit). */
  protected override starDim(p: GlobePlace): number {
    return Math.max(0.3, 1 / Math.sqrt(1 + (this.density.get(p.id) ?? 0) / 4));
  }

  /**
   * Cards dock like a lower third over the open southern ocean: south of 38° S between South America and
   * Australia no place lies (a guest light there narrows it). Null on phones and where it is too small.
   */
  override cardDock(): { top: number; bottom: number; left: number; right: number } | null {
    if (this.el.clientWidth <= 760) return null;
    let [west, east] = DOCK_LON;
    for (const p of [...this.visibleCoop(), ...this.guestPlaces()]) {
      if (p.lat > DOCK_LAT + 2 || p.lon < west || p.lon > east) continue;
      if (p.lon < (west + east) / 2) west = p.lon + 4; else east = p.lon - 4;
    }
    const rect = this.el.getBoundingClientRect();
    // a meridian bends towards the middle further south, so the coasts are nearest at the dock's top
    const top = this.screenPoint(DOCK_LAT, (west + east) / 2).y + 6;
    const bottom = rect.bottom - 8;
    const left = Math.max(rect.left + 16, this.screenPoint(DOCK_LAT, west).x);
    const right = Math.min(rect.right - 16, this.screenPoint(DOCK_LAT, east).x);
    return bottom - top >= 44 && right - left >= 320 ? { top, bottom, left, right } : null;
  }

  /** Cards never cover the map: where no dock fits, the place only gets a name tag. */
  override cardsFloat(): boolean { return false; }

  protected launchGuest(pin: GuestArrival): void {
    const t = seconds();
    this.flights.push({ lat: pin.lat, lon: pin.lon, color: GUEST_COLOR, width: 2.2, launch: t, travel: GUEST_LANDING, until: t + GUEST_LANDING * 1.4 });
    this.guestArcs.set(this.flights);
  }

  screenPoint(lat: number, lon: number): { x: number; y: number; facing: number } {
    const [x, y] = this.lonLat(lon, lat);
    const p = new THREE.Vector3(x, y, Z.stars).project(this.camera);
    const rect = this.el.getBoundingClientRect();
    const inView = Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, facing: inView ? 1 : -1 };
  }

  facing(lat: number, lon: number): number { return this.screenPoint(lat, lon).facing; }

  /** The map as a circle around its middle (a flat map has no free space at its sides: cards sit on it). */
  disc(): { x: number; y: number; r: number } {
    const rect = this.el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: rect.width / 2 };
  }

  turnWhileFocused(): number { return 0; } // the map does not turn
  setFocus(): void {}
  setAutoRotate(): void {}

  attachTitle(el: HTMLElement, { bottomGap = 24, bottom }: { bottomGap?: number; bottom?: () => number | null } = {}): void {
    this.title = { el, bottomGap, limit: bottom };
    el.style.opacity = '1';
    this.placeCamera();
  }

  override dispose(): void {
    super.dispose();
    this.ro.disconnect();
    this.guestArcs.dispose();
    for (const d of this.disposables) d.dispose();
    for (const o of this.scene.children) if (o instanceof THREE.Mesh) o.geometry.dispose();
    this.renderer.dispose();
    this.el.replaceChildren();
  }
}
