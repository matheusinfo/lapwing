/**
 * Shared data model for imported runs. Owned by the app core: screens read
 * these types but should not change them.
 */

/** One recorded point of an activity. */
export interface TrackPoint {
  lat: number;
  lon: number;
  /** Elevation in metres. */
  ele?: number;
  /** Timestamp in milliseconds since the epoch. */
  time?: number;
  /** Heart rate in beats per minute. */
  hr?: number;
  /**
   * Running cadence in steps per minute (both feet). GPX files from Strava
   * and Garmin store strides per minute (one foot); the parser doubles it.
   */
  cad?: number;
  /** Temperature in °C. */
  temp?: number;
  /** Power in watts. */
  power?: number;
}

export type ActivityType = 'run' | 'trail-run' | 'walk' | 'other';

export interface ActivitySummary {
  /** Metres. */
  distance: number;
  /** Seconds from the first to the last point. */
  elapsedTime: number;
  /** Seconds spent moving (stops removed). Equals elapsedTime when there are no timestamps. */
  movingTime: number;
  /** Seconds per km over moving time; undefined without timestamps. */
  avgPace?: number;
  /** Fastest 1 km rolling pace in seconds per km. */
  bestPace?: number;
  elevationGain: number;
  elevationLoss: number;
  minEle?: number;
  maxEle?: number;
  avgHr?: number;
  maxHr?: number;
  /** Steps per minute. */
  avgCadence?: number;
  maxCadence?: number;
  avgTemp?: number;
  avgPower?: number;
  maxPower?: number;
  /** Which optional streams the file contains. */
  has: { time: boolean; ele: boolean; hr: boolean; cad: boolean; temp: boolean; power: boolean };
  /** [[west, south], [east, north]]. */
  bounds: [[number, number], [number, number]];
}

/** An imported run, without its points (those live in the `tracks` store). */
export interface Activity {
  id: string;
  name: string;
  type: ActivityType;
  /** Start time in ms since the epoch (first timestamp, or import time if the file has none). */
  startTime: number;
  /** Whether startTime came from the file. */
  hasStartTime: boolean;
  fileName: string;
  importedAt: number;
  summary: ActivitySummary;
  notes?: string;
  /** Effort from 1 (very easy) to 10 (maximal), entered by the user. */
  rpe?: number;
  /** Shoe worn (id in the `shoes` store). */
  shoeId?: string;
  /** Where the activity came from. Missing means a GPX import. */
  source?: 'gpx' | 'strava';
  /** Strava activity id, for activities synced from Strava (used to skip duplicates). */
  stravaId?: number;
}

/** A pair of running shoes (store `shoes`). */
export interface Shoe {
  id: string;
  name: string;
  brand?: string;
  model?: string;
  /** Distance in metres already on the shoe before it was added to the app. */
  startDistance: number;
  /** Distance in metres at which the shoe should be retired. */
  retireDistance: number;
  /** Assigned automatically to newly imported runs. At most one shoe has it. */
  isDefault?: boolean;
  /** Epoch ms when the shoe was retired; missing while it is in use. */
  retiredAt?: number;
  notes?: string;
  createdAt: number;
}

/** Athlete profile used for heart-rate zones and estimates. */
export interface AthleteSettings {
  maxHr: number;
  restingHr: number;
  /**
   * Upper bound of zones 1–4 as a fraction of max HR; zone 5 is everything
   * above the last bound.
   */
  hrZoneBounds: [number, number, number, number];
  /** Kilograms, optional. */
  weight?: number;
}

export const DEFAULT_SETTINGS: AthleteSettings = {
  maxHr: 190,
  restingHr: 60,
  hrZoneBounds: [0.6, 0.7, 0.8, 0.9],
};
