import * as maplibregl from 'maplibre-gl';
import type { Coord, LngLat } from '../../../types';
import { nearestOnSegments, type NearestHit } from '../../../geo';
import { ROUTE_HIT_LAYER, setRouteData } from '../map';
import type { RouteState, Segment } from './state';

const LONG_PRESS_MS = 600;

const same = (a: LngLat | Coord, b: LngLat | Coord) => a[0] === b[0] && a[1] === b[1];
const withEle = (p: LngLat, ele: number | undefined): Coord =>
  ele === undefined ? [p[0], p[1]] : [p[0], p[1], ele];
const toLngLat = (c: Coord | maplibregl.LngLat): LngLat =>
  Array.isArray(c) ? [c[0], c[1]] : [c.lng, c.lat];

/** Handles map clicks and waypoint markers, and turns them into route edits. */
export class RouteEditor {
  private markers: maplibregl.Marker[] = [];

  constructor(
    private map: maplibregl.Map,
    private state: RouteState,
  ) {
    map.on('click', (e) => {
      // Clicks on markers bubble up to the map; ignore them.
      const target = e.originalEvent.target;
      if (target instanceof Element && target.closest('.maplibregl-marker')) return;

      const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
      const onRoute =
        this.state.segments.length > 0 &&
        map.queryRenderedFeatures(e.point, { layers: [ROUTE_HIT_LAYER] }).length > 0;
      const hit = onRoute ? nearestOnSegments(this.state.segments, p) : null;
      if (hit) this.insertAt(hit);
      else this.addPoint(p);
    });

    // Right-click on the line (long-press on most touch screens) switches a
    // segment between following paths and a forced straight line, e.g. for
    // a running track or open ground.
    map.on('contextmenu', (e) => {
      const target = e.originalEvent.target;
      if (target instanceof Element && target.closest('.maplibregl-marker')) return;
      const feature = map.queryRenderedFeatures(e.point, { layers: [ROUTE_HIT_LAYER] })[0];
      const index = Number(feature?.properties?.index);
      if (!Number.isInteger(index)) return;
      e.preventDefault();
      this.toggleStraight(index);
    });

    const container = map.getCanvasContainer();
    map.on('mouseenter', ROUTE_HIT_LAYER, () => container.classList.add('over-route'));
    map.on('mouseleave', ROUTE_HIT_LAYER, () => container.classList.remove('over-route'));
  }

  /** Redraws the line and the waypoint markers from the current state. */
  render(): void {
    setRouteData(this.map, this.state.segments);
    this.syncMarkers();
  }

  // ---- Edits (each one is a single undo step) ----

  addPoint(p: LngLat): void {
    const s = this.state;
    s.change(() => {
      const last = s.waypoints[s.waypoints.length - 1];
      if (last) s.segments.push(this.newSegment(last, p));
      s.waypoints.push(p);
    });
  }

  moveWaypoint(i: number, p: LngLat): void {
    const s = this.state;
    if (!s.waypoints[i] || same(s.waypoints[i], p)) {
      this.render(); // Undo the drag preview.
      return;
    }
    // In a closed loop the start and finish share one marker; move both.
    const last = s.waypoints.length - 1;
    const moved = this.isLoop() && i === 0 ? [0, last] : [i];
    s.change(() => {
      for (const j of moved) {
        s.waypoints[j] = p;
        if (j > 0) s.segments[j - 1] = this.rebuild(s.segments[j - 1], s.waypoints[j - 1], p);
        if (j < s.segments.length) s.segments[j] = this.rebuild(s.segments[j], p, s.waypoints[j + 1]);
      }
    });
  }

  deleteWaypoint(i: number): void {
    const s = this.state;
    const n = s.waypoints.length;
    if (i < 0 || i >= n) return;
    s.change(() => {
      if (n === 1) {
        s.waypoints = [];
        s.segments = [];
      } else if (i === 0) {
        s.waypoints.shift();
        s.segments.shift();
      } else if (i === n - 1) {
        s.waypoints.pop();
        s.segments.pop();
      } else {
        const joined = this.newSegment(s.waypoints[i - 1], s.waypoints[i + 1]);
        s.waypoints.splice(i, 1);
        s.segments.splice(i - 1, 2, joined);
      }
    });
  }

  /** Adds a waypoint on the line itself, splitting the segment without re-routing it. */
  insertAt(hit: NearestHit): void {
    const s = this.state;
    const seg = s.segments[hit.segIndex];
    const p = toLngLat(hit.point);
    const first: Segment = {
      ...seg,
      to: p,
      coords: [...seg.coords.slice(0, hit.edgeIndex + 1), hit.point],
    };
    const second: Segment = {
      ...seg,
      from: p,
      coords: [hit.point, ...seg.coords.slice(hit.edgeIndex + 1)],
    };
    s.change(() => {
      s.waypoints.splice(hit.segIndex + 1, 0, p);
      s.segments.splice(hit.segIndex, 1, first, second);
    });
  }

  /** Switches segment `i` between a forced straight line and a routed path. */
  toggleStraight(i: number): void {
    const s = this.state;
    const seg = s.segments[i];
    if (!seg) return;
    const next: Segment =
      seg.kind === 'straight'
        ? { from: seg.from, to: seg.to, kind: 'routed', status: 'pending', coords: [seg.from, seg.to] }
        : {
            from: seg.from,
            to: seg.to,
            kind: 'straight',
            status: 'ready',
            coords: [withEle(seg.from, seg.coords[0]?.[2]), withEle(seg.to, seg.coords[seg.coords.length - 1]?.[2])],
          };
    s.change(() => {
      s.segments[i] = next;
    });
  }

  /** Adds a final segment back to the start point. */
  closeLoop(): void {
    const wps = this.state.waypoints;
    if (wps.length < 2 || this.isLoop()) return;
    this.addPoint(wps[0]);
  }

  isLoop(): boolean {
    const wps = this.state.waypoints;
    return wps.length > 2 && same(wps[0], wps[wps.length - 1]);
  }

  reverse(): void {
    const s = this.state;
    if (s.waypoints.length < 2) return;
    s.change(() => {
      s.waypoints = [...s.waypoints].reverse();
      s.segments = [...s.segments].reverse().map((seg) => ({
        ...seg,
        from: seg.to,
        to: seg.from,
        coords: [...seg.coords].reverse(),
      }));
    });
  }

  clear(): void {
    const s = this.state;
    if (!s.waypoints.length) return;
    s.change(() => {
      s.waypoints = [];
      s.segments = [];
    });
  }

  /** Replaces the route with an imported track, keeping its exact shape. */
  loadTrack(coords: Coord[]): void {
    const s = this.state;
    const from = toLngLat(coords[0]);
    const to = toLngLat(coords[coords.length - 1]);
    s.change(() => {
      s.waypoints = [from, to];
      s.segments = [{ from, to, kind: 'imported', status: 'ready', coords }];
    });
  }

  // ---- Helpers ----

  /**
   * Every new segment asks the router; the routing queue then keeps the
   * straight line when the path is almost the same (see `chooseGeometry`).
   */
  private newSegment(a: LngLat, b: LngLat): Segment {
    return { from: a, to: b, kind: 'routed', status: 'pending', coords: [a, b] };
  }

  /**
   * New segment between moved endpoints. Forced straight segments stay
   * straight; routed and imported ones are routed again.
   */
  private rebuild(old: Segment, a: LngLat, b: LngLat): Segment {
    if (old.kind === 'straight') return { from: a, to: b, kind: 'straight', status: 'ready', coords: [a, b] };
    if (old.kind === 'routed') return { from: a, to: b, kind: 'routed', status: 'pending', coords: [a, b] };
    return this.newSegment(a, b);
  }

  /** While a marker is dragged, show dashed straight lines to its neighbours. */
  private previewMove(i: number, p: LngLat): void {
    const { waypoints, segments } = this.state;
    const preview = [...segments];
    const dashed = (a: LngLat, b: LngLat): Segment => ({
      from: a, to: b, kind: 'straight', status: 'pending', coords: [a, b],
    });
    const moved = this.isLoop() && i === 0 ? [0, waypoints.length - 1] : [i];
    for (const j of moved) {
      if (j > 0) preview[j - 1] = dashed(waypoints[j - 1], p);
      if (j < segments.length) preview[j] = dashed(p, waypoints[j + 1]);
    }
    setRouteData(this.map, preview);
  }

  private syncMarkers(): void {
    const wps = this.state.waypoints;
    while (this.markers.length > wps.length) this.markers.pop()!.remove();
    while (this.markers.length < wps.length) this.markers.push(this.createMarker());

    const last = wps.length - 1;
    const loop = this.isLoop();
    wps.forEach((wp, i) => {
      const marker = this.markers[i];
      marker.setLngLat(wp);
      const el = marker.getElement();
      el.dataset.index = String(i);
      el.classList.toggle('wp-start', i === 0);
      el.classList.toggle('wp-end', i === last && last > 0);
      // A closed loop shows one start/finish marker instead of two stacked ones.
      el.classList.toggle('wp-loop', loop && i === 0);
      el.classList.toggle('wp-hidden', loop && i === last);
    });
  }

  private createMarker(): maplibregl.Marker {
    const el = document.createElement('div');
    el.className = 'wp';
    const marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat([0, 0])
      .addTo(this.map);
    const index = () => Number(el.dataset.index);

    marker.on('drag', () => this.previewMove(index(), toLngLat(marker.getLngLat())));
    marker.on('dragend', () => this.moveWaypoint(index(), toLngLat(marker.getLngLat())));

    // Delete: right-click with a mouse, long-press on touch screens. Some
    // mobile browsers also fire `contextmenu` on long-press, so ignore a
    // second delete from the same press.
    let lastDelete = 0;
    const remove = () => {
      const now = Date.now();
      if (now - lastDelete < 1000) return;
      lastDelete = now;
      this.deleteWaypoint(index());
    };
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      remove();
    });
    let pressTimer: number | undefined;
    const cancelPress = () => window.clearTimeout(pressTimer);
    el.addEventListener(
      'touchstart',
      () => {
        cancelPress();
        pressTimer = window.setTimeout(remove, LONG_PRESS_MS);
      },
      { passive: true },
    );
    el.addEventListener('touchmove', cancelPress, { passive: true });
    el.addEventListener('touchend', cancelPress);
    el.addEventListener('touchcancel', cancelPress);

    return marker;
  }
}
