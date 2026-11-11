import { recipes } from '../../db';
import { recipeFlags, todayIso } from '../../domain/cooked';
import type { Rating, Recipe } from '../../domain/types';

export { recipeFlags };

export interface FlagPatch {
  favourite?: boolean;
  /** `null` clears the rating. */
  rating?: Rating | null;
  lastCookedAt?: string;
}

/**
 * Updates favourite / rating / lastCookedAt on the *stored* record (re-read, so a concurrent change
 * to other fields is not overwritten). Unset values are removed from the record, not stored as
 * false/undefined, so the same state always has the same JSON on every device.
 */
export async function updateFlags(id: string, patch: FlagPatch): Promise<Recipe | undefined> {
  const cur = await recipes.get(id);
  if (!cur) return undefined;
  const { favourite: _f, rating: _r, lastCookedAt: _l, ...rest } = cur;
  void _f;
  void _r;
  void _l;
  const flags = recipeFlags(cur);
  if (patch.favourite !== undefined) {
    if (patch.favourite) flags.favourite = true;
    else delete flags.favourite;
  }
  if (patch.rating !== undefined) {
    if (patch.rating === null) delete flags.rating;
    else flags.rating = patch.rating;
  }
  if (patch.lastCookedAt !== undefined) flags.lastCookedAt = patch.lastCookedAt;
  return recipes.save({ ...rest, ...flags });
}

export function markCookedToday(id: string): Promise<Recipe | undefined> {
  return updateFlags(id, { lastCookedAt: todayIso() });
}
