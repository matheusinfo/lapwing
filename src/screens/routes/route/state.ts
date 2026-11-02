import type { Coord, LngLat } from '../../../types';

/**
 * - `routed`: asked from the routing server; ends up as the path, or as a
 *   straight line when the path is almost the same
 * - `straight`: a straight line forced by the user (right-click on the line)
 * - `imported`: geometry from an opened GPX file, kept exactly as it was
 */
export type SegmentKind = 'routed' | 'straight' | 'imported';

/**
 * - `ready`: coords are final
 * - `pending`: waiting for the routing server; coords are a straight placeholder
 * - `failed`: routing failed; coords are a straight-line fallback
 */
export type SegmentStatus = 'ready' | 'pending' | 'failed';

/** The path between two consecutive waypoints. */
export interface Segment {
  from: LngLat;
  to: LngLat;
  kind: SegmentKind;
  status: SegmentStatus;
  coords: Coord[];
}

interface Snapshot {
  waypoints: LngLat[];
  segments: Segment[];
}

const MAX_HISTORY = 100;

/**
 * The route being edited: `segments[i]` connects `waypoints[i]` and
 * `waypoints[i + 1]`.
 *
 * Segment objects are shared between the current state and undo history.
 * When a routing request finishes, the routing queue updates the segment in
 * place, so undo and redo never bring back a stale placeholder.
 */
export class RouteState {
  waypoints: LngLat[] = [];
  segments: Segment[] = [];

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Saves the current state for undo, applies `mutate`, then notifies listeners. */
  change(mutate: () => void): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    mutate();
    this.emit();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  /** Replaces the route without recording history (used when restoring a saved route). */
  load(waypoints: LngLat[], segments: Segment[]): void {
    this.waypoints = waypoints;
    this.segments = segments;
    this.emit();
  }

  /** The whole route as one list of points, without repeated points at the joins. */
  track(): Coord[] {
    const out: Coord[] = [];
    for (const seg of this.segments) {
      for (const c of seg.coords) {
        const last = out[out.length - 1];
        if (last && last[0] === c[0] && last[1] === c[1]) continue;
        out.push(c);
      }
    }
    return out;
  }

  private snapshot(): Snapshot {
    // Arrays are copied; waypoint tuples and segment objects are never
    // replaced in place by edits, so they can be shared.
    return { waypoints: [...this.waypoints], segments: [...this.segments] };
  }

  private restore(s: Snapshot): void {
    this.waypoints = s.waypoints;
    this.segments = s.segments;
    this.emit();
  }
}
