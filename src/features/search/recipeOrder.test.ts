import { filterFavourites, sortRecipes } from './recipeOrder';

const list = [
  { id: 'a', favourite: true, rating: 3 as const, lastCookedAt: '2026-10-01' },
  { id: 'b', rating: 5 as const },
  { id: 'c', favourite: false, lastCookedAt: '2026-11-05' },
  { id: 'd', favourite: true, rating: 5 as const, lastCookedAt: '2026-09-01' },
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('recipe filter / sort', () => {
  it('filters favourites only when asked', () => {
    expect(ids(filterFavourites(list, true))).toEqual(['a', 'd']);
    expect(filterFavourites(list, false)).toBe(list);
  });

  it('sorts by last cooked, newest first, never cooked last', () => {
    expect(ids(sortRecipes(list, 'lastCooked'))).toEqual(['c', 'a', 'd', 'b']);
  });

  it('sorts by rating, best first, unrated last, ties keep order', () => {
    expect(ids(sortRecipes(list, 'rating'))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('default keeps the order and never mutates the input', () => {
    expect(ids(sortRecipes(list, 'default'))).toEqual(['a', 'b', 'c', 'd']);
    sortRecipes(list, 'rating');
    expect(ids(list)).toEqual(['a', 'b', 'c', 'd']);
  });
});
