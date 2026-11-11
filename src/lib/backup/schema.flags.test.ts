import { parseBundle, recipeSchema } from './schema';

const rec = {
  id: 'r1',
  createdAt: 'x',
  updatedAt: 'x',
  deviceId: 'd',
  rev: 1,
  title: 'T',
  tagIds: [],
  ingredients: [],
  steps: [],
  photoHashes: [],
};
const bundle = (recipes: unknown[]) => ({
  format: 'recipes-backup',
  version: 1,
  createdAt: 'x',
  deviceId: 'd',
  appVersion: '1',
  recipes,
  categories: [],
  tags: [],
  photos: [],
});

describe('recipe schema: favourite / rating / lastCookedAt', () => {
  it('old bundles without the fields still parse', () => {
    const b = parseBundle(bundle([rec]));
    expect(b.recipes[0]).not.toHaveProperty('favourite');
  });

  it('keeps the new fields on a round-trip', () => {
    const full = { ...rec, favourite: true, rating: 5, lastCookedAt: '2026-11-01' };
    expect(parseBundle(JSON.parse(JSON.stringify(bundle([full])))).recipes[0]).toMatchObject(full);
  });

  it('rejects out-of-range ratings and non-boolean favourites', () => {
    expect(recipeSchema.safeParse({ ...rec, rating: 6 }).success).toBe(false);
    expect(recipeSchema.safeParse({ ...rec, rating: 0 }).success).toBe(false);
    expect(recipeSchema.safeParse({ ...rec, favourite: 'yes' }).success).toBe(false);
  });
});
