/**
 * The plan chosen on the Training screen, remembered in localStorage. The
 * Today screen reads it too, so both show the same plan.
 */
import type { TrainingPlan } from './types';

export const ACTIVE_PLAN_KEY = 'lapwing:training:active-plan';

export function loadActivePlan(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PLAN_KEY);
  } catch {
    return null;
  }
}

export function saveActivePlan(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PLAN_KEY, id);
  } catch {
    // Not important.
  }
}

/** The remembered plan, or the first one when it is gone (or none was chosen). */
export function pickActivePlan<T extends Pick<TrainingPlan, 'id'>>(plans: T[], id: string | null): T | undefined {
  return plans.find((p) => p.id === id) ?? plans[0];
}
