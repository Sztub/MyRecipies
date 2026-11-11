import type { Recipe } from '../../domain/types';

export type RecipeSort = 'default' | 'lastCooked' | 'rating';
export const RECIPE_SORTS: readonly RecipeSort[] = ['default', 'lastCooked', 'rating'];

/** Keeps only favourites when `onlyFavourites` is set. */
export function filterFavourites<T extends Pick<Recipe, 'favourite'>>(
  list: T[],
  onlyFavourites: boolean,
): T[] {
  return onlyFavourites ? list.filter((r) => r.favourite === true) : list;
}

/**
 * Returns a sorted copy. `lastCooked`: most recent first, never cooked last. `rating`: best first,
 * unrated last. Ties keep the incoming order (the repository already sorts by title), so
 * `default` returns the list unchanged.
 */
export function sortRecipes<T extends Pick<Recipe, 'rating' | 'lastCookedAt'>>(
  list: T[],
  sort: RecipeSort,
): T[] {
  const out = [...list];
  if (sort === 'lastCooked') {
    out.sort((a, b) => (b.lastCookedAt ?? '').localeCompare(a.lastCookedAt ?? ''));
  } else if (sort === 'rating') {
    out.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  }
  return out;
}
