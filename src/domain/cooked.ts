// "Last cooked" helpers (T46). Pure; dates are local calendar days `YYYY-MM-DD` so two devices that
// both mark a recipe as cooked on the same day write the identical value (no sync conflict).

import type { Rating, Recipe } from './types';

export const RATINGS: readonly Rating[] = [1, 2, 3, 4, 5];

export function isRating(x: unknown): x is Rating {
  return typeof x === 'number' && (RATINGS as readonly number[]).includes(x);
}

/** Local calendar date of `now` as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function dayNumber(iso: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return undefined;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

export type CookedAgo =
  | { unit: 'today' }
  | { unit: 'yesterday' }
  | { unit: 'days' | 'weeks' | 'months' | 'years'; count: number };

/** Coarse "how long ago" for `lastCookedAt`; undefined when the value is missing/unparseable. Future dates = today. */
export function cookedAgo(lastCookedAt: string | undefined, now: Date = new Date()): CookedAgo | undefined {
  if (!lastCookedAt) return undefined;
  const then = dayNumber(lastCookedAt);
  const today = dayNumber(todayIso(now));
  if (then === undefined || today === undefined) return undefined;
  const days = today - then;
  if (days <= 0) return { unit: 'today' };
  if (days === 1) return { unit: 'yesterday' };
  if (days < 14) return { unit: 'days', count: days };
  if (days < 60) return { unit: 'weeks', count: Math.floor(days / 7) };
  if (days < 365) return { unit: 'months', count: Math.floor(days / 30) };
  return { unit: 'years', count: Math.floor(days / 365) };
}

/** Fields of a recipe that the edit form does not own and must carry over unchanged when saving. */
export function recipeFlags(
  r: Pick<Recipe, 'favourite' | 'rating' | 'lastCookedAt'>,
): Pick<Recipe, 'favourite' | 'rating' | 'lastCookedAt'> {
  const out: Pick<Recipe, 'favourite' | 'rating' | 'lastCookedAt'> = {};
  if (r.favourite) out.favourite = true;
  if (r.rating !== undefined) out.rating = r.rating;
  if (r.lastCookedAt) out.lastCookedAt = r.lastCookedAt;
  return out;
}
